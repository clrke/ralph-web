import { spawn } from 'child_process';
import type { Plan, UserPreferences } from '@claude-code-web/shared';
import type { ParsedDecision } from './OutputParser';
import { buildDecisionValidationPrompt } from '../prompts/validationPrompts';

/**
 * Actions Haiku can take on a decision
 */
export type ValidationAction = 'pass' | 'filter' | 'repurpose';

/**
 * Result of validating a single decision
 */
export interface ValidationResult {
  decision: ParsedDecision;
  action: ValidationAction;
  reason: string;
  /** Repurposed questions (only present when action === 'repurpose') */
  repurposedQuestions?: ParsedDecision[];
  validatedAt: string;
  durationMs: number;
  /** Raw prompt sent to Haiku (for conversation logging) */
  prompt: string;
  /** Raw output from Haiku (for conversation logging) */
  output: string;
}

/**
 * Aggregate log of all validations in a batch
 */
export interface ValidationLog {
  timestamp: string;
  totalDecisions: number;
  passedCount: number;
  filteredCount: number;
  repurposedCount: number;
  results: ValidationResult[];
}

// Per-decision timeout - give Haiku time to explore codebase thoroughly (3 minutes)
const VALIDATION_TIMEOUT_MS = 180_000;

/**
 * DecisionValidator uses Haiku to verify [DECISION_NEEDED] markers
 * before presenting them to users.
 *
 * Actions:
 * - pass: Valid concern, show to user as-is
 * - filter: False positive, remove entirely
 * - repurpose: Semi-valid, transform into better question(s)
 *
 * Conservative approach: accept (pass) on timeout/error
 */
export class DecisionValidator {
  /**
   * Validate a single decision using Haiku.
   * Returns validation result with action and optional repurposed questions.
   */
  async validateDecision(
    decision: ParsedDecision,
    plan: Plan,
    projectPath: string,
    preferences?: UserPreferences
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    const prompt = buildDecisionValidationPrompt(decision, plan, preferences);

    return new Promise((resolve) => {
      const childProcess = spawn('claude', [
        '--print',
        '--output-format', 'json',
        '--model', 'haiku',
        // Give Haiku read-only tools to inspect codebase
        '--allowedTools', 'Read,Glob,Grep,WebFetch,WebSearch',
        '-p', prompt,
      ], {
        cwd: projectPath,
        env: { ...globalThis.process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      const timeoutId = setTimeout(() => {
        childProcess.kill();
        console.log(`  Validation timed out: "${decision.questionText.substring(0, 50)}..."`);
        // Conservative: pass on timeout
        resolve({
          decision,
          action: 'pass',
          reason: 'Validation timed out - passing conservatively',
          validatedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          prompt,
          output: stdout,
        });
      }, VALIDATION_TIMEOUT_MS);

      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        if (code !== 0) {
          console.log(`  Haiku validation failed (code ${code})`);
          // Conservative: pass on error
          resolve({
            decision,
            action: 'pass',
            reason: `Validation process failed (code ${code}) - passing conservatively`,
            validatedAt: new Date().toISOString(),
            durationMs,
            prompt,
            output: stdout,
          });
          return;
        }

        try {
          // Parse Claude's JSON output wrapper
          const claudeOutput = JSON.parse(stdout);
          const result = claudeOutput.result || '';

          // Extract JSON from result (Haiku may include extra text)
          // Match action-based format: { "action": "...", "reason": "..." }
          const jsonMatch = result.match(/\{[\s\S]*?"action"[\s\S]*?"reason"[\s\S]*?\}/);
          if (!jsonMatch) {
            // Try legacy format for backwards compatibility
            const legacyMatch = result.match(/\{[\s\S]*?"valid"[\s\S]*?"reason"[\s\S]*?\}/);
            if (legacyMatch) {
              const legacy = JSON.parse(legacyMatch[0]);
              resolve({
                decision,
                action: legacy.valid ? 'pass' : 'filter',
                reason: String(legacy.reason || 'No reason provided'),
                validatedAt: new Date().toISOString(),
                durationMs,
                prompt,
                output: stdout,
              });
              return;
            }

            console.log('  No valid JSON found in Haiku response');
            resolve({
              decision,
              action: 'pass',
              reason: 'Could not parse validation response - passing conservatively',
              validatedAt: new Date().toISOString(),
              durationMs,
              prompt,
              output: stdout,
            });
            return;
          }

          // Parse the full response to get repurposed questions if present
          const validation = this.parseValidationResponse(result, jsonMatch[0]);

          resolve({
            decision,
            action: validation.action,
            reason: validation.reason,
            repurposedQuestions: validation.questions,
            validatedAt: new Date().toISOString(),
            durationMs,
            prompt,
            output: stdout,
          });
        } catch (error) {
          console.log('  Failed to parse Haiku validation response:', error);
          // Conservative: pass on parse error
          resolve({
            decision,
            action: 'pass',
            reason: 'Failed to parse validation response - passing conservatively',
            validatedAt: new Date().toISOString(),
            durationMs,
            prompt,
            output: stdout,
          });
        }
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        console.log('  Haiku spawn error:', error.message);
        // Conservative: pass on spawn error
        resolve({
          decision,
          action: 'pass',
          reason: `Validation spawn error: ${error.message} - passing conservatively`,
          validatedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          prompt,
          output: stdout,
        });
      });
    });
  }

  /**
   * Extract a complete JSON object from a string, properly handling nested braces.
   */
  private extractCompleteJson(str: string, startIndex: number): string | null {
    if (str[startIndex] !== '{') return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < str.length; i++) {
      const char = str[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          return str.substring(startIndex, i + 1);
        }
      }
    }

    return null;
  }

  /**
   * Parse validation response, handling repurpose with nested questions.
   */
  private parseValidationResponse(
    fullResult: string,
    jsonStart: string
  ): { action: ValidationAction; reason: string; questions?: ParsedDecision[] } {
    // For repurpose, find the JSON object containing "action": "repurpose"
    const repurposeIndex = fullResult.indexOf('"action"');
    if (repurposeIndex >= 0) {
      // Find the start of the containing object
      let objectStart = repurposeIndex;
      while (objectStart > 0 && fullResult[objectStart] !== '{') {
        objectStart--;
      }

      if (fullResult[objectStart] === '{') {
        const completeJson = this.extractCompleteJson(fullResult, objectStart);
        if (completeJson) {
          try {
            const parsed = JSON.parse(completeJson);

            if (parsed.action === 'repurpose' && parsed.questions) {
              const questions: ParsedDecision[] = (parsed.questions || []).map((q: {
                questionText?: string;
                category?: string;
                priority?: number;
                options?: Array<{ label: string; recommended?: boolean; description?: string }>;
              }) => ({
                questionText: q.questionText || '',
                category: q.category || 'technical',
                priority: q.priority || 2,
                options: (q.options || []).map((o) => ({
                  label: o.label,
                  recommended: Boolean(o.recommended),
                  description: o.description,
                })),
              }));

              return {
                action: 'repurpose',
                reason: parsed.reason || 'Question repurposed',
                questions: questions.length > 0 ? questions : undefined,
              };
            }

            // Handle pass/filter
            if (parsed.action === 'pass' || parsed.action === 'filter') {
              return {
                action: parsed.action,
                reason: parsed.reason || 'No reason provided',
              };
            }
          } catch {
            // Fall through to simple parsing
          }
        }
      }
    }

    // Simple parsing fallback
    try {
      const simple = JSON.parse(jsonStart);
      const action = simple.action as ValidationAction;
      if (action === 'pass' || action === 'filter' || action === 'repurpose') {
        return {
          action,
          reason: simple.reason || 'No reason provided',
        };
      }
    } catch {
      // Fall through
    }

    // Default to pass
    return { action: 'pass', reason: 'Could not determine action - passing conservatively' };
  }

  /**
   * Validate multiple decisions in parallel.
   * Returns processed decisions (passed + repurposed) plus a log of all results.
   */
  async validateDecisions(
    decisions: ParsedDecision[],
    plan: Plan,
    projectPath: string,
    preferences?: UserPreferences
  ): Promise<{
    validDecisions: ParsedDecision[];
    log: ValidationLog;
  }> {
    if (decisions.length === 0) {
      return {
        validDecisions: [],
        log: {
          timestamp: new Date().toISOString(),
          totalDecisions: 0,
          passedCount: 0,
          filteredCount: 0,
          repurposedCount: 0,
          results: [],
        },
      };
    }

    console.log(`Validating ${decisions.length} decision(s) with Haiku...`);
    const batchStartTime = Date.now();

    // Validate all decisions in parallel
    const results = await Promise.all(
      decisions.map(d => this.validateDecision(d, plan, projectPath, preferences))
    );

    // Collect results by action
    const passedDecisions: ParsedDecision[] = [];
    const repurposedDecisions: ParsedDecision[] = [];
    let filteredCount = 0;
    let repurposedCount = 0;

    for (const result of results) {
      switch (result.action) {
        case 'pass':
          passedDecisions.push(result.decision);
          break;
        case 'filter':
          filteredCount++;
          console.log(`  FILTERED: "${result.decision.questionText.substring(0, 60)}..."`);
          console.log(`    Reason: ${result.reason}`);
          break;
        case 'repurpose':
          repurposedCount++;
          if (result.repurposedQuestions && result.repurposedQuestions.length > 0) {
            repurposedDecisions.push(...result.repurposedQuestions);
            console.log(`  REPURPOSED: "${result.decision.questionText.substring(0, 60)}..."`);
            console.log(`    Reason: ${result.reason}`);
            console.log(`    New questions: ${result.repurposedQuestions.length}`);
            for (const q of result.repurposedQuestions) {
              console.log(`      - "${q.questionText.substring(0, 50)}..."`);
            }
          } else {
            // Repurpose without questions = effectively a filter
            filteredCount++;
            console.log(`  REPURPOSE->FILTER: "${result.decision.questionText.substring(0, 60)}..."`);
            console.log(`    Reason: ${result.reason} (no replacement questions)`);
          }
          break;
      }
    }

    // Combine passed and repurposed decisions
    const validDecisions = [...passedDecisions, ...repurposedDecisions];

    const log: ValidationLog = {
      timestamp: new Date().toISOString(),
      totalDecisions: decisions.length,
      passedCount: passedDecisions.length,
      filteredCount,
      repurposedCount,
      results,
    };

    console.log(
      `Validation complete: ${passedDecisions.length} passed, ` +
      `${repurposedCount} repurposed (${repurposedDecisions.length} new questions), ` +
      `${filteredCount} filtered (${Date.now() - batchStartTime}ms)`
    );

    return { validDecisions, log };
  }
}

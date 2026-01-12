import { spawn } from 'child_process';
import type { Plan } from '@claude-code-web/shared';
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
    projectPath: string
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    const prompt = buildDecisionValidationPrompt(decision, plan);

    return new Promise((resolve) => {
      const childProcess = spawn('claude', [
        '--print',
        '--output-format', 'json',
        '--model', 'haiku',
        // Give Haiku read-only tools to inspect codebase
        '--allowedTools', 'Read,Glob,Grep',
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
        });
      });
    });
  }

  /**
   * Parse validation response, handling repurpose with nested questions.
   */
  private parseValidationResponse(
    fullResult: string,
    jsonStart: string
  ): { action: ValidationAction; reason: string; questions?: ParsedDecision[] } {
    // For repurpose, we need to find the complete JSON including the questions array
    // Try to find a more complete JSON object
    const repurposeMatch = fullResult.match(
      /\{[\s\S]*?"action"\s*:\s*"repurpose"[\s\S]*?"questions"\s*:\s*\[[\s\S]*?\]\s*\}/
    );

    if (repurposeMatch) {
      try {
        const parsed = JSON.parse(repurposeMatch[0]);
        const questions: ParsedDecision[] = (parsed.questions || []).map((q: {
          questionText?: string;
          category?: string;
          priority?: number;
          options?: Array<{ label: string; recommended?: boolean }>;
        }) => ({
          questionText: q.questionText || '',
          category: q.category || 'technical',
          priority: q.priority || 2,
          options: (q.options || []).map((o) => ({
            label: o.label,
            recommended: Boolean(o.recommended),
          })),
        }));

        return {
          action: 'repurpose',
          reason: parsed.reason || 'Question repurposed',
          questions: questions.length > 0 ? questions : undefined,
        };
      } catch {
        // Fall through to simple parsing
      }
    }

    // Simple parsing for pass/filter
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
    projectPath: string
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
      decisions.map(d => this.validateDecision(d, plan, projectPath))
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

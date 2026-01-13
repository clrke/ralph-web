import { spawn } from 'child_process';
import type { Plan, Session } from '@claude-code-web/shared';
import { buildTestRequirementPrompt } from '../prompts/validationPrompts';

/**
 * Result of assessing test requirements for a plan
 */
export interface TestRequirement {
  required: boolean;
  reason: string;
  testTypes: string[];
  existingFramework: string | null;
  suggestedCoverage: string;
  assessedAt: string;
  durationMs: number;
  /** Raw prompt sent to Haiku (for conversation logging) */
  prompt: string;
  /** Raw output from Haiku (for conversation logging) */
  output: string;
}

// Timeout for assessment (2 minutes - Haiku needs to explore codebase)
const ASSESSMENT_TIMEOUT_MS = 120_000;

/**
 * TestRequirementAssessor uses Haiku to determine whether a plan
 * requires automated tests before Stage 3→4 transition.
 *
 * Conservative approach: require tests on timeout/error (safer default)
 */
export class TestRequirementAssessor {
  /**
   * Assess whether a plan requires tests.
   */
  async assess(
    session: Session,
    plan: Plan,
    projectPath: string
  ): Promise<TestRequirement> {
    const startTime = Date.now();
    const prompt = buildTestRequirementPrompt(session, plan);

    return new Promise((resolve) => {
      const childProcess = spawn('claude', [
        '--print',
        '--output-format', 'json',
        '--model', 'haiku',
        // Give Haiku read-only tools to inspect codebase for test infrastructure
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
        console.log('Test requirement assessment timed out - requiring tests (conservative)');
        resolve({
          required: true,
          reason: 'Assessment timed out - requiring tests conservatively',
          testTypes: ['unit'],
          existingFramework: null,
          suggestedCoverage: 'Unable to determine - please assess manually',
          assessedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          prompt,
          output: stdout,
        });
      }, ASSESSMENT_TIMEOUT_MS);

      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        if (code !== 0) {
          console.log(`Test requirement assessment failed (code ${code}) - requiring tests`);
          resolve({
            required: true,
            reason: `Assessment failed (code ${code}) - requiring tests conservatively`,
            testTypes: ['unit'],
            existingFramework: null,
            suggestedCoverage: 'Unable to determine - please assess manually',
            assessedAt: new Date().toISOString(),
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

          // Extract JSON from result
          const jsonMatch = result.match(/\{[\s\S]*?"required"[\s\S]*?"reason"[\s\S]*?\}/);
          if (!jsonMatch) {
            console.log('No valid JSON in test assessment response - requiring tests');
            resolve({
              required: true,
              reason: 'Could not parse assessment - requiring tests conservatively',
              testTypes: ['unit'],
              existingFramework: null,
              suggestedCoverage: 'Unable to determine',
              assessedAt: new Date().toISOString(),
              durationMs,
              prompt,
              output: stdout,
            });
            return;
          }

          const assessment = JSON.parse(jsonMatch[0]);

          // Validate and normalize the response
          const testRequirement: TestRequirement = {
            required: Boolean(assessment.required),
            reason: String(assessment.reason || 'No reason provided'),
            testTypes: Array.isArray(assessment.testTypes) ? assessment.testTypes : [],
            existingFramework: assessment.existingFramework || null,
            suggestedCoverage: String(assessment.suggestedCoverage || ''),
            assessedAt: new Date().toISOString(),
            durationMs,
            prompt,
            output: stdout,
          };

          console.log(
            `Test requirement assessment: ${testRequirement.required ? 'REQUIRED' : 'NOT REQUIRED'} - ${testRequirement.reason}`
          );

          resolve(testRequirement);
        } catch (error) {
          console.log('Failed to parse test assessment response:', error);
          resolve({
            required: true,
            reason: 'Failed to parse assessment - requiring tests conservatively',
            testTypes: ['unit'],
            existingFramework: null,
            suggestedCoverage: 'Unable to determine',
            assessedAt: new Date().toISOString(),
            durationMs,
            prompt,
            output: stdout,
          });
        }
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        console.log('Test assessment spawn error:', error.message);
        resolve({
          required: true,
          reason: `Assessment spawn error: ${error.message} - requiring tests conservatively`,
          testTypes: ['unit'],
          existingFramework: null,
          suggestedCoverage: 'Unable to determine',
          assessedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          prompt,
          output: stdout,
        });
      });
    });
  }
}

import { spawn } from 'child_process';
import type { Plan, PlanStepStatus } from '@claude-code-web/shared';
import { buildIncompleteStepsPrompt } from '../prompts/validationPrompts';

/**
 * Result of assessing which steps are incomplete
 */
export interface IncompleteStepsResult {
  affectedSteps: Array<{
    stepId: string;
    status: PlanStepStatus;
    reason: string;
  }>;
  unaffectedSteps: string[];
  summary: string;
  durationMs: number;
  /** Raw prompt sent to Haiku (for conversation logging) */
  prompt: string;
  /** Raw output from Haiku (for conversation logging) */
  output: string;
}

// Timeout for assessment (2 minutes)
const ASSESSMENT_TIMEOUT_MS = 120_000;

/**
 * IncompleteStepsAssessor uses Haiku to determine which plan steps
 * are incomplete based on CI/review issues from Stage 5.
 *
 * Conservative approach: mark all as needs_review on timeout/error
 */
export class IncompleteStepsAssessor {
  /**
   * Assess which steps are incomplete based on CI/review issues.
   */
  async assess(
    plan: Plan,
    issueReason: string,
    projectPath: string
  ): Promise<IncompleteStepsResult> {
    const startTime = Date.now();
    const prompt = buildIncompleteStepsPrompt(plan, issueReason);

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
        console.log('Incomplete steps assessment timed out - marking all as needs_review');
        resolve(this.createConservativeResult(plan, 'Assessment timed out', Date.now() - startTime, prompt, stdout));
      }, ASSESSMENT_TIMEOUT_MS);

      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        if (code !== 0) {
          console.log(`Incomplete steps assessment failed (code ${code}) - marking all as needs_review`);
          resolve(this.createConservativeResult(plan, `Assessment failed (code ${code})`, durationMs, prompt, stdout));
          return;
        }

        try {
          // Parse Claude's JSON output wrapper
          const claudeOutput = JSON.parse(stdout);
          const result = claudeOutput.result || '';

          // Extract JSON from result
          const jsonMatch = result.match(/\{[\s\S]*?"affectedSteps"[\s\S]*?\}/);
          if (!jsonMatch) {
            console.log('No valid JSON in incomplete steps response - marking all as needs_review');
            resolve(this.createConservativeResult(plan, 'Could not parse assessment', durationMs, prompt, stdout));
            return;
          }

          const assessment = JSON.parse(jsonMatch[0]);

          // Validate and normalize the response
          const incompleteStepsResult: IncompleteStepsResult = {
            affectedSteps: Array.isArray(assessment.affectedSteps)
              ? assessment.affectedSteps.map((s: { stepId: string; status: string; reason: string }) => ({
                  stepId: String(s.stepId || ''),
                  status: (s.status === 'pending' ? 'pending' : 'needs_review') as PlanStepStatus,
                  reason: String(s.reason || 'No reason provided'),
                }))
              : [],
            unaffectedSteps: Array.isArray(assessment.unaffectedSteps) ? assessment.unaffectedSteps : [],
            summary: String(assessment.summary || 'No summary provided'),
            durationMs,
            prompt,
            output: stdout,
          };

          const affectedCount = incompleteStepsResult.affectedSteps.length;
          console.log(`Incomplete steps assessment: ${affectedCount} steps affected - ${incompleteStepsResult.summary}`);

          resolve(incompleteStepsResult);
        } catch (error) {
          console.log('Failed to parse incomplete steps response:', error);
          resolve(this.createConservativeResult(plan, 'Failed to parse assessment', durationMs, prompt, stdout));
        }
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        console.log('Incomplete steps assessment spawn error:', error.message);
        resolve(this.createConservativeResult(plan, `Spawn error: ${error.message}`, Date.now() - startTime, prompt, stdout));
      });
    });
  }

  /**
   * Create a conservative result marking all completed steps as needs_review.
   */
  private createConservativeResult(
    plan: Plan,
    reason: string,
    durationMs: number,
    prompt: string,
    output: string
  ): IncompleteStepsResult {
    return {
      affectedSteps: plan.steps
        .filter(s => s.status === 'completed')
        .map(s => ({
          stepId: s.id,
          status: 'needs_review' as PlanStepStatus,
          reason: `${reason} - conservatively marking as needs_review`,
        })),
      unaffectedSteps: plan.steps
        .filter(s => s.status !== 'completed')
        .map(s => s.id),
      summary: `${reason} - all completed steps marked for review`,
      durationMs,
      prompt,
      output,
    };
  }
}

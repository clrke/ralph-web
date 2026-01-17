import { spawn } from 'child_process';
import type { AcceptanceCriterion, ChangeComplexity, ComplexityAssessment, CHANGE_COMPLEXITY_LEVELS } from '@claude-code-web/shared';
import { buildComplexityAssessmentPrompt } from '../prompts/validationPrompts';

// Timeout for assessment (2 minutes - matches TestRequirementAssessor)
const ASSESSMENT_TIMEOUT_MS = 120_000;

// Default conservative fallback when assessment fails
const DEFAULT_COMPLEXITY: ChangeComplexity = 'normal';
const ALL_AGENTS = ['frontend', 'backend', 'database', 'testing', 'infrastructure', 'documentation'];

/**
 * ComplexityAssessor uses Haiku to classify feature request complexity
 * at session creation/edit time, before queueing.
 *
 * Conservative approach: fallback to 'normal' complexity on timeout/error
 * (this ensures we don't skip important agents for unknown complexity)
 */
export class ComplexityAssessor {
  /**
   * Assess the complexity of a feature request.
   */
  async assess(
    title: string,
    description: string,
    acceptanceCriteria: AcceptanceCriterion[],
    projectPath: string
  ): Promise<ComplexityAssessment> {
    const startTime = Date.now();
    const prompt = buildComplexityAssessmentPrompt(title, description, acceptanceCriteria);

    return new Promise((resolve) => {
      const childProcess = spawn('claude', [
        '--print',
        '--output-format', 'json',
        '--model', 'haiku',
        // Give Haiku read-only tools to inspect codebase structure
        '--allowedTools', 'Read,Glob,Grep',
        '-p', prompt,
      ], {
        cwd: projectPath,
        env: { ...globalThis.process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timeoutId = setTimeout(() => {
        childProcess.kill();
        console.log('Complexity assessment timed out - using normal complexity (conservative)');
        if (stderr) {
          console.log('Complexity assessment stderr at timeout:', stderr);
        }
        resolve({
          complexity: DEFAULT_COMPLEXITY,
          reason: 'Assessment timed out - using normal complexity conservatively',
          suggestedAgents: ALL_AGENTS.slice(0, 4), // 4 agents for normal
          useLeanPrompts: false,
          durationMs: Date.now() - startTime,
          prompt,
          output: stdout,
        });
      }, ASSESSMENT_TIMEOUT_MS);

      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        if (code !== 0) {
          console.log(`Complexity assessment failed (code ${code}) - using normal complexity`);
          if (stderr) {
            console.log('Complexity assessment stderr:', stderr);
          }
          resolve({
            complexity: DEFAULT_COMPLEXITY,
            reason: `Assessment failed (code ${code}) - using normal complexity conservatively`,
            suggestedAgents: ALL_AGENTS.slice(0, 4),
            useLeanPrompts: false,
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
          const jsonMatch = result.match(/\{[\s\S]*?"complexity"[\s\S]*?"reason"[\s\S]*?\}/);
          if (!jsonMatch) {
            console.log('No valid JSON in complexity assessment response - using normal complexity');
            resolve({
              complexity: DEFAULT_COMPLEXITY,
              reason: 'Could not parse assessment - using normal complexity conservatively',
              suggestedAgents: ALL_AGENTS.slice(0, 4),
              useLeanPrompts: false,
              durationMs,
              prompt,
              output: stdout,
            });
            return;
          }

          const assessment = JSON.parse(jsonMatch[0]);

          // Validate complexity level
          const validLevels: ChangeComplexity[] = ['trivial', 'simple', 'normal', 'complex'];
          const complexity: ChangeComplexity = validLevels.includes(assessment.complexity)
            ? assessment.complexity
            : DEFAULT_COMPLEXITY;

          // Validate and normalize suggested agents
          const suggestedAgents = Array.isArray(assessment.suggestedAgents)
            ? assessment.suggestedAgents.filter((a: string) => ALL_AGENTS.includes(a))
            : this.getDefaultAgentsForComplexity(complexity);

          // Ensure we have at least one agent
          const finalAgents = suggestedAgents.length > 0
            ? suggestedAgents
            : this.getDefaultAgentsForComplexity(complexity);

          // Determine useLeanPrompts based on complexity if not provided
          const useLeanPrompts = typeof assessment.useLeanPrompts === 'boolean'
            ? assessment.useLeanPrompts
            : (complexity === 'trivial' || complexity === 'simple');

          const complexityAssessment: ComplexityAssessment = {
            complexity,
            reason: String(assessment.reason || 'No reason provided'),
            suggestedAgents: finalAgents,
            useLeanPrompts,
            durationMs,
            prompt,
            output: stdout,
          };

          console.log(
            `Complexity assessment: ${complexityAssessment.complexity} - ${complexityAssessment.reason}`
          );

          resolve(complexityAssessment);
        } catch (error) {
          console.log('Failed to parse complexity assessment response:', error);
          resolve({
            complexity: DEFAULT_COMPLEXITY,
            reason: 'Failed to parse assessment - using normal complexity conservatively',
            suggestedAgents: ALL_AGENTS.slice(0, 4),
            useLeanPrompts: false,
            durationMs,
            prompt,
            output: stdout,
          });
        }
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        console.log('Complexity assessment spawn error:', error.message);
        if (stderr) {
          console.log('Complexity assessment stderr:', stderr);
        }
        resolve({
          complexity: DEFAULT_COMPLEXITY,
          reason: `Assessment spawn error: ${error.message} - using normal complexity conservatively`,
          suggestedAgents: ALL_AGENTS.slice(0, 4),
          useLeanPrompts: false,
          durationMs: Date.now() - startTime,
          prompt,
          output: stdout,
        });
      });
    });
  }

  /**
   * Get default agents for a given complexity level.
   */
  private getDefaultAgentsForComplexity(complexity: ChangeComplexity): string[] {
    switch (complexity) {
      case 'trivial':
        return ['frontend']; // 1 agent
      case 'simple':
        return ['frontend', 'testing']; // 2 agents
      case 'normal':
        return ['frontend', 'backend', 'testing', 'infrastructure']; // 4 agents
      case 'complex':
        return ALL_AGENTS; // All 6 agents
      default:
        return ALL_AGENTS.slice(0, 4); // 4 agents as safe default
    }
  }
}

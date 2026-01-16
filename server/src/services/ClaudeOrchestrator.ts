import { spawn } from 'child_process';
import { OutputParser, ParsedMarker } from './OutputParser';

export type OutputCallback = (chunk: string, isComplete: boolean) => void;

export interface SpawnOptions {
  prompt: string;
  projectPath: string;
  sessionId?: string;
  allowedTools?: string[];
  skipPermissions?: boolean;
  timeoutMs?: number;
  onOutput?: OutputCallback;
}

export interface ClaudeCommand {
  command: string;
  args: string[];
  cwd: string;
}

export interface ClaudeResult {
  output: string;
  sessionId: string | null;
  costUsd: number;
  isError: boolean;
  error?: string;
  parsed: ParsedMarker;
}

/**
 * Result of Haiku post-processing, includes prompt and output for conversation logging
 */
export interface HaikuPostProcessResult {
  parsed: ParsedMarker;
  prompt: string;
  output: string;
  durationMs: number;
}

interface ClaudeJsonOutput {
  result: string;
  session_id?: string;
  cost_usd?: number;
  is_error: boolean;
  error?: string;
}

const STAGE_TOOLS: Record<number, string[]> = {
  1: ['Read', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch', 'Edit(~/.claude-web/**/plan.md)', 'Bash(git:*)'],  // Discovery - read-only + web + plan.md edit + git for branch setup
  2: ['Read', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch', 'Edit(~/.claude-web/**/plan.md)'],  // Plan review - read-only + web + plan.md edit
  3: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],  // Implementation - full access including Task for complex multi-step work
  4: ['Read', 'Bash(git:*)', 'Bash(gh:*)'],  // Restricted to git and gh commands for PR creation
  5: ['Read', 'Glob', 'Grep', 'Task', 'Bash(git:diff*)', 'Bash(gh:pr*)', 'WebFetch', 'WebSearch', 'Edit(~/.claude-web/**/plan.md)', 'Edit(~/.claude-web/**/plan.json)'],  // PR review - read-only with limited diff/PR access + plan file edit
};

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Maximum number of plan validation attempts before giving up.
 * Each attempt re-spawns Stage 2 with validation context to fix incomplete plans.
 */
export const MAX_PLAN_VALIDATION_ATTEMPTS = 3;
const HAIKU_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for Haiku post-processing
const MIN_OUTPUT_LENGTH_FOR_POSTPROCESS = 100; // Minimum output length to consider for post-processing

/**
 * Check if parsed output contains any actionable markers.
 * If false, the output may need post-processing to extract content.
 *
 * Note: planModeEntered/planModeExited removed (deprecated) -
 * planFilePath is sufficient to detect plan file activity.
 */
export function hasActionableContent(parsed: ParsedMarker): boolean {
  return (
    parsed.decisions.length > 0 ||
    parsed.planSteps.length > 0 ||
    parsed.stepCompleted !== null ||
    parsed.stepsCompleted.length > 0 ||
    parsed.planFilePath !== null ||
    parsed.implementationComplete ||
    parsed.implementationSummary !== null ||
    parsed.implementationStatus !== null ||
    parsed.prCreated !== null ||
    parsed.planApproved ||
    parsed.ciStatus !== null ||
    parsed.ciFailed ||
    parsed.prApproved ||
    parsed.returnToStage2 !== null
  );
}

// Prompt for Haiku to extract and format questions
const QUESTION_EXTRACTION_PROMPT = `You are a formatting assistant. Extract any questions or decisions from the following text and format them using the [DECISION_NEEDED] marker format.

Rules:
1. Only extract actual questions that require user input/decision
2. Each question must have at least 2 options
3. Mark one option as (recommended) if the text suggests a preference
4. Use priority 1 for fundamental/scope questions, 2 for technical details, 3 for minor preferences
5. Use appropriate category: scope, approach, technical, design, code_quality, architecture, security, performance

Output format for EACH question found:
[DECISION_NEEDED priority="1" category="scope"]
The question text here?
- Option A: Description (recommended)
- Option B: Description
[/DECISION_NEEDED]

If no questions are found that need user decisions, output exactly: [NO_QUESTIONS]

Text to analyze:
`;

export class ClaudeOrchestrator {
  constructor(private readonly outputParser: OutputParser) {}

  /**
   * Check if output likely contains unformatted questions
   */
  private looksLikeQuestions(output: string): boolean {
    // Heuristics to detect question-like content
    const questionIndicators = [
      /\?\s*$/m,                          // Ends with question mark
      /\?\s*\n/m,                         // Question mark followed by newline
      /should\s+(we|i|it)\b/i,            // "should we/I/it"
      /would\s+you\s+(prefer|like)/i,     // "would you prefer/like"
      /which\s+(option|approach)/i,       // "which option/approach"
      /please\s+(choose|select|decide)/i, // "please choose/select/decide"
      /decision[s]?\s*(needed|required)/i,// "decision needed"
      /option\s*[a-z]:/i,                 // "Option A:"
      /option\s*[a-z]\s*\(/i,             // "Option A (" or "Option A("
      /^\s*[-•]\s+/m,                     // Bullet points (- or •)
      /^\s*\d+\.\s+/m,                    // Numbered list (1. 2. 3.)
      /\(recommended\)/i,                 // Recommendation marker
      /how\s+should\s+(we|i)\b/i,         // "how should we/I"
      /what\s+(approach|method|option)/i, // "what approach/method/option"
      /provide\s+your\s+(decision|answer)/i, // "provide your decision/answer"
      /priority\s*\d/i,                   // "Priority 1", "Priority 2"
      /issue[s]?\s*:/i,                   // "Issue:" or "Issues:"
    ];

    const matchCount = questionIndicators.filter(pattern => pattern.test(output)).length;
    return matchCount >= 2; // At least 2 indicators suggest questions
  }

  /**
   * Post-process output with Haiku to extract and format questions.
   * @param output The Claude output to process
   * @param cwd Working directory for the Haiku subprocess
   * @param force If true, skip heuristics check and always attempt extraction
   */
  async postProcessWithHaiku(output: string, cwd: string, force: boolean = false): Promise<HaikuPostProcessResult | null> {
    // Skip very short outputs
    if (output.length < MIN_OUTPUT_LENGTH_FOR_POSTPROCESS) {
      return null;
    }

    // Check heuristics unless forced
    if (!force && !this.looksLikeQuestions(output)) {
      return null;
    }

    console.log(force
      ? 'No actionable markers found, using Haiku to extract potential questions...'
      : 'Output looks like it contains questions, using Haiku to extract...');

    const prompt = QUESTION_EXTRACTION_PROMPT + output;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const childProcess = spawn('claude', [
        '--print',
        '--output-format', 'json',
        '--model', 'haiku',
        '-p', prompt,
      ], {
        cwd,
        env: { ...globalThis.process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      const timeoutId = setTimeout(() => {
        childProcess.kill();
        console.log('Haiku post-processing timed out');
        resolve(null);
      }, HAIKU_TIMEOUT_MS);

      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        if (code !== 0) {
          console.log('Haiku post-processing failed with code:', code);
          resolve(null);
          return;
        }

        try {
          const jsonOutput = JSON.parse(stdout);
          const result = jsonOutput.result || '';

          if (result.includes('[NO_QUESTIONS]')) {
            console.log('Haiku found no questions to extract');
            resolve(null);
            return;
          }

          const parsed = this.outputParser.parse(result);
          if (parsed.decisions.length > 0) {
            console.log(`Haiku extracted ${parsed.decisions.length} questions`);
            resolve({ parsed, prompt, output: stdout, durationMs });
          } else {
            resolve(null);
          }
        } catch (error) {
          console.log('Failed to parse Haiku output:', error);
          resolve(null);
        }
      });

      childProcess.on('error', () => {
        clearTimeout(timeoutId);
        resolve(null);
      });
    });
  }

  /**
   * Check if streaming mode is enabled via environment variable.
   * Streaming mode uses stream-json format for real-time output visibility.
   */
  private isStreamingEnabled(): boolean {
    return process.env.CLAUDE_STREAMING === 'true';
  }

  buildCommand(options: SpawnOptions): ClaudeCommand {
    const useStreaming = this.isStreamingEnabled();
    const args: string[] = ['--print', '--output-format', useStreaming ? 'stream-json' : 'json'];

    if (options.sessionId) {
      args.push('--resume', options.sessionId);
    }

    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(','));
    }

    if (options.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    args.push('-p', options.prompt);

    return {
      command: 'claude',
      args,
      cwd: options.projectPath,
    };
  }

  /**
   * Parse streaming JSON event and extract readable content.
   * Stream-json format produces newline-delimited JSON events.
   */
  private parseStreamEvent(line: string): { type: string; content?: string; result?: ClaudeJsonOutput } | null {
    try {
      const event = JSON.parse(line);

      // Handle result event (contains final output)
      if (event.type === 'result') {
        return {
          type: 'result',
          result: {
            result: event.result || '',
            session_id: event.session_id,
            cost_usd: event.cost_usd,
            is_error: event.is_error || false,
            error: event.error,
          },
        };
      }

      // Handle text delta (streaming text content)
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        return { type: 'text', content: event.delta.text };
      }

      // Handle assistant message with text content
      if (event.type === 'assistant' && event.message?.content) {
        const textContent = event.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text)
          .join('');
        if (textContent) {
          return { type: 'text', content: textContent };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  async spawn(options: SpawnOptions): Promise<ClaudeResult> {
    const cmd = this.buildCommand(options);
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const useStreaming = this.isStreamingEnabled();

    return new Promise((resolve, reject) => {
      const childProcess = spawn(cmd.command, cmd.args, {
        cwd: cmd.cwd,
        env: { ...globalThis.process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | null = null;
      let streamBuffer = '';
      let streamedContent = ''; // Collect all streamed text for final result
      let finalResult: ClaudeJsonOutput | null = null;

      // Set timeout
      timeoutId = setTimeout(() => {
        childProcess.kill();
        reject(new Error('Claude process timeout'));
      }, timeoutMs);

      childProcess.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        if (useStreaming) {
          // Parse streaming events and extract readable content
          streamBuffer += chunk;
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            const parsed = this.parseStreamEvent(line);
            if (parsed) {
              if (parsed.type === 'text' && parsed.content) {
                streamedContent += parsed.content;
                options.onOutput?.(parsed.content, false);
              } else if (parsed.type === 'result' && parsed.result) {
                finalResult = parsed.result;
              }
            }
          }
        } else {
          // Non-streaming mode: just accumulate chunks
          // Note: With --output-format json, we get all output at the end
          options.onOutput?.(chunk, false);
        }
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        try {
          let result: string;
          let sessionId: string | null = null;
          let costUsd = 0;
          let isError = false;
          let error: string | undefined;

          if (useStreaming && finalResult) {
            // Use result from stream-json format
            result = finalResult.result || streamedContent;
            sessionId = finalResult.session_id || null;
            costUsd = finalResult.cost_usd || 0;
            isError = finalResult.is_error || (code !== null && code !== 0);
            error = finalResult.error;
          } else {
            // Parse regular JSON output
            const jsonOutput: ClaudeJsonOutput = JSON.parse(stdout);
            result = jsonOutput.result || '';
            sessionId = jsonOutput.session_id || null;
            costUsd = jsonOutput.cost_usd || 0;
            isError = jsonOutput.is_error || (code !== null && code !== 0);
            error = jsonOutput.error;
          }

          const parsed = this.outputParser.parse(result);

          // Broadcast final output with isComplete=true
          options.onOutput?.(result, true);

          resolve({
            output: result,
            sessionId,
            costUsd,
            isError,
            error: error || (isError && stderr ? stderr.trim() : undefined),
            parsed,
          });
        } catch (parseError) {
          // If JSON parsing fails, include stderr for better debugging
          const errorMessage = stderr.trim()
            ? `${stderr.trim()}`
            : `Failed to parse Claude output: ${parseError}`;

          // Broadcast error output
          options.onOutput?.(stdout, true);

          resolve({
            output: stdout,
            sessionId: null,
            costUsd: 0,
            isError: true,
            error: errorMessage,
            parsed: this.outputParser.parse(stdout),
          });
        }
      });

      childProcess.on('error', (error: Error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(error);
      });
    });
  }

  getStageTools(stage: number): string[] {
    return STAGE_TOOLS[stage] || STAGE_TOOLS[1];
  }

  shouldSkipPermissions(stage: number): boolean {
    return stage === 3;
  }

  /**
   * Check if plan validation should continue or give up.
   * Returns true if more attempts are allowed, false if max attempts reached.
   *
   * @param currentAttempts - Current number of validation attempts
   * @param maxAttempts - Maximum allowed attempts (default: MAX_PLAN_VALIDATION_ATTEMPTS)
   */
  shouldContinueValidation(
    currentAttempts: number,
    maxAttempts: number = MAX_PLAN_VALIDATION_ATTEMPTS
  ): boolean {
    return currentAttempts < maxAttempts;
  }

  /**
   * Log plan validation attempt for debugging.
   * Call this when starting a validation re-attempt.
   *
   * @param featureId - Feature/session identifier
   * @param attempt - Current attempt number (1-based)
   * @param maxAttempts - Maximum allowed attempts
   * @param context - Brief description of validation issues
   */
  logValidationAttempt(
    featureId: string,
    attempt: number,
    maxAttempts: number,
    context?: string
  ): void {
    const contextPreview = context
      ? context.substring(0, 100) + (context.length > 100 ? '...' : '')
      : 'No context';
    console.log(
      `[Plan Validation] ${featureId}: Attempt ${attempt}/${maxAttempts} - ${contextPreview}`
    );
  }

  /**
   * Log when plan validation gives up after max attempts.
   *
   * @param featureId - Feature/session identifier
   * @param maxAttempts - Maximum allowed attempts that were reached
   */
  logValidationMaxAttemptsReached(featureId: string, maxAttempts: number): void {
    console.warn(
      `[Plan Validation] ${featureId}: Max attempts (${maxAttempts}) reached. ` +
      `Plan validation incomplete - proceeding anyway or user intervention required.`
    );
  }

  /**
   * Log when plan validation succeeds.
   *
   * @param featureId - Feature/session identifier
   * @param attempts - Number of attempts it took
   */
  logValidationSuccess(featureId: string, attempts: number): void {
    console.log(
      `[Plan Validation] ${featureId}: Plan validation succeeded after ${attempts} attempt(s)`
    );
  }
}

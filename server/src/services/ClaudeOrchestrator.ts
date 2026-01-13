import { spawn, ChildProcess } from 'child_process';
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
  1: ['Read', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch', 'Edit(~/.clrke/**/plan.md)'],  // Discovery - read-only + web + plan.md edit
  2: ['Read', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch', 'Edit(~/.clrke/**/plan.md)'],  // Plan review - read-only + web + plan.md edit
  3: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
  4: ['Read', 'Bash(git:*)', 'Bash(gh:*)'],  // Restricted to git and gh commands for PR creation
  5: ['Read', 'Glob', 'Grep', 'Task', 'Bash(git:diff*)', 'Bash(gh:pr*)', 'WebFetch', 'WebSearch'],  // PR review with limited diff/PR access + web
};

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
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

  buildCommand(options: SpawnOptions): ClaudeCommand {
    const args: string[] = ['--print', '--output-format', 'json'];

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

  async spawn(options: SpawnOptions): Promise<ClaudeResult> {
    const cmd = this.buildCommand(options);
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const childProcess = spawn(cmd.command, cmd.args, {
        cwd: cmd.cwd,
        env: { ...globalThis.process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | null = null;

      // Set timeout
      timeoutId = setTimeout(() => {
        childProcess.kill();
        reject(new Error('Claude process timeout'));
      }, timeoutMs);

      childProcess.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        // Note: With --output-format json, we get all output at the end
        // The callback is called with each chunk but content isn't usable until complete
        options.onOutput?.(chunk, false);
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        try {
          const jsonOutput: ClaudeJsonOutput = JSON.parse(stdout);
          const parsed = this.outputParser.parse(jsonOutput.result || '');

          // Check both JSON is_error flag AND exit code
          const hasError = jsonOutput.is_error || (code !== null && code !== 0);

          // Broadcast final output with isComplete=true
          options.onOutput?.(jsonOutput.result || '', true);

          resolve({
            output: jsonOutput.result || '',
            sessionId: jsonOutput.session_id || null,
            costUsd: jsonOutput.cost_usd || 0,
            isError: hasError,
            error: jsonOutput.error || (hasError && stderr ? stderr.trim() : undefined),
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
}

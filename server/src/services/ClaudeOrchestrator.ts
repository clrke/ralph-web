import { spawn, ChildProcess } from 'child_process';
import { OutputParser, ParsedMarker } from './OutputParser';

export interface SpawnOptions {
  prompt: string;
  projectPath: string;
  sessionId?: string;
  allowedTools?: string[];
  skipPermissions?: boolean;
  timeoutMs?: number;
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

interface ClaudeJsonOutput {
  result: string;
  session_id?: string;
  cost_usd?: number;
  is_error: boolean;
  error?: string;
}

const STAGE_TOOLS: Record<number, string[]> = {
  1: ['Read', 'Glob', 'Grep', 'Task'],
  2: ['Read', 'Glob', 'Grep', 'Task'],
  3: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
  4: ['Read', 'Bash(git:*)', 'Bash(gh:*)'],
  5: ['Read', 'Glob', 'Grep', 'Task', 'Bash(git:diff*)', 'Bash(gh:pr*)'],
};

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export class ClaudeOrchestrator {
  constructor(private readonly outputParser: OutputParser) {}

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
        stdout += data.toString();
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

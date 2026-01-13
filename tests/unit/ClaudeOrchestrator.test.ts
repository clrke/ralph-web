import {
  ClaudeOrchestrator,
  ClaudeResult,
  SpawnOptions,
  MAX_PLAN_VALIDATION_ATTEMPTS,
} from '../../server/src/services/ClaudeOrchestrator';
import { OutputParser } from '../../server/src/services/OutputParser';
import { EventEmitter } from 'events';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('ClaudeOrchestrator', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;

  beforeEach(() => {
    jest.clearAllMocks();
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);
  });

  describe('buildCommand', () => {
    it('should build basic claude command with prompt', () => {
      const cmd = orchestrator.buildCommand({
        prompt: 'Hello world',
        projectPath: '/test/project',
      });

      expect(cmd.args).toContain('--print');
      expect(cmd.args).toContain('--output-format');
      expect(cmd.args).toContain('json');
      expect(cmd.args).toContain('-p');
      expect(cmd.args).toContain('Hello world');
    });

    it('should include --resume when sessionId provided', () => {
      const cmd = orchestrator.buildCommand({
        prompt: 'Continue work',
        projectPath: '/test/project',
        sessionId: 'abc-123',
      });

      expect(cmd.args).toContain('--resume');
      expect(cmd.args).toContain('abc-123');
    });

    it('should include --allowedTools when specified', () => {
      const cmd = orchestrator.buildCommand({
        prompt: 'Read files',
        projectPath: '/test/project',
        allowedTools: ['Read', 'Glob', 'Grep'],
      });

      expect(cmd.args).toContain('--allowedTools');
      expect(cmd.args).toContain('Read,Glob,Grep');
    });

    it('should include --dangerously-skip-permissions for Stage 3', () => {
      const cmd = orchestrator.buildCommand({
        prompt: 'Implement feature',
        projectPath: '/test/project',
        skipPermissions: true,
      });

      expect(cmd.args).toContain('--dangerously-skip-permissions');
    });

    it('should set working directory to project path', () => {
      const cmd = orchestrator.buildCommand({
        prompt: 'Test',
        projectPath: '/my/project',
      });

      expect(cmd.cwd).toBe('/my/project');
    });
  });

  describe('spawn', () => {
    it('should spawn claude process and return result', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
      });

      // Simulate successful output
      const mockOutput = JSON.stringify({
        result: 'Hello! How can I help?',
        session_id: 'session-123',
        cost_usd: 0.01,
        is_error: false,
      });

      mockProcess.stdout.emit('data', Buffer.from(mockOutput));
      mockProcess.emit('close', 0);

      const result = await spawnPromise;

      expect(result.output).toBe('Hello! How can I help?');
      expect(result.sessionId).toBe('session-123');
      expect(result.costUsd).toBe(0.01);
      expect(result.isError).toBe(false);
    });

    it('should handle claude errors', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
      });

      const mockOutput = JSON.stringify({
        result: '',
        is_error: true,
        error: 'API rate limit exceeded',
      });

      mockProcess.stdout.emit('data', Buffer.from(mockOutput));
      mockProcess.emit('close', 1);

      const result = await spawnPromise;

      expect(result.isError).toBe(true);
      expect(result.error).toBe('API rate limit exceeded');
    });

    it('should timeout after specified duration', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = jest.fn();

      mockSpawn.mockReturnValue(mockProcess);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Long running task',
        projectPath: '/test',
        timeoutMs: 100,
      });

      // Don't emit close, let it timeout

      await expect(spawnPromise).rejects.toThrow('timeout');
      expect(mockProcess.kill).toHaveBeenCalled();
    }, 10000);

    it('should parse output markers', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Create plan',
        projectPath: '/test',
      });

      const mockOutput = JSON.stringify({
        result: `
[PLAN_MODE_ENTERED]
[PLAN_STEP id="1" parent="null" status="pending"]
Create authentication
[/PLAN_STEP]
[PLAN_MODE_EXITED]
`,
        session_id: 'session-456',
        cost_usd: 0.02,
        is_error: false,
      });

      mockProcess.stdout.emit('data', Buffer.from(mockOutput));
      mockProcess.emit('close', 0);

      const result = await spawnPromise;

      expect(result.parsed.planModeEntered).toBe(true);
      expect(result.parsed.planModeExited).toBe(true);
      expect(result.parsed.planSteps).toHaveLength(1);
      expect(result.parsed.planSteps[0].id).toBe('1');
    });
  });

  describe('getStageTools', () => {
    it('should return read-only tools for Stage 1', () => {
      const tools = orchestrator.getStageTools(1);

      expect(tools).toContain('Read');
      expect(tools).toContain('Glob');
      expect(tools).toContain('Grep');
      expect(tools).toContain('Task');
      expect(tools).not.toContain('Write');
      expect(tools).not.toContain('Edit');
    });

    it('should return read-only tools for Stage 2', () => {
      const tools = orchestrator.getStageTools(2);

      expect(tools).toContain('Read');
      expect(tools).not.toContain('Write');
    });

    it('should return full tools for Stage 3', () => {
      const tools = orchestrator.getStageTools(3);

      expect(tools).toContain('Read');
      expect(tools).toContain('Write');
      expect(tools).toContain('Edit');
      expect(tools).toContain('Bash');
    });

    it('should return git tools for Stage 4', () => {
      const tools = orchestrator.getStageTools(4);

      expect(tools).toContain('Read');
      expect(tools).toContain('Bash(git:*)');
      expect(tools).toContain('Bash(gh:*)');
      expect(tools).not.toContain('Write');
    });

    it('should return read-only + PR tools for Stage 5', () => {
      const tools = orchestrator.getStageTools(5);

      expect(tools).toContain('Read');
      expect(tools).toContain('Bash(git:diff*)');
      expect(tools).toContain('Bash(gh:pr*)');
      expect(tools).not.toContain('Write');
    });
  });

  describe('shouldSkipPermissions', () => {
    it('should return true only for Stage 3', () => {
      expect(orchestrator.shouldSkipPermissions(1)).toBe(false);
      expect(orchestrator.shouldSkipPermissions(2)).toBe(false);
      expect(orchestrator.shouldSkipPermissions(3)).toBe(true);
      expect(orchestrator.shouldSkipPermissions(4)).toBe(false);
      expect(orchestrator.shouldSkipPermissions(5)).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should not settle twice when both error and close events fire', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
      });

      // Emit error first, then close (simulates process crash)
      mockProcess.emit('error', new Error('Process crashed'));
      mockProcess.emit('close', 1);

      // Should reject with the error, not cause unhandled promise issues
      await expect(spawnPromise).rejects.toThrow('Process crashed');
    });

    it('should reject when exit code is non-zero even with valid JSON', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
      });

      // Valid JSON output but non-zero exit code
      const mockOutput = JSON.stringify({
        result: 'Partial work done',
        session_id: 'session-123',
        is_error: false,
      });

      mockProcess.stdout.emit('data', Buffer.from(mockOutput));
      mockProcess.stderr.emit('data', Buffer.from('Error: something went wrong'));
      mockProcess.emit('close', 1);

      const result = await spawnPromise;

      // With non-zero exit, should mark as error even if JSON says is_error: false
      expect(result.isError).toBe(true);
    });

    it('should include stderr content in error message', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
      });

      // No valid JSON, process crashes with stderr
      mockProcess.stdout.emit('data', Buffer.from('invalid json'));
      mockProcess.stderr.emit('data', Buffer.from('Fatal: API key expired'));
      mockProcess.emit('close', 1);

      const result = await spawnPromise;

      expect(result.isError).toBe(true);
      expect(result.error).toContain('API key expired');
    });

    it('should concatenate chunked stdout correctly', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
      });

      // Simulate chunked output (JSON split across multiple chunks)
      const fullOutput = JSON.stringify({
        result: 'This is a longer response that gets chunked',
        session_id: 'session-789',
        cost_usd: 0.05,
        is_error: false,
      });

      // Split into multiple chunks
      const chunk1 = fullOutput.substring(0, 20);
      const chunk2 = fullOutput.substring(20, 50);
      const chunk3 = fullOutput.substring(50);

      mockProcess.stdout.emit('data', Buffer.from(chunk1));
      mockProcess.stdout.emit('data', Buffer.from(chunk2));
      mockProcess.stdout.emit('data', Buffer.from(chunk3));
      mockProcess.emit('close', 0);

      const result = await spawnPromise;

      expect(result.output).toBe('This is a longer response that gets chunked');
      expect(result.sessionId).toBe('session-789');
      expect(result.isError).toBe(false);
    });

    it('should handle spawn error (command not found)', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
      });

      // Simulate ENOENT error (command not found)
      const error = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockProcess.emit('error', error);

      await expect(spawnPromise).rejects.toThrow('ENOENT');
    });
  });

  describe('onOutput callback', () => {
    it('should call onOutput for each stdout chunk', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const onOutput = jest.fn();

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
        onOutput,
      });

      const fullOutput = JSON.stringify({
        result: 'Hello!',
        session_id: 'session-123',
        cost_usd: 0.01,
        is_error: false,
      });

      // Emit in chunks
      mockProcess.stdout.emit('data', Buffer.from(fullOutput.substring(0, 20)));
      mockProcess.stdout.emit('data', Buffer.from(fullOutput.substring(20)));
      mockProcess.emit('close', 0);

      await spawnPromise;

      // Should be called 3 times: 2 chunks + 1 final with isComplete=true
      expect(onOutput).toHaveBeenCalledTimes(3);
      expect(onOutput).toHaveBeenNthCalledWith(1, fullOutput.substring(0, 20), false);
      expect(onOutput).toHaveBeenNthCalledWith(2, fullOutput.substring(20), false);
      expect(onOutput).toHaveBeenNthCalledWith(3, 'Hello!', true);
    });

    it('should call onOutput with isComplete=true on successful completion', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const onOutput = jest.fn();

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
        onOutput,
      });

      const mockOutput = JSON.stringify({
        result: 'Final response',
        session_id: 'session-123',
        cost_usd: 0.01,
        is_error: false,
      });

      mockProcess.stdout.emit('data', Buffer.from(mockOutput));
      mockProcess.emit('close', 0);

      await spawnPromise;

      // Last call should have isComplete=true and the parsed result
      const lastCall = onOutput.mock.calls[onOutput.mock.calls.length - 1];
      expect(lastCall[0]).toBe('Final response');
      expect(lastCall[1]).toBe(true);
    });

    it('should call onOutput with isComplete=true even on parse error', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const onOutput = jest.fn();

      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
        onOutput,
      });

      // Invalid JSON output
      mockProcess.stdout.emit('data', Buffer.from('invalid json'));
      mockProcess.emit('close', 1);

      await spawnPromise;

      // Should still call with isComplete=true
      const lastCall = onOutput.mock.calls[onOutput.mock.calls.length - 1];
      expect(lastCall[0]).toBe('invalid json');
      expect(lastCall[1]).toBe(true);
    });

    it('should work without onOutput callback', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      // No onOutput callback - should not throw
      const spawnPromise = orchestrator.spawn({
        prompt: 'Hello',
        projectPath: '/test',
      });

      const mockOutput = JSON.stringify({
        result: 'Response',
        session_id: 'session-123',
        cost_usd: 0.01,
        is_error: false,
      });

      mockProcess.stdout.emit('data', Buffer.from(mockOutput));
      mockProcess.emit('close', 0);

      const result = await spawnPromise;
      expect(result.output).toBe('Response');
    });
  });

  describe('MAX_PLAN_VALIDATION_ATTEMPTS', () => {
    it('should be exported and have default value of 3', () => {
      expect(MAX_PLAN_VALIDATION_ATTEMPTS).toBe(3);
    });
  });

  describe('shouldContinueValidation', () => {
    it('should return true when current attempts is less than max', () => {
      expect(orchestrator.shouldContinueValidation(0)).toBe(true);
      expect(orchestrator.shouldContinueValidation(1)).toBe(true);
      expect(orchestrator.shouldContinueValidation(2)).toBe(true);
    });

    it('should return false when current attempts equals max', () => {
      expect(orchestrator.shouldContinueValidation(3)).toBe(false);
    });

    it('should return false when current attempts exceeds max', () => {
      expect(orchestrator.shouldContinueValidation(4)).toBe(false);
      expect(orchestrator.shouldContinueValidation(10)).toBe(false);
    });

    it('should use default max attempts of MAX_PLAN_VALIDATION_ATTEMPTS', () => {
      // At 2 attempts (less than default 3), should continue
      expect(orchestrator.shouldContinueValidation(2)).toBe(true);
      // At 3 attempts (equals default 3), should stop
      expect(orchestrator.shouldContinueValidation(3)).toBe(false);
    });

    it('should respect custom max attempts', () => {
      // Custom max of 5
      expect(orchestrator.shouldContinueValidation(4, 5)).toBe(true);
      expect(orchestrator.shouldContinueValidation(5, 5)).toBe(false);

      // Custom max of 1
      expect(orchestrator.shouldContinueValidation(0, 1)).toBe(true);
      expect(orchestrator.shouldContinueValidation(1, 1)).toBe(false);
    });
  });

  describe('logValidationAttempt', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log validation attempt with feature ID and attempt number', () => {
      orchestrator.logValidationAttempt('feature-123', 1, 3);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Plan Validation]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('feature-123')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('1/3')
      );
    });

    it('should include truncated context when provided', () => {
      const longContext = 'A'.repeat(150);
      orchestrator.logValidationAttempt('feature-123', 2, 3, longContext);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('...')
      );
    });

    it('should show full context when under 100 chars', () => {
      const shortContext = 'Missing steps section';
      orchestrator.logValidationAttempt('feature-123', 1, 3, shortContext);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Missing steps section')
      );
    });

    it('should show "No context" when context is not provided', () => {
      orchestrator.logValidationAttempt('feature-123', 1, 3);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No context')
      );
    });
  });

  describe('logValidationMaxAttemptsReached', () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should log warning with feature ID and max attempts', () => {
      orchestrator.logValidationMaxAttemptsReached('feature-456', 3);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Plan Validation]')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('feature-456')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Max attempts (3) reached')
      );
    });
  });

  describe('logValidationSuccess', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log success with feature ID and attempt count', () => {
      orchestrator.logValidationSuccess('feature-789', 2);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Plan Validation]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('feature-789')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('succeeded after 2 attempt(s)')
      );
    });

    it('should handle single attempt', () => {
      orchestrator.logValidationSuccess('feature-success', 1);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('succeeded after 1 attempt(s)')
      );
    });
  });
});

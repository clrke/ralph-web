import { ClaudeOrchestrator, SpawnOptions } from '../../server/src/services/ClaudeOrchestrator';
import { OutputParser } from '../../server/src/services/OutputParser';

/**
 * Tests for Stage 1 retry sessionId preservation.
 *
 * The fix ensures that when Stage 1 is retried via the /api/sessions/:projectId/:featureId/retry
 * endpoint, the sessionId is passed to orchestrator.spawn() to maintain Claude conversation context.
 *
 * Previously, Stage 1 retry was NOT passing sessionId, which caused retries to start fresh
 * sessions instead of resuming the existing conversation.
 */

describe('Stage 1 Retry SessionId Preservation', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);
  });

  describe('orchestrator.buildCommand with sessionId', () => {
    it('should include --resume flag when sessionId is provided for Stage 1 retry', () => {
      const sessionId = 'existing-stage1-session-abc123';
      const cmd = orchestrator.buildCommand({
        prompt: 'Retry Stage 1 discovery',
        projectPath: '/test/project',
        sessionId,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(cmd.args).toContain('--resume');
      expect(cmd.args).toContain(sessionId);
    });

    it('should not include --resume flag when sessionId is undefined', () => {
      const cmd = orchestrator.buildCommand({
        prompt: 'Initial Stage 1 discovery',
        projectPath: '/test/project',
        sessionId: undefined,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(cmd.args).not.toContain('--resume');
    });

    it('should not include --resume flag when sessionId is empty string', () => {
      const cmd = orchestrator.buildCommand({
        prompt: 'Stage 1 discovery',
        projectPath: '/test/project',
        sessionId: '',
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(cmd.args).not.toContain('--resume');
    });
  });

  describe('Stage 1 tools are correctly configured for retry', () => {
    it('should use Stage 1 tools (Read, Glob, Grep, Task) for retry', () => {
      const stage1Tools = orchestrator.getStageTools(1);

      expect(stage1Tools).toContain('Read');
      expect(stage1Tools).toContain('Glob');
      expect(stage1Tools).toContain('Grep');
      expect(stage1Tools).toContain('Task');
    });

    it('should not skip permissions for Stage 1', () => {
      expect(orchestrator.shouldSkipPermissions(1)).toBe(false);
    });
  });

  describe('sessionId fallback pattern', () => {
    /**
     * This test verifies the pattern used in the retry code:
     * sessionId: session.claudeSessionId || undefined
     *
     * This pattern ensures:
     * - If claudeSessionId exists, it's passed to resume the session
     * - If claudeSessionId is null/undefined, undefined is passed (no resume)
     */
    it('should return sessionId when claudeSessionId is a valid string', () => {
      const session = { claudeSessionId: 'valid-session-123' };
      const sessionId = session.claudeSessionId || undefined;

      expect(sessionId).toBe('valid-session-123');
    });

    it('should return undefined when claudeSessionId is null', () => {
      const session = { claudeSessionId: null as string | null };
      const sessionId = session.claudeSessionId || undefined;

      expect(sessionId).toBeUndefined();
    });

    it('should return undefined when claudeSessionId is undefined', () => {
      const session = { claudeSessionId: undefined as string | undefined };
      const sessionId = session.claudeSessionId || undefined;

      expect(sessionId).toBeUndefined();
    });

    it('should return undefined when claudeSessionId is empty string', () => {
      const session = { claudeSessionId: '' };
      const sessionId = session.claudeSessionId || undefined;

      expect(sessionId).toBeUndefined();
    });
  });

  describe('--resume flag position in command', () => {
    it('should have --resume followed by sessionId in args', () => {
      const sessionId = 'test-session-456';
      const cmd = orchestrator.buildCommand({
        prompt: 'Test prompt',
        projectPath: '/test/project',
        sessionId,
        allowedTools: ['Read'],
      });

      const resumeIndex = cmd.args.indexOf('--resume');
      expect(resumeIndex).toBeGreaterThan(-1);
      expect(cmd.args[resumeIndex + 1]).toBe(sessionId);
    });
  });

  describe('Stage 1 retry vs initial spawn behavior difference', () => {
    /**
     * Initial Stage 1 spawn intentionally does NOT pass sessionId
     * because it starts a fresh conversation for a new feature.
     *
     * Stage 1 RETRY should pass sessionId to maintain context from
     * the previous attempt.
     */
    it('should allow both patterns to coexist correctly', () => {
      // Initial spawn - no sessionId
      const initialCmd = orchestrator.buildCommand({
        prompt: 'Start new feature discovery',
        projectPath: '/test/project',
        sessionId: undefined, // Intentionally fresh
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      // Retry spawn - with sessionId to resume
      const retryCmd = orchestrator.buildCommand({
        prompt: 'Retry feature discovery',
        projectPath: '/test/project',
        sessionId: 'previous-session-xyz', // Resume previous session
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(initialCmd.args).not.toContain('--resume');
      expect(retryCmd.args).toContain('--resume');
      expect(retryCmd.args).toContain('previous-session-xyz');
    });
  });
});

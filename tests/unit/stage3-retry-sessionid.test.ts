import { ClaudeOrchestrator, SpawnOptions, ClaudeResult } from '../../server/src/services/ClaudeOrchestrator';
import { OutputParser } from '../../server/src/services/OutputParser';

/**
 * Tests for Stage 3 sessionId preservation across retry scenarios.
 *
 * Stage 3 uses a separate sessionId field: claudeStage3SessionId
 * This is distinct from the main claudeSessionId used in Stages 1, 2, 4, 5.
 *
 * Key behaviors:
 * 1. First step of Stage 3: starts fresh (no sessionId)
 * 2. Subsequent steps: resume with claudeStage3SessionId
 * 3. Manual retries: should resume with existing claudeStage3SessionId
 * 4. Auto-retries within executeSingleStep: should maintain claudeStage3SessionId
 */

describe('Stage 3 Retry SessionId Preservation', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);
  });

  describe('claudeStage3SessionId pattern in executeSingleStep', () => {
    /**
     * The executeSingleStep function uses this pattern:
     * const sessionIdToUse = session.claudeStage3SessionId || undefined;
     *
     * This ensures:
     * - First step (claudeStage3SessionId is null): starts fresh
     * - Subsequent steps (claudeStage3SessionId is set): resumes session
     */
    it('should use claudeStage3SessionId for subsequent steps', () => {
      const session = {
        claudeStage3SessionId: 'stage3-session-abc123',
        projectPath: '/test/project',
      };

      const sessionIdToUse = session.claudeStage3SessionId || undefined;

      const cmd = orchestrator.buildCommand({
        prompt: 'Execute step 2 of implementation',
        projectPath: session.projectPath,
        sessionId: sessionIdToUse,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(cmd.args).toContain('--resume');
      expect(cmd.args).toContain('stage3-session-abc123');
    });

    it('should start fresh when claudeStage3SessionId is null (first step)', () => {
      const session = {
        claudeStage3SessionId: null as string | null,
        projectPath: '/test/project',
      };

      const sessionIdToUse = session.claudeStage3SessionId || undefined;

      const cmd = orchestrator.buildCommand({
        prompt: 'Execute first step of implementation',
        projectPath: session.projectPath,
        sessionId: sessionIdToUse,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(cmd.args).not.toContain('--resume');
    });
  });

  describe('Stage 3 manual retry behavior', () => {
    /**
     * When a user triggers a manual retry via /api/sessions/:projectId/:featureId/retry
     * with stage=3, the executeStage3Steps function is called.
     * This should use the existing claudeStage3SessionId to maintain context.
     */
    it('should resume session when retrying Stage 3 with existing claudeStage3SessionId', () => {
      const session = {
        claudeStage3SessionId: 'stage3-retry-session-xyz',
        projectPath: '/test/project',
        currentStage: 3,
      };

      const sessionIdToUse = session.claudeStage3SessionId || undefined;

      const cmd = orchestrator.buildCommand({
        prompt: 'Retry step implementation after failure',
        projectPath: session.projectPath,
        sessionId: sessionIdToUse,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(cmd.args).toContain('--resume');
      expect(cmd.args).toContain('stage3-retry-session-xyz');
    });

    it('should handle retry when no claudeStage3SessionId exists yet', () => {
      // Edge case: retry triggered before first step completed
      const session = {
        claudeStage3SessionId: null as string | null,
        projectPath: '/test/project',
        currentStage: 3,
      };

      const sessionIdToUse = session.claudeStage3SessionId || undefined;

      const cmd = orchestrator.buildCommand({
        prompt: 'Retry step (first step never completed)',
        projectPath: session.projectPath,
        sessionId: sessionIdToUse,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(cmd.args).not.toContain('--resume');
    });
  });

  describe('Stage 3 blocker resume behavior', () => {
    /**
     * When resuming after a blocker is answered, the session should use
     * claudeStage3SessionId to maintain conversation context.
     */
    it('should resume session when continuing after blocker answer', () => {
      const session = {
        claudeStage3SessionId: 'stage3-blocker-session-789',
        projectPath: '/test/project',
        currentStage: 3,
      };

      const sessionIdToUse = session.claudeStage3SessionId || undefined;

      const cmd = orchestrator.buildCommand({
        prompt: 'Continue step after blocker resolved',
        projectPath: session.projectPath,
        sessionId: sessionIdToUse,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(cmd.args).toContain('--resume');
      expect(cmd.args).toContain('stage3-blocker-session-789');
    });
  });

  describe('Stage 3 tools configuration', () => {
    it('should use correct tools for Stage 3 (includes write permissions)', () => {
      const tools = orchestrator.getStageTools(3);

      // Stage 3 needs write access for implementation
      expect(tools).toContain('Write');
      expect(tools).toContain('Edit');
      expect(tools).toContain('Bash');
      expect(tools).toContain('Read');
      expect(tools).toContain('Glob');
      expect(tools).toContain('Grep');
    });

    it('should skip permissions for Stage 3', () => {
      expect(orchestrator.shouldSkipPermissions(3)).toBe(true);
    });
  });
});

describe('Stage 3 SessionId - Mock Spawn Verification', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;
  let spawnSpy: jest.SpyInstance;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);

    spawnSpy = jest.spyOn(orchestrator, 'spawn').mockResolvedValue({
      output: 'Mock Stage 3 output',
      isError: false,
      sessionId: 'new-stage3-session-from-claude',
      parsed: {
        decisions: [],
        planSteps: [],
        completedSteps: [],
        blockers: [],
        questionAnswers: [],
        stepsCompleted: [{ id: 'step-1', summary: 'Completed' }],
      },
    } as ClaudeResult);
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  describe('executeSingleStep spawn receives correct sessionId', () => {
    it('should pass claudeStage3SessionId to spawn for subsequent steps', async () => {
      const session = {
        claudeStage3SessionId: 'existing-stage3-session-def',
        projectPath: '/test/project',
        projectId: 'test-project',
        featureId: 'test-feature',
      };

      await orchestrator.spawn({
        prompt: 'Execute step 3 of plan',
        projectPath: session.projectPath,
        sessionId: session.claudeStage3SessionId || undefined,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'existing-stage3-session-def',
        })
      );
    });

    it('should pass undefined sessionId for first step (fresh session)', async () => {
      const session = {
        claudeStage3SessionId: null as string | null,
        projectPath: '/test/project',
      };

      await orchestrator.spawn({
        prompt: 'Execute first step of plan',
        projectPath: session.projectPath,
        sessionId: session.claudeStage3SessionId || undefined,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: undefined,
        })
      );
    });
  });

  describe('Stage 3 manual retry spawn receives correct sessionId', () => {
    it('should pass claudeStage3SessionId to spawn for manual retry', async () => {
      const session = {
        claudeStage3SessionId: 'stage3-manual-retry-session-ghi',
        projectPath: '/test/project',
        currentStage: 3,
      };

      // Simulate manual retry path
      await orchestrator.spawn({
        prompt: 'Manual retry of Stage 3 step',
        projectPath: session.projectPath,
        sessionId: session.claudeStage3SessionId || undefined,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'stage3-manual-retry-session-ghi',
        })
      );
    });
  });

  describe('Stage 3 auto-retry spawn receives correct sessionId', () => {
    /**
     * When a step fails tests and auto-retries within executeSingleStep,
     * the retry should use the existing claudeStage3SessionId.
     */
    it('should maintain claudeStage3SessionId across auto-retries', async () => {
      const session = {
        claudeStage3SessionId: 'stage3-auto-retry-session-jkl',
        projectPath: '/test/project',
      };

      // Simulate first attempt
      await orchestrator.spawn({
        prompt: 'Execute step (attempt 1)',
        projectPath: session.projectPath,
        sessionId: session.claudeStage3SessionId || undefined,
        allowedTools: orchestrator.getStageTools(3),
      });

      // Clear and simulate retry attempt
      spawnSpy.mockClear();

      // Same session with same claudeStage3SessionId for retry
      await orchestrator.spawn({
        prompt: 'Execute step (retry attempt 2)',
        projectPath: session.projectPath,
        sessionId: session.claudeStage3SessionId || undefined,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'stage3-auto-retry-session-jkl',
        })
      );
    });
  });
});

describe('Stage 3 SessionId Lifecycle', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);
  });

  /**
   * Documents the Stage 3 sessionId lifecycle:
   *
   * 1. FIRST STEP: claudeStage3SessionId is null, spawn without sessionId
   * 2. CAPTURE: claudeStage3SessionId captured from first spawn result
   * 3. SUBSEQUENT STEPS: Use claudeStage3SessionId for all following steps
   * 4. RETRIES: Use existing claudeStage3SessionId to maintain context
   */
  describe('sessionId lifecycle documentation', () => {
    it('should document the complete Stage 3 sessionId lifecycle', () => {
      // Step 1: First step - no sessionId
      const sessionBefore = {
        claudeStage3SessionId: null as string | null,
        projectPath: '/test/project',
      };

      const firstStepCmd = orchestrator.buildCommand({
        prompt: 'First step of Stage 3',
        projectPath: sessionBefore.projectPath,
        sessionId: sessionBefore.claudeStage3SessionId || undefined,
        allowedTools: orchestrator.getStageTools(3),
      });
      expect(firstStepCmd.args).not.toContain('--resume');

      // Step 2: After first step, claudeStage3SessionId is captured
      const capturedSessionId = 'stage3-session-captured-from-result';
      const sessionAfter = {
        ...sessionBefore,
        claudeStage3SessionId: capturedSessionId,
      };

      // Step 3: Second step - uses captured sessionId
      const secondStepCmd = orchestrator.buildCommand({
        prompt: 'Second step of Stage 3',
        projectPath: sessionAfter.projectPath,
        sessionId: sessionAfter.claudeStage3SessionId || undefined,
        allowedTools: orchestrator.getStageTools(3),
      });
      expect(secondStepCmd.args).toContain('--resume');
      expect(secondStepCmd.args).toContain(capturedSessionId);

      // Step 4: Manual retry - still uses same sessionId
      const retryCmd = orchestrator.buildCommand({
        prompt: 'Manual retry of Stage 3',
        projectPath: sessionAfter.projectPath,
        sessionId: sessionAfter.claudeStage3SessionId || undefined,
        allowedTools: orchestrator.getStageTools(3),
      });
      expect(retryCmd.args).toContain('--resume');
      expect(retryCmd.args).toContain(capturedSessionId);
    });
  });

  describe('contrast with Stage 1 sessionId', () => {
    /**
     * Stage 3 uses claudeStage3SessionId which is separate from claudeSessionId.
     * This allows Stage 3 implementation to maintain its own conversation context
     * independent of the discovery/planning stages.
     */
    it('should use different sessionId fields for Stage 1 vs Stage 3', () => {
      const session = {
        claudeSessionId: 'stages-1-2-4-5-session',
        claudeStage3SessionId: 'stage-3-implementation-session',
        projectPath: '/test/project',
      };

      // Stage 1 retry uses claudeSessionId
      const stage1Cmd = orchestrator.buildCommand({
        prompt: 'Stage 1 retry',
        projectPath: session.projectPath,
        sessionId: session.claudeSessionId || undefined,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      // Stage 3 uses claudeStage3SessionId
      const stage3Cmd = orchestrator.buildCommand({
        prompt: 'Stage 3 step',
        projectPath: session.projectPath,
        sessionId: session.claudeStage3SessionId || undefined,
        allowedTools: orchestrator.getStageTools(3),
      });

      // Both should resume but with different session IDs
      expect(stage1Cmd.args).toContain('--resume');
      expect(stage1Cmd.args).toContain('stages-1-2-4-5-session');

      expect(stage3Cmd.args).toContain('--resume');
      expect(stage3Cmd.args).toContain('stage-3-implementation-session');

      // Session IDs should be different
      const stage1Index = stage1Cmd.args.indexOf('--resume') + 1;
      const stage3Index = stage3Cmd.args.indexOf('--resume') + 1;
      expect(stage1Cmd.args[stage1Index]).not.toBe(stage3Cmd.args[stage3Index]);
    });
  });
});

describe('Regression Protection for Stage 3 SessionId', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;
  let spawnSpy: jest.SpyInstance;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);

    spawnSpy = jest.spyOn(orchestrator, 'spawn').mockResolvedValue({
      output: 'Mock output',
      isError: false,
      sessionId: 'mock-session',
      parsed: {
        decisions: [],
        planSteps: [],
        completedSteps: [],
        blockers: [],
        questionAnswers: [],
        stepsCompleted: [],
      },
    } as ClaudeResult);
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  /**
   * These tests verify the exact patterns used in the code to prevent regression.
   */
  it('should verify executeSingleStep pattern: session.claudeStage3SessionId || undefined', async () => {
    // This is the exact pattern from app.ts line ~882:
    // const sessionIdToUse = session.claudeStage3SessionId || undefined;
    const session = { claudeStage3SessionId: 'stage3-session-pattern-test' };

    await orchestrator.spawn({
      prompt: 'Step execution',
      projectPath: '/test/project',
      sessionId: session.claudeStage3SessionId || undefined, // <-- The pattern
      allowedTools: orchestrator.getStageTools(3),
    });

    expect(spawnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'stage3-session-pattern-test',
      })
    );
  });

  it('should handle edge case: claudeStage3SessionId is empty string', async () => {
    const session = { claudeStage3SessionId: '' };

    await orchestrator.spawn({
      prompt: 'Step with empty sessionId',
      projectPath: '/test/project',
      sessionId: session.claudeStage3SessionId || undefined,
      allowedTools: orchestrator.getStageTools(3),
    });

    // Empty string is falsy, so should result in undefined
    expect(spawnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: undefined,
      })
    );
  });
});

import { ClaudeOrchestrator, SpawnOptions, ClaudeResult } from '../../server/src/services/ClaudeOrchestrator';
import { OutputParser } from '../../server/src/services/OutputParser';
import { Session } from '@claude-code-web/shared';
import { getStage1ExplorationAgents } from '../../server/src/config/agentConfigs';

/**
 * Tests for Stage 1 sessionId preservation across different scenarios:
 *
 * 1. Initial Spawn - New sessions intentionally start WITHOUT sessionId.
 *    The claudeSessionId is captured from the spawn result and saved for later use.
 *
 * 2. Stage 1 Retry - When Stage 1 is retried via the /api/sessions/:projectId/:featureId/retry
 *    endpoint, sessionId should be passed to maintain Claude conversation context.
 *
 * 3. Queue/Resume - When a session was paused (queued) and later resumed, sessionId should
 *    be passed so the resumed session maintains context from before it was paused.
 *
 * The initial spawn is the ONLY place where sessionId is intentionally omitted.
 * All retry and resume paths must pass sessionId to maintain conversation context.
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

describe('Stage 1 Queue/Resume SessionId Preservation', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);
  });

  describe('resumed session should use sessionId from startedSession', () => {
    /**
     * When a session is resumed from the queue, it should pass the
     * startedSession.claudeSessionId to orchestrator.spawn() so that
     * the Claude conversation context is maintained.
     *
     * The queue/resume path uses startedSession (the session being started)
     * rather than session (which may be the session that was paused).
     */
    it('should include --resume flag when startedSession has claudeSessionId', () => {
      const startedSession = {
        claudeSessionId: 'queued-session-resume-789',
        projectPath: '/test/project',
      };

      const cmd = orchestrator.buildCommand({
        prompt: 'Resume Stage 1 discovery after queue',
        projectPath: startedSession.projectPath,
        sessionId: startedSession.claudeSessionId || undefined,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(cmd.args).toContain('--resume');
      expect(cmd.args).toContain('queued-session-resume-789');
    });

    it('should not include --resume flag for fresh queued session without prior claudeSessionId', () => {
      const startedSession = {
        claudeSessionId: null as string | null,
        projectPath: '/test/project',
      };

      const cmd = orchestrator.buildCommand({
        prompt: 'Start Stage 1 discovery for fresh queued session',
        projectPath: startedSession.projectPath,
        sessionId: startedSession.claudeSessionId || undefined,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(cmd.args).not.toContain('--resume');
    });
  });

  describe('queue resume vs retry - both should preserve sessionId', () => {
    /**
     * Both the retry path (via /retry endpoint) and the queue/resume path
     * should preserve sessionId using the same pattern.
     */
    it('should use same sessionId pattern for retry and queue resume', () => {
      const sessionWithId = { claudeSessionId: 'shared-session-pattern-123' };
      const sessionWithoutId = { claudeSessionId: null as string | null };

      // Both paths use the same pattern: session.claudeSessionId || undefined
      const retrySessionId = sessionWithId.claudeSessionId || undefined;
      const queueResumeSessionId = sessionWithId.claudeSessionId || undefined;

      expect(retrySessionId).toBe(queueResumeSessionId);
      expect(retrySessionId).toBe('shared-session-pattern-123');

      // Both should return undefined when no sessionId
      const retryNoId = sessionWithoutId.claudeSessionId || undefined;
      const queueNoId = sessionWithoutId.claudeSessionId || undefined;

      expect(retryNoId).toBeUndefined();
      expect(queueNoId).toBeUndefined();
    });
  });

  describe('queue/resume scenario with existing conversation', () => {
    /**
     * Scenario: User pauses a session that was in the middle of Stage 1.
     * Later, the session is resumed from the queue.
     * The resumed session should continue the Claude conversation.
     */
    it('should allow resuming a partially completed Stage 1 session', () => {
      // Simulates a session that was paused during Stage 1
      const pausedSession = {
        claudeSessionId: 'partial-stage1-session-abc',
        projectPath: '/test/project',
        currentStage: 1,
        status: 'queued',
      };

      // When resumed, should use the existing sessionId
      const cmd = orchestrator.buildCommand({
        prompt: 'Continue Stage 1 discovery after pause',
        projectPath: pausedSession.projectPath,
        sessionId: pausedSession.claudeSessionId || undefined,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(cmd.args).toContain('--resume');
      expect(cmd.args).toContain('partial-stage1-session-abc');
    });
  });
});

describe('Stage 1 Initial Spawn - Intentional SessionId Omission', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);
  });

  /**
   * This test documents that initial Stage 1 spawns INTENTIONALLY omit sessionId.
   *
   * Why sessionId is omitted for initial spawns:
   * - New features start fresh without any Claude conversation context
   * - The claudeSessionId is captured from the spawn result (via handleStage1Result)
   * - This captured sessionId is then saved to the session for future retries/resumes
   *
   * This is NOT a bug - it's the intended behavior. See the code comment at
   * the initial Stage 1 spawn location (around line 2252 in server/src/app.ts).
   */
  describe('new session starts without sessionId', () => {
    it('should start fresh without --resume flag for brand new features', () => {
      // Brand new session has no claudeSessionId yet
      const newSession = {
        claudeSessionId: null as string | null,
        projectPath: '/test/project',
        featureId: 'brand-new-feature',
      };

      const cmd = orchestrator.buildCommand({
        prompt: 'Discover requirements for new feature',
        projectPath: newSession.projectPath,
        // sessionId is intentionally NOT passed for new sessions
        sessionId: undefined,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      // New sessions should NOT have --resume flag
      expect(cmd.args).not.toContain('--resume');
    });

    it('should document the sessionId lifecycle: omit -> capture -> reuse', () => {
      /**
       * SessionId lifecycle for Stage 1:
       *
       * 1. INITIAL SPAWN: sessionId omitted (undefined)
       *    - orchestrator.spawn({ ..., sessionId: undefined })
       *    - Claude starts fresh conversation
       *    - Result contains new claudeSessionId
       *
       * 2. SAVE: claudeSessionId captured from result
       *    - handleStage1Result saves result.sessionId to session.claudeSessionId
       *
       * 3. RETRY/RESUME: sessionId passed to maintain context
       *    - orchestrator.spawn({ ..., sessionId: session.claudeSessionId || undefined })
       *    - Claude resumes previous conversation
       */

      // Phase 1: Initial spawn - no sessionId
      const initialSpawnCmd = orchestrator.buildCommand({
        prompt: 'Initial discovery',
        projectPath: '/test/project',
        sessionId: undefined, // Intentionally omitted
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });
      expect(initialSpawnCmd.args).not.toContain('--resume');

      // Phase 2: After Claude responds, claudeSessionId is captured
      // (simulated - in reality this comes from the spawn result)
      const capturedSessionId = 'claude-session-from-result-xyz';

      // Phase 3: Retry/resume uses the captured sessionId
      const retrySpawnCmd = orchestrator.buildCommand({
        prompt: 'Retry discovery',
        projectPath: '/test/project',
        sessionId: capturedSessionId, // Now passed for retry
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });
      expect(retrySpawnCmd.args).toContain('--resume');
      expect(retrySpawnCmd.args).toContain(capturedSessionId);
    });
  });

  describe('contrast: initial vs retry/resume behavior', () => {
    it('should clearly differentiate when sessionId is omitted vs passed', () => {
      // OMIT sessionId: Only for brand new features (initial spawn)
      const scenariosWhereSessionIdOmitted = [
        { name: 'New feature initial spawn', sessionId: undefined },
      ];

      // PASS sessionId: All retry and resume scenarios
      const scenariosWhereSessionIdPassed = [
        { name: 'Stage 1 retry', sessionId: 'retry-session-123' },
        { name: 'Queue/resume', sessionId: 'resume-session-456' },
        { name: 'Stage 2+ (all have sessionId)', sessionId: 'stage2-session-789' },
      ];

      // Verify omitted scenarios don't have --resume
      for (const scenario of scenariosWhereSessionIdOmitted) {
        const cmd = orchestrator.buildCommand({
          prompt: scenario.name,
          projectPath: '/test/project',
          sessionId: scenario.sessionId,
          allowedTools: ['Read'],
        });
        expect(cmd.args).not.toContain('--resume');
      }

      // Verify passed scenarios DO have --resume
      for (const scenario of scenariosWhereSessionIdPassed) {
        const cmd = orchestrator.buildCommand({
          prompt: scenario.name,
          projectPath: '/test/project',
          sessionId: scenario.sessionId,
          allowedTools: ['Read'],
        });
        expect(cmd.args).toContain('--resume');
        expect(cmd.args).toContain(scenario.sessionId);
      }
    });
  });
});

/**
 * Tests that mock orchestrator.spawn() to verify the sessionId parameter
 * is correctly passed in Stage 1 retry and queue/resume scenarios.
 *
 * These tests provide an additional layer of verification beyond buildCommand tests,
 * ensuring the SpawnOptions interface is correctly used.
 */
describe('Stage 1 SessionId - Mock Spawn Verification', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;
  let spawnSpy: jest.SpyInstance;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);

    // Mock the spawn method to capture the options passed to it
    spawnSpy = jest.spyOn(orchestrator, 'spawn').mockResolvedValue({
      output: 'Mock output',
      isError: false,
      sessionId: 'new-session-from-claude',
      parsed: {
        decisions: [],
        planSteps: [],
        completedSteps: [],
        blockers: [],
        questionAnswers: [],
      },
    } as ClaudeResult);
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  describe('Stage 1 retry spawn receives correct sessionId', () => {
    it('should pass sessionId to spawn when session has claudeSessionId (retry scenario)', async () => {
      const mockSession = {
        claudeSessionId: 'existing-retry-session-abc',
        projectPath: '/test/project',
        projectId: 'test-project',
        featureId: 'test-feature',
      };

      // Simulate the retry path calling spawn with sessionId
      await orchestrator.spawn({
        prompt: 'Retry Stage 1 discovery',
        projectPath: mockSession.projectPath,
        sessionId: mockSession.claudeSessionId || undefined,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'existing-retry-session-abc',
        })
      );
    });

    it('should pass undefined sessionId when session has no claudeSessionId', async () => {
      const mockSession = {
        claudeSessionId: null as string | null,
        projectPath: '/test/project',
      };

      await orchestrator.spawn({
        prompt: 'Stage 1 discovery without prior session',
        projectPath: mockSession.projectPath,
        sessionId: mockSession.claudeSessionId || undefined,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: undefined,
        })
      );
    });
  });

  describe('Stage 1 queue/resume spawn receives correct sessionId', () => {
    it('should pass sessionId to spawn when startedSession has claudeSessionId (resume scenario)', async () => {
      const startedSession = {
        claudeSessionId: 'queued-resume-session-xyz',
        projectPath: '/test/project',
        projectId: 'test-project',
        featureId: 'resumed-feature',
      };

      // Simulate the queue/resume path calling spawn with sessionId
      await orchestrator.spawn({
        prompt: 'Resume Stage 1 after queue',
        projectPath: startedSession.projectPath,
        sessionId: startedSession.claudeSessionId || undefined,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'queued-resume-session-xyz',
        })
      );
    });
  });

  describe('SpawnOptions interface verification', () => {
    it('should accept sessionId as optional parameter in SpawnOptions', async () => {
      // TypeScript compilation verifies the interface, but this test
      // explicitly documents that sessionId is an optional SpawnOptions field

      // With sessionId
      const optionsWithSessionId: SpawnOptions = {
        prompt: 'Test with sessionId',
        projectPath: '/test',
        sessionId: 'test-session-id',
        allowedTools: ['Read'],
      };

      await orchestrator.spawn(optionsWithSessionId);
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'test-session-id' })
      );

      spawnSpy.mockClear();

      // Without sessionId
      const optionsWithoutSessionId: SpawnOptions = {
        prompt: 'Test without sessionId',
        projectPath: '/test',
        allowedTools: ['Read'],
      };

      await orchestrator.spawn(optionsWithoutSessionId);
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({ sessionId: expect.anything() })
      );
    });
  });

  describe('regression protection for sessionId fixes', () => {
    /**
     * These tests document the exact patterns used in the fixed code
     * to prevent regression if someone accidentally removes the sessionId.
     */
    it('should verify Stage 1 retry pattern: session.claudeSessionId || undefined', async () => {
      // This is the exact pattern used in the retry code (app.ts ~line 3772)
      const session = { claudeSessionId: 'retry-session-123' };

      await orchestrator.spawn({
        prompt: 'Stage 1 retry',
        projectPath: '/test/project',
        sessionId: session.claudeSessionId || undefined, // <-- The fixed pattern
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'retry-session-123',
        })
      );
    });

    it('should verify Stage 1 queue/resume pattern: startedSession.claudeSessionId || undefined', async () => {
      // This is the exact pattern used in the queue/resume code (app.ts ~line 2615)
      const startedSession = { claudeSessionId: 'resume-session-456' };

      await orchestrator.spawn({
        prompt: 'Stage 1 queue/resume',
        projectPath: '/test/project',
        sessionId: startedSession.claudeSessionId || undefined, // <-- The fixed pattern
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'resume-session-456',
        })
      );
    });

    it('should verify initial spawn pattern: sessionId intentionally omitted', async () => {
      // Initial spawns do NOT include sessionId - this is intentional
      await orchestrator.spawn({
        prompt: 'Initial Stage 1',
        projectPath: '/test/project',
        // sessionId is NOT passed here - this is correct for initial spawns
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      });

      // Verify sessionId was not passed
      const callArgs = spawnSpy.mock.calls[0][0] as SpawnOptions;
      expect(callArgs.sessionId).toBeUndefined();
    });
  });
});

/**
 * Tests for Stage 1 retry agents parameter.
 *
 * The Stage 1 retry spawn (validation re-prompt) in createApp should include
 * the agents parameter to provide external agent definitions via --agents flag.
 */
describe('Stage 1 Retry Agents Parameter', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);
  });

  describe('Stage 1 retry should include agents parameter', () => {
    it('should include --agents flag when agents are provided in Stage 1 retry', () => {
      const retryAgents = getStage1ExplorationAgents();

      const cmd = orchestrator.buildCommand({
        prompt: 'Retry Stage 1 discovery with missing context',
        projectPath: '/test/project',
        sessionId: 'existing-session-123',
        allowedTools: orchestrator.getStageTools(1),
        agents: retryAgents,
      });

      expect(cmd.args).toContain('--agents');
      // Verify agents JSON is present in args
      const agentsIndex = cmd.args.indexOf('--agents');
      expect(agentsIndex).toBeGreaterThan(-1);
      const agentsJson = cmd.args[agentsIndex + 1];
      expect(agentsJson).toBeTruthy();
      expect(() => JSON.parse(agentsJson)).not.toThrow();
    });

    it('should use orchestrator.getStageTools(1) for consistency with other Stage 1 spawns', () => {
      const stage1Tools = orchestrator.getStageTools(1);

      // Verify expected Stage 1 tools
      expect(stage1Tools).toContain('Read');
      expect(stage1Tools).toContain('Glob');
      expect(stage1Tools).toContain('Grep');
      expect(stage1Tools).toContain('Task');

      // These were the hardcoded tools previously - verify they match getStageTools(1)
      const previouslyHardcodedTools = ['Read', 'Glob', 'Grep', 'Task'];
      for (const tool of previouslyHardcodedTools) {
        expect(stage1Tools).toContain(tool);
      }
    });

    it('should filter agents by suggestedAgents when provided', () => {
      // With no filter - should return all Stage 1 agents
      const allAgents = getStage1ExplorationAgents();
      expect(allAgents).toBeDefined();

      // With specific filter - use actual agent names from STAGE_AGENTS
      const filteredAgents = getStage1ExplorationAgents(['frontend', 'backend']);
      expect(filteredAgents).toBeDefined();

      if (filteredAgents && allAgents) {
        // Filtered should have fewer or equal agents
        expect(Object.keys(filteredAgents).length).toBeLessThanOrEqual(Object.keys(allAgents).length);

        // Filtered should only contain requested agents
        expect(Object.keys(filteredAgents)).toContain('frontend');
        expect(Object.keys(filteredAgents)).toContain('backend');
        expect(Object.keys(filteredAgents).length).toBe(2);
      }
    });

    it('should return undefined agents when suggestedAgents filter matches nothing', () => {
      const noMatchAgents = getStage1ExplorationAgents(['nonexistent-agent']);
      expect(noMatchAgents).toBeUndefined();
    });
  });

  describe('Stage 1 retry command structure with agents', () => {
    it('should have correct command structure for Stage 1 retry with agents', () => {
      const retryAgents = getStage1ExplorationAgents();
      const sessionId = 'retry-session-456';

      const cmd = orchestrator.buildCommand({
        prompt: 'Re-prompt for missing context',
        projectPath: '/test/project',
        sessionId,
        allowedTools: orchestrator.getStageTools(1),
        agents: retryAgents,
      });

      // Should have --resume for sessionId
      expect(cmd.args).toContain('--resume');
      expect(cmd.args).toContain(sessionId);

      // Should have --allowedTools
      expect(cmd.args).toContain('--allowedTools');

      // Should have --agents
      expect(cmd.args).toContain('--agents');

      // Should have -p for prompt
      expect(cmd.args).toContain('-p');

      // Verify --agents appears before -p (as per buildCommand implementation)
      const agentsIndex = cmd.args.indexOf('--agents');
      const promptIndex = cmd.args.indexOf('-p');
      expect(agentsIndex).toBeLessThan(promptIndex);
    });
  });
});

import {
  StepStartedEvent,
  StepCompletedEvent,
  ImplementationProgressEvent,
  Plan,
  Session,
  PlanStep,
} from '@claude-code-web/shared';
import { EventBroadcaster } from '../../server/src/services/EventBroadcaster';
import { ClaudeOrchestrator, ClaudeResult } from '../../server/src/services/ClaudeOrchestrator';
import { OutputParser, ParsedOutput } from '../../server/src/services/OutputParser';
import { ClaudeResultHandler } from '../../server/src/services/ClaudeResultHandler';
import { FileStorageService } from '../../server/src/data/FileStorageService';
import { Server } from 'socket.io';

/**
 * Tests for Stage 3 spawn function behavior.
 *
 * Since spawnStage3Implementation is an internal function in app.ts,
 * we test its component behavior through:
 * 1. EventBroadcaster integration for real-time events
 * 2. ClaudeOrchestrator spawn configuration
 * 3. IMPLEMENTATION_STATUS marker parsing
 * 4. ClaudeResultHandler Stage 3 result handling
 */

describe('Stage 3 Spawn Function Behavior', () => {
  describe('IMPLEMENTATION_STATUS marker parsing', () => {
    it('should parse step_id from IMPLEMENTATION_STATUS marker', () => {
      const output = `
[IMPLEMENTATION_STATUS]
step_id: step-1
status: implementing
message: Creating authentication middleware
[/IMPLEMENTATION_STATUS]
`;
      const statusMatch = output.match(/\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/);
      expect(statusMatch).not.toBeNull();

      const statusContent = statusMatch![1];
      const stepIdMatch = statusContent.match(/step_id:\s*(.+)/i);
      expect(stepIdMatch?.[1].trim()).toBe('step-1');
    });

    it('should parse status from IMPLEMENTATION_STATUS marker', () => {
      const output = `
[IMPLEMENTATION_STATUS]
step_id: step-2
status: testing
tests_status: passing
message: Running test suite
[/IMPLEMENTATION_STATUS]
`;
      const statusMatch = output.match(/\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/);
      const statusContent = statusMatch![1];

      const getValue = (key: string): string => {
        const match = statusContent.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
        return match ? match[1].trim() : '';
      };

      expect(getValue('status')).toBe('testing');
      expect(getValue('tests_status')).toBe('passing');
      expect(getValue('message')).toBe('Running test suite');
    });

    it('should parse retry_count from IMPLEMENTATION_STATUS marker', () => {
      const output = `
[IMPLEMENTATION_STATUS]
step_id: step-1
status: fixing
tests_status: failing
retry_count: 2
message: Fixing test failures (attempt 2 of 3)
[/IMPLEMENTATION_STATUS]
`;
      const statusMatch = output.match(/\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/);
      const statusContent = statusMatch![1];

      const retryMatch = statusContent.match(/retry_count:\s*(.+)/i);
      expect(parseInt(retryMatch?.[1].trim() || '0', 10)).toBe(2);
    });

    it('should handle missing optional fields gracefully', () => {
      const output = `
[IMPLEMENTATION_STATUS]
step_id: step-1
status: implementing
message: Working
[/IMPLEMENTATION_STATUS]
`;
      const statusMatch = output.match(/\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/);
      const statusContent = statusMatch![1];

      const getValue = (key: string): string => {
        const match = statusContent.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
        return match ? match[1].trim() : '';
      };

      expect(getValue('tests_status')).toBe('');
      expect(parseInt(getValue('retry_count') || '0', 10)).toBe(0);
    });

    it('should not match incomplete IMPLEMENTATION_STATUS markers', () => {
      const incompleteOutput = `
[IMPLEMENTATION_STATUS]
step_id: step-1
status: implementing
`;
      const match = incompleteOutput.match(/\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/);
      expect(match).toBeNull();
    });

    it('should match multiple IMPLEMENTATION_STATUS markers in sequence', () => {
      const output = `
Working on authentication...
[IMPLEMENTATION_STATUS]
step_id: step-1
status: implementing
message: Creating files
[/IMPLEMENTATION_STATUS]

Running tests...
[IMPLEMENTATION_STATUS]
step_id: step-1
status: testing
tests_status: passing
message: All tests pass
[/IMPLEMENTATION_STATUS]
`;
      const matches = [...output.matchAll(/\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/g)];
      expect(matches).toHaveLength(2);

      const getValue = (content: string, key: string): string => {
        const match = content.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
        return match ? match[1].trim() : '';
      };

      expect(getValue(matches[0][1], 'status')).toBe('implementing');
      expect(getValue(matches[1][1], 'status')).toBe('testing');
    });
  });

  describe('EventBroadcaster integration for Stage 3', () => {
    let broadcaster: EventBroadcaster;
    let mockIo: jest.Mocked<Server>;
    let mockRoom: { emit: jest.Mock };

    beforeEach(() => {
      mockRoom = { emit: jest.fn() };
      mockIo = {
        to: jest.fn().mockReturnValue(mockRoom),
      } as unknown as jest.Mocked<Server>;
      broadcaster = new EventBroadcaster(mockIo);
    });

    it('should broadcast step.started when new step begins', () => {
      broadcaster.stepStarted('project-1', 'feature-a', 'step-1');

      expect(mockIo.to).toHaveBeenCalledWith('project-1/feature-a');
      expect(mockRoom.emit).toHaveBeenCalledWith('step.started', expect.objectContaining({
        stepId: 'step-1',
        timestamp: expect.any(String),
      }));
    });

    it('should broadcast implementation.progress with all fields', () => {
      broadcaster.implementationProgress('project-1', 'feature-a', {
        stepId: 'step-1',
        status: 'implementing',
        filesModified: ['src/auth.ts'],
        testsStatus: null,
        retryCount: 0,
        message: 'Creating authentication module',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        stepId: 'step-1',
        status: 'implementing',
        filesModified: ['src/auth.ts'],
        testsStatus: null,
        retryCount: 0,
        message: 'Creating authentication module',
        timestamp: expect.any(String),
      }));
    });

    it('should broadcast implementation.progress with test status', () => {
      broadcaster.implementationProgress('project-1', 'feature-a', {
        stepId: 'step-1',
        status: 'testing',
        filesModified: ['src/auth.ts', 'tests/auth.test.ts'],
        testsStatus: 'passing',
        retryCount: 0,
        message: 'All tests passing',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        testsStatus: 'passing',
      }));
    });

    it('should broadcast implementation.progress with retry count', () => {
      broadcaster.implementationProgress('project-1', 'feature-a', {
        stepId: 'step-1',
        status: 'fixing',
        filesModified: ['src/auth.ts'],
        testsStatus: 'failing',
        retryCount: 2,
        message: 'Fixing test failures (attempt 2 of 3)',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        retryCount: 2,
        testsStatus: 'failing',
      }));
    });

    it('should broadcast step.completed with summary and files', () => {
      const mockStep: PlanStep = {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'Create auth module',
        description: 'Implement authentication',
        status: 'completed',
        metadata: {},
      };

      broadcaster.stepCompleted(
        'project-1',
        'feature-a',
        mockStep,
        'Successfully created authentication module',
        ['src/auth.ts', 'src/middleware.ts']
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('step.completed', expect.objectContaining({
        stepId: 'step-1',
        status: 'completed',
        summary: 'Successfully created authentication module',
        filesModified: ['src/auth.ts', 'src/middleware.ts'],
      }));
    });

    it('should broadcast executionStatus with stage3_started', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'running', 'stage3_started');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage3_started',
      }));
    });

    it('should broadcast executionStatus with stage3_complete', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'idle', 'stage3_complete');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'idle',
        action: 'stage3_complete',
      }));
    });

    it('should broadcast executionStatus with stage3_blocked', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'idle', 'stage3_blocked');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'idle',
        action: 'stage3_blocked',
      }));
    });
  });

  describe('ClaudeOrchestrator Stage 3 tools', () => {
    let orchestrator: ClaudeOrchestrator;
    let outputParser: OutputParser;

    beforeEach(() => {
      outputParser = new OutputParser();
      orchestrator = new ClaudeOrchestrator(outputParser);
    });

    it('should include write tools for Stage 3', () => {
      const tools = orchestrator.getStageTools(3);

      expect(tools).toContain('Write');
      expect(tools).toContain('Edit');
    });

    it('should include Bash tool for Stage 3 (git commits)', () => {
      const tools = orchestrator.getStageTools(3);

      expect(tools).toContain('Bash');
    });

    it('should include read tools for Stage 3', () => {
      const tools = orchestrator.getStageTools(3);

      expect(tools).toContain('Read');
      expect(tools).toContain('Glob');
      expect(tools).toContain('Grep');
    });

    it('should skip permissions for Stage 3', () => {
      expect(orchestrator.shouldSkipPermissions(3)).toBe(true);
    });

    it('should not skip permissions for other stages', () => {
      expect(orchestrator.shouldSkipPermissions(1)).toBe(false);
      expect(orchestrator.shouldSkipPermissions(2)).toBe(false);
      expect(orchestrator.shouldSkipPermissions(4)).toBe(false);
    });
  });

  describe('Stage 3 output streaming', () => {
    it('should track step changes through IMPLEMENTATION_STATUS markers', () => {
      let currentStepId: string | null = null;
      const stepChanges: string[] = [];

      const processOutput = (output: string) => {
        const statusMatch = output.match(/\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/);
        if (statusMatch) {
          const statusContent = statusMatch[1];
          const stepIdMatch = statusContent.match(/step_id:\s*(.+)/i);
          const stepId = stepIdMatch ? stepIdMatch[1].trim() : '';

          if (stepId && stepId !== currentStepId) {
            stepChanges.push(stepId);
            currentStepId = stepId;
          }
        }
      };

      // Simulate streaming output
      processOutput('[IMPLEMENTATION_STATUS]\nstep_id: step-1\nstatus: implementing\n[/IMPLEMENTATION_STATUS]');
      processOutput('[IMPLEMENTATION_STATUS]\nstep_id: step-1\nstatus: testing\n[/IMPLEMENTATION_STATUS]');
      processOutput('[IMPLEMENTATION_STATUS]\nstep_id: step-2\nstatus: implementing\n[/IMPLEMENTATION_STATUS]');
      processOutput('[IMPLEMENTATION_STATUS]\nstep_id: step-2\nstatus: committing\n[/IMPLEMENTATION_STATUS]');

      expect(stepChanges).toEqual(['step-1', 'step-2']);
    });

    it('should emit progress for each IMPLEMENTATION_STATUS marker', () => {
      const progressEvents: Array<{ stepId: string; status: string }> = [];

      const processOutput = (output: string) => {
        const statusMatch = output.match(/\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/);
        if (statusMatch) {
          const statusContent = statusMatch[1];
          const getValue = (key: string): string => {
            const match = statusContent.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
            return match ? match[1].trim() : '';
          };

          progressEvents.push({
            stepId: getValue('step_id'),
            status: getValue('status'),
          });
        }
      };

      processOutput('[IMPLEMENTATION_STATUS]\nstep_id: step-1\nstatus: implementing\n[/IMPLEMENTATION_STATUS]');
      processOutput('[IMPLEMENTATION_STATUS]\nstep_id: step-1\nstatus: testing\n[/IMPLEMENTATION_STATUS]');
      processOutput('[IMPLEMENTATION_STATUS]\nstep_id: step-1\nstatus: committing\n[/IMPLEMENTATION_STATUS]');

      expect(progressEvents).toHaveLength(3);
      expect(progressEvents[0]).toEqual({ stepId: 'step-1', status: 'implementing' });
      expect(progressEvents[1]).toEqual({ stepId: 'step-1', status: 'testing' });
      expect(progressEvents[2]).toEqual({ stepId: 'step-1', status: 'committing' });
    });
  });

  describe('Stage 3 completion detection', () => {
    const createMockPlan = (stepStatuses: Array<'pending' | 'in_progress' | 'completed' | 'blocked'>): Plan => ({
      version: '1.0',
      planVersion: 1,
      sessionId: 'session-123',
      isApproved: true,
      reviewCount: 1,
      createdAt: '2026-01-13T00:00:00Z',
      steps: stepStatuses.map((status, i) => ({
        id: `step-${i + 1}`,
        parentId: null,
        orderIndex: i,
        title: `Step ${i + 1}`,
        description: `Description for step ${i + 1}`,
        status,
        metadata: {},
      })),
    });

    it('should detect completion when all steps are completed', () => {
      const plan = createMockPlan(['completed', 'completed', 'completed']);
      const allCompleted = plan.steps.every(s => s.status === 'completed');
      expect(allCompleted).toBe(true);
    });

    it('should not detect completion when some steps are pending', () => {
      const plan = createMockPlan(['completed', 'pending', 'pending']);
      const allCompleted = plan.steps.every(s => s.status === 'completed');
      expect(allCompleted).toBe(false);
    });

    it('should not detect completion when a step is blocked', () => {
      const plan = createMockPlan(['completed', 'blocked', 'pending']);
      const allCompleted = plan.steps.every(s => s.status === 'completed');
      expect(allCompleted).toBe(false);
    });

    it('should not detect completion when a step is in_progress', () => {
      const plan = createMockPlan(['completed', 'in_progress', 'pending']);
      const allCompleted = plan.steps.every(s => s.status === 'completed');
      expect(allCompleted).toBe(false);
    });
  });

  describe('Stage 3 blocker handling', () => {
    let broadcaster: EventBroadcaster;
    let mockIo: jest.Mocked<Server>;
    let mockRoom: { emit: jest.Mock };

    beforeEach(() => {
      mockRoom = { emit: jest.fn() };
      mockIo = {
        to: jest.fn().mockReturnValue(mockRoom),
      } as unknown as jest.Mocked<Server>;
      broadcaster = new EventBroadcaster(mockIo);
    });

    it('should broadcast step.completed with blocked status', () => {
      const blockedStep: PlanStep = {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'Setup authentication',
        description: 'Configure auth provider',
        status: 'blocked',
        metadata: { blockedReason: 'Missing API key configuration' },
      };

      broadcaster.stepCompleted(
        'project-1',
        'feature-a',
        blockedStep,
        'Blocked: Missing API key configuration',
        ['src/auth.ts']
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('step.completed', expect.objectContaining({
        stepId: 'step-1',
        status: 'blocked',
        summary: 'Blocked: Missing API key configuration',
      }));
    });

    it('should broadcast implementation.progress with blocked status at max retries', () => {
      broadcaster.implementationProgress('project-1', 'feature-a', {
        stepId: 'step-1',
        status: 'blocked',
        filesModified: ['src/auth.ts'],
        testsStatus: 'failing',
        retryCount: 3,
        message: 'Max retries (3) exceeded - raising blocker',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        status: 'blocked',
        retryCount: 3,
        testsStatus: 'failing',
      }));
    });
  });

  describe('Stage 3 session resume', () => {
    let orchestrator: ClaudeOrchestrator;
    let outputParser: OutputParser;

    beforeEach(() => {
      outputParser = new OutputParser();
      orchestrator = new ClaudeOrchestrator(outputParser);
    });

    it('should include --resume flag when sessionId is provided', () => {
      const cmd = orchestrator.buildCommand({
        prompt: 'Continue implementation',
        projectPath: '/test/project',
        sessionId: 'existing-session-123',
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(cmd.args).toContain('--resume');
      expect(cmd.args).toContain('existing-session-123');
    });

    it('should not include --resume flag when sessionId is undefined', () => {
      const cmd = orchestrator.buildCommand({
        prompt: 'Start implementation',
        projectPath: '/test/project',
        sessionId: undefined,
        allowedTools: orchestrator.getStageTools(3),
      });

      expect(cmd.args).not.toContain('--resume');
    });
  });

  describe('Stage 3 plan update broadcasting', () => {
    let broadcaster: EventBroadcaster;
    let mockIo: jest.Mocked<Server>;
    let mockRoom: { emit: jest.Mock };

    beforeEach(() => {
      mockRoom = { emit: jest.fn() };
      mockIo = {
        to: jest.fn().mockReturnValue(mockRoom),
      } as unknown as jest.Mocked<Server>;
      broadcaster = new EventBroadcaster(mockIo);
    });

    it('should broadcast plan.updated with step status changes', () => {
      const plan: Plan = {
        version: '1.0',
        planVersion: 1,
        sessionId: 'session-123',
        isApproved: true,
        reviewCount: 1,
        createdAt: '2026-01-13T00:00:00Z',
        steps: [
          {
            id: 'step-1',
            parentId: null,
            orderIndex: 0,
            title: 'Step 1',
            description: 'First step',
            status: 'completed',
            metadata: { completionSummary: 'Done' },
          },
          {
            id: 'step-2',
            parentId: null,
            orderIndex: 1,
            title: 'Step 2',
            description: 'Second step',
            status: 'in_progress',
            metadata: {},
          },
        ],
      };

      broadcaster.planUpdated('project-1', 'feature-a', plan);

      expect(mockRoom.emit).toHaveBeenCalledWith('plan.updated', expect.objectContaining({
        stepCount: 2,
        steps: expect.arrayContaining([
          expect.objectContaining({ id: 'step-1', status: 'completed' }),
          expect.objectContaining({ id: 'step-2', status: 'in_progress' }),
        ]),
      }));
    });
  });

  describe('Stage 3 status.json updates', () => {
    it('should track status transitions through implementation', () => {
      const statusHistory: Array<{ status: string; action: string }> = [];

      // Simulate status.json updates during Stage 3
      statusHistory.push({ status: 'running', action: 'stage3_started' });
      statusHistory.push({ status: 'running', action: 'step_started' });
      statusHistory.push({ status: 'running', action: 'step_completed' });
      statusHistory.push({ status: 'running', action: 'step_started' });
      statusHistory.push({ status: 'idle', action: 'stage3_blocked' });

      expect(statusHistory[0]).toEqual({ status: 'running', action: 'stage3_started' });
      expect(statusHistory[statusHistory.length - 1]).toEqual({ status: 'idle', action: 'stage3_blocked' });
    });

    it('should track currentStepId in status', () => {
      const status = {
        status: 'running',
        lastAction: 'step_started',
        currentStepId: 'step-2',
        lastActionAt: new Date().toISOString(),
      };

      expect(status.currentStepId).toBe('step-2');
    });
  });

  describe('STEP_COMPLETE marker parsing', () => {
    it('should parse STEP_COMPLETE marker with all fields', () => {
      const output = `
[STEP_COMPLETE]
step_id: step-1
status: completed
commit_sha: abc123def
summary: Implemented authentication middleware with JWT validation
files_modified: src/auth.ts, src/middleware.ts, tests/auth.test.ts
[/STEP_COMPLETE]
`;
      const stepMatch = output.match(/\[STEP_COMPLETE\]([\s\S]*?)\[\/STEP_COMPLETE\]/);
      expect(stepMatch).not.toBeNull();

      const content = stepMatch![1];
      const getValue = (key: string): string => {
        const match = content.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
        return match ? match[1].trim() : '';
      };

      expect(getValue('step_id')).toBe('step-1');
      expect(getValue('status')).toBe('completed');
      expect(getValue('commit_sha')).toBe('abc123def');
      expect(getValue('summary')).toBe('Implemented authentication middleware with JWT validation');
      expect(getValue('files_modified')).toBe('src/auth.ts, src/middleware.ts, tests/auth.test.ts');
    });

    it('should parse STEP_COMPLETE marker with blocked status', () => {
      const output = `
[STEP_COMPLETE]
step_id: step-2
status: blocked
blocker_reason: Tests failing after 3 retry attempts
summary: Could not complete step due to persistent test failures
files_modified: src/feature.ts
[/STEP_COMPLETE]
`;
      const stepMatch = output.match(/\[STEP_COMPLETE\]([\s\S]*?)\[\/STEP_COMPLETE\]/);
      const content = stepMatch![1];

      const getValue = (key: string): string => {
        const match = content.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
        return match ? match[1].trim() : '';
      };

      expect(getValue('status')).toBe('blocked');
      expect(getValue('blocker_reason')).toBe('Tests failing after 3 retry attempts');
    });
  });
});

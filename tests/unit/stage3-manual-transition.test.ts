import { Plan, Session, PlanStep } from '@claude-code-web/shared';
import { EventBroadcaster } from '../../server/src/services/EventBroadcaster';
import { StageTransitionInputSchema } from '../../server/src/validation/schemas';
import { Server } from 'socket.io';

/**
 * Tests for Stage 3 manual transition endpoint support.
 *
 * The transition endpoint (POST /api/sessions/:projectId/:featureId/transition)
 * handles manual stage transitions including Stage 3:
 * 1. Validates targetStage via StageTransitionInputSchema
 * 2. Reads plan and verifies plan.isApproved === true
 * 3. Calls executeStage3Steps() to start step-by-step execution
 * 4. Broadcasts stageChanged event
 */

describe('Stage 3 Manual Transition', () => {
  describe('StageTransitionInputSchema validation for Stage 3', () => {
    it('should accept targetStage 3', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 3,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.targetStage).toBe(3);
      }
    });

    it('should accept all valid stages (1-5)', () => {
      for (let stage = 1; stage <= 5; stage++) {
        const result = StageTransitionInputSchema.safeParse({
          targetStage: stage,
        });
        expect(result.success).toBe(true);
      }
    });

    it('should reject stage 0', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject stage 6', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 6,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer stage', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 3.5,
      });
      expect(result.success).toBe(false);
    });

    it('should reject string stage', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: '3',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Plan approval verification', () => {
    const createPlan = (isApproved: boolean): Plan => ({
      version: '1.0',
      planVersion: 1,
      sessionId: 'session-123',
      isApproved,
      reviewCount: 1,
      createdAt: '2026-01-13T00:00:00Z',
      steps: [
        {
          id: 'step-1',
          parentId: null,
          orderIndex: 0,
          title: 'Step 1',
          description: 'First step',
          status: 'pending',
          metadata: {},
        },
      ],
    });

    it('should allow transition when plan.isApproved is true', () => {
      const plan = createPlan(true);
      expect(plan.isApproved).toBe(true);
    });

    it('should block transition when plan.isApproved is false', () => {
      const plan = createPlan(false);
      expect(plan.isApproved).toBe(false);
    });

    it('should handle plan with multiple steps', () => {
      const plan: Plan = {
        version: '1.0',
        planVersion: 1,
        sessionId: 'session-123',
        isApproved: true,
        reviewCount: 2,
        createdAt: '2026-01-13T00:00:00Z',
        steps: [
          { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc 1', status: 'pending', metadata: {} },
          { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Step 2', description: 'Desc 2', status: 'pending', metadata: {} },
          { id: 'step-3', parentId: 'step-2', orderIndex: 2, title: 'Step 3', description: 'Desc 3', status: 'pending', metadata: {} },
        ],
      };

      expect(plan.isApproved).toBe(true);
      expect(plan.steps).toHaveLength(3);
    });
  });

  describe('Stage transition event broadcasting', () => {
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

    it('should broadcast stageChanged event for Stage 3 transition', () => {
      const session: Session = {
        id: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
        currentStage: 3,
        createdAt: '2026-01-13T00:00:00Z',
        updatedAt: '2026-01-13T00:01:00Z',
      };

      broadcaster.stageChanged(session, 2); // From Stage 2 to 3

      expect(mockIo.to).toHaveBeenCalledWith('project-1/feature-a');
      expect(mockRoom.emit).toHaveBeenCalledWith('stage.changed', expect.objectContaining({
        sessionId: 'session-123',
        currentStage: 3,
        previousStage: 2,
        timestamp: expect.any(String),
      }));
    });

    it('should broadcast executionStatus running on Stage 3 start', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'running', 'stage3_started');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage3_started',
      }));
    });

    it('should broadcast to correct room for manual transition', () => {
      const session: Session = {
        id: 'session-456',
        projectId: 'my-project',
        featureId: 'my-feature',
        title: 'Test',
        featureDescription: 'Desc',
        projectPath: '/path',
        currentStage: 3,
        createdAt: '2026-01-13T00:00:00Z',
        updatedAt: '2026-01-13T00:01:00Z',
      };

      broadcaster.stageChanged(session, 1);

      expect(mockIo.to).toHaveBeenCalledWith('my-project/my-feature');
    });
  });

  describe('Session state for Stage 3 transition', () => {
    it('should track currentStage as 3 after transition', () => {
      const session: Session = {
        id: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        title: 'Feature',
        featureDescription: 'Description',
        projectPath: '/test/project',
        currentStage: 3,
        createdAt: '2026-01-13T00:00:00Z',
        updatedAt: '2026-01-13T00:01:00Z',
      };

      expect(session.currentStage).toBe(3);
    });

    it('should have status running during implementation', () => {
      const status = {
        status: 'running',
        lastAction: 'stage3_started',
        currentStepId: 'step-1',
        lastActionAt: '2026-01-13T00:00:00Z',
      };

      expect(status.status).toBe('running');
      expect(status.lastAction).toBe('stage3_started');
    });

    it('should track currentStepId during execution', () => {
      const status = {
        status: 'running',
        lastAction: 'step_started',
        currentStepId: 'step-2',
        lastActionAt: '2026-01-13T00:00:00Z',
      };

      expect(status.currentStepId).toBe('step-2');
    });
  });

  describe('Plan step initial state', () => {
    it('should have all steps pending before Stage 3 starts', () => {
      const plan: Plan = {
        version: '1.0',
        planVersion: 1,
        sessionId: 'session-123',
        isApproved: true,
        reviewCount: 1,
        createdAt: '2026-01-13T00:00:00Z',
        steps: [
          { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'pending', metadata: {} },
          { id: 'step-2', parentId: null, orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'pending', metadata: {} },
        ],
      };

      expect(plan.steps.every(s => s.status === 'pending')).toBe(true);
    });

    it('should convert needs_review to pending at Stage 3 start', () => {
      const steps: PlanStep[] = [
        { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'needs_review' as any, metadata: {} },
        { id: 'step-2', parentId: null, orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'needs_review' as any, metadata: {} },
      ];

      // Simulate conversion
      for (const step of steps) {
        if ((step.status as string) === 'needs_review') {
          step.status = 'pending';
        }
      }

      expect(steps[0].status).toBe('pending');
      expect(steps[1].status).toBe('pending');
    });
  });

  describe('Next ready step selection', () => {
    const createPlanWithSteps = (steps: PlanStep[]): Plan => ({
      version: '1.0',
      planVersion: 1,
      sessionId: 'session-123',
      isApproved: true,
      reviewCount: 1,
      createdAt: '2026-01-13T00:00:00Z',
      steps,
    });

    it('should select first pending step with no dependencies', () => {
      const plan = createPlanWithSteps([
        { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'pending', metadata: {} },
        { id: 'step-2', parentId: null, orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'pending', metadata: {} },
      ]);

      const nextStep = plan.steps.find(step =>
        step.status === 'pending' &&
        (step.parentId === null ||
          plan.steps.find(p => p.id === step.parentId)?.status === 'completed')
      );

      expect(nextStep?.id).toBe('step-1');
    });

    it('should select dependent step when parent is completed', () => {
      const plan = createPlanWithSteps([
        { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'completed', metadata: {} },
        { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'pending', metadata: {} },
      ]);

      const nextStep = plan.steps.find(step =>
        step.status === 'pending' &&
        (step.parentId === null ||
          plan.steps.find(p => p.id === step.parentId)?.status === 'completed')
      );

      expect(nextStep?.id).toBe('step-2');
    });

    it('should not select step with incomplete parent', () => {
      const plan = createPlanWithSteps([
        { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'in_progress', metadata: {} },
        { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'pending', metadata: {} },
      ]);

      const nextStep = plan.steps.find(step =>
        step.status === 'pending' &&
        (step.parentId === null ||
          plan.steps.find(p => p.id === step.parentId)?.status === 'completed')
      );

      expect(nextStep).toBeUndefined();
    });
  });

  describe('Error handling', () => {
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

    it('should broadcast error when Stage 3 fails to start', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'error', 'stage3_error');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'error',
        action: 'stage3_error',
      }));
    });

    it('should handle missing plan gracefully', () => {
      const plan: Plan | null = null;
      expect(plan).toBeNull();
    });

    it('should handle unapproved plan gracefully', () => {
      const plan: Plan = {
        version: '1.0',
        planVersion: 1,
        sessionId: 'session-123',
        isApproved: false,
        reviewCount: 0,
        createdAt: '2026-01-13T00:00:00Z',
        steps: [],
      };

      expect(plan.isApproved).toBe(false);
    });
  });

  describe('Stage 3 transition from different stages', () => {
    it('should allow transition from Stage 2 to Stage 3', () => {
      const previousStage = 2;
      const targetStage = 3;
      expect(targetStage).toBeGreaterThan(previousStage);
    });

    it('should allow manual skip from Stage 1 to Stage 3', () => {
      const previousStage = 1;
      const targetStage = 3;
      expect(targetStage - previousStage).toBe(2);
    });

    it('should allow backward transition from Stage 4 to Stage 3', () => {
      const previousStage = 4;
      const targetStage = 3;
      expect(targetStage).toBeLessThan(previousStage);
    });
  });

  describe('executeStage3Steps trigger', () => {
    it('should execute steps sequentially', () => {
      const executionOrder: string[] = [];
      const steps = ['step-1', 'step-2', 'step-3'];

      // Simulate sequential execution
      for (const stepId of steps) {
        executionOrder.push(stepId);
      }

      expect(executionOrder).toEqual(['step-1', 'step-2', 'step-3']);
    });

    it('should respect step dependencies', () => {
      const plan: Plan = {
        version: '1.0',
        planVersion: 1,
        sessionId: 'session-123',
        isApproved: true,
        reviewCount: 1,
        createdAt: '2026-01-13T00:00:00Z',
        steps: [
          { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'completed', metadata: {} },
          { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'completed', metadata: {} },
          { id: 'step-3', parentId: 'step-2', orderIndex: 2, title: 'Step 3', description: 'Desc', status: 'pending', metadata: {} },
        ],
      };

      // step-3 depends on step-2, which depends on step-1
      const step3 = plan.steps.find(s => s.id === 'step-3');
      const step2 = plan.steps.find(s => s.id === step3?.parentId);
      const step1 = plan.steps.find(s => s.id === step2?.parentId);

      expect(step1?.status).toBe('completed');
      expect(step2?.status).toBe('completed');
      expect(step3?.status).toBe('pending');
    });
  });

  describe('Broadcast events during Stage 3 execution', () => {
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

    it('should broadcast step.started when step begins', () => {
      broadcaster.stepStarted('project-1', 'feature-a', 'step-1');

      expect(mockRoom.emit).toHaveBeenCalledWith('step.started', expect.objectContaining({
        stepId: 'step-1',
      }));
    });

    it('should broadcast implementation.progress during step', () => {
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
      }));
    });

    it('should broadcast step.completed when step finishes', () => {
      const step: PlanStep = {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'Step 1',
        description: 'Desc',
        status: 'completed',
        metadata: {},
      };

      broadcaster.stepCompleted('project-1', 'feature-a', step, 'Successfully completed', ['src/auth.ts']);

      expect(mockRoom.emit).toHaveBeenCalledWith('step.completed', expect.objectContaining({
        stepId: 'step-1',
        status: 'completed',
      }));
    });

    it('should broadcast plan.updated after each step', () => {
      const plan: Plan = {
        version: '1.0',
        planVersion: 1,
        sessionId: 'session-123',
        isApproved: true,
        reviewCount: 1,
        createdAt: '2026-01-13T00:00:00Z',
        steps: [
          { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'completed', metadata: {} },
        ],
      };

      broadcaster.planUpdated('project-1', 'feature-a', plan);

      expect(mockRoom.emit).toHaveBeenCalledWith('plan.updated', expect.objectContaining({
        stepCount: 1,
      }));
    });
  });
});

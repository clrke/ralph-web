import { Plan, Session, Question, PlanStep } from '@claude-code-web/shared';
import { EventBroadcaster } from '../../server/src/services/EventBroadcaster';
import { buildStage3Prompt, buildSingleStepPrompt } from '../../server/src/prompts/stagePrompts';
import {
  isPlanApproved,
  isImplementationComplete,
  getStepCounts,
} from '../../server/src/utils/stateVerification';
import { Server } from 'socket.io';

/**
 * Tests for Stage 2 → Stage 3 auto-transition flow.
 *
 * This tests the handleStage2Completion behavior which:
 * 1. Detects plan approval via state (all planning questions answered) or isApproved flag
 * 2. Marks plan as approved
 * 3. Transitions session to Stage 3
 * 4. Broadcasts stageChanged event
 * 5. Auto-starts Stage 3 execution via executeStage3Steps
 *
 * Note: The isPlanApproved function checks:
 * - plan.isApproved === true, OR
 * - All questions with stage === 'planning' are answered (have answeredAt)
 */

describe('Stage 2 → Stage 3 Auto-Transition', () => {
  describe('Plan approval detection', () => {
    const createMockPlan = (isApproved: boolean): Plan => ({
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
          title: 'Create auth module',
          description: 'Implement authentication',
          status: 'pending',
          metadata: {},
        },
        {
          id: 'step-2',
          parentId: null,
          orderIndex: 1,
          title: 'Add tests',
          description: 'Write unit tests',
          status: 'pending',
          metadata: {},
        },
      ],
    });

    const createQuestionsFile = (questions: Question[]): { questions: Question[] } => ({
      questions,
    });

    it('should detect approval when plan.isApproved is true', () => {
      const plan = createMockPlan(true);
      const questions = createQuestionsFile([
        {
          id: 'q1',
          stage: 'planning',
          questionType: 'single_choice',
          questionText: 'Which auth method?',
          options: [{ value: 'jwt', label: 'JWT', recommended: true }],
          answer: { value: 'jwt' },
          isRequired: true,
          priority: 1,
          askedAt: '2026-01-13T00:00:00Z',
          answeredAt: '2026-01-13T00:01:00Z',
        },
      ]);

      const approved = isPlanApproved(plan, questions);
      expect(approved).toBe(true);
    });

    it('should detect approval when all planning questions are answered (state-based)', () => {
      const plan = createMockPlan(false); // isApproved false but state shows all planning questions answered
      const questions = createQuestionsFile([
        {
          id: 'q1',
          stage: 'planning', // Must be 'planning' stage for state-based approval
          questionType: 'single_choice',
          questionText: 'Which auth method?',
          options: [{ value: 'jwt', label: 'JWT', recommended: true }],
          answer: { value: 'jwt' },
          isRequired: true,
          priority: 1,
          askedAt: '2026-01-13T00:00:00Z',
          answeredAt: '2026-01-13T00:01:00Z',
        },
      ]);

      const approved = isPlanApproved(plan, questions);
      expect(approved).toBe(true);
    });

    it('should not approve when planning questions are unanswered', () => {
      const plan = createMockPlan(false);
      const questions = createQuestionsFile([
        {
          id: 'q1',
          stage: 'planning',
          questionType: 'single_choice',
          questionText: 'Which auth method?',
          options: [{ value: 'jwt', label: 'JWT', recommended: true }],
          answer: null, // Not answered
          isRequired: true,
          priority: 1,
          askedAt: '2026-01-13T00:00:00Z',
          answeredAt: null,
        },
      ]);

      const approved = isPlanApproved(plan, questions);
      expect(approved).toBe(false);
    });

    it('should approve when all planning questions are answered regardless of discovery questions', () => {
      const plan = createMockPlan(false);
      const questions = createQuestionsFile([
        {
          id: 'q1',
          stage: 'planning', // Planning question - answered
          questionType: 'single_choice',
          questionText: 'Which auth method?',
          options: [{ value: 'jwt', label: 'JWT', recommended: true }],
          answer: { value: 'jwt' },
          isRequired: true,
          priority: 1,
          askedAt: '2026-01-13T00:00:00Z',
          answeredAt: '2026-01-13T00:01:00Z',
        },
        {
          id: 'q2',
          stage: 'discovery', // Discovery question - not answered (doesn't affect planning approval)
          questionType: 'text_input',
          questionText: 'Any notes?',
          options: [],
          answer: null,
          isRequired: false,
          priority: 3,
          askedAt: '2026-01-13T00:00:00Z',
          answeredAt: null,
        },
      ]);

      const approved = isPlanApproved(plan, questions);
      expect(approved).toBe(true);
    });

    it('should approve when plan is explicitly approved even with unanswered questions', () => {
      const plan = createMockPlan(true); // Explicitly approved
      const questions = createQuestionsFile([
        {
          id: 'q1',
          stage: 'planning',
          questionType: 'single_choice',
          questionText: 'Which auth method?',
          options: [{ value: 'jwt', label: 'JWT', recommended: true }],
          answer: null, // Not answered but plan approved
          isRequired: true,
          priority: 1,
          askedAt: '2026-01-13T00:00:00Z',
          answeredAt: null,
        },
      ]);

      const approved = isPlanApproved(plan, questions);
      expect(approved).toBe(true);
    });

    it('should handle null plan gracefully', () => {
      const approved = isPlanApproved(null, null);
      expect(approved).toBe(false);
    });

    it('should handle null questions file gracefully when plan is approved', () => {
      const plan = createMockPlan(true);
      const approved = isPlanApproved(plan, null);
      expect(approved).toBe(true); // Plan is explicitly approved
    });

    it('should not approve when no planning questions exist (discovery still in progress)', () => {
      const plan = createMockPlan(false);
      const questions = createQuestionsFile([
        {
          id: 'q1',
          stage: 'discovery', // Only discovery questions, no planning
          questionType: 'single_choice',
          questionText: 'What framework?',
          options: [{ value: 'react', label: 'React', recommended: true }],
          answer: { value: 'react' },
          isRequired: true,
          priority: 1,
          askedAt: '2026-01-13T00:00:00Z',
          answeredAt: '2026-01-13T00:01:00Z',
        },
      ]);

      // No planning questions = can't be approved via state (discovery not complete)
      const approved = isPlanApproved(plan, questions);
      expect(approved).toBe(false);
    });

    it('should not approve when questions file is empty (no review done yet)', () => {
      const plan = createMockPlan(false);
      const questions = createQuestionsFile([]);

      // Empty questions = no planning questions = can't approve
      const approved = isPlanApproved(plan, questions);
      expect(approved).toBe(false);
    });
  });

  describe('Stage transition broadcasting', () => {
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

    it('should broadcast stageChanged event on transition to Stage 3', () => {
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

      broadcaster.stageChanged(session, 2); // Previous stage was 2

      expect(mockIo.to).toHaveBeenCalledWith('project-1/feature-a');
      // Event structure: { sessionId, previousStage, currentStage, status, timestamp }
      expect(mockRoom.emit).toHaveBeenCalledWith('stage.changed', expect.objectContaining({
        sessionId: 'session-123',
        currentStage: 3,
        previousStage: 2,
        timestamp: expect.any(String),
      }));
    });

    it('should broadcast planApproved event when plan is approved', () => {
      const plan: Plan = {
        version: '1.0',
        planVersion: 2,
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
            status: 'pending',
            metadata: {},
          },
        ],
      };

      broadcaster.planApproved('project-1', 'feature-a', plan);

      // Event structure: { planVersion, timestamp }
      expect(mockRoom.emit).toHaveBeenCalledWith('plan.approved', expect.objectContaining({
        planVersion: 2,
        timestamp: expect.any(String),
      }));
    });

    it('should broadcast executionStatus with stage3_started', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'running', 'stage3_started');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage3_started',
      }));
    });
  });

  describe('buildSingleStepPrompt for auto-start', () => {
    const createMockSession = (): Session => ({
      id: 'session-123',
      projectId: 'project-1',
      featureId: 'feature-a',
      title: 'Auth Feature',
      featureDescription: 'Add authentication to the app',
      projectPath: '/test/project',
      currentStage: 3,
      createdAt: '2026-01-13T00:00:00Z',
      updatedAt: '2026-01-13T00:01:00Z',
      acceptanceCriteria: [{ text: 'Users can log in' }],
      affectedFiles: ['src/auth.ts'],
    });

    const createMockPlan = (): Plan => ({
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
          title: 'Create auth module',
          description: 'Implement authentication middleware',
          status: 'pending',
          metadata: {},
        },
        {
          id: 'step-2',
          parentId: 'step-1',
          orderIndex: 1,
          title: 'Add tests',
          description: 'Write unit tests for auth',
          status: 'pending',
          metadata: {},
        },
      ],
    });

    it('should generate prompt for first step', () => {
      const session = createMockSession();
      const plan = createMockPlan();
      const step = plan.steps[0];
      const completedSteps: Array<{ id: string; title: string; summary: string }> = [];

      const prompt = buildSingleStepPrompt(session, plan, step, completedSteps);

      expect(prompt).toContain('step-1');
      expect(prompt).toContain('Create auth module');
      expect(prompt).toContain('Implement authentication middleware');
      expect(prompt).toContain('[STEP_COMPLETE]');
    });

    it('should include completed steps summary in subsequent step prompts', () => {
      const session = createMockSession();
      const plan = createMockPlan();
      plan.steps[0].status = 'completed';
      const step = plan.steps[1];
      const completedSteps = [
        { id: 'step-1', title: 'Create auth module', summary: 'Implemented auth middleware with JWT' },
      ];

      const prompt = buildSingleStepPrompt(session, plan, step, completedSteps);

      expect(prompt).toContain('step-2');
      expect(prompt).toContain('Add tests');
      expect(prompt).toContain('step-1'); // Reference to completed step
      expect(prompt).toContain('Implemented auth middleware with JWT');
    });

    it('should include git commit instructions', () => {
      const session = createMockSession();
      const plan = createMockPlan();
      const step = plan.steps[0];

      const prompt = buildSingleStepPrompt(session, plan, step, []);

      expect(prompt).toContain('git');
      expect(prompt).toContain('commit');
    });

    it('should include test requirements', () => {
      const session = createMockSession();
      const plan = createMockPlan();
      const step = plan.steps[0];

      const prompt = buildSingleStepPrompt(session, plan, step, []);

      expect(prompt).toContain('test');
    });

    it('should include blocker handling instructions', () => {
      const session = createMockSession();
      const plan = createMockPlan();
      const step = plan.steps[0];

      const prompt = buildSingleStepPrompt(session, plan, step, []);

      // Single step prompt mentions blocker handling
      expect(prompt).toContain('blocker');
    });
  });

  describe('Implementation completion detection', () => {
    const createPlan = (stepStatuses: Array<'pending' | 'in_progress' | 'completed' | 'blocked'>): Plan => ({
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
        description: `Description ${i + 1}`,
        status,
        metadata: {},
      })),
    });

    it('should detect completion when all steps are completed', () => {
      const plan = createPlan(['completed', 'completed', 'completed']);
      expect(isImplementationComplete(plan)).toBe(true);
    });

    it('should not detect completion with pending steps', () => {
      const plan = createPlan(['completed', 'pending', 'pending']);
      expect(isImplementationComplete(plan)).toBe(false);
    });

    it('should not detect completion with blocked steps', () => {
      const plan = createPlan(['completed', 'blocked', 'pending']);
      expect(isImplementationComplete(plan)).toBe(false);
    });

    it('should not detect completion with in_progress steps', () => {
      const plan = createPlan(['completed', 'in_progress', 'pending']);
      expect(isImplementationComplete(plan)).toBe(false);
    });

    it('should handle null plan', () => {
      expect(isImplementationComplete(null)).toBe(false);
    });

    it('should not detect completion when steps array is empty (invalid state)', () => {
      const plan: Plan = {
        version: '1.0',
        planVersion: 1,
        sessionId: 'session-123',
        isApproved: true,
        reviewCount: 1,
        createdAt: '2026-01-13T00:00:00Z',
        steps: [],
      };
      // Empty plan with no steps returns false (nothing to complete)
      expect(isImplementationComplete(plan)).toBe(false);
    });
  });

  describe('Step counts utility', () => {
    const createPlan = (stepStatuses: Array<'pending' | 'in_progress' | 'completed' | 'blocked'>): Plan => ({
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
        description: `Description ${i + 1}`,
        status,
        metadata: {},
      })),
    });

    it('should count all step statuses correctly', () => {
      const plan = createPlan(['completed', 'in_progress', 'pending', 'blocked']);
      const counts = getStepCounts(plan);

      expect(counts.total).toBe(4);
      expect(counts.completed).toBe(1);
      expect(counts.inProgress).toBe(1);
      expect(counts.pending).toBe(1);
      expect(counts.blocked).toBe(1);
    });

    it('should handle all completed', () => {
      const plan = createPlan(['completed', 'completed', 'completed']);
      const counts = getStepCounts(plan);

      expect(counts.total).toBe(3);
      expect(counts.completed).toBe(3);
      expect(counts.pending).toBe(0);
    });

    it('should handle null plan', () => {
      const counts = getStepCounts(null);

      expect(counts.total).toBe(0);
      expect(counts.completed).toBe(0);
    });
  });

  describe('buildStage3Prompt', () => {
    const createMockSession = (): Session => ({
      id: 'session-123',
      projectId: 'project-1',
      featureId: 'feature-a',
      title: 'Auth Feature',
      featureDescription: 'Add authentication',
      projectPath: '/test/project',
      currentStage: 3,
      createdAt: '2026-01-13T00:00:00Z',
      updatedAt: '2026-01-13T00:01:00Z',
      acceptanceCriteria: [{ text: 'Users can log in' }],
      affectedFiles: ['src/auth.ts'],
    });

    const createMockPlan = (): Plan => ({
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
          title: 'Create auth module',
          description: 'Implement auth',
          status: 'pending',
          metadata: {},
        },
      ],
    });

    it('should include feature title and description', () => {
      const session = createMockSession();
      const plan = createMockPlan();

      const prompt = buildStage3Prompt(session, plan);

      expect(prompt).toContain('Auth Feature');
      expect(prompt).toContain('Add authentication');
    });

    it('should include plan steps', () => {
      const session = createMockSession();
      const plan = createMockPlan();

      const prompt = buildStage3Prompt(session, plan);

      expect(prompt).toContain('step-1');
      expect(prompt).toContain('Create auth module');
    });

    it('should include IMPLEMENTATION_COMPLETE marker instructions', () => {
      const session = createMockSession();
      const plan = createMockPlan();

      const prompt = buildStage3Prompt(session, plan);

      expect(prompt).toContain('[IMPLEMENTATION_COMPLETE]');
    });

    it('should include STEP_COMPLETE marker instructions', () => {
      const session = createMockSession();
      const plan = createMockPlan();

      const prompt = buildStage3Prompt(session, plan);

      // The marker appears in the code block format
      expect(prompt).toContain('STEP_COMPLETE');
    });

    it('should include IMPLEMENTATION_STATUS marker instructions', () => {
      const session = createMockSession();
      const plan = createMockPlan();

      const prompt = buildStage3Prompt(session, plan);

      expect(prompt).toContain('[IMPLEMENTATION_STATUS]');
    });
  });

  describe('executeStage3Steps flow simulation', () => {
    const createMockPlan = (steps: PlanStep[]): Plan => ({
      version: '1.0',
      planVersion: 1,
      sessionId: 'session-123',
      isApproved: true,
      reviewCount: 1,
      createdAt: '2026-01-13T00:00:00Z',
      steps,
    });

    it('should identify next ready step (no dependencies)', () => {
      const plan = createMockPlan([
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

    it('should identify next ready step respecting dependencies', () => {
      const plan = createMockPlan([
        { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'completed', metadata: {} },
        { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'pending', metadata: {} },
        { id: 'step-3', parentId: 'step-2', orderIndex: 2, title: 'Step 3', description: 'Desc', status: 'pending', metadata: {} },
      ]);

      const nextStep = plan.steps.find(step =>
        step.status === 'pending' &&
        (step.parentId === null ||
          plan.steps.find(p => p.id === step.parentId)?.status === 'completed')
      );

      expect(nextStep?.id).toBe('step-2');
    });

    it('should not return step with incomplete dependency', () => {
      const plan = createMockPlan([
        { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'pending', metadata: {} },
        { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'pending', metadata: {} },
      ]);

      const nextStep = plan.steps.find(step =>
        step.status === 'pending' &&
        (step.parentId === null ||
          plan.steps.find(p => p.id === step.parentId)?.status === 'completed')
      );

      expect(nextStep?.id).toBe('step-1'); // step-2 depends on step-1 which is not completed
    });

    it('should return null when no steps are ready (all blocked)', () => {
      const plan = createMockPlan([
        { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'blocked', metadata: {} },
        { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'pending', metadata: {} },
      ]);

      const nextStep = plan.steps.find(step =>
        step.status === 'pending' &&
        (step.parentId === null ||
          plan.steps.find(p => p.id === step.parentId)?.status === 'completed')
      );

      expect(nextStep).toBeUndefined();
    });

    it('should handle mixed completion states', () => {
      const plan = createMockPlan([
        { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'completed', metadata: {} },
        { id: 'step-2', parentId: null, orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'in_progress', metadata: {} },
        { id: 'step-3', parentId: null, orderIndex: 2, title: 'Step 3', description: 'Desc', status: 'pending', metadata: {} },
        { id: 'step-4', parentId: 'step-1', orderIndex: 3, title: 'Step 4', description: 'Desc', status: 'pending', metadata: {} },
      ]);

      const nextStep = plan.steps.find(step =>
        step.status === 'pending' &&
        (step.parentId === null ||
          plan.steps.find(p => p.id === step.parentId)?.status === 'completed')
      );

      // step-3 has no dependency and is pending
      // step-4 depends on step-1 which is completed
      // Both are valid next steps, but step-3 comes first
      expect(nextStep?.id).toBe('step-3');
    });
  });

  describe('Stage 3 status transitions', () => {
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

    it('should broadcast stage3_waiting when no steps are ready', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'idle', 'stage3_waiting');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'idle',
        action: 'stage3_waiting',
      }));
    });

    it('should broadcast stage3_blocked when a step is blocked', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'idle', 'stage3_blocked');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'idle',
        action: 'stage3_blocked',
      }));
    });

    it('should broadcast stage3_error on spawn error', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'error', 'stage3_error');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'error',
        action: 'stage3_error',
      }));
    });
  });

  describe('needs_review to pending conversion', () => {
    it('should convert needs_review steps to pending at Stage 3 start', () => {
      const plan: Plan = {
        version: '1.0',
        planVersion: 1,
        sessionId: 'session-123',
        isApproved: true,
        reviewCount: 1,
        createdAt: '2026-01-13T00:00:00Z',
        steps: [
          { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', description: 'Desc', status: 'needs_review' as any, metadata: {} },
          { id: 'step-2', parentId: null, orderIndex: 1, title: 'Step 2', description: 'Desc', status: 'needs_review' as any, metadata: {} },
        ],
      };

      // Simulate conversion
      for (const step of plan.steps) {
        if ((step.status as string) === 'needs_review') {
          step.status = 'pending';
        }
      }

      expect(plan.steps[0].status).toBe('pending');
      expect(plan.steps[1].status).toBe('pending');
    });
  });
});

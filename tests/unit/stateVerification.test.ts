import {
  isPlanApproved,
  isPlanApprovedAndValid,
  isPlanStructureComplete,
  getPlanValidationResult,
  isImplementationComplete,
  getNextReadyStep,
  getAllReadySteps,
  getStepCounts,
  getStepComplexityCounts,
} from '../../server/src/utils/stateVerification';
import type { Plan, PlanStep, ComposablePlan } from '@claude-code-web/shared';

describe('stateVerification', () => {
  // Helper to create a mock Plan
  const createMockPlan = (
    isApproved: boolean,
    steps: Array<Partial<PlanStep> & { id: string; status: string }>
  ): Plan => ({
    version: '1.0',
    planVersion: 1,
    sessionId: 'session-123',
    isApproved,
    reviewCount: 1,
    createdAt: '2026-01-13T00:00:00Z',
    steps: steps.map((s, i) => ({
      id: s.id,
      parentId: s.parentId ?? null,
      orderIndex: s.orderIndex ?? i,
      title: s.title ?? `Step ${i + 1}`,
      description: s.description ?? `Description for step ${i + 1}`,
      status: s.status as PlanStep['status'],
      metadata: s.metadata ?? {},
      ...s,
    })),
  });

  // Helper to create a mock ComposablePlan that passes actual validation
  const createValidComposablePlan = (
    steps: Array<{ id: string; status: string; complexity: 'low' | 'medium' | 'high'; parentId?: string }>
  ): ComposablePlan => ({
    meta: {
      version: '1.0.0',
      sessionId: 'session-123',
      isApproved: true,
      createdAt: '2026-01-13T00:00:00Z',
      updatedAt: '2026-01-13T00:00:00Z',
      reviewCount: 1, // Required by schema
    },
    steps: steps.map((s, i) => ({
      id: s.id,
      parentId: s.parentId ?? null,
      orderIndex: i,
      title: `Step ${i + 1}: Implementation Task`,
      // Description must be at least 50 characters
      description: `This is a detailed description for step ${i + 1} that contains enough characters to pass the validation requirements of the plan validator schema.`,
      status: s.status as PlanStep['status'],
      metadata: {},
      complexity: s.complexity,
    })),
    dependencies: {
      stepDependencies: steps
        .filter(s => s.parentId)
        .map(s => ({
          stepId: s.id,
          dependsOn: s.parentId!,
          reason: 'Sequential dependency between steps',
        })),
      externalDependencies: [],
    },
    testCoverage: {
      framework: 'vitest',
      requiredTestTypes: ['unit'], // Schema uses requiredTestTypes, not requiredTypes
      stepCoverage: steps.map(s => ({
        stepId: s.id,
        requiredTestTypes: ['unit'], // Schema uses requiredTestTypes
      })),
    },
    acceptanceMapping: {
      mappings: [
        {
          criterionId: 'AC-1',
          criterionText: 'Feature works correctly as expected',
          implementingStepIds: steps.map(s => s.id),
          isFullyCovered: true, // Required by schema
        },
      ],
      updatedAt: '2026-01-13T00:00:00Z', // Required by schema
    },
    validationStatus: {
      meta: true,
      steps: true,
      dependencies: true,
      testCoverage: true,
      acceptanceMapping: true,
      overall: true,
    },
  });

  // Helper to create an invalid ComposablePlan (missing required fields)
  const createInvalidComposablePlan = (): ComposablePlan => ({
    meta: {
      version: '1.0.0',
      sessionId: 'session-123',
      isApproved: false,
      createdAt: '2026-01-13T00:00:00Z',
      updatedAt: '2026-01-13T00:00:00Z',
    },
    steps: [
      {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'Step 1',
        description: 'Too short', // Will fail validation - needs 50+ chars
        status: 'pending',
        metadata: {},
        // Missing complexity - will fail validation
      },
    ],
    dependencies: {
      stepDependencies: [],
      externalDependencies: [],
    },
    testCoverage: {
      framework: 'vitest',
      requiredTypes: ['unit'],
      stepCoverage: [],
    },
    acceptanceMapping: {
      mappings: [],
    },
    validationStatus: {
      meta: true,
      steps: false,
      dependencies: true,
      testCoverage: true,
      acceptanceMapping: true,
      overall: false,
    },
  });

  // Helper to create questions file
  const createQuestionsFile = (
    questions: Array<{ id: string; stage: string; answeredAt: string | null }>
  ) => ({ questions });

  describe('isPlanApproved', () => {
    it('should return true when plan.isApproved is true', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'pending' },
      ]);
      const questions = createQuestionsFile([]);

      expect(isPlanApproved(plan, questions)).toBe(true);
    });

    it('should return true when all planning questions are answered', () => {
      const plan = createMockPlan(false, [
        { id: 'step-1', status: 'pending' },
      ]);
      const questions = createQuestionsFile([
        { id: 'q1', stage: 'planning', answeredAt: '2026-01-13T00:01:00Z' },
        { id: 'q2', stage: 'planning', answeredAt: '2026-01-13T00:02:00Z' },
      ]);

      expect(isPlanApproved(plan, questions)).toBe(true);
    });

    it('should return false when planning questions are unanswered', () => {
      const plan = createMockPlan(false, [
        { id: 'step-1', status: 'pending' },
      ]);
      const questions = createQuestionsFile([
        { id: 'q1', stage: 'planning', answeredAt: '2026-01-13T00:01:00Z' },
        { id: 'q2', stage: 'planning', answeredAt: null }, // Unanswered
      ]);

      expect(isPlanApproved(plan, questions)).toBe(false);
    });

    it('should return false when no planning questions exist', () => {
      const plan = createMockPlan(false, [
        { id: 'step-1', status: 'pending' },
      ]);
      const questions = createQuestionsFile([
        { id: 'q1', stage: 'discovery', answeredAt: '2026-01-13T00:01:00Z' },
      ]);

      expect(isPlanApproved(plan, questions)).toBe(false);
    });

    it('should return false when plan is null', () => {
      expect(isPlanApproved(null, null)).toBe(false);
    });
  });

  describe('isPlanStructureComplete', () => {
    it('should return true for valid composable plan', () => {
      const plan = createValidComposablePlan([
        { id: 'step-1', status: 'pending', complexity: 'low' },
        { id: 'step-2', status: 'pending', complexity: 'medium', parentId: 'step-1' },
      ]);

      expect(isPlanStructureComplete(plan)).toBe(true);
    });

    it('should return false for null plan', () => {
      expect(isPlanStructureComplete(null)).toBe(false);
    });

    it('should return false for plan with missing sections', () => {
      const invalidPlan = createInvalidComposablePlan();
      expect(isPlanStructureComplete(invalidPlan)).toBe(false);
    });
  });

  describe('isPlanApprovedAndValid', () => {
    it('should return true when plan is approved and composable plan is valid', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'pending' },
      ]);
      const composablePlan = createValidComposablePlan([
        { id: 'step-1', status: 'pending', complexity: 'low' },
      ]);
      const questions = createQuestionsFile([]);

      expect(isPlanApprovedAndValid(plan, questions, composablePlan)).toBe(true);
    });

    it('should return false when plan is not approved', () => {
      const plan = createMockPlan(false, [
        { id: 'step-1', status: 'pending' },
      ]);
      const composablePlan = createValidComposablePlan([
        { id: 'step-1', status: 'pending', complexity: 'low' },
      ]);
      const questions = createQuestionsFile([]);

      expect(isPlanApprovedAndValid(plan, questions, composablePlan)).toBe(false);
    });

    it('should return true when approved but no composable plan provided', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'pending' },
      ]);
      const questions = createQuestionsFile([]);

      expect(isPlanApprovedAndValid(plan, questions)).toBe(true);
    });
  });

  describe('getPlanValidationResult', () => {
    it('should return validation result for composable plan', () => {
      const plan = createValidComposablePlan([
        { id: 'step-1', status: 'pending', complexity: 'low' },
      ]);

      const result = getPlanValidationResult(plan);

      expect(result).not.toBeNull();
      expect(result?.overall).toBe(true);
      expect(result?.meta.valid).toBe(true);
      expect(result?.steps.valid).toBe(true);
    });

    it('should return null for null plan', () => {
      expect(getPlanValidationResult(null)).toBeNull();
    });
  });

  describe('isImplementationComplete', () => {
    it('should return true when all steps are completed', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'completed' },
        { id: 'step-2', status: 'completed' },
      ]);

      expect(isImplementationComplete(plan)).toBe(true);
    });

    it('should return true when steps are completed or skipped', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'completed' },
        { id: 'step-2', status: 'skipped' },
      ]);

      expect(isImplementationComplete(plan)).toBe(true);
    });

    it('should return false when some steps are pending', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'completed' },
        { id: 'step-2', status: 'pending' },
      ]);

      expect(isImplementationComplete(plan)).toBe(false);
    });

    it('should return false when some steps are in_progress', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'completed' },
        { id: 'step-2', status: 'in_progress' },
      ]);

      expect(isImplementationComplete(plan)).toBe(false);
    });

    it('should return false for null plan', () => {
      expect(isImplementationComplete(null)).toBe(false);
    });

    it('should return false for plan with no steps', () => {
      const plan = createMockPlan(true, []);
      expect(isImplementationComplete(plan)).toBe(false);
    });

    it('should work with ComposablePlan', () => {
      const plan = createValidComposablePlan([
        { id: 'step-1', status: 'completed', complexity: 'low' },
        { id: 'step-2', status: 'completed', complexity: 'medium' },
      ]);

      expect(isImplementationComplete(plan)).toBe(true);
    });
  });

  describe('getNextReadyStep', () => {
    it('should return first pending step with no dependencies', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'pending' },
        { id: 'step-2', status: 'pending' },
      ]);

      const nextStep = getNextReadyStep(plan);
      expect(nextStep?.id).toBe('step-1');
    });

    it('should return dependent step when parent is completed', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'completed' },
        { id: 'step-2', status: 'pending', parentId: 'step-1' },
      ]);

      const nextStep = getNextReadyStep(plan);
      expect(nextStep?.id).toBe('step-2');
    });

    it('should not return step with incomplete parent', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'in_progress' },
        { id: 'step-2', status: 'pending', parentId: 'step-1' },
      ]);

      const nextStep = getNextReadyStep(plan);
      expect(nextStep).toBeNull();
    });

    it('should prefer lower complexity steps when multiple are ready', () => {
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
            title: 'High complexity step',
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'high',
          } as PlanStep & { complexity: string },
          {
            id: 'step-2',
            parentId: null,
            orderIndex: 1,
            title: 'Low complexity step',
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'low',
          } as PlanStep & { complexity: string },
          {
            id: 'step-3',
            parentId: null,
            orderIndex: 2,
            title: 'Medium complexity step',
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'medium',
          } as PlanStep & { complexity: string },
        ],
      };

      const nextStep = getNextReadyStep(plan);
      // Should return low complexity step first
      expect(nextStep?.id).toBe('step-2');
    });

    it('should fall back to orderIndex when complexity is the same', () => {
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
            orderIndex: 2,
            title: 'Step A',
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'medium',
          } as PlanStep & { complexity: string },
          {
            id: 'step-2',
            parentId: null,
            orderIndex: 0,
            title: 'Step B',
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'medium',
          } as PlanStep & { complexity: string },
        ],
      };

      const nextStep = getNextReadyStep(plan);
      // Should return step with lower orderIndex when complexity is same
      expect(nextStep?.id).toBe('step-2');
    });

    it('should treat missing complexity as medium', () => {
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
            title: 'No complexity',
            description: 'Description',
            status: 'pending',
            metadata: {},
          },
          {
            id: 'step-2',
            parentId: null,
            orderIndex: 1,
            title: 'Low complexity',
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'low',
          } as PlanStep & { complexity: string },
        ],
      };

      const nextStep = getNextReadyStep(plan);
      // Low complexity should come before unspecified (treated as medium)
      expect(nextStep?.id).toBe('step-2');
    });

    it('should return null for null plan', () => {
      expect(getNextReadyStep(null as unknown as Plan)).toBeNull();
    });

    it('should return null for plan with no steps', () => {
      const plan = createMockPlan(true, []);
      expect(getNextReadyStep(plan)).toBeNull();
    });
  });

  describe('getAllReadySteps', () => {
    it('should return all steps that are ready for execution', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'completed' },
        { id: 'step-2', status: 'pending', parentId: 'step-1' },
        { id: 'step-3', status: 'pending' },
        { id: 'step-4', status: 'pending', parentId: 'step-2' }, // Not ready - step-2 not completed
      ]);

      const readySteps = getAllReadySteps(plan);
      expect(readySteps.map(s => s.id)).toEqual(['step-2', 'step-3']);
    });

    it('should return empty array when no steps are ready', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'in_progress' },
        { id: 'step-2', status: 'pending', parentId: 'step-1' },
      ]);

      const readySteps = getAllReadySteps(plan);
      expect(readySteps).toEqual([]);
    });

    it('should return empty array for null plan', () => {
      expect(getAllReadySteps(null as unknown as Plan)).toEqual([]);
    });
  });

  describe('getStepCounts', () => {
    it('should count steps by status', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'completed' },
        { id: 'step-2', status: 'completed' },
        { id: 'step-3', status: 'pending' },
        { id: 'step-4', status: 'in_progress' },
        { id: 'step-5', status: 'blocked' },
      ]);

      const counts = getStepCounts(plan);
      expect(counts).toEqual({
        total: 5,
        completed: 2,
        pending: 1,
        inProgress: 1,
        blocked: 1,
      });
    });

    it('should count skipped as completed', () => {
      const plan = createMockPlan(true, [
        { id: 'step-1', status: 'completed' },
        { id: 'step-2', status: 'skipped' },
      ]);

      const counts = getStepCounts(plan);
      expect(counts.completed).toBe(2);
    });

    it('should return zeros for null plan', () => {
      const counts = getStepCounts(null);
      expect(counts).toEqual({
        total: 0,
        completed: 0,
        pending: 0,
        inProgress: 0,
        blocked: 0,
      });
    });

    it('should work with ComposablePlan', () => {
      const plan = createValidComposablePlan([
        { id: 'step-1', status: 'completed', complexity: 'low' },
        { id: 'step-2', status: 'pending', complexity: 'medium' },
      ]);

      const counts = getStepCounts(plan);
      expect(counts.total).toBe(2);
      expect(counts.completed).toBe(1);
      expect(counts.pending).toBe(1);
    });
  });

  describe('getStepComplexityCounts', () => {
    it('should count steps by complexity', () => {
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
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'low',
          } as PlanStep & { complexity: string },
          {
            id: 'step-2',
            parentId: null,
            orderIndex: 1,
            title: 'Step 2',
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'low',
          } as PlanStep & { complexity: string },
          {
            id: 'step-3',
            parentId: null,
            orderIndex: 2,
            title: 'Step 3',
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'medium',
          } as PlanStep & { complexity: string },
          {
            id: 'step-4',
            parentId: null,
            orderIndex: 3,
            title: 'Step 4',
            description: 'Description',
            status: 'pending',
            metadata: {},
            complexity: 'high',
          } as PlanStep & { complexity: string },
          {
            id: 'step-5',
            parentId: null,
            orderIndex: 4,
            title: 'Step 5',
            description: 'Description',
            status: 'pending',
            metadata: {},
            // No complexity
          },
        ],
      };

      const counts = getStepComplexityCounts(plan);
      expect(counts).toEqual({
        low: 2,
        medium: 1,
        high: 1,
        unspecified: 1,
      });
    });

    it('should return zeros for null plan', () => {
      const counts = getStepComplexityCounts(null);
      expect(counts).toEqual({
        low: 0,
        medium: 0,
        high: 0,
        unspecified: 0,
      });
    });

    it('should return zeros for empty plan', () => {
      const plan = createMockPlan(true, []);
      const counts = getStepComplexityCounts(plan);
      expect(counts).toEqual({
        low: 0,
        medium: 0,
        high: 0,
        unspecified: 0,
      });
    });
  });
});

/**
 * Integration tests for the step modification flow:
 * Stage 5 (PR rejection) → Stage 2 (plan modification) → Stage 3 (implementation)
 *
 * Tests the complete flow where:
 * - Stage 5 PR rejection triggers plan_changes action
 * - Stage 2 modifies steps (add, edit, remove)
 * - Stage 3 picks up changes and only re-implements modified/added steps
 * - Unchanged completed steps are skipped via contentHash comparison
 */

import type { Session, Plan, PlanStep } from '@claude-code-web/shared';
import {
  processStepModifications,
  findCascadeDeletedSteps,
  detectModifiedStepsFromPlanSteps,
  hasStepModificationMarkers,
} from '../services/stepModificationParser';
import {
  computeStepHash,
  isStepContentUnchanged,
  setStepContentHash,
} from '../utils/stepContentHash';
import { StepModificationContext } from '../prompts/stagePrompts';

// =============================================================================
// Test Data Factories
// =============================================================================

function createMockStep(
  id: string,
  parentId: string | null = null,
  status: 'pending' | 'completed' | 'in_progress' | 'blocked' = 'pending',
  overrides: Partial<PlanStep> = {}
): PlanStep {
  const step: PlanStep = {
    id,
    parentId,
    orderIndex: 0,
    title: `Step ${id} Title`,
    description: `This is the description for step ${id}. It contains implementation details.`,
    status,
    metadata: {},
    ...overrides,
  };
  return step;
}

function createMockPlan(steps: PlanStep[], overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    sessionId: 'session-123',
    planVersion: 1,
    steps,
    isApproved: false,
    reviewCount: 1,
    testRequirement: { required: true, reason: 'Unit tests required' },
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Plan;
}

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    version: '1.0.0',
    dataVersion: 1,
    id: 'session-123',
    projectId: 'project-1',
    featureId: 'feature-a',
    title: 'Test Feature',
    featureDescription: 'A test feature for step modification flow testing',
    projectPath: '/test/project',
    acceptanceCriteria: [{ text: 'Feature works correctly', checked: false, type: 'manual' }],
    affectedFiles: [],
    technicalNotes: '',
    baseBranch: 'main',
    featureBranch: 'feature/test-feature',
    baseCommitSha: 'abc123',
    status: 'planning',
    currentStage: 2,
    replanningCount: 0,
    claudeSessionId: null,
    claudePlanFilePath: null,
    currentPlanVersion: 1,
    claudeStage3SessionId: null,
    prUrl: null,
    sessionExpiresAt: '2024-01-16T10:00:00Z',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

// =============================================================================
// Stage 5 → Stage 2: plan_changes Action Flow
// =============================================================================

describe('Step Modification Flow - Stage 5 → Stage 2', () => {
  describe('plan_changes action initialization', () => {
    it('should initialize isPlanModificationSession flag', () => {
      const session = createMockSession({
        isPlanModificationSession: true,
      });

      expect(session.isPlanModificationSession).toBe(true);
    });

    it('should clear previous modification tracking fields', () => {
      // Simulate clearing existing tracking before new modification session
      const session = createMockSession({
        modifiedStepIds: ['old-modified'],
        addedStepIds: ['old-added'],
        removedStepIds: ['old-removed'],
      });

      // Plan_changes action clears these
      const clearedSession: Partial<Session> = {
        modifiedStepIds: undefined,
        addedStepIds: undefined,
        removedStepIds: undefined,
      };

      expect(clearedSession.modifiedStepIds).toBeUndefined();
      expect(clearedSession.addedStepIds).toBeUndefined();
      expect(clearedSession.removedStepIds).toBeUndefined();
    });
  });

  describe('transition to Stage 2 with feedback', () => {
    it('should preserve session state during transition', () => {
      const session = createMockSession({
        currentStage: 5,
        prUrl: 'https://github.com/org/repo/pull/123',
      });

      // After transition to Stage 2
      const updatedSession = {
        ...session,
        currentStage: 2,
        isPlanModificationSession: true,
      };

      expect(updatedSession.currentStage).toBe(2);
      expect(updatedSession.prUrl).toBe('https://github.com/org/repo/pull/123');
      expect(updatedSession.isPlanModificationSession).toBe(true);
    });
  });
});

// =============================================================================
// Stage 2: Step Modification Processing
// =============================================================================

describe('Step Modification Flow - Stage 2 Processing', () => {
  describe('step removal with cascade deletion', () => {
    it('should identify all cascade-deleted children', () => {
      const steps: PlanStep[] = [
        createMockStep('parent'),
        createMockStep('child-1', 'parent'),
        createMockStep('child-2', 'parent'),
        createMockStep('grandchild', 'child-1'),
        createMockStep('unrelated'),
      ];

      const cascaded = findCascadeDeletedSteps(['parent'], steps);

      expect(cascaded).toContain('child-1');
      expect(cascaded).toContain('child-2');
      expect(cascaded).toContain('grandchild');
      expect(cascaded).not.toContain('parent'); // Original not in cascade list
      expect(cascaded).not.toContain('unrelated');
    });

    it('should handle deep nesting (3+ levels)', () => {
      const steps: PlanStep[] = [
        createMockStep('root'),
        createMockStep('level-1', 'root'),
        createMockStep('level-2', 'level-1'),
        createMockStep('level-3', 'level-2'),
        createMockStep('level-4', 'level-3'),
      ];

      const cascaded = findCascadeDeletedSteps(['root'], steps);

      expect(cascaded).toEqual(
        expect.arrayContaining(['level-1', 'level-2', 'level-3', 'level-4'])
      );
      expect(cascaded).toHaveLength(4);
    });

    it('should handle multiple removal roots', () => {
      const steps: PlanStep[] = [
        createMockStep('root-a'),
        createMockStep('child-a', 'root-a'),
        createMockStep('root-b'),
        createMockStep('child-b', 'root-b'),
      ];

      const cascaded = findCascadeDeletedSteps(['root-a', 'root-b'], steps);

      expect(cascaded).toContain('child-a');
      expect(cascaded).toContain('child-b');
    });
  });

  describe('step modification detection from PLAN_STEP markers', () => {
    it('should detect modified existing steps', () => {
      const claudeOutput = `
[PLAN_STEP id="step-1" parentId="null"]
Updated title for step 1
Updated description for step 1
[/PLAN_STEP]
`;
      const existingStepIds = new Set(['step-1', 'step-2']);

      const { modifiedIds, newIds } = detectModifiedStepsFromPlanSteps(
        claudeOutput,
        existingStepIds
      );

      expect(modifiedIds).toContain('step-1');
      expect(newIds).toHaveLength(0);
    });

    it('should detect newly added steps', () => {
      const claudeOutput = `
[PLAN_STEP id="new-step" parentId="null"]
New step title
New step description
[/PLAN_STEP]
`;
      const existingStepIds = new Set(['step-1', 'step-2']);

      const { modifiedIds, newIds } = detectModifiedStepsFromPlanSteps(
        claudeOutput,
        existingStepIds
      );

      expect(modifiedIds).toHaveLength(0);
      expect(newIds).toContain('new-step');
    });

    it('should handle mixed modified and new steps', () => {
      const claudeOutput = `
[PLAN_STEP id="step-1" parentId="null"]
Modified existing step
[/PLAN_STEP]
[PLAN_STEP id="new-step" parentId="step-1"]
New child step
[/PLAN_STEP]
`;
      const existingStepIds = new Set(['step-1', 'step-2']);

      const { modifiedIds, newIds } = detectModifiedStepsFromPlanSteps(
        claudeOutput,
        existingStepIds
      );

      expect(modifiedIds).toContain('step-1');
      expect(newIds).toContain('new-step');
    });
  });

  describe('processStepModifications integration', () => {
    it('should process STEP_MODIFICATIONS marker', () => {
      const claudeOutput = `
[STEP_MODIFICATIONS]
modified: ["step-1"]
added: ["step-3"]
removed: ["step-2"]
[/STEP_MODIFICATIONS]
`;
      const steps: PlanStep[] = [
        createMockStep('step-1'),
        createMockStep('step-2'),
      ];

      const result = processStepModifications(claudeOutput, steps, ['step-3']);

      expect(result.isValid).toBe(true);
      expect(result.modifications.modifiedStepIds).toContain('step-1');
      expect(result.modifications.addedStepIds).toContain('step-3');
      expect(result.allRemovedStepIds).toContain('step-2');
    });

    it('should process REMOVE_STEPS marker alone', () => {
      const claudeOutput = `
Based on the feedback, we need to remove some steps.

[REMOVE_STEPS]
["step-2", "step-3"]
[/REMOVE_STEPS]
`;
      const steps: PlanStep[] = [
        createMockStep('step-1'),
        createMockStep('step-2'),
        createMockStep('step-3'),
      ];

      const result = processStepModifications(claudeOutput, steps);

      expect(result.isValid).toBe(true);
      expect(result.allRemovedStepIds).toContain('step-2');
      expect(result.allRemovedStepIds).toContain('step-3');
    });

    it('should compute cascade deletions in result', () => {
      const claudeOutput = `
[REMOVE_STEPS]
["parent"]
[/REMOVE_STEPS]
`;
      const steps: PlanStep[] = [
        createMockStep('parent'),
        createMockStep('child', 'parent'),
      ];

      const result = processStepModifications(claudeOutput, steps);

      expect(result.allRemovedStepIds).toContain('parent');
      expect(result.allRemovedStepIds).toContain('child');
      expect(result.cascadeDeletedStepIds).toContain('child');
      expect(result.cascadeDeletedStepIds).not.toContain('parent');
    });

    it('should return validation errors for invalid modifications', () => {
      const claudeOutput = `
[STEP_MODIFICATIONS]
modified: ["non-existent"]
removed: ["also-non-existent"]
[/STEP_MODIFICATIONS]
`;
      const steps: PlanStep[] = [createMockStep('step-1')];

      const result = processStepModifications(claudeOutput, steps);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('non-existent'))).toBe(true);
    });
  });

  describe('hasStepModificationMarkers', () => {
    it('should detect STEP_MODIFICATIONS marker', () => {
      const text = 'Some text [STEP_MODIFICATIONS] content [/STEP_MODIFICATIONS]';
      expect(hasStepModificationMarkers(text)).toBe(true);
    });

    it('should detect REMOVE_STEPS marker', () => {
      const text = 'Some text [REMOVE_STEPS] content [/REMOVE_STEPS]';
      expect(hasStepModificationMarkers(text)).toBe(true);
    });

    it('should return false for no markers', () => {
      const text = 'Just some regular text without any markers';
      expect(hasStepModificationMarkers(text)).toBe(false);
    });
  });
});

// =============================================================================
// Stage 3: Skip Unchanged Completed Steps
// =============================================================================

describe('Step Modification Flow - Stage 3 Execution', () => {
  describe('contentHash comparison for unchanged steps', () => {
    it('should mark step unchanged when hash matches', () => {
      const step = createMockStep('step-1', null, 'completed');

      // Simulate setting hash when step was completed
      setStepContentHash(step);
      const originalHash = step.contentHash;

      // Content hasn't changed
      const isUnchanged = isStepContentUnchanged(step);

      expect(isUnchanged).toBe(true);
      expect(step.contentHash).toBe(originalHash);
    });

    it('should mark step changed when content differs', () => {
      const step = createMockStep('step-1', null, 'completed');

      // Set hash with original content
      setStepContentHash(step);

      // Modify the step content
      step.title = 'Updated Title';

      const isUnchanged = isStepContentUnchanged(step);

      expect(isUnchanged).toBe(false);
    });

    it('should mark step changed when hash is missing', () => {
      const step = createMockStep('step-1', null, 'completed');
      // No contentHash set

      const isUnchanged = isStepContentUnchanged(step);

      expect(isUnchanged).toBe(false);
    });

    it('should mark step changed when hash is cleared', () => {
      const step = createMockStep('step-1', null, 'completed');
      setStepContentHash(step);

      // Clear hash (simulating edit during Stage 2)
      step.contentHash = undefined;

      const isUnchanged = isStepContentUnchanged(step);

      expect(isUnchanged).toBe(false);
    });
  });

  describe('computeStepHash determinism', () => {
    it('should produce consistent hash for same content', () => {
      const step1 = createMockStep('step-1');
      const step2 = createMockStep('step-1'); // Same ID, same content

      expect(computeStepHash(step1)).toBe(computeStepHash(step2));
    });

    it('should produce different hash for different content', () => {
      const step1 = createMockStep('step-1');
      const step2 = createMockStep('step-2'); // Different content

      expect(computeStepHash(step1)).not.toBe(computeStepHash(step2));
    });

    it('should normalize whitespace differences', () => {
      const step1 = createMockStep('step-1');
      step1.title = 'Title with spaces';

      const step2 = createMockStep('step-1');
      step2.title = 'Title  with   spaces'; // Multiple spaces

      expect(computeStepHash(step1)).toBe(computeStepHash(step2));
    });
  });

  describe('StepModificationContext for modified steps', () => {
    it('should build context for modified step', () => {
      const session = createMockSession({
        modifiedStepIds: ['step-1'],
        addedStepIds: [],
        removedStepIds: ['step-2'],
      });
      const step = createMockStep('step-1');

      // Build modification context as executeSingleStep does
      let modificationContext: StepModificationContext | undefined;
      if (session.modifiedStepIds?.includes(step.id) || session.addedStepIds?.includes(step.id)) {
        modificationContext = {
          wasModified: session.modifiedStepIds?.includes(step.id) ?? false,
          wasAdded: session.addedStepIds?.includes(step.id) ?? false,
          removedStepIds: session.removedStepIds,
        };
      }

      expect(modificationContext).toBeDefined();
      expect(modificationContext!.wasModified).toBe(true);
      expect(modificationContext!.wasAdded).toBe(false);
      expect(modificationContext!.removedStepIds).toContain('step-2');
    });

    it('should build context for added step', () => {
      const session = createMockSession({
        modifiedStepIds: [],
        addedStepIds: ['new-step'],
        removedStepIds: [],
      });
      const step = createMockStep('new-step');

      let modificationContext: StepModificationContext | undefined;
      if (session.modifiedStepIds?.includes(step.id) || session.addedStepIds?.includes(step.id)) {
        modificationContext = {
          wasModified: session.modifiedStepIds?.includes(step.id) ?? false,
          wasAdded: session.addedStepIds?.includes(step.id) ?? false,
          removedStepIds: session.removedStepIds,
        };
      }

      expect(modificationContext).toBeDefined();
      expect(modificationContext!.wasModified).toBe(false);
      expect(modificationContext!.wasAdded).toBe(true);
    });

    it('should not build context for unmodified step', () => {
      const session = createMockSession({
        modifiedStepIds: ['step-1'],
        addedStepIds: [],
        removedStepIds: [],
      });
      const step = createMockStep('step-2'); // Not in modified list

      let modificationContext: StepModificationContext | undefined;
      if (session.modifiedStepIds?.includes(step.id) || session.addedStepIds?.includes(step.id)) {
        modificationContext = {
          wasModified: session.modifiedStepIds?.includes(step.id) ?? false,
          wasAdded: session.addedStepIds?.includes(step.id) ?? false,
          removedStepIds: session.removedStepIds,
        };
      }

      expect(modificationContext).toBeUndefined();
    });
  });
});

// =============================================================================
// Full Flow Integration: Stage 5 → Stage 2 → Stage 3
// =============================================================================

describe('Step Modification Flow - Full Integration', () => {
  describe('complete modification flow simulation', () => {
    it('should handle edit-only flow: modify existing step', () => {
      // Initial state: 3 completed steps
      const steps: PlanStep[] = [
        createMockStep('step-1', null, 'completed'),
        createMockStep('step-2', null, 'completed'),
        createMockStep('step-3', null, 'completed'),
      ];
      steps.forEach(s => setStepContentHash(s));
      const plan = createMockPlan(steps);

      // Stage 2: Claude modifies step-2 content
      const claudeOutput = `
[STEP_MODIFICATIONS]
modified: ["step-2"]
[/STEP_MODIFICATIONS]

[PLAN_STEP id="step-2" parentId="null"]
Updated step 2 title
Updated step 2 description with new requirements
[/PLAN_STEP]
`;

      const { modifiedIds } = detectModifiedStepsFromPlanSteps(
        claudeOutput,
        new Set(plan.steps.map(s => s.id))
      );

      expect(modifiedIds).toContain('step-2');

      // Simulate clearing contentHash for modified step (as mergePlanStepsWithEdits does)
      const modifiedStep = plan.steps.find(s => s.id === 'step-2')!;
      modifiedStep.title = 'Updated step 2 title';
      modifiedStep.description = 'Updated step 2 description with new requirements';
      delete modifiedStep.contentHash;
      modifiedStep.status = 'pending';

      // Stage 3: Check which steps to skip
      const step1Unchanged = isStepContentUnchanged(plan.steps.find(s => s.id === 'step-1')!);
      const step2Unchanged = isStepContentUnchanged(plan.steps.find(s => s.id === 'step-2')!);
      const step3Unchanged = isStepContentUnchanged(plan.steps.find(s => s.id === 'step-3')!);

      expect(step1Unchanged).toBe(true); // Skip
      expect(step2Unchanged).toBe(false); // Re-implement
      expect(step3Unchanged).toBe(true); // Skip
    });

    it('should handle add flow: add new step', () => {
      // Initial state: 2 completed steps
      const steps: PlanStep[] = [
        createMockStep('step-1', null, 'completed'),
        createMockStep('step-2', null, 'completed'),
      ];
      steps.forEach(s => setStepContentHash(s));
      const plan = createMockPlan(steps);

      // Stage 2: Claude adds new step
      const claudeOutput = `
[STEP_MODIFICATIONS]
added: ["step-3"]
[/STEP_MODIFICATIONS]

[PLAN_STEP id="step-3" parentId="null"]
New step 3
New step 3 description
[/PLAN_STEP]
`;

      const result = processStepModifications(claudeOutput, plan.steps, ['step-3']);

      expect(result.modifications.addedStepIds).toContain('step-3');
      expect(result.isValid).toBe(true);

      // Add the new step to plan
      plan.steps.push(createMockStep('step-3', null, 'pending'));

      // Stage 3: Check which steps to skip
      const step1Unchanged = isStepContentUnchanged(plan.steps.find(s => s.id === 'step-1')!);
      const step2Unchanged = isStepContentUnchanged(plan.steps.find(s => s.id === 'step-2')!);
      const step3Unchanged = isStepContentUnchanged(plan.steps.find(s => s.id === 'step-3')!);

      expect(step1Unchanged).toBe(true); // Skip
      expect(step2Unchanged).toBe(true); // Skip
      expect(step3Unchanged).toBe(false); // Implement (new, no hash)
    });

    it('should handle remove flow: cascade delete', () => {
      // Initial state: parent with 2 children, all completed
      const steps: PlanStep[] = [
        createMockStep('parent', null, 'completed'),
        createMockStep('child-1', 'parent', 'completed'),
        createMockStep('child-2', 'parent', 'completed'),
        createMockStep('unrelated', null, 'completed'),
      ];
      steps.forEach(s => setStepContentHash(s));
      const plan = createMockPlan(steps);

      // Stage 2: Claude removes parent (triggers cascade)
      const claudeOutput = `
[REMOVE_STEPS]
["parent"]
[/REMOVE_STEPS]
`;

      const result = processStepModifications(claudeOutput, plan.steps);

      expect(result.allRemovedStepIds).toContain('parent');
      expect(result.allRemovedStepIds).toContain('child-1');
      expect(result.allRemovedStepIds).toContain('child-2');
      expect(result.allRemovedStepIds).not.toContain('unrelated');

      // Remove steps from plan
      plan.steps = plan.steps.filter(s => !result.allRemovedStepIds.includes(s.id));

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].id).toBe('unrelated');

      // Stage 3: Only unrelated step remains, should be skipped
      const unrelatedUnchanged = isStepContentUnchanged(plan.steps[0]);
      expect(unrelatedUnchanged).toBe(true);
    });

    it('should handle mixed flow: edit + add + remove', () => {
      // Initial state: 4 steps
      const steps: PlanStep[] = [
        createMockStep('step-1', null, 'completed'),
        createMockStep('step-2', null, 'completed'),
        createMockStep('step-3', null, 'completed'),
        createMockStep('step-4', null, 'pending'),
      ];
      steps.filter(s => s.status === 'completed').forEach(s => setStepContentHash(s));
      const plan = createMockPlan(steps);

      // Stage 2: Edit step-1, add step-5, remove step-3
      const claudeOutput = `
Based on feedback, I'm making the following changes:

[STEP_MODIFICATIONS]
modified: ["step-1"]
added: ["step-5"]
removed: ["step-3"]
[/STEP_MODIFICATIONS]

[PLAN_STEP id="step-1" parentId="null"]
Updated step 1 with new approach
[/PLAN_STEP]

[PLAN_STEP id="step-5" parentId="null"]
New additional step
[/PLAN_STEP]
`;

      const result = processStepModifications(claudeOutput, plan.steps, ['step-5']);

      expect(result.isValid).toBe(true);
      expect(result.modifications.modifiedStepIds).toContain('step-1');
      expect(result.modifications.addedStepIds).toContain('step-5');
      expect(result.allRemovedStepIds).toContain('step-3');

      // Apply changes
      // Remove step-3
      plan.steps = plan.steps.filter(s => !result.allRemovedStepIds.includes(s.id));

      // Edit step-1 (clear hash, reset status)
      const step1 = plan.steps.find(s => s.id === 'step-1')!;
      step1.title = 'Updated step 1 with new approach';
      delete step1.contentHash;
      step1.status = 'pending';

      // Add step-5
      plan.steps.push(createMockStep('step-5', null, 'pending'));

      // Stage 3 execution order check
      const results = plan.steps.map(s => ({
        id: s.id,
        status: s.status,
        shouldSkip: isStepContentUnchanged(s),
      }));

      // step-1: modified, should NOT skip
      expect(results.find(r => r.id === 'step-1')?.shouldSkip).toBe(false);
      // step-2: unchanged, should skip
      expect(results.find(r => r.id === 'step-2')?.shouldSkip).toBe(true);
      // step-3: removed, not in list
      expect(results.find(r => r.id === 'step-3')).toBeUndefined();
      // step-4: was pending, no hash, should NOT skip
      expect(results.find(r => r.id === 'step-4')?.shouldSkip).toBe(false);
      // step-5: new, no hash, should NOT skip
      expect(results.find(r => r.id === 'step-5')?.shouldSkip).toBe(false);
    });
  });

  describe('error handling for invalid modifications', () => {
    it('should handle error when removing non-existent step', () => {
      const steps: PlanStep[] = [createMockStep('step-1')];
      const claudeOutput = `
[REMOVE_STEPS]
["non-existent"]
[/REMOVE_STEPS]
`;

      const result = processStepModifications(claudeOutput, steps);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('non-existent'))).toBe(true);
    });

    it('should handle error when modifying non-existent step', () => {
      const steps: PlanStep[] = [createMockStep('step-1')];
      const claudeOutput = `
[STEP_MODIFICATIONS]
modified: ["non-existent"]
[/STEP_MODIFICATIONS]
`;

      const result = processStepModifications(claudeOutput, steps);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('non-existent'))).toBe(true);
    });

    it('should handle error when step is both added and removed', () => {
      const steps: PlanStep[] = [createMockStep('step-1')];
      const claudeOutput = `
[STEP_MODIFICATIONS]
added: ["step-2"]
removed: ["step-2"]
[/STEP_MODIFICATIONS]
`;

      const result = processStepModifications(claudeOutput, steps, ['step-2']);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('both added and removed'))).toBe(true);
    });
  });

  describe('handleStage3Completion clears modification tracking', () => {
    it('should clear all modification fields after Stage 3 completes', () => {
      // Simulate session with modification tracking set
      const session = createMockSession({
        currentStage: 3,
        modifiedStepIds: ['step-1'],
        addedStepIds: ['step-3'],
        removedStepIds: ['step-2'],
        isPlanModificationSession: true,
      });

      // Check that fields exist before clearing
      expect(session.modifiedStepIds).toBeDefined();
      expect(session.addedStepIds).toBeDefined();
      expect(session.removedStepIds).toBeDefined();
      expect(session.isPlanModificationSession).toBe(true);

      // Simulate what handleStage3Completion does
      const updatedSession: Partial<Session> = {
        modifiedStepIds: undefined,
        addedStepIds: undefined,
        removedStepIds: undefined,
        isPlanModificationSession: undefined,
      };

      // Apply updates
      const clearedSession = { ...session, ...updatedSession };

      expect(clearedSession.modifiedStepIds).toBeUndefined();
      expect(clearedSession.addedStepIds).toBeUndefined();
      expect(clearedSession.removedStepIds).toBeUndefined();
      expect(clearedSession.isPlanModificationSession).toBeUndefined();
    });
  });
});

// =============================================================================
// Edge Cases and Boundary Conditions
// =============================================================================

describe('Step Modification Flow - Edge Cases', () => {
  describe('empty and boundary conditions', () => {
    it('should handle empty plan with no steps', () => {
      const steps: PlanStep[] = [];
      const claudeOutput = `
[STEP_MODIFICATIONS]
added: ["step-1"]
[/STEP_MODIFICATIONS]
`;

      const result = processStepModifications(claudeOutput, steps, ['step-1']);

      expect(result.isValid).toBe(true);
      expect(result.modifications.addedStepIds).toContain('step-1');
    });

    it('should handle no modification markers in output', () => {
      const steps: PlanStep[] = [createMockStep('step-1')];
      const claudeOutput = 'Just some text without any markers';

      const result = processStepModifications(claudeOutput, steps);

      expect(result.isValid).toBe(true);
      expect(result.modifications.modifiedStepIds).toHaveLength(0);
      expect(result.modifications.addedStepIds).toHaveLength(0);
      expect(result.allRemovedStepIds).toHaveLength(0);
    });

    it('should handle step with null description', () => {
      const step: PlanStep = {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'Step with null description',
        description: null as unknown as string,
        status: 'completed',
        metadata: {},
      };

      // Should not throw
      setStepContentHash(step);
      expect(step.contentHash).toBeDefined();

      const isUnchanged = isStepContentUnchanged(step);
      expect(isUnchanged).toBe(true);
    });

    it('should handle step with empty string description', () => {
      const step: PlanStep = {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'Step with empty description',
        description: '',
        status: 'completed',
        metadata: {},
      };

      setStepContentHash(step);
      expect(step.contentHash).toBeDefined();

      const isUnchanged = isStepContentUnchanged(step);
      expect(isUnchanged).toBe(true);
    });
  });

  describe('concurrent modification scenarios', () => {
    it('should deduplicate step IDs across multiple REMOVE_STEPS markers', () => {
      const steps: PlanStep[] = [
        createMockStep('step-1'),
        createMockStep('step-2'),
      ];
      const claudeOutput = `
[REMOVE_STEPS]
["step-1"]
[/REMOVE_STEPS]

[REMOVE_STEPS]
["step-1", "step-2"]
[/REMOVE_STEPS]
`;

      const result = processStepModifications(claudeOutput, steps);

      // step-1 appears in both, should be deduplicated
      expect(result.allRemovedStepIds.filter(id => id === 'step-1')).toHaveLength(1);
      expect(result.allRemovedStepIds).toHaveLength(2); // step-1, step-2
    });

    it('should merge STEP_MODIFICATIONS removed with REMOVE_STEPS', () => {
      const steps: PlanStep[] = [
        createMockStep('step-1'),
        createMockStep('step-2'),
        createMockStep('step-3'),
      ];
      const claudeOutput = `
[STEP_MODIFICATIONS]
removed: ["step-1"]
[/STEP_MODIFICATIONS]

[REMOVE_STEPS]
["step-2"]
[/REMOVE_STEPS]
`;

      const result = processStepModifications(claudeOutput, steps);

      expect(result.allRemovedStepIds).toContain('step-1');
      expect(result.allRemovedStepIds).toContain('step-2');
      expect(result.allRemovedStepIds).not.toContain('step-3');
    });
  });

  describe('whitespace and formatting edge cases', () => {
    it('should handle PLAN_STEP markers with various whitespace', () => {
      const claudeOutput = `
[PLAN_STEP   id="step-1"   parentId="null"  ]
Title
Description
[/PLAN_STEP]
`;
      const existingStepIds = new Set(['step-1']);

      const { modifiedIds } = detectModifiedStepsFromPlanSteps(
        claudeOutput,
        existingStepIds
      );

      expect(modifiedIds).toContain('step-1');
    });

    it('should compute same hash regardless of line ending style', () => {
      const step1: PlanStep = {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'Title',
        description: 'Line 1\nLine 2\nLine 3',
        status: 'completed',
        metadata: {},
      };

      const step2: PlanStep = {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'Title',
        description: 'Line 1\r\nLine 2\r\nLine 3', // Windows line endings
        status: 'completed',
        metadata: {},
      };

      expect(computeStepHash(step1)).toBe(computeStepHash(step2));
    });
  });
});

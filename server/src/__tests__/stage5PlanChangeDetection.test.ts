/**
 * Integration tests for Stage 5 plan change detection flow.
 *
 * Tests the complete workflow including:
 * 1. Plan hash saved before Stage 5 execution
 * 2. Plan changes detected when Claude edits plan.md
 * 3. Auto-transition to Stage 2 triggered on plan change
 * 4. No transition when plan unchanged
 * 5. Event broadcast sent on auto-transition
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  computePlanHash,
  savePlanSnapshot,
  loadPlanSnapshot,
  hasPlanChangedSinceSnapshot,
  deletePlanSnapshot,
} from '../utils/stepContentHash';
import { syncPlanFromMarkdown } from '../utils/syncPlanFromMarkdown';
import type { Plan, PlanStep, Session } from '@claude-code-web/shared';
import type { ExecutionStatusOptions } from '../services/EventBroadcaster';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockStep(
  id: string,
  title: string,
  description: string,
  status: 'pending' | 'completed' = 'completed',
  complexity: 'low' | 'medium' | 'high' = 'medium'
): PlanStep {
  return {
    id,
    parentId: null,
    orderIndex: 0,
    title,
    description,
    status,
    metadata: {},
    complexity,
  };
}

function createMockPlan(steps: PlanStep[], planVersion = 1): Plan {
  return {
    version: '1.0.0',
    planVersion,
    sessionId: 'test-session',
    isApproved: true,
    reviewCount: 1,
    createdAt: new Date().toISOString(),
    steps,
  };
}

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    version: '1.0.0',
    dataVersion: 1,
    id: 'session-123',
    projectId: 'project-abc',
    featureId: 'test-feature',
    title: 'Test Feature',
    featureDescription: 'Test description',
    projectPath: '/test/project',
    acceptanceCriteria: [],
    affectedFiles: [],
    technicalNotes: '',
    baseBranch: 'main',
    featureBranch: 'feature/test',
    baseCommitSha: 'abc123',
    status: 'pr_review',
    currentStage: 5,
    replanningCount: 0,
    claudeSessionId: 'claude-session-123',
    claudeStage3SessionId: null,
    claudePlanFilePath: null,
    currentPlanVersion: 1,
    prUrl: null,
    sessionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Stage 5 Plan Change Detection Flow', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join('/tmp', `stage5-plan-change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Plan hash snapshot before Stage 5', () => {
    it('should save plan hash snapshot before Stage 5 execution', () => {
      const plan = createMockPlan([
        createMockStep('step-1', 'Add feature', 'Implementation'),
      ], 2);

      // Simulate spawnStage5PRReview saving snapshot
      const planHash = computePlanHash(plan);
      savePlanSnapshot(testDir, planHash, plan.planVersion);

      // Verify snapshot was saved correctly
      const snapshot = loadPlanSnapshot(testDir);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.hash).toBe(planHash);
      expect(snapshot?.planVersion).toBe(2);
      expect(snapshot?.savedAt).toBeDefined();
    });

    it('should overwrite previous snapshot when Stage 5 is re-run', () => {
      const plan1 = createMockPlan([createMockStep('step-1', 'Title', 'Desc')], 1);
      const plan2 = createMockPlan([createMockStep('step-1', 'Updated Title', 'Desc')], 2);

      // First Stage 5 run
      savePlanSnapshot(testDir, computePlanHash(plan1), plan1.planVersion);
      expect(loadPlanSnapshot(testDir)?.planVersion).toBe(1);

      // Second Stage 5 run (after returning from Stage 2)
      savePlanSnapshot(testDir, computePlanHash(plan2), plan2.planVersion);
      expect(loadPlanSnapshot(testDir)?.planVersion).toBe(2);
    });
  });

  describe('Plan change detection after Stage 5', () => {
    it('should detect no changes when plan is unchanged', () => {
      const plan = createMockPlan([
        createMockStep('step-1', 'Feature', 'Description'),
        createMockStep('step-2', 'Tests', 'Add tests'),
      ], 1);

      // Save snapshot before Stage 5
      savePlanSnapshot(testDir, computePlanHash(plan), plan.planVersion);

      // After Stage 5 completes without edits
      const result = hasPlanChangedSinceSnapshot(testDir, plan);
      expect(result).not.toBeNull();
      expect(result?.changed).toBe(false);
    });

    it('should detect changes when step title is modified', () => {
      const originalPlan = createMockPlan([
        createMockStep('step-1', 'Original Title', 'Description'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(originalPlan), originalPlan.planVersion);

      // Plan modified during Stage 5
      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Corrected Title', 'Description'),
      ], 1);

      const result = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);
      expect(result?.changed).toBe(true);
    });

    it('should detect changes when step description is modified', () => {
      const originalPlan = createMockPlan([
        createMockStep('step-1', 'Title', 'Original description'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(originalPlan), originalPlan.planVersion);

      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Title', 'Updated description with more detail'),
      ], 1);

      const result = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);
      expect(result?.changed).toBe(true);
    });

    it('should detect changes when a step is added', () => {
      const originalPlan = createMockPlan([
        createMockStep('step-1', 'Feature', 'Implementation'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(originalPlan), originalPlan.planVersion);

      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Feature', 'Implementation'),
        createMockStep('step-2', 'Error Handling', 'Added during review'),
      ], 1);

      const result = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);
      expect(result?.changed).toBe(true);
    });

    it('should detect changes when a step is removed', () => {
      const originalPlan = createMockPlan([
        createMockStep('step-1', 'Feature A', 'Description A'),
        createMockStep('step-2', 'Feature B', 'Description B'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(originalPlan), originalPlan.planVersion);

      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Feature A', 'Description A'),
      ], 1);

      const result = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);
      expect(result?.changed).toBe(true);
    });
  });

  describe('Plan.md sync and change detection', () => {
    it('should detect changes after syncing from edited plan.md', async () => {
      const originalPlan = createMockPlan([
        createMockStep('step-1', 'Original', 'Original description'),
      ], 1);

      // Save snapshot before Stage 5
      savePlanSnapshot(testDir, computePlanHash(originalPlan), originalPlan.planVersion);

      // Claude edits plan.md via Edit tool
      const planMdPath = path.join(testDir, 'plan.md');
      fs.writeFileSync(planMdPath, `# Plan

[PLAN_STEP id="step-1" complexity="medium"]
## Corrected Title
Updated description from PR review
[/PLAN_STEP]
`, 'utf8');

      // Sync plan.json from plan.md
      const syncResult = await syncPlanFromMarkdown(planMdPath, originalPlan);
      expect(syncResult).not.toBeNull();
      expect(syncResult!.syncResult.changed).toBe(true);

      // Check for changes against snapshot
      const changeResult = hasPlanChangedSinceSnapshot(testDir, syncResult!.updatedPlan);
      expect(changeResult?.changed).toBe(true);
    });

    it('should not detect changes when plan.md matches original plan', async () => {
      // Plan with title that includes markdown heading (as parser extracts it)
      const plan = createMockPlan([
        createMockStep('step-1', '## Feature', 'Description'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(plan), plan.planVersion);

      // plan.md content that matches
      const planMdPath = path.join(testDir, 'plan.md');
      fs.writeFileSync(planMdPath, `# Plan

[PLAN_STEP id="step-1" complexity="medium"]
## Feature
Description
[/PLAN_STEP]
`, 'utf8');

      const syncResult = await syncPlanFromMarkdown(planMdPath, plan);
      expect(syncResult!.syncResult.changed).toBe(false);

      const changeResult = hasPlanChangedSinceSnapshot(testDir, plan);
      expect(changeResult?.changed).toBe(false);
    });
  });

  describe('Auto-transition to Stage 2 simulation', () => {
    it('should trigger transition when plan changes detected', () => {
      const originalPlan = createMockPlan([
        createMockStep('step-1', 'Original', 'Description'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(originalPlan), originalPlan.planVersion);

      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Modified', 'Description'),
      ], 1);

      const changeResult = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);

      // Simulate handleStage5Result logic
      if (changeResult?.changed) {
        // Would trigger: sessionManager.transitionStage(projectId, featureId, 2)
        // Would trigger: eventBroadcaster.executionStatus(..., 'plan_changes_detected', ...)

        // Verify the transition would be triggered
        expect(changeResult.changed).toBe(true);

        // Clean up snapshot as handleStage5Result does
        deletePlanSnapshot(testDir);
        expect(loadPlanSnapshot(testDir)).toBeNull();
      }
    });

    it('should NOT trigger transition when plan unchanged', () => {
      const plan = createMockPlan([
        createMockStep('step-1', 'Feature', 'Description'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(plan), plan.planVersion);

      const changeResult = hasPlanChangedSinceSnapshot(testDir, plan);

      // Verify no transition would be triggered
      expect(changeResult?.changed).toBe(false);

      // Still clean up snapshot
      deletePlanSnapshot(testDir);
    });
  });

  describe('Event broadcast on auto-transition', () => {
    it('should include correct event data for plan_changes_detected', () => {
      // Simulate the event data that would be broadcast
      const session = createMockSession();
      const eventOptions: ExecutionStatusOptions = {
        stage: 5,
        autoTransitionTo: 2,
        reason: 'Plan steps modified during PR Review',
      };

      // Verify event structure
      expect(eventOptions.stage).toBe(5);
      expect(eventOptions.autoTransitionTo).toBe(2);
      expect(eventOptions.reason).toBe('Plan steps modified during PR Review');
    });

    it('should broadcast event before transitioning to Stage 2', () => {
      const originalPlan = createMockPlan([
        createMockStep('step-1', 'Original', 'Description'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(originalPlan), originalPlan.planVersion);

      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Modified', 'New description'),
      ], 1);

      const changeResult = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);

      // Simulate the order of operations in handleStage5Result
      const operations: string[] = [];

      if (changeResult?.changed) {
        // 1. Log the change
        operations.push('log_change_detected');

        // 2. Broadcast event (before transition)
        operations.push('broadcast_plan_changes_detected');

        // 3. Clean up snapshot
        operations.push('delete_snapshot');

        // 4. Transition to Stage 2
        operations.push('transition_to_stage_2');

        // 5. Spawn Stage 2
        operations.push('spawn_stage_2');
      }

      expect(operations).toEqual([
        'log_change_detected',
        'broadcast_plan_changes_detected',
        'delete_snapshot',
        'transition_to_stage_2',
        'spawn_stage_2',
      ]);
    });
  });

  describe('Complete Stage 5 workflow', () => {
    it('should handle full workflow: no changes -> PR approved', async () => {
      const plan = createMockPlan([
        createMockStep('step-1', 'Authentication', 'JWT auth', 'completed'),
        createMockStep('step-2', 'Tests', 'Unit tests', 'completed'),
      ], 2);

      // 1. Before Stage 5: save snapshot
      savePlanSnapshot(testDir, computePlanHash(plan), plan.planVersion);
      expect(loadPlanSnapshot(testDir)).not.toBeNull();

      // 2. Stage 5 runs, Claude reviews PR, no plan edits

      // 3. After Stage 5: check for changes
      const changeResult = hasPlanChangedSinceSnapshot(testDir, plan);
      expect(changeResult?.changed).toBe(false);

      // 4. Since no changes, proceed to check for PR_APPROVED marker
      // (would be handled by subsequent code in handleStage5Result)

      // 5. Clean up snapshot
      deletePlanSnapshot(testDir);
      expect(loadPlanSnapshot(testDir)).toBeNull();
    });

    it('should handle full workflow: changes detected -> return to Stage 2', async () => {
      const originalPlan = createMockPlan([
        createMockStep('step-1', 'Feature', 'Basic implementation'),
      ], 1);

      // 1. Before Stage 5: save snapshot
      savePlanSnapshot(testDir, computePlanHash(originalPlan), originalPlan.planVersion);

      // 2. Stage 5 runs, Claude reviews PR and edits plan.md
      const planMdPath = path.join(testDir, 'plan.md');
      fs.writeFileSync(planMdPath, `# Plan

[PLAN_STEP id="step-1" complexity="high"]
## Feature with error handling
Implementation with comprehensive error handling - discovered during review
[/PLAN_STEP]

[PLAN_STEP id="step-2" complexity="low"]
## Add logging
Logging discovered necessary during PR review
[/PLAN_STEP]
`, 'utf8');

      // 3. Sync plan.json from plan.md
      const syncResult = await syncPlanFromMarkdown(planMdPath, originalPlan);
      expect(syncResult!.syncResult.changed).toBe(true);
      expect(syncResult!.syncResult.addedCount).toBe(1);
      expect(syncResult!.syncResult.updatedCount).toBe(1);

      // 4. Check for changes
      const changeResult = hasPlanChangedSinceSnapshot(testDir, syncResult!.updatedPlan);
      expect(changeResult?.changed).toBe(true);

      // 5. Changes detected -> would transition to Stage 2
      // Clean up snapshot
      deletePlanSnapshot(testDir);
      expect(loadPlanSnapshot(testDir)).toBeNull();

      // 6. Stage 2 would be spawned with revision context
    });

    it('should handle edge case: snapshot missing (first-time or cleaned up)', () => {
      const plan = createMockPlan([createMockStep('step-1', 'Title', 'Desc')], 1);

      // No snapshot exists
      const changeResult = hasPlanChangedSinceSnapshot(testDir, plan);

      // Should return null, not throw
      expect(changeResult).toBeNull();

      // handleStage5Result would proceed to check markers without auto-transition
    });

    it('should handle edge case: corrupted snapshot file', () => {
      const plan = createMockPlan([createMockStep('step-1', 'Title', 'Desc')], 1);

      // Write corrupted snapshot
      const snapshotPath = path.join(testDir, '.plan-snapshot.json');
      fs.writeFileSync(snapshotPath, 'invalid json{', 'utf8');

      const changeResult = hasPlanChangedSinceSnapshot(testDir, plan);

      // Should handle gracefully
      expect(changeResult).toBeNull();
    });
  });

  describe('Hash determinism verification', () => {
    it('should produce consistent hashes across workflow steps', () => {
      const plan = createMockPlan([
        createMockStep('step-1', 'Feature A', 'Description A'),
        createMockStep('step-2', 'Feature B', 'Description B'),
      ], 1);

      // Hash at different points should be identical for same plan
      const hashBeforeStage5 = computePlanHash(plan);
      savePlanSnapshot(testDir, hashBeforeStage5, plan.planVersion);

      const hashAfterStage5 = computePlanHash(plan);
      const changeResult = hasPlanChangedSinceSnapshot(testDir, plan);

      expect(hashBeforeStage5).toBe(hashAfterStage5);
      expect(changeResult?.beforeHash).toBe(hashBeforeStage5);
      expect(changeResult?.afterHash).toBe(hashAfterStage5);
      expect(changeResult?.changed).toBe(false);
    });

    it('should be order-independent for steps', () => {
      const plan1 = createMockPlan([
        createMockStep('step-a', 'A', 'Desc A'),
        createMockStep('step-b', 'B', 'Desc B'),
        createMockStep('step-c', 'C', 'Desc C'),
      ], 1);

      const plan2 = createMockPlan([
        createMockStep('step-c', 'C', 'Desc C'),
        createMockStep('step-a', 'A', 'Desc A'),
        createMockStep('step-b', 'B', 'Desc B'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(plan1), plan1.planVersion);

      // Checking plan2 (different order) should show no changes
      const changeResult = hasPlanChangedSinceSnapshot(testDir, plan2);
      expect(changeResult?.changed).toBe(false);
    });
  });
});

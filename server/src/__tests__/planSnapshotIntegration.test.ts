/**
 * Integration tests for plan snapshot functionality in Stage 5 workflow.
 *
 * Tests the workflow where:
 * 1. Plan hash is computed and saved before Stage 5 starts
 * 2. Changes during Stage 5 are detected by comparing hashes
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
import type { Plan, PlanStep } from '@claude-code-web/shared';

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

// =============================================================================
// Integration Tests
// =============================================================================

describe('Plan Snapshot Integration for Stage 5', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join('/tmp', `plan-snapshot-integration-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Stage 5 workflow simulation', () => {
    it('should save snapshot before Stage 5 and detect no changes when PR is approved without edits', async () => {
      // Simulate the plan state when entering Stage 5
      const plan = createMockPlan([
        createMockStep('step-1', 'Implement authentication', 'Add JWT-based auth system', 'completed'),
        createMockStep('step-2', 'Add unit tests', 'Write tests for auth module', 'completed'),
        createMockStep('step-3', 'Update documentation', 'Document the new auth flow', 'completed'),
      ], 2);

      // Before Stage 5: save snapshot (as spawnStage5PRReview does)
      const planHash = computePlanHash(plan);
      savePlanSnapshot(testDir, planHash, plan.planVersion);

      // Verify snapshot was saved
      const savedSnapshot = loadPlanSnapshot(testDir);
      expect(savedSnapshot).not.toBeNull();
      expect(savedSnapshot?.hash).toBe(planHash);
      expect(savedSnapshot?.planVersion).toBe(2);

      // After Stage 5: check for changes (Claude didn't edit plan)
      const result = hasPlanChangedSinceSnapshot(testDir, plan);
      expect(result).not.toBeNull();
      expect(result?.changed).toBe(false);

      // Clean up snapshot after workflow
      deletePlanSnapshot(testDir);
      expect(loadPlanSnapshot(testDir)).toBeNull();
    });

    it('should detect when Claude modifies step description during PR review', async () => {
      // Initial plan before Stage 5
      const initialPlan = createMockPlan([
        createMockStep('step-1', 'Add feature', 'Basic implementation'),
      ], 1);

      // Save snapshot before Stage 5
      savePlanSnapshot(testDir, computePlanHash(initialPlan), initialPlan.planVersion);

      // Simulate Claude editing the plan during Stage 5
      // (e.g., correcting description to match actual implementation)
      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Add feature', 'Full implementation with error handling and logging'),
      ], 1);

      // Detect changes
      const result = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);
      expect(result).not.toBeNull();
      expect(result?.changed).toBe(true);
      expect(result?.beforeHash).not.toBe(result?.afterHash);
    });

    it('should detect when Claude adds a new step during PR review', async () => {
      const initialPlan = createMockPlan([
        createMockStep('step-1', 'Initial step', 'Description'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(initialPlan), initialPlan.planVersion);

      // Claude adds a missing step discovered during review
      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Initial step', 'Description'),
        createMockStep('step-2', 'Add validation', 'Input validation discovered necessary during review'),
      ], 1);

      const result = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);
      expect(result?.changed).toBe(true);
    });

    it('should detect when Claude removes a step during PR review', async () => {
      const initialPlan = createMockPlan([
        createMockStep('step-1', 'Step 1', 'Description 1'),
        createMockStep('step-2', 'Step 2', 'Description 2'),
        createMockStep('step-3', 'Step 3', 'Description 3'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(initialPlan), initialPlan.planVersion);

      // Claude removes a step that was redundant
      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Step 1', 'Description 1'),
        createMockStep('step-3', 'Step 3', 'Description 3'),
      ], 1);

      const result = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);
      expect(result?.changed).toBe(true);
    });

    it('should detect when Claude modifies step complexity during PR review', async () => {
      const initialPlan = createMockPlan([
        createMockStep('step-1', 'Complex feature', 'Implementation', 'completed', 'low'),
      ], 1);

      savePlanSnapshot(testDir, computePlanHash(initialPlan), initialPlan.planVersion);

      // Claude corrects complexity based on actual implementation effort
      const modifiedPlan = createMockPlan([
        createMockStep('step-1', 'Complex feature', 'Implementation', 'completed', 'high'),
      ], 1);

      const result = hasPlanChangedSinceSnapshot(testDir, modifiedPlan);
      expect(result?.changed).toBe(true);
    });

    it('should handle multiple Stage 5 iterations with snapshot updates', async () => {
      // First Stage 5 run
      const plan1 = createMockPlan([
        createMockStep('step-1', 'Feature A', 'Description A'),
      ], 1);
      savePlanSnapshot(testDir, computePlanHash(plan1), plan1.planVersion);

      // First run - no changes
      expect(hasPlanChangedSinceSnapshot(testDir, plan1)?.changed).toBe(false);

      // Transition back to Stage 2 for revisions, then new Stage 5
      const plan2 = createMockPlan([
        createMockStep('step-1', 'Feature A (revised)', 'Updated description'),
      ], 2);

      // Save new snapshot for second Stage 5 run
      savePlanSnapshot(testDir, computePlanHash(plan2), plan2.planVersion);

      // Verify new snapshot
      const snapshot = loadPlanSnapshot(testDir);
      expect(snapshot?.planVersion).toBe(2);
      expect(hasPlanChangedSinceSnapshot(testDir, plan2)?.changed).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle missing plan gracefully (no snapshot to compare)', async () => {
      const plan = createMockPlan([createMockStep('step-1', 'Title', 'Desc')], 1);

      // No snapshot saved - should return null
      const result = hasPlanChangedSinceSnapshot(testDir, plan);
      expect(result).toBeNull();
    });

    it('should handle corrupted snapshot file', async () => {
      // Write invalid JSON to snapshot file
      const snapshotPath = path.join(testDir, '.plan-snapshot.json');
      fs.writeFileSync(snapshotPath, 'not valid json', 'utf8');

      const plan = createMockPlan([createMockStep('step-1', 'Title', 'Desc')], 1);
      const result = hasPlanChangedSinceSnapshot(testDir, plan);

      // Should return null when snapshot can't be loaded
      expect(result).toBeNull();
    });
  });

  describe('hash determinism', () => {
    it('should produce identical hashes for identical plans across multiple calls', async () => {
      const plan = createMockPlan([
        createMockStep('step-1', 'Title 1', 'Description 1'),
        createMockStep('step-2', 'Title 2', 'Description 2'),
      ], 1);

      const hash1 = computePlanHash(plan);
      const hash2 = computePlanHash(plan);
      const hash3 = computePlanHash(plan);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('should produce same hash regardless of step array order', async () => {
      const plan1 = createMockPlan([
        createMockStep('step-a', 'Title A', 'Desc A'),
        createMockStep('step-b', 'Title B', 'Desc B'),
        createMockStep('step-c', 'Title C', 'Desc C'),
      ], 1);

      const plan2 = createMockPlan([
        createMockStep('step-c', 'Title C', 'Desc C'),
        createMockStep('step-a', 'Title A', 'Desc A'),
        createMockStep('step-b', 'Title B', 'Desc B'),
      ], 1);

      expect(computePlanHash(plan1)).toBe(computePlanHash(plan2));
    });
  });
});

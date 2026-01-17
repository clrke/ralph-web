/**
 * Unit tests for syncPlanFromMarkdown utility
 *
 * Tests the synchronization of plan.json with plan.md after direct Edit tool modifications.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parsePlanMarkdown,
  syncPlanFromMarkdown,
  getPlanMdPath,
  getValidPlanMdPath,
} from '../utils/syncPlanFromMarkdown';
import { computeStepHash } from '../utils/stepContentHash';
import type { Plan, PlanStep } from '@claude-code-web/shared';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockStep(
  id: string,
  title: string,
  description: string,
  status: 'pending' | 'completed' = 'pending'
): PlanStep {
  return {
    id,
    parentId: null,
    orderIndex: 0,
    title,
    description,
    status,
    metadata: {},
  };
}

function createMockPlan(steps: PlanStep[], planVersion = 1): Plan {
  return {
    version: '1.0.0',
    planVersion,
    sessionId: 'test-session',
    isApproved: false,
    reviewCount: 1,
    createdAt: new Date().toISOString(),
    steps,
  };
}

function createPlanMarkdown(steps: Array<{ id: string; title: string; description: string; parentId?: string | null }>): string {
  return steps.map(step => {
    const parentAttr = step.parentId ? ` parent="${step.parentId}"` : '';
    return `[PLAN_STEP id="${step.id}"${parentAttr}]
${step.title}
${step.description}
[/PLAN_STEP]`;
  }).join('\n\n');
}

// =============================================================================
// Test Suite
// =============================================================================

describe('syncPlanFromMarkdown', () => {
  let testDir: string;
  let planMdPath: string;

  beforeEach(() => {
    testDir = path.join('/tmp', `sync-plan-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    fs.mkdirSync(testDir, { recursive: true });
    planMdPath = path.join(testDir, 'plan.md');
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('parsePlanMarkdown', () => {
    it('should parse plan steps from markdown file', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'First Step', description: 'Description of first step' },
        { id: 'step-2', title: 'Second Step', description: 'Description of second step' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const steps = await parsePlanMarkdown(planMdPath);

      expect(steps).not.toBeNull();
      expect(steps).toHaveLength(2);
      expect(steps![0].id).toBe('step-1');
      expect(steps![0].title).toBe('First Step');
      expect(steps![1].id).toBe('step-2');
      expect(steps![1].title).toBe('Second Step');
    });

    it('should return null for non-existent file', async () => {
      const steps = await parsePlanMarkdown('/non/existent/plan.md');
      expect(steps).toBeNull();
    });

    it('should return empty array for file with no plan steps', async () => {
      fs.writeFileSync(planMdPath, '# Plan\n\nNo steps here.', 'utf8');

      const steps = await parsePlanMarkdown(planMdPath);

      expect(steps).not.toBeNull();
      expect(steps).toHaveLength(0);
    });

    it('should parse parent relationships', async () => {
      const markdown = `[PLAN_STEP id="step-1"]
Parent Step
This is the parent
[/PLAN_STEP]

[PLAN_STEP id="step-1a" parent="step-1"]
Child Step
This is the child
[/PLAN_STEP]`;
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const steps = await parsePlanMarkdown(planMdPath);

      expect(steps).toHaveLength(2);
      expect(steps![0].parentId).toBeNull();
      expect(steps![1].parentId).toBe('step-1');
    });
  });

  describe('syncPlanFromMarkdown', () => {
    it('should detect no changes when plan.md matches plan.json', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Step One', description: 'Description one' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const currentPlan = createMockPlan([
        createMockStep('step-1', 'Step One', 'Description one'),
      ]);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.syncResult.changed).toBe(false);
      expect(result!.syncResult.addedCount).toBe(0);
      expect(result!.syncResult.updatedCount).toBe(0);
      expect(result!.syncResult.removedCount).toBe(0);
    });

    it('should detect added steps', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Step One', description: 'Description one' },
        { id: 'step-2', title: 'Step Two', description: 'Description two' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const currentPlan = createMockPlan([
        createMockStep('step-1', 'Step One', 'Description one'),
      ]);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.syncResult.changed).toBe(true);
      expect(result!.syncResult.addedCount).toBe(1);
      expect(result!.syncResult.addedStepIds).toContain('step-2');
      expect(result!.updatedPlan.steps).toHaveLength(2);
    });

    it('should detect removed steps', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Step One', description: 'Description one' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const currentPlan = createMockPlan([
        createMockStep('step-1', 'Step One', 'Description one'),
        createMockStep('step-2', 'Step Two', 'Description two'),
      ]);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.syncResult.changed).toBe(true);
      expect(result!.syncResult.removedCount).toBe(1);
      expect(result!.syncResult.removedStepIds).toContain('step-2');
      expect(result!.updatedPlan.steps).toHaveLength(1);
    });

    it('should detect updated step titles', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Updated Title', description: 'Description one' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const currentPlan = createMockPlan([
        createMockStep('step-1', 'Original Title', 'Description one'),
      ]);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.syncResult.changed).toBe(true);
      expect(result!.syncResult.updatedCount).toBe(1);
      expect(result!.syncResult.updatedStepIds).toContain('step-1');
      expect(result!.updatedPlan.steps[0].title).toBe('Updated Title');
    });

    it('should detect updated step descriptions', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Step One', description: 'Updated description' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const currentPlan = createMockPlan([
        createMockStep('step-1', 'Step One', 'Original description'),
      ]);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.syncResult.changed).toBe(true);
      expect(result!.syncResult.updatedCount).toBe(1);
      expect(result!.updatedPlan.steps[0].description).toBe('Updated description');
    });

    it('should reset completed step to pending when content changes', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Updated Title', description: 'Updated description' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const completedStep = createMockStep('step-1', 'Original Title', 'Original description', 'completed');
      completedStep.contentHash = 'abc123';
      const currentPlan = createMockPlan([completedStep]);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.syncResult.changed).toBe(true);
      expect(result!.updatedPlan.steps[0].status).toBe('pending');
      expect(result!.updatedPlan.steps[0].contentHash).toBeUndefined();
    });

    it('should preserve step status when content unchanged', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Step One', description: 'Description one' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const completedStep = createMockStep('step-1', 'Step One', 'Description one', 'completed');
      const currentPlan = createMockPlan([completedStep]);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.syncResult.changed).toBe(false);
      expect(result!.updatedPlan.steps[0].status).toBe('completed');
    });

    it('should increment planVersion when changes detected', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Updated Title', description: 'Description' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const currentPlan = createMockPlan([
        createMockStep('step-1', 'Original Title', 'Description'),
      ], 3);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.updatedPlan.planVersion).toBe(4);
    });

    it('should not increment planVersion when no changes', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Step One', description: 'Description' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const currentPlan = createMockPlan([
        createMockStep('step-1', 'Step One', 'Description'),
      ], 3);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.updatedPlan.planVersion).toBe(3);
    });

    it('should handle multiple changes at once', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-1', title: 'Updated Step 1', description: 'Updated desc' },
        { id: 'step-3', title: 'New Step 3', description: 'New description' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const currentPlan = createMockPlan([
        createMockStep('step-1', 'Original Step 1', 'Original desc'),
        createMockStep('step-2', 'Step 2', 'Will be removed'),
      ]);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.syncResult.changed).toBe(true);
      expect(result!.syncResult.addedCount).toBe(1);
      expect(result!.syncResult.updatedCount).toBe(1);
      expect(result!.syncResult.removedCount).toBe(1);
      expect(result!.updatedPlan.steps).toHaveLength(2);
    });

    it('should return null when plan.md does not exist', async () => {
      const currentPlan = createMockPlan([
        createMockStep('step-1', 'Step One', 'Description'),
      ]);

      const result = await syncPlanFromMarkdown('/non/existent/plan.md', currentPlan);

      expect(result).toBeNull();
    });

    it('should update orderIndex based on position in markdown', async () => {
      const markdown = createPlanMarkdown([
        { id: 'step-2', title: 'Now First', description: 'Reordered' },
        { id: 'step-1', title: 'Now Second', description: 'Reordered' },
      ]);
      fs.writeFileSync(planMdPath, markdown, 'utf8');

      const currentPlan = createMockPlan([
        { ...createMockStep('step-1', 'Now Second', 'Reordered'), orderIndex: 0 },
        { ...createMockStep('step-2', 'Now First', 'Reordered'), orderIndex: 1 },
      ]);

      const result = await syncPlanFromMarkdown(planMdPath, currentPlan);

      expect(result).not.toBeNull();
      expect(result!.updatedPlan.steps[0].id).toBe('step-2');
      expect(result!.updatedPlan.steps[0].orderIndex).toBe(0);
      expect(result!.updatedPlan.steps[1].id).toBe('step-1');
      expect(result!.updatedPlan.steps[1].orderIndex).toBe(1);
    });
  });

  describe('getPlanMdPath', () => {
    it('should derive plan.md path from plan.json path', () => {
      expect(getPlanMdPath('/path/to/session/plan.json')).toBe('/path/to/session/plan.md');
      expect(getPlanMdPath('relative/plan.json')).toBe('relative/plan.md');
    });
  });

  describe('getValidPlanMdPath', () => {
    it('should return path if it ends with plan.md', () => {
      expect(getValidPlanMdPath('/path/to/plan.md')).toBe('/path/to/plan.md');
    });

    it('should return null for non-plan.md paths', () => {
      expect(getValidPlanMdPath('/path/to/plan.json')).toBeNull();
      expect(getValidPlanMdPath('/path/to/file.txt')).toBeNull();
    });

    it('should return null for null/undefined input', () => {
      expect(getValidPlanMdPath(null)).toBeNull();
      expect(getValidPlanMdPath(undefined)).toBeNull();
    });

    it('should append plan.md to directory paths', () => {
      expect(getValidPlanMdPath('/path/to/session')).toBe('/path/to/session/plan.md');
    });
  });
});

describe('integration: Stage 2 direct Edit workflow', () => {
  let testDir: string;
  let planMdPath: string;

  beforeEach(() => {
    testDir = path.join('/tmp', `sync-plan-integration-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    fs.mkdirSync(testDir, { recursive: true });
    planMdPath = path.join(testDir, 'plan.md');
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should sync plan after Claude edits step description via Edit tool', async () => {
    // Initial plan state
    const initialPlan = createMockPlan([
      createMockStep('step-1', 'Add authentication', 'Implement basic auth', 'completed'),
      createMockStep('step-2', 'Add tests', 'Write unit tests'),
    ], 1);

    // Claude uses Edit tool to update step-1 description in plan.md
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-1', title: 'Add authentication', description: 'Implement JWT authentication with refresh tokens' },
      { id: 'step-2', title: 'Add tests', description: 'Write unit tests' },
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    // Sync detects the change
    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    expect(result!.syncResult.changed).toBe(true);
    expect(result!.syncResult.updatedCount).toBe(1);
    expect(result!.syncResult.updatedStepIds).toContain('step-1');
    // Completed step should be reset to pending since content changed
    expect(result!.updatedPlan.steps[0].status).toBe('pending');
  });

  it('should sync plan after Claude adds new step via Edit tool', async () => {
    // Initial plan state
    const initialPlan = createMockPlan([
      createMockStep('step-1', 'Step 1', 'Description 1'),
    ], 1);

    // Claude uses Edit tool to add a new step
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-1', title: 'Step 1', description: 'Description 1' },
      { id: 'step-1a', title: 'New Step', description: 'Added during review', parentId: 'step-1' },
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    expect(result!.syncResult.changed).toBe(true);
    expect(result!.syncResult.addedCount).toBe(1);
    expect(result!.syncResult.addedStepIds).toContain('step-1a');
    expect(result!.updatedPlan.steps).toHaveLength(2);
    expect(result!.updatedPlan.steps[1].parentId).toBe('step-1');
  });

  it('should sync plan after Claude removes step via Edit tool', async () => {
    // Initial plan state
    const initialPlan = createMockPlan([
      createMockStep('step-1', 'Step 1', 'Description 1'),
      createMockStep('step-2', 'Step 2', 'Description 2'),
      createMockStep('step-3', 'Step 3', 'Description 3'),
    ], 1);

    // Claude uses Edit tool to remove step-2
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-1', title: 'Step 1', description: 'Description 1' },
      { id: 'step-3', title: 'Step 3', description: 'Description 3' },
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    expect(result!.syncResult.changed).toBe(true);
    expect(result!.syncResult.removedCount).toBe(1);
    expect(result!.syncResult.removedStepIds).toContain('step-2');
    expect(result!.updatedPlan.steps).toHaveLength(2);
  });
});

describe('content-hash based step matching', () => {
  let testDir: string;
  let planMdPath: string;

  beforeEach(() => {
    testDir = path.join('/tmp', `sync-plan-hash-match-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    fs.mkdirSync(testDir, { recursive: true });
    planMdPath = path.join(testDir, 'plan.md');
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should match renamed step by content hash and preserve completed status', async () => {
    // Original step-2 is completed with hash
    const originalStep = createMockStep('step-2', 'Implement Feature X', 'Add the feature X implementation', 'completed');
    originalStep.contentHash = computeStepHash(originalStep);

    const initialPlan = createMockPlan([
      createMockStep('step-1', 'Step 1', 'Description 1'),
      originalStep,
    ], 1);

    // Claude inserts a step and renumbers: old step-2 becomes step-3 (with same content)
    // Note: step-2 ID is removed and reused - realistic when Claude renumbers
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-1', title: 'Step 1', description: 'Description 1' },
      { id: 'step-1a', title: 'New Inserted Step', description: 'This is newly inserted' }, // New step with fresh ID
      { id: 'step-3', title: 'Implement Feature X', description: 'Add the feature X implementation' }, // Same content as old step-2, new ID
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    expect(result!.syncResult.changed).toBe(true);
    expect(result!.syncResult.renamedCount).toBe(1);
    expect(result!.syncResult.renamedSteps).toHaveLength(1);
    expect(result!.syncResult.renamedSteps[0]).toEqual({ oldId: 'step-2', newId: 'step-3' });

    // The renamed step should preserve completed status
    const renamedStep = result!.updatedPlan.steps.find(s => s.id === 'step-3');
    expect(renamedStep).toBeDefined();
    expect(renamedStep!.status).toBe('completed');
    expect(renamedStep!.contentHash).toBe(originalStep.contentHash);

    // The new step should be pending
    const newStep = result!.updatedPlan.steps.find(s => s.id === 'step-1a');
    expect(newStep).toBeDefined();
    expect(newStep!.status).toBe('pending');
  });

  it('should not match by hash if content is different', async () => {
    const completedStep = createMockStep('step-1', 'Original Title', 'Original description', 'completed');
    completedStep.contentHash = computeStepHash(completedStep);

    const initialPlan = createMockPlan([completedStep], 1);

    // New step with different content but similar structure
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-2', title: 'Different Title', description: 'Different description' },
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    expect(result!.syncResult.renamedCount).toBe(0);
    expect(result!.syncResult.addedCount).toBe(1);
    expect(result!.syncResult.removedCount).toBe(1);

    // New step should be pending (not matched)
    const newStep = result!.updatedPlan.steps.find(s => s.id === 'step-2');
    expect(newStep).toBeDefined();
    expect(newStep!.status).toBe('pending');
  });

  it('should not match pending steps by hash (only completed)', async () => {
    // Pending step with hash (edge case - shouldn't normally have hash)
    const pendingStep = createMockStep('step-1', 'Pending Step', 'Pending description', 'pending');
    pendingStep.contentHash = computeStepHash(pendingStep);

    const initialPlan = createMockPlan([pendingStep], 1);

    // Rename the step
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-2', title: 'Pending Step', description: 'Pending description' },
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    // Should NOT be renamed because original was pending
    expect(result!.syncResult.renamedCount).toBe(0);
    expect(result!.syncResult.addedCount).toBe(1);
    expect(result!.syncResult.removedCount).toBe(1);
  });

  it('should handle multiple renamed steps', async () => {
    const step1 = createMockStep('step-1', 'First Feature', 'First feature implementation', 'completed');
    step1.contentHash = computeStepHash(step1);
    const step2 = createMockStep('step-2', 'Second Feature', 'Second feature implementation', 'completed');
    step2.contentHash = computeStepHash(step2);

    const initialPlan = createMockPlan([step1, step2], 1);

    // Both steps renumbered
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-0', title: 'New First Step', description: 'Inserted at beginning' },
      { id: 'step-1', title: 'First Feature', description: 'First feature implementation' }, // Same content as old step-1
      { id: 'step-2', title: 'Second Feature', description: 'Second feature implementation' }, // Same content as old step-2
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    // step-1 and step-2 should be matched by ID (not hash), step-0 is new
    expect(result!.syncResult.addedCount).toBe(1);
    expect(result!.syncResult.renamedCount).toBe(0); // Matched by ID, not hash
    expect(result!.updatedPlan.steps).toHaveLength(3);
  });

  it('should not double-match a step (once matched by hash, not available for another)', async () => {
    // Two completed steps with the SAME content (edge case)
    const step1 = createMockStep('step-1', 'Duplicate Content', 'Same description', 'completed');
    step1.contentHash = computeStepHash(step1);
    const step2 = createMockStep('step-2', 'Duplicate Content', 'Same description', 'completed');
    step2.contentHash = computeStepHash(step2);

    const initialPlan = createMockPlan([step1, step2], 1);

    // Both renamed
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-3', title: 'Duplicate Content', description: 'Same description' },
      { id: 'step-4', title: 'Duplicate Content', description: 'Same description' },
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    // Only ONE should be matched by hash (first match wins), the other is treated as new
    expect(result!.syncResult.renamedCount).toBe(1);
    expect(result!.syncResult.addedCount).toBe(1);
    expect(result!.syncResult.removedCount).toBe(1); // The unmatched original

    // Both steps should have completed status (one from hash match, one is actually new but will be pending)
    const matchedStep = result!.updatedPlan.steps.find(s => s.status === 'completed');
    expect(matchedStep).toBeDefined();
  });

  it('should preserve metadata when matching by hash', async () => {
    const completedStep = createMockStep('step-old', 'Feature Implementation', 'Implement the feature', 'completed');
    completedStep.contentHash = computeStepHash(completedStep);
    completedStep.metadata = { completedAt: '2024-01-15T10:00:00Z', reviewer: 'test-user' };
    completedStep.complexity = 'high';

    const initialPlan = createMockPlan([completedStep], 1);

    // Renamed step
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-new', title: 'Feature Implementation', description: 'Implement the feature' },
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    expect(result!.syncResult.renamedCount).toBe(1);

    const renamedStep = result!.updatedPlan.steps.find(s => s.id === 'step-new');
    expect(renamedStep).toBeDefined();
    expect(renamedStep!.metadata).toEqual({ completedAt: '2024-01-15T10:00:00Z', reviewer: 'test-user' });
  });

  it('should handle whitespace-insensitive hash matching', async () => {
    // Step with some whitespace variations
    const completedStep = createMockStep('step-1', 'Feature Title', 'Feature description', 'completed');
    completedStep.contentHash = computeStepHash(completedStep);

    const initialPlan = createMockPlan([completedStep], 1);

    // Renamed step with extra whitespace (should normalize to same hash)
    const updatedMarkdown = `[PLAN_STEP id="step-2"]
Feature Title
  Feature description
[/PLAN_STEP]`;
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    // Should be matched by hash due to whitespace normalization
    expect(result!.syncResult.renamedCount).toBe(1);
    expect(result!.syncResult.renamedSteps[0]).toEqual({ oldId: 'step-1', newId: 'step-2' });
  });

  it('should not match step without contentHash (never completed)', async () => {
    // Completed step without contentHash (edge case - should not happen normally)
    const completedStep = createMockStep('step-1', 'Feature Title', 'Feature description', 'completed');
    // Intentionally NOT setting contentHash

    const initialPlan = createMockPlan([completedStep], 1);

    // Renamed step with same content
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-2', title: 'Feature Title', description: 'Feature description' },
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    // Should NOT be matched because original has no contentHash
    expect(result!.syncResult.renamedCount).toBe(0);
    expect(result!.syncResult.addedCount).toBe(1);
    expect(result!.syncResult.removedCount).toBe(1);
  });

  it('should prioritize ID match over hash match', async () => {
    // Two steps: step-1 completed with hash, step-2 pending
    const step1 = createMockStep('step-1', 'Same Content', 'Same description', 'completed');
    step1.contentHash = computeStepHash(step1);
    const step2 = createMockStep('step-2', 'Different Content', 'Different desc', 'pending');

    const initialPlan = createMockPlan([step1, step2], 1);

    // Markdown has step-2 with step-1's content (ID match should take precedence)
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-2', title: 'Same Content', description: 'Same description' }, // Same content as step-1, but ID matches step-2
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    // step-2 should be matched by ID (and updated), NOT by hash
    expect(result!.syncResult.renamedCount).toBe(0);
    expect(result!.syncResult.updatedCount).toBe(1);
    expect(result!.syncResult.updatedStepIds).toContain('step-2');
    // step-1 should be marked as removed
    expect(result!.syncResult.removedCount).toBe(1);
    expect(result!.syncResult.removedStepIds).toContain('step-1');
  });

  it('should handle complex renumbering scenario with ID conflicts', async () => {
    // Initial: step-1, step-2 (completed), step-3 (completed), step-4
    // This tests what happens when IDs are reused with different content
    const step1 = createMockStep('step-1', 'Setup', 'Initial setup', 'pending');
    const step2 = createMockStep('step-2', 'Feature A', 'Implement feature A', 'completed');
    step2.contentHash = computeStepHash(step2);
    const step3 = createMockStep('step-3', 'Feature B', 'Implement feature B', 'completed');
    step3.contentHash = computeStepHash(step3);
    const step4 = createMockStep('step-4', 'Cleanup', 'Final cleanup', 'pending');

    const initialPlan = createMockPlan([step1, step2, step3, step4], 1);

    // Claude fully renumbers with ID conflicts:
    // - step-2, step-3, step-4 IDs are REUSED with different content
    // - This prevents hash matching because IDs match first
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-1', title: 'Setup', description: 'Initial setup' },
      { id: 'step-2', title: 'New Middleware', description: 'Add middleware layer' }, // REUSES step-2 ID
      { id: 'step-3', title: 'Feature A', description: 'Implement feature A' }, // REUSES step-3 ID
      { id: 'step-4', title: 'Feature B', description: 'Implement feature B' }, // REUSES step-4 ID
      { id: 'step-5', title: 'Cleanup', description: 'Final cleanup' }, // NEW ID
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    expect(result!.syncResult.changed).toBe(true);

    // All existing IDs match, but content changed for step-2, step-3, step-4
    expect(result!.syncResult.updatedCount).toBe(3);
    expect(result!.syncResult.updatedStepIds).toContain('step-2');
    expect(result!.syncResult.updatedStepIds).toContain('step-3');
    expect(result!.syncResult.updatedStepIds).toContain('step-4');

    // step-5 is genuinely new
    expect(result!.syncResult.addedCount).toBe(1);
    expect(result!.syncResult.addedStepIds).toContain('step-5');

    // No hash matching happens because all IDs matched
    expect(result!.syncResult.renamedCount).toBe(0);

    // No removals (all old IDs still present in markdown)
    expect(result!.syncResult.removedCount).toBe(0);

    // step-2 and step-3 should be reset to pending (content changed, were completed)
    const newStep2 = result!.updatedPlan.steps.find(s => s.id === 'step-2');
    expect(newStep2?.status).toBe('pending');
    const newStep3 = result!.updatedPlan.steps.find(s => s.id === 'step-3');
    expect(newStep3?.status).toBe('pending');
  });

  it('should handle ideal renumbering (no ID reuse)', async () => {
    // This is the IDEAL scenario: Claude uses fresh IDs for new steps
    const step1 = createMockStep('step-1', 'Setup', 'Initial setup', 'pending');
    const step2 = createMockStep('step-2', 'Feature A', 'Implement feature A', 'completed');
    step2.contentHash = computeStepHash(step2);
    const step3 = createMockStep('step-3', 'Feature B', 'Implement feature B', 'completed');
    step3.contentHash = computeStepHash(step3);

    const initialPlan = createMockPlan([step1, step2, step3], 1);

    // Claude inserts step with a NEW ID (step-1a), renames old steps
    const updatedMarkdown = createPlanMarkdown([
      { id: 'step-1', title: 'Setup', description: 'Initial setup' },
      { id: 'step-1a', title: 'New Middleware', description: 'Add middleware layer' }, // NEW (fresh ID)
      { id: 'step-4', title: 'Feature A', description: 'Implement feature A' }, // Renamed from step-2
      { id: 'step-5', title: 'Feature B', description: 'Implement feature B' }, // Renamed from step-3
    ]);
    fs.writeFileSync(planMdPath, updatedMarkdown, 'utf8');

    const result = await syncPlanFromMarkdown(planMdPath, initialPlan);

    expect(result).not.toBeNull();
    expect(result!.syncResult.changed).toBe(true);

    // step-1a is new
    expect(result!.syncResult.addedCount).toBe(1);
    expect(result!.syncResult.addedStepIds).toContain('step-1a');

    // Both completed steps should be matched by hash
    expect(result!.syncResult.renamedCount).toBe(2);
    expect(result!.syncResult.renamedSteps).toContainEqual({ oldId: 'step-2', newId: 'step-4' });
    expect(result!.syncResult.renamedSteps).toContainEqual({ oldId: 'step-3', newId: 'step-5' });

    // Both renamed steps should preserve completed status
    const newStep4 = result!.updatedPlan.steps.find(s => s.id === 'step-4');
    expect(newStep4?.status).toBe('completed');
    const newStep5 = result!.updatedPlan.steps.find(s => s.id === 'step-5');
    expect(newStep5?.status).toBe('completed');

    // No removals (all old steps matched by ID or hash)
    expect(result!.syncResult.removedCount).toBe(0);
  });
});

import type { PlanStep } from '@claude-code-web/shared';
import {
  parseStepModifications,
  parseRemoveSteps,
  findCascadeDeletedSteps,
  validateStepModifications,
  processStepModifications,
  hasStepModificationMarkers,
  detectModifiedStepsFromPlanSteps,
  ParsedStepModifications,
} from '../../server/src/services/stepModificationParser';

describe('stepModificationParser', () => {
  // Helper to create mock plan steps
  const createMockStep = (
    id: string,
    parentId: string | null = null,
    title = `Step ${id}`
  ): PlanStep => ({
    id,
    parentId,
    orderIndex: 0,
    title,
    description: `Description for ${id}`,
    status: 'pending',
    metadata: {},
  });

  describe('parseStepModifications', () => {
    it('should parse STEP_MODIFICATIONS marker with JSON arrays', () => {
      const input = `
Some text before
[STEP_MODIFICATIONS]
modified: ["step-1", "step-2"]
added: ["step-new-1"]
removed: ["step-3"]
[/STEP_MODIFICATIONS]
Some text after
`;
      const result = parseStepModifications(input);

      expect(result).not.toBeNull();
      expect(result!.modifiedStepIds).toEqual(['step-1', 'step-2']);
      expect(result!.addedStepIds).toEqual(['step-new-1']);
      expect(result!.removedStepIds).toEqual(['step-3']);
    });

    it('should handle empty arrays', () => {
      const input = `
[STEP_MODIFICATIONS]
modified: []
added: []
removed: []
[/STEP_MODIFICATIONS]
`;
      const result = parseStepModifications(input);

      expect(result).not.toBeNull();
      expect(result!.modifiedStepIds).toEqual([]);
      expect(result!.addedStepIds).toEqual([]);
      expect(result!.removedStepIds).toEqual([]);
    });

    it('should handle missing fields', () => {
      const input = `
[STEP_MODIFICATIONS]
modified: ["step-1"]
[/STEP_MODIFICATIONS]
`;
      const result = parseStepModifications(input);

      expect(result).not.toBeNull();
      expect(result!.modifiedStepIds).toEqual(['step-1']);
      expect(result!.addedStepIds).toEqual([]);
      expect(result!.removedStepIds).toEqual([]);
    });

    it('should handle simple comma-separated format', () => {
      const input = `
[STEP_MODIFICATIONS]
modified: step-1, step-2
added: step-new-1
removed: step-3, step-4
[/STEP_MODIFICATIONS]
`;
      const result = parseStepModifications(input);

      expect(result).not.toBeNull();
      expect(result!.modifiedStepIds).toEqual(['step-1', 'step-2']);
      expect(result!.addedStepIds).toEqual(['step-new-1']);
      expect(result!.removedStepIds).toEqual(['step-3', 'step-4']);
    });

    it('should return null when marker is not found', () => {
      const input = 'Some text without markers';
      const result = parseStepModifications(input);

      expect(result).toBeNull();
    });

    it('should handle whitespace variations', () => {
      const input = `
[STEP_MODIFICATIONS]
  modified:   ["step-1"]
  added:["step-2"]
  removed :  ["step-3"]
[/STEP_MODIFICATIONS]
`;
      const result = parseStepModifications(input);

      expect(result).not.toBeNull();
      expect(result!.modifiedStepIds).toEqual(['step-1']);
      expect(result!.addedStepIds).toEqual(['step-2']);
      expect(result!.removedStepIds).toEqual(['step-3']);
    });

    it('should handle single quotes in array values', () => {
      const input = `
[STEP_MODIFICATIONS]
modified: 'step-1', 'step-2'
[/STEP_MODIFICATIONS]
`;
      const result = parseStepModifications(input);

      expect(result).not.toBeNull();
      expect(result!.modifiedStepIds).toEqual(['step-1', 'step-2']);
    });
  });

  describe('parseRemoveSteps', () => {
    it('should parse REMOVE_STEPS marker with JSON array', () => {
      const input = `
[REMOVE_STEPS]
["step-3", "step-4"]
[/REMOVE_STEPS]
`;
      const result = parseRemoveSteps(input);

      expect(result).toEqual(['step-3', 'step-4']);
    });

    it('should parse multiple REMOVE_STEPS markers', () => {
      const input = `
[REMOVE_STEPS]
["step-1"]
[/REMOVE_STEPS]

Some text

[REMOVE_STEPS]
["step-2", "step-3"]
[/REMOVE_STEPS]
`;
      const result = parseRemoveSteps(input);

      expect(result).toEqual(['step-1', 'step-2', 'step-3']);
    });

    it('should deduplicate step IDs', () => {
      const input = `
[REMOVE_STEPS]
["step-1", "step-1", "step-2"]
[/REMOVE_STEPS]
`;
      const result = parseRemoveSteps(input);

      expect(result).toEqual(['step-1', 'step-2']);
    });

    it('should handle line-by-line format', () => {
      const input = `
[REMOVE_STEPS]
- step-3
- step-4
[/REMOVE_STEPS]
`;
      const result = parseRemoveSteps(input);

      expect(result).toEqual(['step-3', 'step-4']);
    });

    it('should handle comma-separated format', () => {
      const input = `
[REMOVE_STEPS]
step-3, step-4
[/REMOVE_STEPS]
`;
      const result = parseRemoveSteps(input);

      expect(result).toEqual(['step-3', 'step-4']);
    });

    it('should return empty array when no marker found', () => {
      const input = 'Some text without markers';
      const result = parseRemoveSteps(input);

      expect(result).toEqual([]);
    });

    it('should handle empty marker', () => {
      const input = `
[REMOVE_STEPS]
[]
[/REMOVE_STEPS]
`;
      const result = parseRemoveSteps(input);

      expect(result).toEqual([]);
    });
  });

  describe('findCascadeDeletedSteps', () => {
    const mockSteps: PlanStep[] = [
      createMockStep('step-1', null),
      createMockStep('step-2', 'step-1'),
      createMockStep('step-3', 'step-1'),
      createMockStep('step-4', 'step-2'),
      createMockStep('step-5', 'step-4'),
      createMockStep('step-6', null),
    ];

    it('should find direct children', () => {
      const result = findCascadeDeletedSteps(['step-1'], mockSteps);

      expect(result).toContain('step-2');
      expect(result).toContain('step-3');
    });

    it('should find nested children recursively', () => {
      const result = findCascadeDeletedSteps(['step-1'], mockSteps);

      expect(result).toContain('step-2');
      expect(result).toContain('step-3');
      expect(result).toContain('step-4');
      expect(result).toContain('step-5');
    });

    it('should not include the original step being removed', () => {
      const result = findCascadeDeletedSteps(['step-1'], mockSteps);

      expect(result).not.toContain('step-1');
    });

    it('should not include unrelated steps', () => {
      const result = findCascadeDeletedSteps(['step-1'], mockSteps);

      expect(result).not.toContain('step-6');
    });

    it('should handle removing leaf node (no children)', () => {
      const result = findCascadeDeletedSteps(['step-6'], mockSteps);

      expect(result).toEqual([]);
    });

    it('should handle removing multiple steps', () => {
      const result = findCascadeDeletedSteps(['step-2', 'step-6'], mockSteps);

      expect(result).toContain('step-4');
      expect(result).toContain('step-5');
      expect(result).not.toContain('step-2');
      expect(result).not.toContain('step-6');
    });

    it('should handle empty removal list', () => {
      const result = findCascadeDeletedSteps([], mockSteps);

      expect(result).toEqual([]);
    });

    it('should handle step with no children', () => {
      const result = findCascadeDeletedSteps(['step-5'], mockSteps);

      expect(result).toEqual([]);
    });

    it('should not add children already in the original removal list', () => {
      // If both step-1 and step-2 are being removed, step-2 should not appear in cascadeDeleted
      const result = findCascadeDeletedSteps(['step-1', 'step-2'], mockSteps);

      expect(result).not.toContain('step-2');
      expect(result).toContain('step-3');
      expect(result).toContain('step-4');
      expect(result).toContain('step-5');
    });
  });

  describe('validateStepModifications', () => {
    const existingSteps: PlanStep[] = [
      createMockStep('step-1'),
      createMockStep('step-2', 'step-1'),
      createMockStep('step-3', 'step-1'),
    ];

    it('should return no errors for valid modifications', () => {
      const modifications: ParsedStepModifications = {
        modifiedStepIds: ['step-1'],
        addedStepIds: ['step-new-1'],
        removedStepIds: ['step-3'],
      };

      const errors = validateStepModifications(modifications, existingSteps, ['step-new-1']);

      expect(errors).toEqual([]);
    });

    it('should error when removing non-existent step', () => {
      const modifications: ParsedStepModifications = {
        modifiedStepIds: [],
        addedStepIds: [],
        removedStepIds: ['step-99'],
      };

      const errors = validateStepModifications(modifications, existingSteps, []);

      expect(errors).toContain('Cannot remove step "step-99": step does not exist in current plan');
    });

    it('should error when modifying non-existent step', () => {
      const modifications: ParsedStepModifications = {
        modifiedStepIds: ['step-99'],
        addedStepIds: [],
        removedStepIds: [],
      };

      const errors = validateStepModifications(modifications, existingSteps, []);

      expect(errors).toContain('Cannot modify step "step-99": step does not exist in current plan');
    });

    it('should error when adding step with existing ID', () => {
      const modifications: ParsedStepModifications = {
        modifiedStepIds: [],
        addedStepIds: ['step-1'],
        removedStepIds: [],
      };

      const errors = validateStepModifications(modifications, existingSteps, []);

      expect(errors).toContain('Cannot add step "step-1": step ID already exists');
    });

    it('should error when step is both added and removed', () => {
      const modifications: ParsedStepModifications = {
        modifiedStepIds: [],
        addedStepIds: ['step-new-1'],
        removedStepIds: ['step-new-1'],
      };

      const errors = validateStepModifications(modifications, existingSteps, ['step-new-1']);

      expect(errors).toContain('Step "step-new-1" cannot be both added and removed');
    });

    it('should error when step is both modified and removed', () => {
      const modifications: ParsedStepModifications = {
        modifiedStepIds: ['step-1'],
        addedStepIds: [],
        removedStepIds: ['step-1'],
      };

      const errors = validateStepModifications(modifications, existingSteps, []);

      expect(errors).toContain('Step "step-1" cannot be both modified and removed');
    });

    it('should allow adding step with ID that exists in newStepIds', () => {
      const modifications: ParsedStepModifications = {
        modifiedStepIds: [],
        addedStepIds: ['step-new-1'],
        removedStepIds: [],
      };

      const errors = validateStepModifications(modifications, existingSteps, ['step-new-1']);

      expect(errors).toEqual([]);
    });

    it('should collect multiple errors', () => {
      const modifications: ParsedStepModifications = {
        modifiedStepIds: ['step-99'],
        addedStepIds: ['step-1'],
        removedStepIds: ['step-98'],
      };

      const errors = validateStepModifications(modifications, existingSteps, []);

      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('processStepModifications', () => {
    const existingSteps: PlanStep[] = [
      createMockStep('step-1', null),
      createMockStep('step-2', 'step-1'),
      createMockStep('step-3', 'step-1'),
      createMockStep('step-4', 'step-2'),
    ];

    it('should process STEP_MODIFICATIONS marker', () => {
      const input = `
[STEP_MODIFICATIONS]
modified: ["step-1"]
added: ["step-new-1"]
removed: ["step-3"]
[/STEP_MODIFICATIONS]
`;
      const result = processStepModifications(input, existingSteps, ['step-new-1']);

      expect(result.isValid).toBe(true);
      expect(result.modifications.modifiedStepIds).toEqual(['step-1']);
      expect(result.modifications.addedStepIds).toEqual(['step-new-1']);
      expect(result.modifications.removedStepIds).toEqual(['step-3']);
    });

    it('should process REMOVE_STEPS marker alone', () => {
      const input = `
[REMOVE_STEPS]
["step-3"]
[/REMOVE_STEPS]
`;
      const result = processStepModifications(input, existingSteps);

      expect(result.isValid).toBe(true);
      expect(result.modifications.removedStepIds).toEqual(['step-3']);
    });

    it('should merge STEP_MODIFICATIONS and REMOVE_STEPS', () => {
      const input = `
[STEP_MODIFICATIONS]
removed: ["step-3"]
[/STEP_MODIFICATIONS]

[REMOVE_STEPS]
["step-4"]
[/REMOVE_STEPS]
`;
      const result = processStepModifications(input, existingSteps);

      expect(result.isValid).toBe(true);
      expect(result.modifications.removedStepIds).toContain('step-3');
      expect(result.modifications.removedStepIds).toContain('step-4');
    });

    it('should compute cascade deletions', () => {
      const input = `
[REMOVE_STEPS]
["step-1"]
[/REMOVE_STEPS]
`;
      const result = processStepModifications(input, existingSteps);

      expect(result.allRemovedStepIds).toContain('step-1');
      expect(result.allRemovedStepIds).toContain('step-2');
      expect(result.allRemovedStepIds).toContain('step-3');
      expect(result.allRemovedStepIds).toContain('step-4');
      expect(result.cascadeDeletedStepIds).toContain('step-2');
      expect(result.cascadeDeletedStepIds).toContain('step-3');
      expect(result.cascadeDeletedStepIds).toContain('step-4');
    });

    it('should return validation errors', () => {
      const input = `
[REMOVE_STEPS]
["step-99"]
[/REMOVE_STEPS]
`;
      const result = processStepModifications(input, existingSteps);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return empty result when no markers found', () => {
      const input = 'No markers here';
      const result = processStepModifications(input, existingSteps);

      expect(result.isValid).toBe(true);
      expect(result.modifications.modifiedStepIds).toEqual([]);
      expect(result.modifications.addedStepIds).toEqual([]);
      expect(result.modifications.removedStepIds).toEqual([]);
      expect(result.allRemovedStepIds).toEqual([]);
    });

    it('should deduplicate removed step IDs', () => {
      const input = `
[STEP_MODIFICATIONS]
removed: ["step-3"]
[/STEP_MODIFICATIONS]

[REMOVE_STEPS]
["step-3"]
[/REMOVE_STEPS]
`;
      const result = processStepModifications(input, existingSteps);

      expect(result.modifications.removedStepIds).toEqual(['step-3']);
    });
  });

  describe('hasStepModificationMarkers', () => {
    it('should detect STEP_MODIFICATIONS marker', () => {
      expect(hasStepModificationMarkers('[STEP_MODIFICATIONS]')).toBe(true);
    });

    it('should detect REMOVE_STEPS marker', () => {
      expect(hasStepModificationMarkers('[REMOVE_STEPS]')).toBe(true);
    });

    it('should return false when no markers present', () => {
      expect(hasStepModificationMarkers('No markers here')).toBe(false);
    });

    it('should detect markers in larger text', () => {
      const input = `
Some text before
[STEP_MODIFICATIONS]
content
[/STEP_MODIFICATIONS]
Some text after
`;
      expect(hasStepModificationMarkers(input)).toBe(true);
    });
  });

  describe('detectModifiedStepsFromPlanSteps', () => {
    const existingStepIds = new Set(['step-1', 'step-2', 'step-3']);

    it('should detect modified steps from PLAN_STEP markers', () => {
      const input = `
[PLAN_STEP id="step-1" parent="null" status="pending" complexity="medium"]
Updated step 1 title
Updated description
[/PLAN_STEP]
`;
      const result = detectModifiedStepsFromPlanSteps(input, existingStepIds);

      expect(result.modifiedIds).toEqual(['step-1']);
      expect(result.newIds).toEqual([]);
    });

    it('should detect new steps from PLAN_STEP markers', () => {
      const input = `
[PLAN_STEP id="step-new-1" parent="step-1" status="pending" complexity="low"]
New step title
New description
[/PLAN_STEP]
`;
      const result = detectModifiedStepsFromPlanSteps(input, existingStepIds);

      expect(result.modifiedIds).toEqual([]);
      expect(result.newIds).toEqual(['step-new-1']);
    });

    it('should handle multiple PLAN_STEP markers', () => {
      const input = `
[PLAN_STEP id="step-1" parent="null" status="pending" complexity="medium"]
Updated
[/PLAN_STEP]

[PLAN_STEP id="step-new-1" parent="step-1" status="pending" complexity="low"]
New
[/PLAN_STEP]

[PLAN_STEP id="step-2" parent="null" status="pending" complexity="high"]
Also updated
[/PLAN_STEP]
`;
      const result = detectModifiedStepsFromPlanSteps(input, existingStepIds);

      expect(result.modifiedIds).toEqual(['step-1', 'step-2']);
      expect(result.newIds).toEqual(['step-new-1']);
    });

    it('should deduplicate IDs', () => {
      const input = `
[PLAN_STEP id="step-1" parent="null" status="pending" complexity="medium"]
First occurrence
[/PLAN_STEP]

[PLAN_STEP id="step-1" parent="null" status="pending" complexity="high"]
Second occurrence (shouldn't happen but handle gracefully)
[/PLAN_STEP]
`;
      const result = detectModifiedStepsFromPlanSteps(input, existingStepIds);

      expect(result.modifiedIds).toEqual(['step-1']);
    });

    it('should return empty arrays when no PLAN_STEP markers', () => {
      const input = 'No markers here';
      const result = detectModifiedStepsFromPlanSteps(input, existingStepIds);

      expect(result.modifiedIds).toEqual([]);
      expect(result.newIds).toEqual([]);
    });
  });

  describe('integration scenarios', () => {
    it('should handle Stage 2 revision with all modification types', () => {
      const existingSteps: PlanStep[] = [
        createMockStep('step-1', null),
        createMockStep('step-2', 'step-1'),
        createMockStep('step-3', 'step-1'),
        createMockStep('step-4', 'step-2'),
      ];

      const claudeOutput = `
Based on your feedback, I'll make the following changes to the plan:

1. I'll update step-1 to include more detail
2. I'll add a new step for testing
3. I'll remove step-3 as it's no longer needed

[PLAN_STEP id="step-1" parent="null" status="pending" complexity="medium"]
Updated step 1 title
More detailed description for step 1 with additional context.
[/PLAN_STEP]

[PLAN_STEP id="step-new-1" parent="step-1" status="pending" complexity="low"]
Add unit tests
Create comprehensive unit tests for the new functionality.
[/PLAN_STEP]

[REMOVE_STEPS]
["step-3"]
[/REMOVE_STEPS]

[STEP_MODIFICATIONS]
modified: ["step-1"]
added: ["step-new-1"]
removed: ["step-3"]
[/STEP_MODIFICATIONS]
`;

      const result = processStepModifications(claudeOutput, existingSteps, ['step-new-1']);

      expect(result.isValid).toBe(true);
      expect(result.modifications.modifiedStepIds).toEqual(['step-1']);
      expect(result.modifications.addedStepIds).toEqual(['step-new-1']);
      expect(result.modifications.removedStepIds).toEqual(['step-3']);
      expect(result.allRemovedStepIds).toEqual(['step-3']);
      expect(result.cascadeDeletedStepIds).toEqual([]);
    });

    it('should handle cascade deletion scenario', () => {
      const existingSteps: PlanStep[] = [
        createMockStep('step-1', null),
        createMockStep('step-2', 'step-1'),
        createMockStep('step-3', 'step-2'),
        createMockStep('step-4', null),
      ];

      const claudeOutput = `
Removing the entire authentication flow as per your request.

[REMOVE_STEPS]
["step-1"]
[/REMOVE_STEPS]

[STEP_MODIFICATIONS]
removed: ["step-1"]
[/STEP_MODIFICATIONS]
`;

      const result = processStepModifications(claudeOutput, existingSteps);

      expect(result.isValid).toBe(true);
      expect(result.modifications.removedStepIds).toEqual(['step-1']);
      expect(result.cascadeDeletedStepIds).toEqual(['step-2', 'step-3']);
      expect(result.allRemovedStepIds).toContain('step-1');
      expect(result.allRemovedStepIds).toContain('step-2');
      expect(result.allRemovedStepIds).toContain('step-3');
      expect(result.allRemovedStepIds).not.toContain('step-4');
    });

    it('should detect modifications from PLAN_STEP markers when STEP_MODIFICATIONS is incomplete', () => {
      const existingStepIds = new Set(['step-1', 'step-2']);

      const claudeOutput = `
[PLAN_STEP id="step-1" parent="null" status="pending" complexity="high"]
Updated title
Updated description with more context and detail.
[/PLAN_STEP]

[PLAN_STEP id="step-new-1" parent="step-1" status="pending" complexity="medium"]
New step
Add this new functionality to the system.
[/PLAN_STEP]
`;

      const detected = detectModifiedStepsFromPlanSteps(claudeOutput, existingStepIds);

      expect(detected.modifiedIds).toEqual(['step-1']);
      expect(detected.newIds).toEqual(['step-new-1']);
    });
  });
});

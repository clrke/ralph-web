/**
 * Parser for step modification markers in Claude's output.
 * Handles [STEP_MODIFICATIONS] and [REMOVE_STEPS] markers,
 * and implements cascade deletion logic for child steps.
 */

import type { PlanStep } from '@claude-code-web/shared';

/**
 * Parsed step modifications from Claude's output
 */
export interface ParsedStepModifications {
  /** IDs of steps that were modified (existing steps with updated content) */
  modifiedStepIds: string[];
  /** IDs of newly added steps */
  addedStepIds: string[];
  /** IDs of steps to remove (directly specified) */
  removedStepIds: string[];
}

/**
 * Result of applying step modifications to a plan
 */
export interface StepModificationResult {
  /** The parsed modifications from markers */
  modifications: ParsedStepModifications;
  /** All step IDs that will be removed (including cascade-deleted children) */
  allRemovedStepIds: string[];
  /** Step IDs that were cascade-deleted (children of removed steps) */
  cascadeDeletedStepIds: string[];
  /** Validation errors, if any */
  errors: string[];
  /** Whether the modifications are valid */
  isValid: boolean;
}

/**
 * Parse [STEP_MODIFICATIONS] marker from Claude's output.
 *
 * Expected format:
 * ```
 * [STEP_MODIFICATIONS]
 * modified: ["step-1", "step-2"]
 * added: ["step-new-1"]
 * removed: ["step-3"]
 * [/STEP_MODIFICATIONS]
 * ```
 */
export function parseStepModifications(input: string): ParsedStepModifications | null {
  const regex = /\[STEP_MODIFICATIONS\]([\s\S]*?)\[\/STEP_MODIFICATIONS\]/;
  const match = input.match(regex);

  if (!match) {
    return null;
  }

  const content = match[1].trim();

  // Parse each array field
  const modifiedStepIds = parseArrayField(content, 'modified');
  const addedStepIds = parseArrayField(content, 'added');
  const removedStepIds = parseArrayField(content, 'removed');

  return {
    modifiedStepIds,
    addedStepIds,
    removedStepIds,
  };
}

/**
 * Parse [REMOVE_STEPS] marker from Claude's output.
 *
 * Expected format:
 * ```
 * [REMOVE_STEPS]
 * ["step-3", "step-4"]
 * [/REMOVE_STEPS]
 * ```
 */
export function parseRemoveSteps(input: string): string[] {
  const regex = /\[REMOVE_STEPS\]([\s\S]*?)\[\/REMOVE_STEPS\]/g;
  const allRemovedIds: string[] = [];

  let match;
  while ((match = regex.exec(input)) !== null) {
    const content = match[1].trim();

    try {
      // Try to parse as JSON array
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        allRemovedIds.push(...parsed.filter((id): id is string => typeof id === 'string'));
      }
    } catch {
      // If JSON parsing fails, try line-by-line parsing
      // Handle formats like:
      // - step-3
      // - step-4
      // Or: step-3, step-4
      const lines = content.split(/[\n,]/);
      for (const line of lines) {
        const trimmed = line.replace(/^[-*\s]+/, '').replace(/["']/g, '').trim();
        if (trimmed && !trimmed.startsWith('[') && !trimmed.startsWith(']')) {
          allRemovedIds.push(trimmed);
        }
      }
    }
  }

  // Return unique IDs
  return Array.from(new Set(allRemovedIds));
}

/**
 * Parse an array field from STEP_MODIFICATIONS content.
 * Handles both JSON array format and simple list format.
 */
function parseArrayField(content: string, fieldName: string): string[] {
  // Try to match field with JSON array: modified: ["step-1", "step-2"]
  const jsonRegex = new RegExp(`${fieldName}\\s*:\\s*(\\[[^\\]]*\\])`, 'i');
  const jsonMatch = content.match(jsonRegex);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      // Fall through to simple format parsing
    }
  }

  // Try simpler format: modified: step-1, step-2
  const simpleRegex = new RegExp(`${fieldName}\\s*:\\s*([^\\n]+)`, 'i');
  const simpleMatch = content.match(simpleRegex);

  if (simpleMatch) {
    const value = simpleMatch[1].trim();
    // Skip if it looks like a JSON array (we already tried to parse it)
    if (!value.startsWith('[')) {
      return value
        .split(',')
        .map(s => s.replace(/["']/g, '').trim())
        .filter(Boolean);
    }
  }

  return [];
}

/**
 * Maximum depth for cascade deletion to prevent DoS via deeply nested plans.
 * 100 levels is more than sufficient for any realistic plan structure.
 */
const MAX_CASCADE_DEPTH = 100;

/**
 * Find all child steps recursively (cascade deletion).
 * Returns all step IDs that are descendants of the given step IDs.
 *
 * Security: Includes depth limiting and cycle detection to prevent DoS attacks
 * via malformed plans with circular parentId references or excessive nesting.
 */
export function findCascadeDeletedSteps(
  stepsToRemove: string[],
  allSteps: PlanStep[]
): string[] {
  const cascadeDeleted: Set<string> = new Set();
  const processed = new Set<string>();

  // Track ancestry path for cycle detection
  const ancestryPath = new Set<string>();

  // Build a parent->children index for efficient lookups
  const childrenByParent = new Map<string, PlanStep[]>();
  for (const step of allSteps) {
    if (step.parentId) {
      const siblings = childrenByParent.get(step.parentId) || [];
      siblings.push(step);
      childrenByParent.set(step.parentId, siblings);
    }
  }

  function processStep(stepId: string, depth: number): void {
    // Depth limit check
    if (depth > MAX_CASCADE_DEPTH) {
      console.warn(
        `[Security] Cascade deletion depth limit (${MAX_CASCADE_DEPTH}) exceeded at step "${stepId}". ` +
        `This may indicate a malformed plan structure.`
      );
      return;
    }

    // Cycle detection
    if (ancestryPath.has(stepId)) {
      console.warn(
        `[Security] Circular parentId reference detected at step "${stepId}". ` +
        `This indicates a malformed plan structure. Stopping cascade for this branch.`
      );
      return;
    }

    if (processed.has(stepId)) {
      return;
    }
    processed.add(stepId);
    ancestryPath.add(stepId);

    // Find all direct children of this step using the index
    const children = childrenByParent.get(stepId) || [];

    for (const child of children) {
      // Only add if not already in the original removal list
      if (!stepsToRemove.includes(child.id)) {
        cascadeDeleted.add(child.id);
      }
      // Recursively process grandchildren
      processStep(child.id, depth + 1);
    }

    ancestryPath.delete(stepId);
  }

  // Process each step to remove
  for (const stepId of stepsToRemove) {
    processStep(stepId, 0);
  }

  return Array.from(cascadeDeleted);
}

/**
 * Validate step modifications against existing plan steps.
 */
export function validateStepModifications(
  modifications: ParsedStepModifications,
  existingSteps: PlanStep[],
  newStepIds: string[]
): string[] {
  const errors: string[] = [];
  const existingStepIds = new Set(existingSteps.map(s => s.id));

  // Validate removed step IDs exist
  for (const stepId of modifications.removedStepIds) {
    if (!existingStepIds.has(stepId)) {
      errors.push(`Cannot remove step "${stepId}": step does not exist in current plan`);
    }
  }

  // Validate modified step IDs exist
  for (const stepId of modifications.modifiedStepIds) {
    if (!existingStepIds.has(stepId)) {
      errors.push(`Cannot modify step "${stepId}": step does not exist in current plan`);
    }
  }

  // Validate added step IDs are unique
  const allExistingIds = new Set(Array.from(existingStepIds).concat(modifications.modifiedStepIds));
  for (const stepId of modifications.addedStepIds) {
    if (allExistingIds.has(stepId) && !newStepIds.includes(stepId)) {
      errors.push(`Cannot add step "${stepId}": step ID already exists`);
    }
  }

  // Validate no circular references - a step cannot be both added and removed
  const addedSet = new Set(modifications.addedStepIds);
  const removedSet = new Set(modifications.removedStepIds);
  for (const stepId of modifications.addedStepIds) {
    if (removedSet.has(stepId)) {
      errors.push(`Step "${stepId}" cannot be both added and removed`);
    }
  }

  // Validate no step is both modified and removed
  for (const stepId of modifications.modifiedStepIds) {
    if (removedSet.has(stepId)) {
      errors.push(`Step "${stepId}" cannot be both modified and removed`);
    }
  }

  return errors;
}

/**
 * Process step modifications from Claude's output.
 * Parses both STEP_MODIFICATIONS and REMOVE_STEPS markers,
 * validates modifications, and computes cascade deletions.
 */
export function processStepModifications(
  input: string,
  existingSteps: PlanStep[],
  newStepIds: string[] = []
): StepModificationResult {
  // Parse STEP_MODIFICATIONS marker
  let modifications = parseStepModifications(input);

  // Parse REMOVE_STEPS markers (can have multiple)
  const removeStepsFromMarker = parseRemoveSteps(input);

  // If no STEP_MODIFICATIONS marker but has REMOVE_STEPS, construct modifications
  if (!modifications && removeStepsFromMarker.length > 0) {
    modifications = {
      modifiedStepIds: [],
      addedStepIds: [],
      removedStepIds: removeStepsFromMarker,
    };
  }

  // If no modifications found at all, return empty result
  if (!modifications) {
    return {
      modifications: {
        modifiedStepIds: [],
        addedStepIds: [],
        removedStepIds: [],
      },
      allRemovedStepIds: [],
      cascadeDeletedStepIds: [],
      errors: [],
      isValid: true,
    };
  }

  // Merge REMOVE_STEPS into modifications (deduplicated)
  const mergedRemovedIds = Array.from(new Set(
    modifications.removedStepIds.concat(removeStepsFromMarker)
  ));
  modifications = {
    ...modifications,
    removedStepIds: mergedRemovedIds,
  };

  // Validate modifications
  const errors = validateStepModifications(modifications, existingSteps, newStepIds);

  // Compute cascade deletions
  const cascadeDeletedStepIds = findCascadeDeletedSteps(
    modifications.removedStepIds,
    existingSteps
  );

  // All removed IDs = directly removed + cascade deleted
  const allRemovedStepIds = Array.from(new Set(
    modifications.removedStepIds.concat(cascadeDeletedStepIds)
  ));

  return {
    modifications,
    allRemovedStepIds,
    cascadeDeletedStepIds,
    errors,
    isValid: errors.length === 0,
  };
}

/**
 * Check if the input contains any step modification markers.
 */
export function hasStepModificationMarkers(input: string): boolean {
  return (
    input.includes('[STEP_MODIFICATIONS]') ||
    input.includes('[REMOVE_STEPS]')
  );
}

/**
 * Determine which existing step IDs are being modified based on PLAN_STEP markers.
 * A step is considered "modified" if a PLAN_STEP marker with that ID exists in the output.
 */
export function detectModifiedStepsFromPlanSteps(
  input: string,
  existingStepIds: Set<string>
): { modifiedIds: string[]; newIds: string[] } {
  const planStepIdRegex = /\[PLAN_STEP\s+id="([^"]+)"/g;
  const modifiedIds: string[] = [];
  const newIds: string[] = [];

  let match;
  while ((match = planStepIdRegex.exec(input)) !== null) {
    const stepId = match[1];
    if (existingStepIds.has(stepId)) {
      modifiedIds.push(stepId);
    } else {
      newIds.push(stepId);
    }
  }

  return {
    modifiedIds: Array.from(new Set(modifiedIds)),
    newIds: Array.from(new Set(newIds)),
  };
}

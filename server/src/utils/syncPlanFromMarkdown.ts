/**
 * Utility to synchronize plan.json with plan.md after direct file edits.
 *
 * When Claude uses the Edit tool directly to modify plan.md (instead of outputting markers),
 * this utility reads the updated plan.md file, parses the PLAN_STEP markers,
 * and updates plan.json to match.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { Plan, PlanStep } from '@claude-code-web/shared';
import { OutputParser, ParsedPlanStep } from '../services/OutputParser';
import { computeStepHash } from './stepContentHash';

/**
 * Result of syncing plan.md to plan.json
 */
export interface SyncResult {
  /** Whether any changes were detected and applied */
  changed: boolean;
  /** Number of steps added */
  addedCount: number;
  /** Number of steps updated (title/description changed) */
  updatedCount: number;
  /** Number of steps removed */
  removedCount: number;
  /** Number of steps matched by content hash (ID changed but content same) */
  renamedCount: number;
  /** Step IDs that were added */
  addedStepIds: string[];
  /** Step IDs that were updated */
  updatedStepIds: string[];
  /** Step IDs that were removed */
  removedStepIds: string[];
  /** Steps that were renamed (old ID -> new ID) */
  renamedSteps: Array<{ oldId: string; newId: string }>;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Parse plan.md file and extract plan steps.
 *
 * @param planMdPath - Absolute path to plan.md file
 * @returns Array of parsed plan steps, or null if file doesn't exist or parsing fails
 */
export async function parsePlanMarkdown(planMdPath: string): Promise<ParsedPlanStep[] | null> {
  try {
    if (!existsSync(planMdPath)) {
      return null;
    }

    const content = await readFile(planMdPath, 'utf-8');
    const parser = new OutputParser();
    return parser.parsePlanSteps(content);
  } catch (error) {
    console.error(`Failed to parse plan.md at ${planMdPath}:`, error);
    return null;
  }
}

/**
 * Synchronize plan.json with plan.md.
 *
 * This function:
 * 1. Reads the current plan.md file
 * 2. Parses PLAN_STEP markers from it
 * 3. Compares with existing plan.json steps
 * 4. Returns sync result (caller is responsible for persisting changes)
 *
 * @param planMdPath - Absolute path to plan.md file
 * @param currentPlan - Current plan object from plan.json
 * @returns Sync result with changes detected, or null if plan.md couldn't be read
 */
export async function syncPlanFromMarkdown(
  planMdPath: string,
  currentPlan: Plan
): Promise<{ syncResult: SyncResult; updatedPlan: Plan } | null> {
  const parsedSteps = await parsePlanMarkdown(planMdPath);

  if (parsedSteps === null) {
    return null;
  }

  const result: SyncResult = {
    changed: false,
    addedCount: 0,
    updatedCount: 0,
    removedCount: 0,
    renamedCount: 0,
    addedStepIds: [],
    updatedStepIds: [],
    removedStepIds: [],
    renamedSteps: [],
    errors: [],
  };

  // Create a map of existing steps for quick lookup by ID
  const existingStepMap = new Map<string, PlanStep>();
  for (const step of currentPlan.steps) {
    existingStepMap.set(step.id, step);
  }

  // Create a map of completed steps by content hash for fallback matching
  // This handles the case where a step's ID changed but content is the same
  const completedStepsByHash = new Map<string, PlanStep>();
  for (const step of currentPlan.steps) {
    if (step.status === 'completed' && step.contentHash) {
      completedStepsByHash.set(step.contentHash, step);
    }
  }

  // Track which existing step IDs have been matched (by ID or hash)
  const matchedExistingIds = new Set<string>();

  // Track which existing steps are still present in markdown
  const updatedSteps: PlanStep[] = [];

  // Process steps from markdown
  for (let i = 0; i < parsedSteps.length; i++) {
    const parsedStep = parsedSteps[i];
    const existingStep = existingStepMap.get(parsedStep.id);

    if (existingStep) {
      // Step exists by ID - check if content changed
      matchedExistingIds.add(existingStep.id);
      const titleChanged = existingStep.title !== parsedStep.title;
      const descriptionChanged = existingStep.description !== parsedStep.description;

      if (titleChanged || descriptionChanged) {
        // Update the step
        const updatedStep: PlanStep = {
          ...existingStep,
          title: parsedStep.title,
          description: parsedStep.description,
          parentId: parsedStep.parentId,
          orderIndex: i,
        };

        // Reset status to pending if content changed and step was completed
        if (existingStep.status === 'completed' || existingStep.status === 'skipped') {
          updatedStep.status = 'pending';
          delete updatedStep.contentHash; // Force re-implementation
        }

        // Preserve complexity if specified in markdown
        if (parsedStep.complexity) {
          updatedStep.complexity = parsedStep.complexity;
        }

        updatedSteps.push(updatedStep);
        result.updatedCount++;
        result.updatedStepIds.push(parsedStep.id);
        result.changed = true;
      } else {
        // No content change - keep existing step with updated orderIndex
        updatedSteps.push({
          ...existingStep,
          orderIndex: i,
          parentId: parsedStep.parentId,
        });
      }
    } else {
      // Step ID not found - try matching by content hash
      // This handles the case where Claude renumbered steps but content is unchanged
      const parsedStepHash = computeStepHash(parsedStep);
      const matchedByHash = completedStepsByHash.get(parsedStepHash);

      if (matchedByHash && !matchedExistingIds.has(matchedByHash.id)) {
        // Found a completed step with same content but different ID
        // Carry over the completed status and contentHash to the new ID
        matchedExistingIds.add(matchedByHash.id);

        const renamedStep: PlanStep = {
          id: parsedStep.id, // Use new ID
          parentId: parsedStep.parentId,
          orderIndex: i,
          title: parsedStep.title,
          description: parsedStep.description,
          status: matchedByHash.status, // Preserve completed status
          metadata: { ...matchedByHash.metadata },
          contentHash: matchedByHash.contentHash, // Preserve hash
          complexity: parsedStep.complexity || matchedByHash.complexity,
          acceptanceCriteriaIds: parsedStep.acceptanceCriteriaIds,
          estimatedFiles: parsedStep.estimatedFiles,
        };

        updatedSteps.push(renamedStep);
        result.renamedCount++;
        result.renamedSteps.push({ oldId: matchedByHash.id, newId: parsedStep.id });
        result.changed = true;
      } else {
        // Truly new step from markdown
        const newStep: PlanStep = {
          id: parsedStep.id,
          parentId: parsedStep.parentId,
          orderIndex: i,
          title: parsedStep.title,
          description: parsedStep.description,
          status: 'pending',
          metadata: {},
          complexity: parsedStep.complexity,
          acceptanceCriteriaIds: parsedStep.acceptanceCriteriaIds,
          estimatedFiles: parsedStep.estimatedFiles,
        };

        updatedSteps.push(newStep);
        result.addedCount++;
        result.addedStepIds.push(parsedStep.id);
        result.changed = true;
      }
    }
  }

  // Check for removed steps (steps in plan.json but not in markdown AND not matched by hash)
  for (const existingStep of currentPlan.steps) {
    if (!matchedExistingIds.has(existingStep.id)) {
      result.removedCount++;
      result.removedStepIds.push(existingStep.id);
      result.changed = true;
    }
  }

  // Create updated plan
  const updatedPlan: Plan = {
    ...currentPlan,
    steps: updatedSteps,
    planVersion: result.changed ? (currentPlan.planVersion || 0) + 1 : currentPlan.planVersion,
  };

  return { syncResult: result, updatedPlan };
}

/**
 * Get the plan.md path from plan.json path.
 * Assumes both files are in the same directory.
 *
 * @param planJsonPath - Path to plan.json (relative or absolute)
 * @returns Path to plan.md
 */
export function getPlanMdPath(planJsonPath: string): string {
  const dir = path.dirname(planJsonPath);
  return path.join(dir, 'plan.md');
}

/**
 * Get the plan.md path from claudePlanFilePath (which is typically the plan.md path).
 * Validates that the path ends with plan.md.
 *
 * @param claudePlanFilePath - The claudePlanFilePath from session
 * @returns The plan.md path if valid, null otherwise
 */
export function getValidPlanMdPath(claudePlanFilePath: string | null | undefined): string | null {
  if (!claudePlanFilePath) {
    return null;
  }

  // claudePlanFilePath should already be the plan.md path
  if (claudePlanFilePath.endsWith('plan.md')) {
    return claudePlanFilePath;
  }

  // If it's a directory, append plan.md
  if (!claudePlanFilePath.includes('.')) {
    return path.join(claudePlanFilePath, 'plan.md');
  }

  return null;
}

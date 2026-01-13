/**
 * Plan Migration Utilities
 *
 * Provides functions to migrate legacy Plan (plan.json) to the new ComposablePlan format.
 * Used during session load to automatically upgrade old plans.
 */

import {
  Plan,
  PlanStep,
  ComposablePlan,
  PlanMeta,
  PlanDependencies,
  PlanTestCoverage,
  PlanAcceptanceCriteriaMapping,
  PlanValidationStatus,
  StepComplexity,
} from '@claude-code-web/shared';

/**
 * Check if a plan object is in the legacy Plan format (not ComposablePlan).
 * Legacy plans have `planVersion` field and no `meta` section.
 */
export function isLegacyPlan(plan: unknown): plan is Plan {
  if (!plan || typeof plan !== 'object') {
    return false;
  }

  const p = plan as Record<string, unknown>;

  // Legacy plans have planVersion but no meta section
  return (
    'planVersion' in p &&
    typeof p.planVersion === 'number' &&
    !('meta' in p)
  );
}

/**
 * Check if a plan object is already in ComposablePlan format.
 */
export function isComposablePlan(plan: unknown): plan is ComposablePlan {
  if (!plan || typeof plan !== 'object') {
    return false;
  }

  const p = plan as Record<string, unknown>;

  // ComposablePlan has meta, steps, dependencies, testCoverage, acceptanceMapping, validationStatus
  return (
    'meta' in p &&
    'steps' in p &&
    'dependencies' in p &&
    'testCoverage' in p &&
    'acceptanceMapping' in p &&
    'validationStatus' in p
  );
}

/**
 * Migrate a legacy Plan to ComposablePlan format.
 *
 * - Sets default complexity to 'medium' for existing steps
 * - Creates empty but valid sections for dependencies, testCoverage, acceptanceMapping
 * - Preserves all existing step data
 *
 * @param legacyPlan - The legacy Plan object to migrate
 * @returns The migrated ComposablePlan
 */
export function migrateToComposablePlan(legacyPlan: Plan): ComposablePlan {
  const now = new Date().toISOString();

  // Create meta section from legacy plan fields
  const meta: PlanMeta = {
    version: legacyPlan.version || '1.0',
    sessionId: legacyPlan.sessionId,
    createdAt: legacyPlan.createdAt || now,
    updatedAt: now,
    isApproved: legacyPlan.isApproved || false,
    reviewCount: legacyPlan.reviewCount || 0,
  };

  // Migrate steps - add default complexity if missing
  const steps: PlanStep[] = (legacyPlan.steps || []).map((step) => ({
    ...step,
    complexity: step.complexity || ('medium' as StepComplexity),
    acceptanceCriteriaIds: step.acceptanceCriteriaIds || [],
    estimatedFiles: step.estimatedFiles || [],
  }));

  // Create empty but valid dependencies section
  const dependencies: PlanDependencies = {
    stepDependencies: extractStepDependencies(steps),
    externalDependencies: [],
  };

  // Create empty but valid test coverage section
  const testCoverage: PlanTestCoverage = createDefaultTestCoverage(legacyPlan, steps);

  // Create empty acceptance mapping
  const acceptanceMapping: PlanAcceptanceCriteriaMapping = {
    mappings: [],
    updatedAt: now,
  };

  // Set initial validation status - mark as needing validation
  const validationStatus: PlanValidationStatus = {
    meta: true, // Meta is valid after migration
    steps: steps.length > 0,
    dependencies: true, // Empty dependencies are valid
    testCoverage: true, // Default test coverage is valid
    acceptanceMapping: true, // Empty mapping is valid (will be filled during Stage 2)
    overall: steps.length > 0,
  };

  return {
    meta,
    steps,
    dependencies,
    testCoverage,
    acceptanceMapping,
    validationStatus,
  };
}

/**
 * Extract step dependencies from parentId relationships.
 * This converts the implicit parent-child relationships to explicit StepDependency objects.
 */
function extractStepDependencies(steps: PlanStep[]): { stepId: string; dependsOn: string; reason?: string }[] {
  const dependencies: { stepId: string; dependsOn: string; reason?: string }[] = [];

  for (const step of steps) {
    if (step.parentId) {
      dependencies.push({
        stepId: step.id,
        dependsOn: step.parentId,
        reason: 'Parent-child relationship from legacy plan',
      });
    }
  }

  return dependencies;
}

/**
 * Create default test coverage based on legacy plan's testRequirement if available.
 */
function createDefaultTestCoverage(legacyPlan: Plan, steps: PlanStep[]): PlanTestCoverage {
  const testRequirement = legacyPlan.testRequirement;

  if (testRequirement) {
    return {
      framework: testRequirement.existingFramework || 'jest',
      requiredTestTypes: testRequirement.testTypes || ['unit'],
      stepCoverage: steps.map((step) => ({
        stepId: step.id,
        requiredTestTypes: testRequirement.testTypes || ['unit'],
        coverageTarget: 80,
      })),
      globalCoverageTarget: 80,
    };
  }

  // Default test coverage when no testRequirement exists
  return {
    framework: 'jest',
    requiredTestTypes: ['unit'],
    stepCoverage: [],
    globalCoverageTarget: 80,
  };
}

/**
 * Migrate plan if needed. Returns the plan in ComposablePlan format.
 * If already a ComposablePlan, returns as-is.
 * If a legacy Plan, migrates to ComposablePlan.
 *
 * @param plan - Either a legacy Plan or ComposablePlan
 * @returns The plan in ComposablePlan format
 */
export function ensureComposablePlan(plan: Plan | ComposablePlan): ComposablePlan {
  if (isComposablePlan(plan)) {
    return plan;
  }

  if (isLegacyPlan(plan)) {
    return migrateToComposablePlan(plan);
  }

  // If neither, treat as legacy and try to migrate
  return migrateToComposablePlan(plan as Plan);
}

/**
 * Check if migration is needed for a plan.
 * Returns true if the plan is in legacy format.
 */
export function needsMigration(plan: unknown): boolean {
  return isLegacyPlan(plan);
}

/**
 * Read a plan from storage and migrate to ComposablePlan format if needed.
 * This is the recommended way to load plans to ensure compatibility.
 *
 * @param storage - FileStorageService instance
 * @param sessionDir - Session directory path (e.g., "projectId/featureId")
 * @returns The plan in ComposablePlan format, or null if not found
 */
export async function readPlanWithMigration(
  storage: { readJson<T>(path: string): Promise<T | null>; writeJson<T>(path: string, data: T): Promise<void> },
  sessionDir: string
): Promise<ComposablePlan | null> {
  const planPath = `${sessionDir}/plan.json`;
  const plan = await storage.readJson<Plan | ComposablePlan>(planPath);

  if (!plan) {
    return null;
  }

  // If already composable, return as-is
  if (isComposablePlan(plan)) {
    return plan;
  }

  // Migrate legacy plan
  if (isLegacyPlan(plan)) {
    const migrated = migrateToComposablePlan(plan);

    // Persist the migration
    await storage.writeJson(planPath, migrated);

    console.log(`Migrated legacy plan to composable format: ${sessionDir}`);
    return migrated;
  }

  // Unknown format - try to treat as legacy
  const migrated = migrateToComposablePlan(plan as Plan);
  await storage.writeJson(planPath, migrated);

  console.log(`Migrated unknown plan format to composable format: ${sessionDir}`);
  return migrated;
}

/**
 * Convert a ComposablePlan back to legacy Plan format for backwards compatibility.
 * Useful for API responses that expect the old format.
 */
export function composablePlanToLegacy(composable: ComposablePlan): Plan {
  return {
    version: composable.meta.version,
    planVersion: 1, // Legacy format always uses planVersion
    sessionId: composable.meta.sessionId,
    isApproved: composable.meta.isApproved,
    reviewCount: composable.meta.reviewCount,
    createdAt: composable.meta.createdAt,
    steps: composable.steps,
    // testRequirement is not preserved in ComposablePlan directly,
    // it's split into testCoverage section
  };
}

import { z } from 'zod';

/**
 * Zod validation schemas for the composable plan structure.
 * These schemas provide deterministic validation of plan sections
 * after Stage 2 Claude sessions.
 */

// ============================================================================
// Common Constants and Patterns
// ============================================================================

/** Minimum description length for plan steps */
const MIN_DESCRIPTION_LENGTH = 50;

/** Placeholder text patterns to reject */
const PLACEHOLDER_PATTERNS = [
  /\bTBD\b/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bXXX\b/i,
  /\bPLACEHOLDER\b/i,
  /\bTO BE DETERMINED\b/i,
  /\bTO BE DEFINED\b/i,
  /\bNEEDS?\s+(TO BE\s+)?(FILLED|COMPLETED|WRITTEN)\b/i,
  /\[\.{3,}\]/,  // [...] or [....] etc.
  /<\.{3,}>/,  // <...> or <....> etc.
];

/** Marker patterns that should not appear in step content (security) */
const MARKER_PATTERNS = [
  /\[DECISION_NEEDED[^\]]*\]/,
  /\[\/DECISION_NEEDED\]/,
  /\[PLAN_STEP[^\]]*\]/,
  /\[\/PLAN_STEP\]/,
  /\[PR_CREATED[^\]]*\]/,
  /\[\/PR_CREATED\]/,
  /\[CI_STATUS[^\]]*\]/,
  /\[\/CI_STATUS\]/,
  /\[STEP_COMPLETE[^\]]*\]/,
  /\[\/STEP_COMPLETE\]/,
  /\[IMPLEMENTATION_COMPLETE[^\]]*\]/,
  /\[\/IMPLEMENTATION_COMPLETE\]/,
  /\[RETURN_TO_STAGE_2[^\]]*\]/,
  /\[\/RETURN_TO_STAGE_2\]/,
];

// ============================================================================
// Helper Validators
// ============================================================================

/**
 * Check if text contains placeholder patterns
 */
function containsPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Check if text contains marker patterns (security)
 */
function containsMarkerPattern(text: string): boolean {
  return MARKER_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Detect circular dependencies in a list of step dependencies
 */
function hasCircularDependencies(
  dependencies: Array<{ stepId: string; dependsOn: string }>
): { hasCycle: boolean; cycle?: string[] } {
  // Build adjacency list
  const graph = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!graph.has(dep.stepId)) {
      graph.set(dep.stepId, []);
    }
    graph.get(dep.stepId)!.push(dep.dependsOn);
  }

  // DFS to detect cycles
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): string[] | null {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        const cycle = dfs(neighbor);
        if (cycle) return cycle;
      } else if (recursionStack.has(neighbor)) {
        // Found cycle - return the cycle path
        const cycleStart = path.indexOf(neighbor);
        return [...path.slice(cycleStart), neighbor];
      }
    }

    path.pop();
    recursionStack.delete(node);
    return null;
  }

  // Check all nodes
  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      const cycle = dfs(node);
      if (cycle) {
        return { hasCycle: true, cycle };
      }
    }
  }

  return { hasCycle: false };
}

// ============================================================================
// Plan Meta Schema
// ============================================================================

export const planMetaSchema = z.object({
  version: z.string().min(1, 'Version is required'),
  sessionId: z.string().min(1, 'Session ID is required'),
  createdAt: z.iso.datetime({ message: 'createdAt must be a valid ISO datetime' }),
  updatedAt: z.iso.datetime({ message: 'updatedAt must be a valid ISO datetime' }),
  isApproved: z.boolean(),
  reviewCount: z.number().int().min(0, 'Review count must be non-negative'),
});

export type PlanMetaValidated = z.infer<typeof planMetaSchema>;

// ============================================================================
// Plan Step Schema
// ============================================================================

export const stepComplexitySchema = z.enum(['low', 'medium', 'high']);

export const planStepStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'skipped',
  'needs_review',
]);

export const planStepSchema = z.object({
  id: z.string().min(1, 'Step ID is required'),
  parentId: z.string().nullable(),
  orderIndex: z.number().int().min(0),
  title: z
    .string()
    .min(1, 'Step title is required')
    .max(200, 'Step title must be 200 characters or less')
    .refine(
      (title) => !containsPlaceholder(title),
      { message: 'Step title contains placeholder text' }
    )
    .refine(
      (title) => !containsMarkerPattern(title),
      { message: 'Step title contains invalid marker patterns' }
    ),
  description: z
    .string()
    .min(MIN_DESCRIPTION_LENGTH, `Step description must be at least ${MIN_DESCRIPTION_LENGTH} characters`)
    .max(5000, 'Step description must be 5000 characters or less')
    .refine(
      (desc) => !containsPlaceholder(desc),
      { message: 'Step description contains placeholder text' }
    )
    .refine(
      (desc) => !containsMarkerPattern(desc),
      { message: 'Step description contains invalid marker patterns' }
    ),
  status: planStepStatusSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
  contentHash: z.string().nullable().optional(),
  complexity: stepComplexitySchema.optional(),
  acceptanceCriteriaIds: z.array(z.string()).optional(),
  estimatedFiles: z.array(z.string()).optional(),
});

export type PlanStepValidated = z.infer<typeof planStepSchema>;

/**
 * Schema for validating a step has required fields for Stage 2 completion.
 * More strict than the base schema - requires complexity rating.
 */
export const planStepCompleteSchema = planStepSchema.extend({
  complexity: stepComplexitySchema,  // Required for complete steps
});

// ============================================================================
// Plan Dependencies Schema
// ============================================================================

export const stepDependencySchema = z.object({
  stepId: z.string().min(1, 'Step ID is required'),
  dependsOn: z.string().min(1, 'Depends-on step ID is required'),
  reason: z.string().optional(),
});

export const externalDependencyTypeSchema = z.enum(['npm', 'api', 'service', 'file', 'other']);

export const externalDependencySchema = z.object({
  name: z.string().min(1, 'Dependency name is required'),
  type: externalDependencyTypeSchema,
  version: z.string().optional(),
  reason: z.string().min(1, 'Dependency reason is required'),
  requiredBy: z.array(z.string()).min(1, 'At least one step must require this dependency'),
});

export const planDependenciesSchema = z.object({
  stepDependencies: z.array(stepDependencySchema),
  externalDependencies: z.array(externalDependencySchema),
}).superRefine((deps, ctx) => {
  // Check for circular dependencies
  const circularCheck = hasCircularDependencies(deps.stepDependencies);
  if (circularCheck.hasCycle) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Circular dependency detected: ${circularCheck.cycle?.join(' -> ')}`,
      path: ['stepDependencies'],
    });
  }
});

/**
 * Validate dependencies against a list of step IDs.
 * Checks for orphaned parentIds and invalid dependency references.
 */
export function validateDependenciesAgainstSteps(
  dependencies: z.infer<typeof planDependenciesSchema>,
  stepIds: string[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stepIdSet = new Set(stepIds);

  // Check step dependencies reference valid steps
  for (const dep of dependencies.stepDependencies) {
    if (!stepIdSet.has(dep.stepId)) {
      errors.push(`Step dependency references unknown step: ${dep.stepId}`);
    }
    if (!stepIdSet.has(dep.dependsOn)) {
      errors.push(`Step dependency references unknown dependency: ${dep.dependsOn}`);
    }
  }

  // Check external dependencies reference valid steps
  for (const extDep of dependencies.externalDependencies) {
    for (const requiredBy of extDep.requiredBy) {
      if (!stepIdSet.has(requiredBy)) {
        errors.push(`External dependency "${extDep.name}" references unknown step: ${requiredBy}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export type PlanDependenciesValidated = z.infer<typeof planDependenciesSchema>;

// ============================================================================
// Plan Test Coverage Schema
// ============================================================================

export const stepTestCoverageSchema = z.object({
  stepId: z.string().min(1, 'Step ID is required'),
  requiredTestTypes: z.array(z.string()).min(1, 'At least one test type is required'),
  coverageTarget: z.number().min(0).max(100).optional(),
  testCases: z.array(z.string()).optional(),
});

export const planTestCoverageSchema = z.object({
  framework: z.string().min(1, 'Testing framework is required'),
  requiredTestTypes: z.array(z.string()).min(1, 'At least one global test type is required'),
  stepCoverage: z.array(stepTestCoverageSchema),
  globalCoverageTarget: z.number().min(0).max(100).optional(),
});

/**
 * Validate test coverage against a list of step IDs.
 */
export function validateTestCoverageAgainstSteps(
  testCoverage: z.infer<typeof planTestCoverageSchema>,
  stepIds: string[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stepIdSet = new Set(stepIds);

  for (const coverage of testCoverage.stepCoverage) {
    if (!stepIdSet.has(coverage.stepId)) {
      errors.push(`Test coverage references unknown step: ${coverage.stepId}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export type PlanTestCoverageValidated = z.infer<typeof planTestCoverageSchema>;

// ============================================================================
// Plan Acceptance Criteria Mapping Schema
// ============================================================================

export const acceptanceCriteriaStepMappingSchema = z.object({
  criterionId: z.string().min(1, 'Criterion ID is required'),
  criterionText: z.string().min(1, 'Criterion text is required'),
  implementingStepIds: z.array(z.string()),
  isFullyCovered: z.boolean(),
});

export const planAcceptanceMappingSchema = z.object({
  mappings: z.array(acceptanceCriteriaStepMappingSchema),
  updatedAt: z.iso.datetime({ message: 'updatedAt must be a valid ISO datetime' }),
}).superRefine((mapping, ctx) => {
  // Check that all criteria have at least one implementing step
  for (let i = 0; i < mapping.mappings.length; i++) {
    const m = mapping.mappings[i];
    if (m.implementingStepIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Acceptance criterion "${m.criterionId}" has no implementing steps`,
        path: ['mappings', i, 'implementingStepIds'],
      });
    }
  }
});

/**
 * Validate acceptance mapping against a list of step IDs.
 */
export function validateAcceptanceMappingAgainstSteps(
  mapping: z.infer<typeof planAcceptanceMappingSchema>,
  stepIds: string[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stepIdSet = new Set(stepIds);

  for (const m of mapping.mappings) {
    for (const stepId of m.implementingStepIds) {
      if (!stepIdSet.has(stepId)) {
        errors.push(`Acceptance mapping for "${m.criterionId}" references unknown step: ${stepId}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export type PlanAcceptanceMappingValidated = z.infer<typeof planAcceptanceMappingSchema>;

// ============================================================================
// Plan Validation Status Schema
// ============================================================================

export const planValidationStatusSchema = z.object({
  meta: z.boolean(),
  steps: z.boolean(),
  dependencies: z.boolean(),
  testCoverage: z.boolean(),
  acceptanceMapping: z.boolean(),
  overall: z.boolean(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export type PlanValidationStatusValidated = z.infer<typeof planValidationStatusSchema>;

// ============================================================================
// Composable Plan Schema
// ============================================================================

export const composablePlanSchema = z.object({
  meta: planMetaSchema,
  steps: z.array(planStepSchema).min(1, 'Plan must have at least one step'),
  dependencies: planDependenciesSchema,
  testCoverage: planTestCoverageSchema,
  acceptanceMapping: planAcceptanceMappingSchema,
  validationStatus: planValidationStatusSchema,
}).superRefine((plan, ctx) => {
  const stepIds = plan.steps.map(s => s.id);

  // Validate parentIds reference valid steps
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (step.parentId !== null && !stepIds.includes(step.parentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Step "${step.id}" has orphaned parentId: ${step.parentId}`,
        path: ['steps', i, 'parentId'],
      });
    }
  }

  // Cross-validate dependencies against steps
  const depValidation = validateDependenciesAgainstSteps(plan.dependencies, stepIds);
  if (!depValidation.valid) {
    for (const error of depValidation.errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error,
        path: ['dependencies'],
      });
    }
  }

  // Cross-validate test coverage against steps
  const testValidation = validateTestCoverageAgainstSteps(plan.testCoverage, stepIds);
  if (!testValidation.valid) {
    for (const error of testValidation.errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error,
        path: ['testCoverage'],
      });
    }
  }

  // Cross-validate acceptance mapping against steps
  const acceptanceValidation = validateAcceptanceMappingAgainstSteps(plan.acceptanceMapping, stepIds);
  if (!acceptanceValidation.valid) {
    for (const error of acceptanceValidation.errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error,
        path: ['acceptanceMapping'],
      });
    }
  }
});

export type ComposablePlanValidated = z.infer<typeof composablePlanSchema>;

// ============================================================================
// New*Input Schemas (for Claude JSON file editing)
// ============================================================================

/**
 * Schema for new-steps.json input
 */
export const newStepsInputSchema = z.object({
  steps: z.array(
    planStepSchema.omit({ status: true })
  ),
  removeStepIds: z.array(z.string()).optional(),
});

export type NewStepsInputValidated = z.infer<typeof newStepsInputSchema>;

/**
 * Schema for new-dependencies.json input
 */
export const newDependenciesInputSchema = z.object({
  addStepDependencies: z.array(stepDependencySchema).optional(),
  removeStepDependencies: z.array(
    z.object({
      stepId: z.string(),
      dependsOn: z.string(),
    })
  ).optional(),
  addExternalDependencies: z.array(externalDependencySchema).optional(),
  removeExternalDependencies: z.array(z.string()).optional(),
});

export type NewDependenciesInputValidated = z.infer<typeof newDependenciesInputSchema>;

/**
 * Schema for new-test-coverage.json input
 */
export const newTestCoverageInputSchema = z.object({
  framework: z.string().optional(),
  requiredTestTypes: z.array(z.string()).optional(),
  stepCoverage: z.array(stepTestCoverageSchema).optional(),
  globalCoverageTarget: z.number().min(0).max(100).optional(),
});

export type NewTestCoverageInputValidated = z.infer<typeof newTestCoverageInputSchema>;

/**
 * Schema for new-acceptance.json input
 */
export const newAcceptanceMappingInputSchema = z.object({
  mappings: z.array(acceptanceCriteriaStepMappingSchema),
});

export type NewAcceptanceMappingInputValidated = z.infer<typeof newAcceptanceMappingInputSchema>;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Helper to check if a string contains placeholder text
 * (exported for use in other validation contexts)
 */
export { containsPlaceholder, containsMarkerPattern, hasCircularDependencies };

/**
 * Deterministic state verification utilities
 *
 * These functions provide reliable state checks based on actual data
 * rather than relying on Claude's output markers which can be inconsistent.
 *
 * Use these as the primary source of truth, with markers as secondary signals.
 */

import { Plan, PlanStep, ComposablePlan } from '@claude-code-web/shared';
import { planValidator, PlanValidationResult } from '../services/PlanValidator';

interface Question {
  id: string;
  stage: string;
  answeredAt: string | null;
}

interface QuestionsFile {
  questions: Question[];
}

/**
 * Check if plan is approved based on state:
 * - plan.isApproved flag is true, OR
 * - All planning stage questions have been answered
 *
 * This replaces reliance on [PLAN_APPROVED] marker
 */
export function isPlanApproved(plan: Plan | null, questionsFile: QuestionsFile | null): boolean {
  // If plan explicitly marked as approved
  if (plan?.isApproved) {
    return true;
  }

  // If no questions exist, plan can't be approved yet (discovery not complete)
  if (!questionsFile?.questions?.length) {
    return false;
  }

  // Check if all planning questions are answered
  const planningQuestions = questionsFile.questions.filter(q => q.stage === 'planning');

  // If no planning questions, can't be approved (still in discovery or no review done)
  if (planningQuestions.length === 0) {
    return false;
  }

  return planningQuestions.every(q => q.answeredAt !== null);
}

/**
 * Check if plan is approved AND all sections are structurally valid.
 * This is a stricter check that ensures the composable plan structure is complete.
 *
 * @param plan - The plan to check (can be regular Plan or ComposablePlan)
 * @param questionsFile - Questions file for approval state
 * @param composablePlan - Optional composable plan structure for validation
 */
export function isPlanApprovedAndValid(
  plan: Plan | null,
  questionsFile: QuestionsFile | null,
  composablePlan?: ComposablePlan | null
): boolean {
  // First check basic approval
  if (!isPlanApproved(plan, questionsFile)) {
    return false;
  }

  // If composable plan provided, validate its structure
  if (composablePlan) {
    return isPlanStructureComplete(composablePlan);
  }

  // If no composable plan, basic approval is sufficient
  return true;
}

/**
 * Check if a composable plan's structure is complete and valid.
 * Validates all required sections: meta, steps, dependencies, testCoverage, acceptanceMapping
 *
 * @param plan - The composable plan to validate
 * @returns true if all sections are valid
 */
export function isPlanStructureComplete(plan: ComposablePlan | null): boolean {
  if (!plan) {
    return false;
  }

  const validationResult = planValidator.validatePlan(plan);
  return validationResult.overall;
}

/**
 * Get detailed validation result for a composable plan.
 * Useful for displaying which sections need work.
 *
 * @param plan - The composable plan to validate
 * @returns Detailed validation result per section
 */
export function getPlanValidationResult(plan: ComposablePlan | null): PlanValidationResult | null {
  if (!plan) {
    return null;
  }

  return planValidator.validatePlan(plan);
}

/**
 * Check if implementation is complete based on plan step statuses:
 * - All steps are either 'completed' or 'skipped'
 *
 * Works with both regular Plan and ComposablePlan.
 * This replaces reliance on [IMPLEMENTATION_COMPLETE] marker
 */
export function isImplementationComplete(plan: Plan | ComposablePlan | null): boolean {
  // Handle ComposablePlan which has steps array
  const steps = getStepsFromPlan(plan);

  if (!steps?.length) {
    return false;
  }

  return steps.every(
    step => step.status === 'completed' || step.status === 'skipped'
  );
}

/**
 * Helper to extract steps from either Plan or ComposablePlan
 */
function getStepsFromPlan(plan: Plan | ComposablePlan | null): PlanStep[] | null {
  if (!plan) {
    return null;
  }

  // Both Plan and ComposablePlan have steps array
  return plan.steps;
}

/**
 * Complexity weight for ordering steps (lower = should execute first)
 */
const COMPLEXITY_ORDER: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Get the next pending step that's ready for execution
 * (has no incomplete parent dependencies)
 *
 * When multiple steps are ready, prefers steps with lower complexity
 * to get quick wins first.
 */
export function getNextReadyStep(plan: Plan | ComposablePlan): PlanStep | null {
  const steps = getStepsFromPlan(plan);

  if (!steps?.length) {
    return null;
  }

  // Find all ready steps (pending with completed parents)
  const readySteps = steps.filter(step => {
    // Must be pending
    if (step.status !== 'pending') {
      return false;
    }

    // If has parent, parent must be completed
    if (step.parentId !== null) {
      const parent = steps.find(p => p.id === step.parentId);
      if (!parent || parent.status !== 'completed') {
        return false;
      }
    }

    return true;
  });

  if (readySteps.length === 0) {
    return null;
  }

  // Sort by complexity (low first) then by orderIndex
  readySteps.sort((a, b) => {
    const complexityA = (a as PlanStep & { complexity?: string }).complexity;
    const complexityB = (b as PlanStep & { complexity?: string }).complexity;

    const orderA = COMPLEXITY_ORDER[complexityA || 'medium'] ?? 2;
    const orderB = COMPLEXITY_ORDER[complexityB || 'medium'] ?? 2;

    // First sort by complexity
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    // Then by orderIndex
    return a.orderIndex - b.orderIndex;
  });

  return readySteps[0];
}

/**
 * Get all steps that are ready for execution.
 * Useful for displaying available next steps to the user.
 */
export function getAllReadySteps(plan: Plan | ComposablePlan): PlanStep[] {
  const steps = getStepsFromPlan(plan);

  if (!steps?.length) {
    return [];
  }

  return steps.filter(step => {
    if (step.status !== 'pending') {
      return false;
    }

    if (step.parentId !== null) {
      const parent = steps.find(p => p.id === step.parentId);
      if (!parent || parent.status !== 'completed') {
        return false;
      }
    }

    return true;
  });
}

/**
 * Count steps by status for progress tracking
 */
export function getStepCounts(plan: Plan | ComposablePlan | null): {
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  blocked: number;
} {
  const steps = getStepsFromPlan(plan);

  if (!steps?.length) {
    return { total: 0, completed: 0, pending: 0, inProgress: 0, blocked: 0 };
  }

  return {
    total: steps.length,
    completed: steps.filter(s => s.status === 'completed' || s.status === 'skipped').length,
    pending: steps.filter(s => s.status === 'pending').length,
    inProgress: steps.filter(s => s.status === 'in_progress').length,
    blocked: steps.filter(s => s.status === 'blocked' || s.status === 'needs_review').length,
  };
}

/**
 * Count steps by complexity for effort estimation
 */
export function getStepComplexityCounts(plan: Plan | ComposablePlan | null): {
  low: number;
  medium: number;
  high: number;
  unspecified: number;
} {
  const steps = getStepsFromPlan(plan);

  if (!steps?.length) {
    return { low: 0, medium: 0, high: 0, unspecified: 0 };
  }

  return {
    low: steps.filter(s => (s as PlanStep & { complexity?: string }).complexity === 'low').length,
    medium: steps.filter(s => (s as PlanStep & { complexity?: string }).complexity === 'medium').length,
    high: steps.filter(s => (s as PlanStep & { complexity?: string }).complexity === 'high').length,
    unspecified: steps.filter(s => !(s as PlanStep & { complexity?: string }).complexity).length,
  };
}

/**
 * Check if there are unanswered questions for a specific stage
 */
export function hasUnansweredQuestions(questionsFile: QuestionsFile | null, stage: string): boolean {
  if (!questionsFile?.questions?.length) {
    return false;
  }

  return questionsFile.questions.some(q => q.stage === stage && q.answeredAt === null);
}

/**
 * Get all unanswered questions for a stage
 */
export function getUnansweredQuestions(questionsFile: QuestionsFile | null, stage: string): Question[] {
  if (!questionsFile?.questions?.length) {
    return [];
  }

  return questionsFile.questions.filter(q => q.stage === stage && q.answeredAt === null);
}

/**
 * Get current HEAD commit SHA for a project
 */
export async function getHeadCommitSha(projectPath: string): Promise<string | null> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: projectPath,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Check if a new commit was made since the given SHA.
 * Returns true if HEAD is different from the provided SHA.
 *
 * This is a deterministic way to verify step completion -
 * if Claude made a commit, the step is complete.
 */
export async function hasNewCommitSince(projectPath: string, previousSha: string | null): Promise<boolean> {
  if (!previousSha) {
    return false;
  }

  const currentSha = await getHeadCommitSha(projectPath);
  return currentSha !== null && currentSha !== previousSha;
}

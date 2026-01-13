/**
 * Deterministic state verification utilities
 *
 * These functions provide reliable state checks based on actual data
 * rather than relying on Claude's output markers which can be inconsistent.
 *
 * Use these as the primary source of truth, with markers as secondary signals.
 */

import { Plan, PlanStep } from '@claude-code-web/shared';

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
 * Check if implementation is complete based on plan step statuses:
 * - All steps are either 'completed' or 'skipped'
 *
 * This replaces reliance on [IMPLEMENTATION_COMPLETE] marker
 */
export function isImplementationComplete(plan: Plan | null): boolean {
  if (!plan?.steps?.length) {
    return false;
  }

  return plan.steps.every(
    step => step.status === 'completed' || step.status === 'skipped'
  );
}

/**
 * Get the next pending step that's ready for execution
 * (has no incomplete parent dependencies)
 */
export function getNextReadyStep(plan: Plan): PlanStep | null {
  if (!plan?.steps?.length) {
    return null;
  }

  return plan.steps.find(step => {
    // Must be pending
    if (step.status !== 'pending') {
      return false;
    }

    // If has parent, parent must be completed
    if (step.parentId !== null) {
      const parent = plan.steps.find(p => p.id === step.parentId);
      if (!parent || parent.status !== 'completed') {
        return false;
      }
    }

    return true;
  }) || null;
}

/**
 * Count steps by status for progress tracking
 */
export function getStepCounts(plan: Plan | null): {
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  blocked: number;
} {
  if (!plan?.steps?.length) {
    return { total: 0, completed: 0, pending: 0, inProgress: 0, blocked: 0 };
  }

  return {
    total: plan.steps.length,
    completed: plan.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length,
    pending: plan.steps.filter(s => s.status === 'pending').length,
    inProgress: plan.steps.filter(s => s.status === 'in_progress').length,
    blocked: plan.steps.filter(s => s.status === 'blocked' || s.status === 'needs_review').length,
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

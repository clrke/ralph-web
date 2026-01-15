import type { PlanStep, Question } from '@claude-code-web/shared';
import type { ConversationEntry, ValidationAction } from '../../stores/sessionStore';

/**
 * Maximum length for truncated step titles in labels.
 */
export const MAX_STEP_TITLE_LENGTH = 30;

/**
 * Maximum length for truncated question text in labels.
 */
export const MAX_QUESTION_TEXT_LENGTH = 25;

/**
 * Truncates text to a maximum length with ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trimEnd() + '...';
}

/**
 * Gets the status of a question: 'pending' or 'answered'.
 */
export function getQuestionStatus(question: Question | undefined): 'pending' | 'answered' {
  if (!question) return 'pending';
  return question.answeredAt !== null ? 'answered' : 'pending';
}

/**
 * Gets a display label for a validation action.
 */
export function getValidationActionLabel(action: ValidationAction | undefined): string {
  switch (action) {
    case 'pass':
      return 'Passed';
    case 'filter':
      return 'Filtered';
    case 'repurpose':
      return 'Repurposed';
    default:
      return '';
  }
}

/**
 * Post-processing type to display label mapping.
 */
const POST_PROCESSING_LABELS: Record<string, string> = {
  decision_validation: 'Validation',
  test_assessment: 'Test Assessment',
  incomplete_steps: 'Step Assessment',
  question_extraction: 'Question Extraction',
  plan_step_extraction: 'Plan Extraction',
  pr_info_extraction: 'PR Extraction',
  implementation_status_extraction: 'Status Extraction',
  test_results_extraction: 'Test Extraction',
  review_findings_extraction: 'Review Extraction',
  commit_message_generation: 'Commit Message',
  summary_generation: 'Summary',
};

/**
 * Stage number to default label mapping.
 */
const STAGE_LABELS: Record<number, string> = {
  0: 'Queued',
  1: 'Discovery',
  2: 'Plan Review',
  3: 'Implementation',
  4: 'PR Creation',
  5: 'PR Review',
  6: 'Final Approval',
  7: 'Completed',
};

/**
 * Generates a descriptive label for a conversation entry.
 *
 * Examples:
 * - "Discovery" (Stage 1 main call)
 * - "Implementation of Step 3: Add user auth..." (Stage 3 with step)
 * - "Validation of Q2: Which auth..." (decision_validation with questionIndex)
 * - "Test Assessment" (post-processing without special context)
 */
export function generateConversationLabel(
  entry: ConversationEntry,
  planSteps?: PlanStep[]
): string {
  // Handle post-processing entries
  if (entry.postProcessingType) {
    const baseLabel = POST_PROCESSING_LABELS[entry.postProcessingType] || entry.postProcessingType;

    // For decision_validation, include question index context
    if (entry.postProcessingType === 'decision_validation' && entry.questionIndex !== undefined) {
      return `${baseLabel} of Q${entry.questionIndex}`;
    }

    return baseLabel;
  }

  // Handle main stage entries
  const stageLabel = STAGE_LABELS[entry.stage] || `Stage ${entry.stage}`;

  // For Stage 3, include step context if available
  if (entry.stage === 3 && entry.stepId && planSteps) {
    const step = planSteps.find(s => s.id === entry.stepId);
    if (step) {
      // Use step.orderIndex for correct display (1-based, so add 1)
      const stepNumber = step.orderIndex + 1;
      const truncatedTitle = truncateText(step.title, MAX_STEP_TITLE_LENGTH);
      return `${stageLabel} of Step ${stepNumber}: ${truncatedTitle}`;
    }
  }

  return stageLabel;
}

/**
 * Determines the CSS color class for a stage badge.
 */
export function getStageColor(stage: number, postProcessingType?: string): string {
  // Post-processing entries get a distinct color
  if (postProcessingType) {
    return 'bg-cyan-600';
  }
  const colors: Record<number, string> = {
    1: 'bg-purple-600',
    2: 'bg-blue-600',
    3: 'bg-green-600',
    4: 'bg-yellow-600',
    5: 'bg-orange-600',
  };
  return colors[stage] || 'bg-gray-600';
}

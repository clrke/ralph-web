/**
 * Validation action result from decision validation.
 * - 'pass': Question is valid and should be shown to user
 * - 'filter': Question should be filtered out (duplicate, not relevant, etc.)
 * - 'repurpose': Question should be repurposed into a different question
 */
export type ValidationAction = 'pass' | 'filter' | 'repurpose';

/**
 * A filtered question with its decision ID and reason for filtering.
 * Used to track why certain questions were removed during validation.
 */
export interface FilteredQuestion {
  /** Stable UUID assigned during validation for tracking */
  decisionId: string;
  /** Original question text that was filtered */
  questionText: string;
  /** Reason why the question was filtered */
  reason: string;
  /** Timestamp when the question was filtered */
  filteredAt: string;
}

/**
 * A repurposed question tracking the transformation from original to new questions.
 * Used to show how questions were modified during validation.
 */
export interface RepurposedQuestion {
  /** Stable UUID of the original decision */
  originalDecisionId: string;
  /** Original question text before repurposing */
  originalQuestionText: string;
  /** Reason for repurposing the question */
  reason: string;
  /** New question texts that replaced the original */
  newQuestionTexts: string[];
  /** Timestamp when the question was repurposed */
  repurposedAt: string;
}

/**
 * Summary counts for validation context.
 * Provides quick overview of validation results.
 */
export interface ValidationSummary {
  /** Total number of questions processed in this session */
  totalProcessed: number;
  /** Number of questions that passed validation */
  passedCount: number;
  /** Number of questions that were filtered out */
  filteredCount: number;
  /** Number of questions that were repurposed */
  repurposedCount: number;
}

/**
 * Complete validation context containing all filtered and repurposed questions
 * from a session's validation history. Used to provide Claude with context about
 * validation decisions when processing user answers.
 */
export interface ValidationContext {
  /** Summary counts of all validation actions */
  summary: ValidationSummary;
  /** All questions that were filtered during validation */
  filteredQuestions: FilteredQuestion[];
  /** All questions that were repurposed during validation */
  repurposedQuestions: RepurposedQuestion[];
}

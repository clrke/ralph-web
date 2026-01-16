import { v4 as uuidv4 } from 'uuid';
import type {
  ValidationContext,
  ValidationSummary,
  FilteredQuestion,
  RepurposedQuestion,
} from '@claude-code-web/shared';
import type { ValidationLog, ValidationResult } from '../services/DecisionValidator';

/**
 * Structure of the validation-logs.json file
 */
interface ValidationLogsFile {
  entries: ValidationLog[];
}

/**
 * Extract validation context from validation logs.
 * Aggregates all filtered and repurposed questions across all validation batches
 * to provide Claude with context about what questions were removed or modified.
 *
 * @param validationLogs - The validation logs file contents (or null if not found)
 * @returns ValidationContext with aggregated filtered/repurposed questions and summary
 */
export function extractValidationContext(
  validationLogs: ValidationLogsFile | null
): ValidationContext {
  // Return empty context if no logs exist
  if (!validationLogs || !validationLogs.entries || validationLogs.entries.length === 0) {
    return createEmptyValidationContext();
  }

  const filteredQuestions: FilteredQuestion[] = [];
  const repurposedQuestions: RepurposedQuestion[] = [];
  let totalProcessed = 0;
  let passedCount = 0;
  let filteredCount = 0;
  let repurposedCount = 0;

  // Process all validation log entries
  for (const log of validationLogs.entries) {
    totalProcessed += log.totalDecisions;
    passedCount += log.passedCount;
    filteredCount += log.filteredCount;
    repurposedCount += log.repurposedCount;

    // Extract individual results
    for (const result of log.results) {
      if (result.action === 'filter') {
        filteredQuestions.push(createFilteredQuestion(result));
      } else if (result.action === 'repurpose') {
        repurposedQuestions.push(createRepurposedQuestion(result));
      }
    }
  }

  return {
    summary: {
      totalProcessed,
      passedCount,
      filteredCount,
      repurposedCount,
    },
    filteredQuestions,
    repurposedQuestions,
  };
}

/**
 * Create an empty validation context for when no validation has occurred.
 */
export function createEmptyValidationContext(): ValidationContext {
  return {
    summary: {
      totalProcessed: 0,
      passedCount: 0,
      filteredCount: 0,
      repurposedCount: 0,
    },
    filteredQuestions: [],
    repurposedQuestions: [],
  };
}

/**
 * Convert a filtered ValidationResult to a FilteredQuestion.
 */
function createFilteredQuestion(result: ValidationResult): FilteredQuestion {
  return {
    decisionId: uuidv4(),
    questionText: result.decision.questionText,
    reason: result.reason,
    filteredAt: result.validatedAt,
  };
}

/**
 * Convert a repurposed ValidationResult to a RepurposedQuestion.
 */
function createRepurposedQuestion(result: ValidationResult): RepurposedQuestion {
  // Extract new question texts from repurposed questions
  const newQuestionTexts = (result.repurposedQuestions || [])
    .map(q => q.questionText)
    .filter(text => text && text.length > 0);

  return {
    originalDecisionId: uuidv4(),
    originalQuestionText: result.decision.questionText,
    reason: result.reason,
    newQuestionTexts,
    repurposedAt: result.validatedAt,
  };
}

/**
 * Check if a validation context has any meaningful data.
 * Useful for conditionally including context in prompts.
 */
export function hasValidationContext(context: ValidationContext): boolean {
  return (
    context.filteredQuestions.length > 0 ||
    context.repurposedQuestions.length > 0
  );
}

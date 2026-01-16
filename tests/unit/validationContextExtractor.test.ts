/**
 * Tests for validationContextExtractor utility functions
 */

import {
  extractValidationContext,
  createEmptyValidationContext,
  hasValidationContext,
} from '../../server/src/utils/validationContextExtractor';
import type { ValidationLog, ValidationResult } from '../../server/src/services/DecisionValidator';

// Helper to create a mock ValidationResult
function createMockValidationResult(
  overrides: Partial<ValidationResult> = {}
): ValidationResult {
  return {
    decision: {
      questionText: 'What approach should we use?',
      category: 'technical',
      priority: 2,
      options: [
        { label: 'Option A', recommended: true },
        { label: 'Option B', recommended: false },
      ],
    },
    action: 'pass',
    reason: 'Valid question',
    validatedAt: '2024-01-15T10:00:00Z',
    durationMs: 1500,
    prompt: 'Validation prompt...',
    output: '{"action": "pass", "reason": "Valid question"}',
    ...overrides,
  };
}

// Helper to create a mock ValidationLog
function createMockValidationLog(overrides: Partial<ValidationLog> = {}): ValidationLog {
  return {
    timestamp: '2024-01-15T10:00:00Z',
    totalDecisions: 3,
    passedCount: 1,
    filteredCount: 1,
    repurposedCount: 1,
    results: [],
    ...overrides,
  };
}

describe('validationContextExtractor', () => {
  describe('extractValidationContext', () => {
    it('should return empty context when validationLogs is null', () => {
      const context = extractValidationContext(null);

      expect(context.summary.totalProcessed).toBe(0);
      expect(context.summary.passedCount).toBe(0);
      expect(context.summary.filteredCount).toBe(0);
      expect(context.summary.repurposedCount).toBe(0);
      expect(context.filteredQuestions).toEqual([]);
      expect(context.repurposedQuestions).toEqual([]);
    });

    it('should return empty context when entries array is empty', () => {
      const context = extractValidationContext({ entries: [] });

      expect(context.summary.totalProcessed).toBe(0);
      expect(context.filteredQuestions).toEqual([]);
      expect(context.repurposedQuestions).toEqual([]);
    });

    it('should extract filtered questions correctly', () => {
      const filteredResult = createMockValidationResult({
        action: 'filter',
        reason: 'Duplicate question already asked',
        decision: {
          questionText: 'What database should we use?',
          category: 'technical',
          priority: 2,
          options: [],
        },
        validatedAt: '2024-01-15T11:00:00Z',
      });

      const log = createMockValidationLog({
        totalDecisions: 1,
        passedCount: 0,
        filteredCount: 1,
        repurposedCount: 0,
        results: [filteredResult],
      });

      const context = extractValidationContext({ entries: [log] });

      expect(context.summary.filteredCount).toBe(1);
      expect(context.filteredQuestions).toHaveLength(1);
      expect(context.filteredQuestions[0].questionText).toBe('What database should we use?');
      expect(context.filteredQuestions[0].reason).toBe('Duplicate question already asked');
      expect(context.filteredQuestions[0].filteredAt).toBe('2024-01-15T11:00:00Z');
      expect(context.filteredQuestions[0].decisionId).toBeDefined();
    });

    it('should extract repurposed questions correctly', () => {
      const repurposedResult = createMockValidationResult({
        action: 'repurpose',
        reason: 'Question too broad - split into specific questions',
        decision: {
          questionText: 'What tech stack should we use?',
          category: 'approach',
          priority: 1,
          options: [],
        },
        repurposedQuestions: [
          {
            questionText: 'What frontend framework should we use?',
            category: 'technical',
            priority: 2,
            options: [{ label: 'React', recommended: true }],
          },
          {
            questionText: 'What backend framework should we use?',
            category: 'technical',
            priority: 2,
            options: [{ label: 'Express', recommended: true }],
          },
        ],
        validatedAt: '2024-01-15T12:00:00Z',
      });

      const log = createMockValidationLog({
        totalDecisions: 1,
        passedCount: 0,
        filteredCount: 0,
        repurposedCount: 1,
        results: [repurposedResult],
      });

      const context = extractValidationContext({ entries: [log] });

      expect(context.summary.repurposedCount).toBe(1);
      expect(context.repurposedQuestions).toHaveLength(1);
      expect(context.repurposedQuestions[0].originalQuestionText).toBe('What tech stack should we use?');
      expect(context.repurposedQuestions[0].reason).toBe('Question too broad - split into specific questions');
      expect(context.repurposedQuestions[0].newQuestionTexts).toHaveLength(2);
      expect(context.repurposedQuestions[0].newQuestionTexts[0]).toBe('What frontend framework should we use?');
      expect(context.repurposedQuestions[0].newQuestionTexts[1]).toBe('What backend framework should we use?');
      expect(context.repurposedQuestions[0].repurposedAt).toBe('2024-01-15T12:00:00Z');
      expect(context.repurposedQuestions[0].originalDecisionId).toBeDefined();
    });

    it('should handle repurposed questions with empty replacement list', () => {
      const repurposedResult = createMockValidationResult({
        action: 'repurpose',
        reason: 'Question not applicable - removed',
        repurposedQuestions: [], // No replacements
        validatedAt: '2024-01-15T12:00:00Z',
      });

      const log = createMockValidationLog({
        totalDecisions: 1,
        passedCount: 0,
        filteredCount: 0,
        repurposedCount: 1,
        results: [repurposedResult],
      });

      const context = extractValidationContext({ entries: [log] });

      expect(context.repurposedQuestions).toHaveLength(1);
      expect(context.repurposedQuestions[0].newQuestionTexts).toEqual([]);
    });

    it('should handle repurposed questions with undefined repurposedQuestions', () => {
      const repurposedResult = createMockValidationResult({
        action: 'repurpose',
        reason: 'Question repurposed',
        repurposedQuestions: undefined,
        validatedAt: '2024-01-15T12:00:00Z',
      });

      const log = createMockValidationLog({
        totalDecisions: 1,
        passedCount: 0,
        filteredCount: 0,
        repurposedCount: 1,
        results: [repurposedResult],
      });

      const context = extractValidationContext({ entries: [log] });

      expect(context.repurposedQuestions).toHaveLength(1);
      expect(context.repurposedQuestions[0].newQuestionTexts).toEqual([]);
    });

    it('should aggregate counts across multiple validation logs', () => {
      const log1 = createMockValidationLog({
        totalDecisions: 5,
        passedCount: 3,
        filteredCount: 1,
        repurposedCount: 1,
        results: [
          createMockValidationResult({ action: 'filter', reason: 'R1' }),
          createMockValidationResult({ action: 'repurpose', reason: 'R2', repurposedQuestions: [] }),
        ],
      });

      const log2 = createMockValidationLog({
        totalDecisions: 3,
        passedCount: 1,
        filteredCount: 2,
        repurposedCount: 0,
        results: [
          createMockValidationResult({ action: 'filter', reason: 'R3' }),
          createMockValidationResult({ action: 'filter', reason: 'R4' }),
        ],
      });

      const context = extractValidationContext({ entries: [log1, log2] });

      expect(context.summary.totalProcessed).toBe(8);
      expect(context.summary.passedCount).toBe(4);
      expect(context.summary.filteredCount).toBe(3);
      expect(context.summary.repurposedCount).toBe(1);
      expect(context.filteredQuestions).toHaveLength(3);
      expect(context.repurposedQuestions).toHaveLength(1);
    });

    it('should not include passed questions in filtered or repurposed arrays', () => {
      const passedResult = createMockValidationResult({
        action: 'pass',
        reason: 'Valid question',
      });

      const log = createMockValidationLog({
        totalDecisions: 1,
        passedCount: 1,
        filteredCount: 0,
        repurposedCount: 0,
        results: [passedResult],
      });

      const context = extractValidationContext({ entries: [log] });

      expect(context.summary.passedCount).toBe(1);
      expect(context.filteredQuestions).toHaveLength(0);
      expect(context.repurposedQuestions).toHaveLength(0);
    });

    it('should generate unique decision IDs for each filtered question', () => {
      const log = createMockValidationLog({
        totalDecisions: 2,
        passedCount: 0,
        filteredCount: 2,
        repurposedCount: 0,
        results: [
          createMockValidationResult({ action: 'filter', reason: 'R1' }),
          createMockValidationResult({ action: 'filter', reason: 'R2' }),
        ],
      });

      const context = extractValidationContext({ entries: [log] });

      expect(context.filteredQuestions[0].decisionId).not.toBe(
        context.filteredQuestions[1].decisionId
      );
    });

    it('should generate unique decision IDs for each repurposed question', () => {
      const log = createMockValidationLog({
        totalDecisions: 2,
        passedCount: 0,
        filteredCount: 0,
        repurposedCount: 2,
        results: [
          createMockValidationResult({ action: 'repurpose', reason: 'R1', repurposedQuestions: [] }),
          createMockValidationResult({ action: 'repurpose', reason: 'R2', repurposedQuestions: [] }),
        ],
      });

      const context = extractValidationContext({ entries: [log] });

      expect(context.repurposedQuestions[0].originalDecisionId).not.toBe(
        context.repurposedQuestions[1].originalDecisionId
      );
    });
  });

  describe('createEmptyValidationContext', () => {
    it('should return a valid empty context', () => {
      const context = createEmptyValidationContext();

      expect(context.summary).toEqual({
        totalProcessed: 0,
        passedCount: 0,
        filteredCount: 0,
        repurposedCount: 0,
      });
      expect(context.filteredQuestions).toEqual([]);
      expect(context.repurposedQuestions).toEqual([]);
    });
  });

  describe('hasValidationContext', () => {
    it('should return false for empty context', () => {
      const context = createEmptyValidationContext();
      expect(hasValidationContext(context)).toBe(false);
    });

    it('should return true when there are filtered questions', () => {
      const context = createEmptyValidationContext();
      context.filteredQuestions.push({
        decisionId: 'id1',
        questionText: 'Q1',
        reason: 'R1',
        filteredAt: '2024-01-15T10:00:00Z',
      });

      expect(hasValidationContext(context)).toBe(true);
    });

    it('should return true when there are repurposed questions', () => {
      const context = createEmptyValidationContext();
      context.repurposedQuestions.push({
        originalDecisionId: 'id1',
        originalQuestionText: 'Q1',
        reason: 'R1',
        newQuestionTexts: ['Q2'],
        repurposedAt: '2024-01-15T10:00:00Z',
      });

      expect(hasValidationContext(context)).toBe(true);
    });

    it('should return true when there are both filtered and repurposed questions', () => {
      const context = createEmptyValidationContext();
      context.filteredQuestions.push({
        decisionId: 'id1',
        questionText: 'Q1',
        reason: 'R1',
        filteredAt: '2024-01-15T10:00:00Z',
      });
      context.repurposedQuestions.push({
        originalDecisionId: 'id2',
        originalQuestionText: 'Q2',
        reason: 'R2',
        newQuestionTexts: ['Q3'],
        repurposedAt: '2024-01-15T10:00:00Z',
      });

      expect(hasValidationContext(context)).toBe(true);
    });

    it('should return false when only summary has counts but no actual items', () => {
      const context = createEmptyValidationContext();
      // Manually set counts (shouldn't normally happen but testing edge case)
      context.summary.filteredCount = 5;
      context.summary.repurposedCount = 3;

      // Still false because arrays are empty
      expect(hasValidationContext(context)).toBe(false);
    });
  });
});

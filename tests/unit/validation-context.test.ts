/**
 * Tests for ValidationContext type definition and related types
 */

import type {
  ValidationAction,
  ValidationContext,
  ValidationSummary,
  FilteredQuestion,
  RepurposedQuestion,
} from '@claude-code-web/shared';

describe('ValidationContext Types', () => {
  describe('FilteredQuestion', () => {
    it('should accept a valid filtered question', () => {
      const filtered: FilteredQuestion = {
        decisionId: 'abc-123-def',
        questionText: 'What database should we use?',
        reason: 'Already answered in previous session',
        filteredAt: '2024-01-15T10:00:00Z',
      };

      expect(filtered.decisionId).toBe('abc-123-def');
      expect(filtered.questionText).toBe('What database should we use?');
      expect(filtered.reason).toBe('Already answered in previous session');
      expect(filtered.filteredAt).toBe('2024-01-15T10:00:00Z');
    });

    it('should require all fields', () => {
      // This test verifies TypeScript compilation - all fields are required
      const filtered: FilteredQuestion = {
        decisionId: 'uuid-1',
        questionText: 'Test question',
        reason: 'Duplicate',
        filteredAt: new Date().toISOString(),
      };

      expect(Object.keys(filtered)).toHaveLength(4);
      expect(filtered).toHaveProperty('decisionId');
      expect(filtered).toHaveProperty('questionText');
      expect(filtered).toHaveProperty('reason');
      expect(filtered).toHaveProperty('filteredAt');
    });
  });

  describe('RepurposedQuestion', () => {
    it('should accept a valid repurposed question', () => {
      const repurposed: RepurposedQuestion = {
        originalDecisionId: 'xyz-789-uvw',
        originalQuestionText: 'What tech stack should we use?',
        reason: 'Too broad - split into specific questions',
        newQuestionTexts: [
          'What frontend framework should we use?',
          'What backend language should we use?',
        ],
        repurposedAt: '2024-01-15T11:00:00Z',
      };

      expect(repurposed.originalDecisionId).toBe('xyz-789-uvw');
      expect(repurposed.originalQuestionText).toBe('What tech stack should we use?');
      expect(repurposed.reason).toBe('Too broad - split into specific questions');
      expect(repurposed.newQuestionTexts).toHaveLength(2);
      expect(repurposed.repurposedAt).toBe('2024-01-15T11:00:00Z');
    });

    it('should support empty newQuestionTexts array', () => {
      // When repurposed but no replacement questions generated
      const repurposed: RepurposedQuestion = {
        originalDecisionId: 'uuid-2',
        originalQuestionText: 'Invalid question',
        reason: 'Question not applicable',
        newQuestionTexts: [],
        repurposedAt: '2024-01-15T12:00:00Z',
      };

      expect(repurposed.newQuestionTexts).toEqual([]);
    });

    it('should support single replacement question', () => {
      const repurposed: RepurposedQuestion = {
        originalDecisionId: 'uuid-3',
        originalQuestionText: 'What approach?',
        reason: 'Made more specific',
        newQuestionTexts: ['Which authentication method: JWT or session cookies?'],
        repurposedAt: '2024-01-15T13:00:00Z',
      };

      expect(repurposed.newQuestionTexts).toHaveLength(1);
    });
  });

  describe('ValidationSummary', () => {
    it('should accept valid summary counts', () => {
      const summary: ValidationSummary = {
        totalProcessed: 10,
        passedCount: 5,
        filteredCount: 3,
        repurposedCount: 2,
      };

      expect(summary.totalProcessed).toBe(10);
      expect(summary.passedCount).toBe(5);
      expect(summary.filteredCount).toBe(3);
      expect(summary.repurposedCount).toBe(2);
    });

    it('should allow zero counts', () => {
      const summary: ValidationSummary = {
        totalProcessed: 0,
        passedCount: 0,
        filteredCount: 0,
        repurposedCount: 0,
      };

      expect(summary.totalProcessed).toBe(0);
      expect(summary.passedCount).toBe(0);
    });

    it('should have counts that can sum correctly', () => {
      const summary: ValidationSummary = {
        totalProcessed: 15,
        passedCount: 8,
        filteredCount: 4,
        repurposedCount: 3,
      };

      // Verify logical consistency (passed + filtered + repurposed = total)
      const sumOfActions = summary.passedCount + summary.filteredCount + summary.repurposedCount;
      expect(sumOfActions).toBe(summary.totalProcessed);
    });
  });

  describe('ValidationContext', () => {
    it('should accept a complete validation context', () => {
      const context: ValidationContext = {
        summary: {
          totalProcessed: 5,
          passedCount: 2,
          filteredCount: 2,
          repurposedCount: 1,
        },
        filteredQuestions: [
          {
            decisionId: 'filter-1',
            questionText: 'Duplicate question?',
            reason: 'Already asked',
            filteredAt: '2024-01-15T10:00:00Z',
          },
          {
            decisionId: 'filter-2',
            questionText: 'Irrelevant question?',
            reason: 'Out of scope',
            filteredAt: '2024-01-15T10:01:00Z',
          },
        ],
        repurposedQuestions: [
          {
            originalDecisionId: 'repurpose-1',
            originalQuestionText: 'What should we do?',
            reason: 'Too vague',
            newQuestionTexts: ['Should we use option A or B?'],
            repurposedAt: '2024-01-15T10:02:00Z',
          },
        ],
      };

      expect(context.summary.totalProcessed).toBe(5);
      expect(context.filteredQuestions).toHaveLength(2);
      expect(context.repurposedQuestions).toHaveLength(1);
    });

    it('should accept empty arrays for filtered and repurposed', () => {
      const context: ValidationContext = {
        summary: {
          totalProcessed: 3,
          passedCount: 3,
          filteredCount: 0,
          repurposedCount: 0,
        },
        filteredQuestions: [],
        repurposedQuestions: [],
      };

      expect(context.filteredQuestions).toEqual([]);
      expect(context.repurposedQuestions).toEqual([]);
    });

    it('should work with ValidationAction type', () => {
      // Verify types work together
      const actions: ValidationAction[] = ['pass', 'filter', 'repurpose'];
      const context: ValidationContext = {
        summary: {
          totalProcessed: actions.length,
          passedCount: 1,
          filteredCount: 1,
          repurposedCount: 1,
        },
        filteredQuestions: [],
        repurposedQuestions: [],
      };

      expect(actions).toContain('filter');
      expect(actions).toContain('repurpose');
      expect(context.summary.totalProcessed).toBe(3);
    });
  });

  describe('Type Integration', () => {
    it('should support building context from validation results', () => {
      // Simulate aggregating validation results into context
      const filteredResults = [
        { id: 'f1', text: 'Q1', reason: 'R1', timestamp: '2024-01-15T10:00:00Z' },
        { id: 'f2', text: 'Q2', reason: 'R2', timestamp: '2024-01-15T10:01:00Z' },
      ];

      const repurposedResults = [
        { id: 'r1', text: 'Q3', reason: 'R3', newTexts: ['Q3a'], timestamp: '2024-01-15T10:02:00Z' },
      ];

      const context: ValidationContext = {
        summary: {
          totalProcessed: 5,
          passedCount: 2,
          filteredCount: filteredResults.length,
          repurposedCount: repurposedResults.length,
        },
        filteredQuestions: filteredResults.map(r => ({
          decisionId: r.id,
          questionText: r.text,
          reason: r.reason,
          filteredAt: r.timestamp,
        })),
        repurposedQuestions: repurposedResults.map(r => ({
          originalDecisionId: r.id,
          originalQuestionText: r.text,
          reason: r.reason,
          newQuestionTexts: r.newTexts,
          repurposedAt: r.timestamp,
        })),
      };

      expect(context.filteredQuestions).toHaveLength(2);
      expect(context.repurposedQuestions).toHaveLength(1);
      expect(context.summary.filteredCount).toBe(context.filteredQuestions.length);
      expect(context.summary.repurposedCount).toBe(context.repurposedQuestions.length);
    });

    it('should maintain data integrity with decision IDs', () => {
      // Verify decision ID tracking is consistent
      const originalDecisionId = 'decision-uuid-123';

      const filtered: FilteredQuestion = {
        decisionId: originalDecisionId,
        questionText: 'Original question',
        reason: 'Filter reason',
        filteredAt: '2024-01-15T10:00:00Z',
      };

      const repurposed: RepurposedQuestion = {
        originalDecisionId: originalDecisionId,
        originalQuestionText: 'Original question',
        reason: 'Repurpose reason',
        newQuestionTexts: ['New question 1'],
        repurposedAt: '2024-01-15T10:00:00Z',
      };

      // Decision ID can be used to correlate across different collections
      expect(filtered.decisionId).toBe(repurposed.originalDecisionId);
    });
  });
});

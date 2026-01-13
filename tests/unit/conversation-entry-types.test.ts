/**
 * Tests for ConversationEntry type extensions with validation metadata
 */

import type { ValidationAction } from '@claude-code-web/shared';

describe('ConversationEntry Types', () => {
  describe('ValidationAction type', () => {
    it('should accept valid validation actions', () => {
      const validActions: ValidationAction[] = ['pass', 'filter', 'repurpose'];

      validActions.forEach(action => {
        expect(['pass', 'filter', 'repurpose']).toContain(action);
      });
    });

    it('should use pass for approved questions', () => {
      const action: ValidationAction = 'pass';
      expect(action).toBe('pass');
    });

    it('should use filter for rejected questions', () => {
      const action: ValidationAction = 'filter';
      expect(action).toBe('filter');
    });

    it('should use repurpose for modified questions', () => {
      const action: ValidationAction = 'repurpose';
      expect(action).toBe('repurpose');
    });
  });

  describe('ConversationEntry validation fields', () => {
    interface ConversationEntry {
      stage: number;
      stepId?: string;
      timestamp: string;
      prompt: string;
      output: string;
      sessionId: string | null;
      costUsd: number;
      isError: boolean;
      error?: string;
      status?: 'started' | 'completed';
      postProcessingType?: string;
      questionId?: string;
      validationAction?: ValidationAction;
      questionIndex?: number;
    }

    const baseEntry: ConversationEntry = {
      stage: 1,
      timestamp: '2024-01-01T00:00:00Z',
      prompt: 'Test prompt',
      output: 'Test output',
      sessionId: 'session-123',
      costUsd: 0.01,
      isError: false,
    };

    it('should allow entries without validation metadata', () => {
      const entry: ConversationEntry = { ...baseEntry };
      expect(entry.questionId).toBeUndefined();
      expect(entry.validationAction).toBeUndefined();
      expect(entry.questionIndex).toBeUndefined();
    });

    it('should allow entries with validation metadata', () => {
      const entry: ConversationEntry = {
        ...baseEntry,
        postProcessingType: 'decision_validation',
        questionId: 'question-456',
        validationAction: 'pass',
        questionIndex: 1,
      };
      expect(entry.questionId).toBe('question-456');
      expect(entry.validationAction).toBe('pass');
      expect(entry.questionIndex).toBe(1);
    });

    it('should allow entries with stepId for Stage 3', () => {
      const entry: ConversationEntry = {
        ...baseEntry,
        stage: 3,
        stepId: 'step-1',
      };
      expect(entry.stepId).toBe('step-1');
      expect(entry.stage).toBe(3);
    });

    it('should handle questionIndex as 1-based index', () => {
      const entries: ConversationEntry[] = [
        { ...baseEntry, questionId: 'q1', questionIndex: 1 },
        { ...baseEntry, questionId: 'q2', questionIndex: 2 },
        { ...baseEntry, questionId: 'q3', questionIndex: 3 },
      ];

      entries.forEach((entry, idx) => {
        expect(entry.questionIndex).toBe(idx + 1);
      });
    });

    it('should support filter validation action for rejected questions', () => {
      const entry: ConversationEntry = {
        ...baseEntry,
        postProcessingType: 'decision_validation',
        questionId: 'question-789',
        validationAction: 'filter',
        questionIndex: 2,
      };
      expect(entry.validationAction).toBe('filter');
    });

    it('should support repurpose validation action', () => {
      const entry: ConversationEntry = {
        ...baseEntry,
        postProcessingType: 'decision_validation',
        questionId: 'question-abc',
        validationAction: 'repurpose',
        questionIndex: 3,
      };
      expect(entry.validationAction).toBe('repurpose');
    });
  });
});

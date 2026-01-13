import { describe, it, expect } from 'vitest';
import {
  truncateText,
  getQuestionStatus,
  getValidationActionLabel,
  generateConversationLabel,
  getStageColor,
  MAX_STEP_TITLE_LENGTH,
  MAX_QUESTION_TEXT_LENGTH,
} from './labelUtils';
import type { PlanStep, Question } from '@claude-code-web/shared';
import type { ConversationEntry } from '../../stores/sessionStore';

describe('truncateText', () => {
  it('returns text unchanged when shorter than maxLength', () => {
    expect(truncateText('short', 10)).toBe('short');
  });

  it('returns text unchanged when equal to maxLength', () => {
    expect(truncateText('exact', 5)).toBe('exact');
  });

  it('truncates text with ellipsis when longer than maxLength', () => {
    expect(truncateText('this is a long text', 10)).toBe('this is a...');
  });

  it('trims trailing spaces before ellipsis', () => {
    expect(truncateText('hello world', 6)).toBe('hello...');
  });

  it('handles empty string', () => {
    expect(truncateText('', 10)).toBe('');
  });
});

describe('getQuestionStatus', () => {
  it('returns pending when question is undefined', () => {
    expect(getQuestionStatus(undefined)).toBe('pending');
  });

  it('returns pending when answeredAt is null', () => {
    const question = {
      id: '1',
      answeredAt: null,
    } as Question;
    expect(getQuestionStatus(question)).toBe('pending');
  });

  it('returns answered when answeredAt is set', () => {
    const question = {
      id: '1',
      answeredAt: '2024-01-01T00:00:00Z',
    } as Question;
    expect(getQuestionStatus(question)).toBe('answered');
  });
});

describe('getValidationActionLabel', () => {
  it('returns "Passed" for pass action', () => {
    expect(getValidationActionLabel('pass')).toBe('Passed');
  });

  it('returns "Filtered" for filter action', () => {
    expect(getValidationActionLabel('filter')).toBe('Filtered');
  });

  it('returns "Repurposed" for repurpose action', () => {
    expect(getValidationActionLabel('repurpose')).toBe('Repurposed');
  });

  it('returns empty string for undefined action', () => {
    expect(getValidationActionLabel(undefined)).toBe('');
  });
});

describe('generateConversationLabel', () => {
  const createEntry = (overrides: Partial<ConversationEntry> = {}): ConversationEntry => ({
    stage: 1,
    timestamp: '2024-01-01T00:00:00Z',
    prompt: 'test prompt',
    output: 'test output',
    sessionId: 'session-1',
    costUsd: 0,
    isError: false,
    ...overrides,
  });

  describe('main stage entries', () => {
    it('returns "Discovery" for stage 1', () => {
      expect(generateConversationLabel(createEntry({ stage: 1 }))).toBe('Discovery');
    });

    it('returns "Plan Review" for stage 2', () => {
      expect(generateConversationLabel(createEntry({ stage: 2 }))).toBe('Plan Review');
    });

    it('returns "Implementation" for stage 3', () => {
      expect(generateConversationLabel(createEntry({ stage: 3 }))).toBe('Implementation');
    });

    it('returns "PR Creation" for stage 4', () => {
      expect(generateConversationLabel(createEntry({ stage: 4 }))).toBe('PR Creation');
    });

    it('returns "PR Review" for stage 5', () => {
      expect(generateConversationLabel(createEntry({ stage: 5 }))).toBe('PR Review');
    });

    it('returns "Stage N" for unknown stages', () => {
      expect(generateConversationLabel(createEntry({ stage: 99 }))).toBe('Stage 99');
    });
  });

  describe('stage 3 with step context', () => {
    const planSteps: PlanStep[] = [
      { id: 'step-1', title: 'First step', parentId: null, orderIndex: 0, description: '', status: 'pending', metadata: {} },
      { id: 'step-2', title: 'Second step', parentId: null, orderIndex: 1, description: '', status: 'pending', metadata: {} },
      { id: 'step-3', title: 'This is a very long step title that should be truncated', parentId: null, orderIndex: 2, description: '', status: 'pending', metadata: {} },
    ];

    it('includes step number and title when stepId matches', () => {
      const entry = createEntry({ stage: 3, stepId: 'step-2' });
      expect(generateConversationLabel(entry, planSteps)).toBe('Implementation of Step 2: Second step');
    });

    it('truncates long step titles', () => {
      const entry = createEntry({ stage: 3, stepId: 'step-3' });
      const label = generateConversationLabel(entry, planSteps);
      expect(label).toContain('Implementation of Step 3:');
      expect(label).toContain('...');
      expect(label.length).toBeLessThan(60); // Should be truncated
    });

    it('falls back to default label when stepId not found', () => {
      const entry = createEntry({ stage: 3, stepId: 'nonexistent' });
      expect(generateConversationLabel(entry, planSteps)).toBe('Implementation');
    });

    it('falls back to default label when planSteps not provided', () => {
      const entry = createEntry({ stage: 3, stepId: 'step-1' });
      expect(generateConversationLabel(entry)).toBe('Implementation');
    });
  });

  describe('post-processing entries', () => {
    it('returns "Validation" for decision_validation', () => {
      const entry = createEntry({ postProcessingType: 'decision_validation' });
      expect(generateConversationLabel(entry)).toBe('Validation');
    });

    it('includes question index for decision_validation when available', () => {
      const entry = createEntry({ postProcessingType: 'decision_validation', questionIndex: 2 });
      expect(generateConversationLabel(entry)).toBe('Validation of Q2');
    });

    it('returns "Test Assessment" for test_assessment', () => {
      const entry = createEntry({ postProcessingType: 'test_assessment' });
      expect(generateConversationLabel(entry)).toBe('Test Assessment');
    });

    it('returns "Step Assessment" for incomplete_steps', () => {
      const entry = createEntry({ postProcessingType: 'incomplete_steps' });
      expect(generateConversationLabel(entry)).toBe('Step Assessment');
    });

    it('returns "Summary" for summary_generation', () => {
      const entry = createEntry({ postProcessingType: 'summary_generation' });
      expect(generateConversationLabel(entry)).toBe('Summary');
    });

    it('uses post-processing type as fallback for unknown types', () => {
      const entry = createEntry({ postProcessingType: 'unknown_type' as any });
      expect(generateConversationLabel(entry)).toBe('unknown_type');
    });
  });
});

describe('getStageColor', () => {
  it('returns cyan for post-processing entries', () => {
    expect(getStageColor(1, 'decision_validation')).toBe('bg-cyan-600');
  });

  it('returns purple for stage 1', () => {
    expect(getStageColor(1)).toBe('bg-purple-600');
  });

  it('returns blue for stage 2', () => {
    expect(getStageColor(2)).toBe('bg-blue-600');
  });

  it('returns green for stage 3', () => {
    expect(getStageColor(3)).toBe('bg-green-600');
  });

  it('returns yellow for stage 4', () => {
    expect(getStageColor(4)).toBe('bg-yellow-600');
  });

  it('returns orange for stage 5', () => {
    expect(getStageColor(5)).toBe('bg-orange-600');
  });

  it('returns gray for unknown stages', () => {
    expect(getStageColor(99)).toBe('bg-gray-600');
  });
});

describe('Constants', () => {
  it('MAX_STEP_TITLE_LENGTH is 30', () => {
    expect(MAX_STEP_TITLE_LENGTH).toBe(30);
  });

  it('MAX_QUESTION_TEXT_LENGTH is 25', () => {
    expect(MAX_QUESTION_TEXT_LENGTH).toBe(25);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionStore, usePlanStep, useQuestion, type ExecutionStatus } from './sessionStore';
import type { Plan, PlanStep, Question } from '@claude-code-web/shared';

describe('sessionStore selector hooks', () => {
  // Reset store state before each test
  beforeEach(() => {
    useSessionStore.setState({
      session: null,
      plan: null,
      questions: [],
      conversations: [],
      executionStatus: null,
      liveOutput: '',
      isOutputComplete: true,
      implementationProgress: null,
      isLoading: false,
      error: null,
    });
  });

  describe('usePlanStep', () => {
    const mockPlanSteps: PlanStep[] = [
      { id: 'step-1', title: 'First step', parentId: null, orderIndex: 0, description: 'Desc 1', status: 'pending', metadata: {} },
      { id: 'step-2', title: 'Second step', parentId: null, orderIndex: 1, description: 'Desc 2', status: 'completed', metadata: {} },
      { id: 'step-3', title: 'Third step', parentId: 'step-1', orderIndex: 2, description: 'Desc 3', status: 'in_progress', metadata: {} },
    ];

    const mockPlan: Plan = {
      version: '1.0',
      planVersion: 1,
      sessionId: 'test-session',
      isApproved: false,
      reviewCount: 0,
      createdAt: '2024-01-01T00:00:00Z',
      steps: mockPlanSteps,
    };

    it('returns undefined when stepId is undefined', () => {
      const { result } = renderHook(() => usePlanStep(undefined));
      expect(result.current).toBeUndefined();
    });

    it('returns undefined when plan is not loaded', () => {
      const { result } = renderHook(() => usePlanStep('step-1'));
      expect(result.current).toBeUndefined();
    });

    it('returns undefined when step is not found', () => {
      useSessionStore.setState({ plan: mockPlan });
      const { result } = renderHook(() => usePlanStep('nonexistent-step'));
      expect(result.current).toBeUndefined();
    });

    it('returns the correct step when found', () => {
      useSessionStore.setState({ plan: mockPlan });
      const { result } = renderHook(() => usePlanStep('step-2'));
      expect(result.current).toEqual(mockPlanSteps[1]);
      expect(result.current?.title).toBe('Second step');
    });

    it('updates when store changes', () => {
      useSessionStore.setState({ plan: mockPlan });
      const { result } = renderHook(() => usePlanStep('step-1'));
      expect(result.current?.status).toBe('pending');

      // Update the step status
      act(() => {
        useSessionStore.getState().updateStepStatus('step-1', 'completed');
      });

      expect(result.current?.status).toBe('completed');
    });
  });

  describe('useQuestion', () => {
    const mockQuestions: Question[] = [
      {
        id: 'q-1',
        stage: 'discovery',
        questionType: 'single_choice',
        category: 'scope',
        priority: 1,
        questionText: 'First question?',
        options: [{ value: 'a', label: 'Option A' }],
        answer: null,
        isRequired: true,
        askedAt: '2024-01-01T00:00:00Z',
        answeredAt: null,
      },
      {
        id: 'q-2',
        stage: 'planning',
        questionType: 'single_choice',
        category: 'approach',
        priority: 2,
        questionText: 'Second question?',
        options: [{ value: 'b', label: 'Option B' }],
        answer: { value: 'b' },
        isRequired: false,
        askedAt: '2024-01-01T01:00:00Z',
        answeredAt: '2024-01-01T02:00:00Z',
      },
    ];

    it('returns undefined when questionId is undefined', () => {
      const { result } = renderHook(() => useQuestion(undefined));
      expect(result.current).toBeUndefined();
    });

    it('returns undefined when questions array is empty', () => {
      const { result } = renderHook(() => useQuestion('q-1'));
      expect(result.current).toBeUndefined();
    });

    it('returns undefined when question is not found', () => {
      useSessionStore.setState({ questions: mockQuestions });
      const { result } = renderHook(() => useQuestion('nonexistent-question'));
      expect(result.current).toBeUndefined();
    });

    it('returns the correct question when found', () => {
      useSessionStore.setState({ questions: mockQuestions });
      const { result } = renderHook(() => useQuestion('q-2'));
      expect(result.current).toEqual(mockQuestions[1]);
      expect(result.current?.questionText).toBe('Second question?');
    });

    it('returns answered question correctly', () => {
      useSessionStore.setState({ questions: mockQuestions });
      const { result } = renderHook(() => useQuestion('q-2'));
      expect(result.current?.answeredAt).toBe('2024-01-01T02:00:00Z');
      expect(result.current?.answer).toEqual({ value: 'b' });
    });

    it('returns unanswered question correctly', () => {
      useSessionStore.setState({ questions: mockQuestions });
      const { result } = renderHook(() => useQuestion('q-1'));
      expect(result.current?.answeredAt).toBeNull();
      expect(result.current?.answer).toBeNull();
    });

    it('updates when store changes', () => {
      useSessionStore.setState({ questions: mockQuestions });
      const { result } = renderHook(() => useQuestion('q-1'));
      expect(result.current?.answer).toBeNull();

      // Answer the question
      act(() => {
        useSessionStore.getState().answerQuestion('q-1', { value: 'a' });
      });

      expect(result.current?.answer).toEqual({ value: 'a' });
      expect(result.current?.answeredAt).not.toBeNull();
    });
  });

  describe('ExecutionStatus with extended fields', () => {
    it('sets execution status with basic fields', () => {
      const basicStatus: ExecutionStatus = {
        status: 'running',
        action: 'stage1_started',
        timestamp: '2024-01-01T00:00:00Z',
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(basicStatus);
      });

      const state = useSessionStore.getState();
      expect(state.executionStatus).toEqual(basicStatus);
      expect(state.executionStatus?.stage).toBeUndefined();
      expect(state.executionStatus?.subState).toBeUndefined();
    });

    it('sets execution status with stage field', () => {
      const statusWithStage: ExecutionStatus = {
        status: 'running',
        action: 'stage2_started',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 2,
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(statusWithStage);
      });

      const state = useSessionStore.getState();
      expect(state.executionStatus?.stage).toBe(2);
    });

    it('sets execution status with subState field', () => {
      const statusWithSubState: ExecutionStatus = {
        status: 'running',
        action: 'stage1_started',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 1,
        subState: 'spawning_agent',
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(statusWithSubState);
      });

      const state = useSessionStore.getState();
      expect(state.executionStatus?.subState).toBe('spawning_agent');
    });

    it('sets execution status with stepId field', () => {
      const statusWithStepId: ExecutionStatus = {
        status: 'running',
        action: 'stage3_progress',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 3,
        stepId: 'step-5',
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(statusWithStepId);
      });

      const state = useSessionStore.getState();
      expect(state.executionStatus?.stepId).toBe('step-5');
    });

    it('sets execution status with progress field', () => {
      const statusWithProgress: ExecutionStatus = {
        status: 'running',
        action: 'stage3_progress',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 3,
        progress: { current: 3, total: 10 },
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(statusWithProgress);
      });

      const state = useSessionStore.getState();
      expect(state.executionStatus?.progress).toEqual({ current: 3, total: 10 });
    });

    it('sets execution status with all extended fields', () => {
      const fullStatus: ExecutionStatus = {
        status: 'running',
        action: 'stage3_progress',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 3,
        subState: 'processing_output',
        stepId: 'step-7',
        progress: { current: 5, total: 12 },
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(fullStatus);
      });

      const state = useSessionStore.getState();
      expect(state.executionStatus).toEqual(fullStatus);
      expect(state.executionStatus?.stage).toBe(3);
      expect(state.executionStatus?.subState).toBe('processing_output');
      expect(state.executionStatus?.stepId).toBe('step-7');
      expect(state.executionStatus?.progress?.current).toBe(5);
      expect(state.executionStatus?.progress?.total).toBe(12);
    });

    it('updates execution status preserving extended fields', () => {
      const initialStatus: ExecutionStatus = {
        status: 'running',
        action: 'stage3_started',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 3,
        subState: 'spawning_agent',
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(initialStatus);
      });

      const updatedStatus: ExecutionStatus = {
        status: 'running',
        action: 'stage3_progress',
        timestamp: '2024-01-01T00:01:00Z',
        stage: 3,
        subState: 'processing_output',
        stepId: 'step-1',
        progress: { current: 1, total: 5 },
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(updatedStatus);
      });

      const state = useSessionStore.getState();
      expect(state.executionStatus).toEqual(updatedStatus);
      expect(state.executionStatus?.subState).toBe('processing_output');
    });

    it('clears extended fields when set to undefined', () => {
      const fullStatus: ExecutionStatus = {
        status: 'running',
        action: 'stage3_progress',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 3,
        subState: 'processing_output',
        stepId: 'step-1',
        progress: { current: 1, total: 5 },
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(fullStatus);
      });

      const basicStatus: ExecutionStatus = {
        status: 'idle',
        action: 'stage3_complete',
        timestamp: '2024-01-01T00:02:00Z',
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(basicStatus);
      });

      const state = useSessionStore.getState();
      expect(state.executionStatus?.stage).toBeUndefined();
      expect(state.executionStatus?.subState).toBeUndefined();
      expect(state.executionStatus?.stepId).toBeUndefined();
      expect(state.executionStatus?.progress).toBeUndefined();
    });

    it('reset clears execution status', () => {
      const status: ExecutionStatus = {
        status: 'running',
        action: 'stage1_started',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 1,
        subState: 'spawning_agent',
      };

      act(() => {
        useSessionStore.getState().setExecutionStatus(status);
      });

      expect(useSessionStore.getState().executionStatus).not.toBeNull();

      act(() => {
        useSessionStore.getState().reset();
      });

      expect(useSessionStore.getState().executionStatus).toBeNull();
    });
  });
});

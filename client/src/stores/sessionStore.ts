import { create } from 'zustand';
import type { Session, Plan, Question, PlanStepStatus, ImplementationProgressEvent, ValidationAction, ExecutionSubState, StepProgress, BackoutAction, BackoutReason } from '@claude-code-web/shared';

export type { ValidationAction } from '@claude-code-web/shared';

export interface ConversationEntry {
  stage: number;
  /** Plan step this conversation is for (Stage 3) */
  stepId?: string;
  timestamp: string;
  prompt: string;
  output: string;
  sessionId: string | null;
  costUsd: number;
  isError: boolean;
  error?: string;
  status?: 'started' | 'completed' | 'interrupted';
  /** Post-processing type (if this is a Haiku post-processing call) */
  postProcessingType?:
    | 'decision_validation'
    | 'test_assessment'
    | 'incomplete_steps'
    | 'question_extraction'
    | 'plan_step_extraction'
    | 'pr_info_extraction'
    | 'implementation_status_extraction'
    | 'test_results_extraction'
    | 'review_findings_extraction'
    | 'commit_message_generation'
    | 'summary_generation';
  /** ID of the question this validation is for (for decision_validation entries) */
  questionId?: string;
  /** Validation result action (pass/filter/repurpose) */
  validationAction?: ValidationAction;
  /** 1-based index of the question for display purposes */
  questionIndex?: number;
}

export interface ExecutionStatus {
  status: 'running' | 'idle' | 'error';
  action: string;
  timestamp: string;
  /** Current stage number (1-7) */
  stage?: number;
  /** Granular sub-state within the current action */
  subState?: ExecutionSubState;
  /** Current step ID for Stage 3 context */
  stepId?: string;
  /** Progress tracking for multi-step operations */
  progress?: StepProgress;
}

interface SessionState {
  // Current session data
  session: Session | null;
  plan: Plan | null;
  questions: Question[];
  conversations: ConversationEntry[];

  // Queue management (for Dashboard)
  queuedSessions: Session[];
  isReorderingQueue: boolean;

  // Real-time state
  executionStatus: ExecutionStatus | null;
  liveOutput: string;
  isOutputComplete: boolean;
  implementationProgress: ImplementationProgressEvent | null;
  /** True after submitting answers until Claude starts running */
  isAwaitingClaudeResponse: boolean;

  // UI state
  isLoading: boolean;
  error: string | null;

  // Actions
  setSession: (session: Session | null) => void;
  setPlan: (plan: Plan | null) => void;
  setQuestions: (questions: Question[]) => void;
  addQuestion: (question: Question) => void;
  answerQuestion: (questionId: string, answer: Question['answer']) => void;
  setConversations: (conversations: ConversationEntry[]) => void;
  setExecutionStatus: (status: ExecutionStatus) => void;
  appendLiveOutput: (output: string, isComplete: boolean) => void;
  updateStepStatus: (stepId: string, status: PlanStepStatus) => void;
  setImplementationProgress: (progress: ImplementationProgressEvent | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;

  // Queue actions
  setQueuedSessions: (sessions: Session[]) => void;
  updateQueuedSessionsFromEvent: (sessions: Array<{ featureId: string; title: string; queuePosition: number | null }>) => void;

  // Async actions
  fetchSession: (projectId: string, featureId: string) => Promise<void>;
  fetchConversations: (projectId: string, featureId: string) => Promise<void>;
  submitQuestionAnswer: (questionId: string, answer: Question['answer']) => Promise<void>;
  submitAllAnswers: (answers: Array<{ questionId: string; answer: Question['answer'] }>, remarks?: string) => Promise<void>;
  approvePlan: () => Promise<void>;
  requestPlanChanges: (feedback: string) => Promise<void>;
  retrySession: () => Promise<void>;
  reorderQueue: (projectId: string, orderedFeatureIds: string[]) => Promise<void>;
  backoutSession: (projectId: string, featureId: string, action: BackoutAction, reason?: BackoutReason) => Promise<void>;
  resumeSession: (projectId: string, featureId: string) => Promise<void>;
}

const initialState = {
  session: null,
  plan: null,
  questions: [],
  conversations: [],
  queuedSessions: [] as Session[],
  isReorderingQueue: false,
  executionStatus: null,
  liveOutput: '',
  isOutputComplete: true,
  implementationProgress: null,
  isAwaitingClaudeResponse: false,
  isLoading: false,
  error: null,
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState,

  setSession: (session) => set({ session }),
  setPlan: (plan) => set({ plan }),
  setQuestions: (questions) => set({ questions, isAwaitingClaudeResponse: false }),

  addQuestion: (question) =>
    set((state) => ({
      questions: [...state.questions, question],
    })),

  answerQuestion: (questionId, answer) =>
    set((state) => ({
      questions: state.questions.map((q) =>
        q.id === questionId ? { ...q, answer, answeredAt: new Date().toISOString() } : q
      ),
    })),

  setConversations: (conversations) => set({ conversations }),

  setExecutionStatus: (executionStatus) => set({
    executionStatus,
    // Clear awaiting flag when Claude starts running
    isAwaitingClaudeResponse: executionStatus.status === 'running' ? false : get().isAwaitingClaudeResponse,
  }),

  appendLiveOutput: (output, isComplete) =>
    set((state) => ({
      liveOutput: isComplete ? output : state.liveOutput + output,
      isOutputComplete: isComplete,
    })),

  updateStepStatus: (stepId, status) =>
    set((state) => {
      if (!state.plan) return state;
      return {
        plan: {
          ...state.plan,
          steps: state.plan.steps.map((step) =>
            step.id === stepId ? { ...step, status } : step
          ),
        },
      };
    }),

  setImplementationProgress: (implementationProgress) =>
    set({ implementationProgress }),

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),

  // Queue actions
  setQueuedSessions: (queuedSessions) => set({ queuedSessions }),

  updateQueuedSessionsFromEvent: (sessions) =>
    set((state) => ({
      queuedSessions: state.queuedSessions.map((s) => {
        const update = sessions.find((u) => u.featureId === s.featureId);
        if (update) {
          return { ...s, queuePosition: update.queuePosition };
        }
        return s;
      }).sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0)),
    })),

  fetchSession: async (projectId, featureId) => {
    set({ isLoading: true, error: null });
    try {
      const [sessionRes, planRes, questionsRes] = await Promise.all([
        fetch(`/api/sessions/${projectId}/${featureId}`),
        fetch(`/api/sessions/${projectId}/${featureId}/plan`),
        fetch(`/api/sessions/${projectId}/${featureId}/questions`),
      ]);

      if (!sessionRes.ok) {
        throw new Error('Session not found');
      }

      const session = await sessionRes.json();
      const plan = planRes.ok ? await planRes.json() : null;
      const questionsData = questionsRes.ok ? await questionsRes.json() : { questions: [] };

      set({
        session,
        plan,
        questions: questionsData.questions || [],
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch session',
        isLoading: false,
      });
    }
  },

  fetchConversations: async (projectId, featureId) => {
    try {
      const response = await fetch(`/api/sessions/${projectId}/${featureId}/conversations`);
      if (response.ok) {
        const data = await response.json();
        set({ conversations: data.entries || [] });
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  },

  submitQuestionAnswer: async (questionId, answer) => {
    const { session, questions } = get();
    if (!session) return;

    const question = questions.find((q) => q.id === questionId);
    if (!question) return;

    try {
      const response = await fetch(
        `/api/sessions/${session.projectId}/${session.featureId}/questions/${questionId}/answer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(answer),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to submit answer');
      }

      // Update local state
      get().answerQuestion(questionId, answer);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to submit answer',
      });
    }
  },

  submitAllAnswers: async (answers: Array<{ questionId: string; answer: Question['answer'] }>, remarks?: string) => {
    const { session } = get();
    if (!session) return;

    try {
      const response = await fetch(
        `/api/sessions/${session.projectId}/${session.featureId}/questions/answers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers, remarks: remarks || undefined }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit answers');
      }

      // Update local state for all answered questions
      answers.forEach(({ questionId, answer }) => {
        get().answerQuestion(questionId, answer);
      });

      // Set flag to indicate we're waiting for Claude to respond
      set({ isAwaitingClaudeResponse: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to submit answers',
      });
      throw error; // Re-throw so caller knows it failed
    }
  },

  approvePlan: async () => {
    const { session, plan } = get();
    if (!session || !plan) return;

    try {
      const response = await fetch(
        `/api/sessions/${session.projectId}/${session.featureId}/plan/approve`,
        {
          method: 'POST',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to approve plan');
      }

      const updatedPlan = await response.json();
      set({ plan: updatedPlan });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to approve plan',
      });
    }
  },

  requestPlanChanges: async (feedback) => {
    const { session } = get();
    if (!session) return;

    try {
      const response = await fetch(
        `/api/sessions/${session.projectId}/${session.featureId}/plan/request-changes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to request changes');
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to request changes',
      });
    }
  },

  retrySession: async () => {
    const { session } = get();
    if (!session) return;

    try {
      const response = await fetch(
        `/api/sessions/${session.projectId}/${session.featureId}/retry`,
        {
          method: 'POST',
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to retry session');
      }

      // Refresh session and conversations data after retry
      await Promise.all([
        get().fetchSession(session.projectId, session.featureId),
        get().fetchConversations(session.projectId, session.featureId),
      ]);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to retry session',
      });
      throw error;
    }
  },

  reorderQueue: async (projectId, orderedFeatureIds) => {
    const { queuedSessions } = get();

    // Optimistic update: immediately reorder local state
    const orderedSet = new Set(orderedFeatureIds);
    const reorderedSessions = [
      // First, sessions in the new order
      ...orderedFeatureIds
        .map((fid) => queuedSessions.find((s) => s.featureId === fid))
        .filter((s): s is Session => s !== undefined),
      // Then, any remaining sessions not in the reorder list
      ...queuedSessions.filter((s) => !orderedSet.has(s.featureId)),
    ].map((s, index) => ({ ...s, queuePosition: index + 1 }));

    // Apply optimistic update
    set({ queuedSessions: reorderedSessions, isReorderingQueue: true });

    try {
      const response = await fetch(`/api/sessions/${projectId}/queue-order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedFeatureIds }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reorder queue');
      }

      // Update with server response (authoritative)
      const updatedSessions: Session[] = await response.json();
      set({ queuedSessions: updatedSessions, isReorderingQueue: false });
    } catch (error) {
      // Rollback to original order on error
      set({
        queuedSessions,
        isReorderingQueue: false,
        error: error instanceof Error ? error.message : 'Failed to reorder queue',
      });
      throw error;
    }
  },

  backoutSession: async (projectId, featureId, action, reason) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(
        `/api/sessions/${projectId}/${featureId}/backout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, reason }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to back out session');
      }

      const data = await response.json();

      // Update local session state with the backed out session
      set({
        session: data.session,
        isLoading: false,
      });

      // If a session was promoted, update queued sessions list
      if (data.promotedSession) {
        set((state) => ({
          queuedSessions: state.queuedSessions.filter(
            (s) => s.featureId !== data.promotedSession.featureId
          ),
        }));
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to back out session',
        isLoading: false,
      });
      throw error;
    }
  },

  resumeSession: async (projectId, featureId) => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(
        `/api/sessions/${projectId}/${featureId}/resume`,
        {
          method: 'POST',
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to resume session');
      }

      const data = await response.json();

      // Update local session state with the resumed session
      set({
        session: data.session,
        isLoading: false,
      });

      // If the session was queued, add it to queuedSessions
      if (data.wasQueued) {
        set((state) => ({
          queuedSessions: [...state.queuedSessions, data.session].sort(
            (a, b) => (a.queuePosition || 0) - (b.queuePosition || 0)
          ),
        }));
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to resume session',
        isLoading: false,
      });
      throw error;
    }
  },
}));

/**
 * Selector hook to get a specific plan step by ID.
 * Returns undefined if step or plan not found.
 */
export const usePlanStep = (stepId: string | undefined) => {
  return useSessionStore((state) => {
    if (!stepId || !state.plan) return undefined;
    return state.plan.steps.find((step) => step.id === stepId);
  });
};

/**
 * Selector hook to get a specific question by ID.
 * Returns undefined if question not found.
 */
export const useQuestion = (questionId: string | undefined) => {
  return useSessionStore((state) => {
    if (!questionId) return undefined;
    return state.questions.find((q) => q.id === questionId);
  });
};

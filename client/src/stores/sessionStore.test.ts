import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionStore } from './sessionStore';

describe('sessionStore', () => {
  beforeEach(() => {
    // Reset store between tests
    useSessionStore.setState({
      session: null,
      plan: null,
      questions: [],
      isLoading: false,
      error: null,
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchSession', () => {
    it('should set loading state while fetching', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'session-1' }),
      });
      global.fetch = fetchMock;

      const fetchPromise = useSessionStore.getState().fetchSession('proj1', 'feat1');

      // Loading should be true during fetch
      expect(useSessionStore.getState().isLoading).toBe(true);

      await fetchPromise;

      expect(useSessionStore.getState().isLoading).toBe(false);
    });

    it('should fetch session, plan, and questions in parallel', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'session-1', title: 'Test' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ steps: [], isApproved: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ questions: [{ id: 'q1', questionText: 'Test?' }] }),
        });
      global.fetch = fetchMock;

      await useSessionStore.getState().fetchSession('proj1', 'feat1');

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(useSessionStore.getState().session?.id).toBe('session-1');
      expect(useSessionStore.getState().plan).not.toBeNull();
      expect(useSessionStore.getState().questions).toHaveLength(1);
    });

    it('should handle session not found error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await useSessionStore.getState().fetchSession('proj1', 'feat1');

      expect(useSessionStore.getState().error).toBe('Session not found');
      expect(useSessionStore.getState().session).toBeNull();
    });

    it('should clear previous error on new fetch', async () => {
      useSessionStore.setState({ error: 'previous error' });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'session-1' }),
      });

      await useSessionStore.getState().fetchSession('proj1', 'feat1');

      expect(useSessionStore.getState().error).toBeNull();
    });
  });

  describe('answerQuestion', () => {
    it('should update question answer and set answeredAt', () => {
      useSessionStore.setState({
        questions: [
          { id: 'q1', questionText: 'Test?', answer: null, answeredAt: null } as any,
        ],
      });

      const answer = { value: 'Yes' };
      useSessionStore.getState().answerQuestion('q1', answer);

      const question = useSessionStore.getState().questions[0];
      expect(question.answer).toEqual(answer);
      expect(question.answeredAt).not.toBeNull();
    });

    it('should not affect other questions', () => {
      useSessionStore.setState({
        questions: [
          { id: 'q1', questionText: 'Q1?', answer: null } as any,
          { id: 'q2', questionText: 'Q2?', answer: null } as any,
        ],
      });

      useSessionStore.getState().answerQuestion('q1', { value: 'Yes' });

      expect(useSessionStore.getState().questions[0].answer).toEqual({ value: 'Yes' });
      expect(useSessionStore.getState().questions[1].answer).toBeNull();
    });
  });

  describe('requestPlanChanges', () => {
    it('should send feedback to the API', async () => {
      useSessionStore.setState({
        session: { projectId: 'proj1', featureId: 'feat1' } as any,
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      global.fetch = fetchMock;

      await useSessionStore.getState().requestPlanChanges('Please add more tests');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sessions/proj1/feat1/plan/request-changes',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ feedback: 'Please add more tests' }),
        })
      );
    });

    it('should set error on failure', async () => {
      useSessionStore.setState({
        session: { projectId: 'proj1', featureId: 'feat1' } as any,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await useSessionStore.getState().requestPlanChanges('feedback');

      expect(useSessionStore.getState().error).toBe('Failed to request changes');
    });

    it('should do nothing if no session', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      await useSessionStore.getState().requestPlanChanges('feedback');

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('approvePlan', () => {
    it('should update plan on success', async () => {
      useSessionStore.setState({
        session: { projectId: 'proj1', featureId: 'feat1' } as any,
        plan: { isApproved: false, steps: [] } as any,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isApproved: true, steps: [] }),
      });

      await useSessionStore.getState().approvePlan();

      expect(useSessionStore.getState().plan?.isApproved).toBe(true);
    });

    it('should do nothing if no session or plan', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      await useSessionStore.getState().approvePlan();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      useSessionStore.setState({
        session: { id: 'session-1' } as any,
        plan: { steps: [] } as any,
        questions: [{ id: 'q1' } as any],
        isLoading: true,
        error: 'some error',
      });

      useSessionStore.getState().reset();

      const state = useSessionStore.getState();
      expect(state.session).toBeNull();
      expect(state.plan).toBeNull();
      expect(state.questions).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});

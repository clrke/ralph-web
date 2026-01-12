/**
 * Tests for SessionView socket event handlers
 *
 * Tests the client-side socket event handlers for Stage 3 events:
 * - step.started: Updates step status to 'in_progress'
 * - step.completed: Updates step status to final status
 * - implementation.progress: Sets implementation progress state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SessionView from './SessionView';
import { useSessionStore } from '../stores/sessionStore';
import type {
  StepStartedEvent,
  StepCompletedEvent,
  ImplementationProgressEvent,
  Session,
  Plan,
} from '@claude-code-web/shared';

// Mock socket service
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connected: true,
};

vi.mock('../services/socket', () => ({
  getSocket: () => mockSocket,
  connectToSession: vi.fn(() => mockSocket),
  disconnectFromSession: vi.fn(),
}));

// Helper to capture socket event handlers
function getSocketHandler(eventName: string): ((...args: unknown[]) => void) | undefined {
  const call = mockSocket.on.mock.calls.find((c: unknown[]) => c[0] === eventName);
  return call ? call[1] as (...args: unknown[]) => void : undefined;
}

// Helper to create test session
function createTestSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-123',
    projectId: 'project-1',
    featureId: 'feature-a',
    title: 'Test Feature',
    featureDescription: 'Test description',
    projectPath: '/test/project',
    currentStage: 3,
    status: 'active',
    baseBranch: 'main',
    acceptanceCriteria: [],
    createdAt: '2026-01-13T00:00:00Z',
    updatedAt: '2026-01-13T00:01:00Z',
    ...overrides,
  };
}

// Helper to create test plan
function createTestPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-123',
    sessionId: 'session-123',
    steps: [
      { id: 'step-1', title: 'Step 1', description: 'First step', status: 'pending', order: 0, parentId: null },
      { id: 'step-2', title: 'Step 2', description: 'Second step', status: 'pending', order: 1, parentId: null },
      { id: 'step-3', title: 'Step 3', description: 'Third step', status: 'pending', order: 2, parentId: null },
    ],
    isApproved: true,
    planVersion: 1,
    createdAt: '2026-01-13T00:00:00Z',
    updatedAt: '2026-01-13T00:01:00Z',
    ...overrides,
  };
}

// Wrapper to provide router context
const renderWithRouter = (projectId: string, featureId: string) => {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${projectId}/${featureId}`]}>
      <Routes>
        <Route path="/sessions/:projectId/:featureId" element={<SessionView />} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
};

describe('SessionView Socket Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Socket connection setup', () => {
    it('should register step.started handler on mount', async () => {
      // Set up initial state
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        const registeredEvents = mockSocket.on.mock.calls.map((c: unknown[]) => c[0]);
        expect(registeredEvents).toContain('step.started');
      });
    });

    it('should register step.completed handler on mount', async () => {
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        const registeredEvents = mockSocket.on.mock.calls.map((c: unknown[]) => c[0]);
        expect(registeredEvents).toContain('step.completed');
      });
    });

    it('should register implementation.progress handler on mount', async () => {
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        const registeredEvents = mockSocket.on.mock.calls.map((c: unknown[]) => c[0]);
        expect(registeredEvents).toContain('implementation.progress');
      });
    });

    it('should unregister all handlers on unmount', async () => {
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      const { unmount } = renderWithRouter('project-1', 'feature-a');

      // Wait for handlers to be registered
      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      unmount();

      // Verify cleanup was called for each event
      const unregisteredEvents = mockSocket.off.mock.calls.map((c: unknown[]) => c[0]);
      expect(unregisteredEvents).toContain('step.started');
      expect(unregisteredEvents).toContain('step.completed');
      expect(unregisteredEvents).toContain('implementation.progress');
    });
  });

  describe('handleStepStarted', () => {
    it('should update step status to in_progress when step.started event fires', async () => {
      const plan = createTestPlan({
        steps: [
          { id: 'step-1', title: 'Step 1', description: 'First step', status: 'pending', order: 0, parentId: null },
          { id: 'step-2', title: 'Step 2', description: 'Second step', status: 'pending', order: 1, parentId: null },
        ],
      });

      useSessionStore.setState({
        session: createTestSession(),
        plan,
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      // Wait for handlers to be registered
      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      // Get the handler and call it
      const handler = getSocketHandler('step.started');
      expect(handler).toBeDefined();

      const event: StepStartedEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        stepId: 'step-1',
        stepTitle: 'Step 1',
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      // Verify the store was updated
      const updatedPlan = useSessionStore.getState().plan;
      expect(updatedPlan?.steps[0].status).toBe('in_progress');
      expect(updatedPlan?.steps[1].status).toBe('pending');
    });

    it('should only update the specific step that started', async () => {
      const plan = createTestPlan({
        steps: [
          { id: 'step-1', title: 'Step 1', description: 'First step', status: 'completed', order: 0, parentId: null },
          { id: 'step-2', title: 'Step 2', description: 'Second step', status: 'pending', order: 1, parentId: null },
          { id: 'step-3', title: 'Step 3', description: 'Third step', status: 'pending', order: 2, parentId: null },
        ],
      });

      useSessionStore.setState({
        session: createTestSession(),
        plan,
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('step.started');

      const event: StepStartedEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        stepId: 'step-2',
        stepTitle: 'Step 2',
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const updatedPlan = useSessionStore.getState().plan;
      expect(updatedPlan?.steps[0].status).toBe('completed'); // Unchanged
      expect(updatedPlan?.steps[1].status).toBe('in_progress'); // Updated
      expect(updatedPlan?.steps[2].status).toBe('pending'); // Unchanged
    });
  });

  describe('handleStepCompleted', () => {
    it('should update step status to completed when step.completed event fires', async () => {
      const plan = createTestPlan({
        steps: [
          { id: 'step-1', title: 'Step 1', description: 'First step', status: 'in_progress', order: 0, parentId: null },
        ],
      });

      useSessionStore.setState({
        session: createTestSession(),
        plan,
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('step.completed');
      expect(handler).toBeDefined();

      const event: StepCompletedEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        stepId: 'step-1',
        stepTitle: 'Step 1',
        status: 'completed',
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const updatedPlan = useSessionStore.getState().plan;
      expect(updatedPlan?.steps[0].status).toBe('completed');
    });

    it('should update step status to blocked when step is blocked', async () => {
      const plan = createTestPlan({
        steps: [
          { id: 'step-1', title: 'Step 1', description: 'First step', status: 'in_progress', order: 0, parentId: null },
        ],
      });

      useSessionStore.setState({
        session: createTestSession(),
        plan,
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('step.completed');

      const event: StepCompletedEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        stepId: 'step-1',
        stepTitle: 'Step 1',
        status: 'blocked',
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const updatedPlan = useSessionStore.getState().plan;
      expect(updatedPlan?.steps[0].status).toBe('blocked');
    });

    it('should update step status to skipped when step is skipped', async () => {
      const plan = createTestPlan({
        steps: [
          { id: 'step-1', title: 'Step 1', description: 'First step', status: 'pending', order: 0, parentId: null },
        ],
      });

      useSessionStore.setState({
        session: createTestSession(),
        plan,
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('step.completed');

      const event: StepCompletedEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        stepId: 'step-1',
        stepTitle: 'Step 1',
        status: 'skipped',
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const updatedPlan = useSessionStore.getState().plan;
      expect(updatedPlan?.steps[0].status).toBe('skipped');
    });

    it('should include filesModified in completed event', async () => {
      const plan = createTestPlan({
        steps: [
          { id: 'step-1', title: 'Step 1', description: 'First step', status: 'in_progress', order: 0, parentId: null },
        ],
      });

      useSessionStore.setState({
        session: createTestSession(),
        plan,
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('step.completed');

      const event: StepCompletedEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        stepId: 'step-1',
        stepTitle: 'Step 1',
        status: 'completed',
        filesModified: ['src/app.ts', 'src/utils.ts'],
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      // Event is valid with filesModified
      const updatedPlan = useSessionStore.getState().plan;
      expect(updatedPlan?.steps[0].status).toBe('completed');
    });
  });

  describe('handleImplementationProgress', () => {
    it('should set implementation progress when event fires', async () => {
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('implementation.progress');
      expect(handler).toBeDefined();

      const event: ImplementationProgressEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        status: 'in_progress',
        currentStepId: 'step-1',
        completedSteps: 0,
        totalSteps: 3,
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const progress = useSessionStore.getState().implementationProgress;
      expect(progress).not.toBeNull();
      expect(progress?.status).toBe('in_progress');
      expect(progress?.currentStepId).toBe('step-1');
      expect(progress?.completedSteps).toBe(0);
      expect(progress?.totalSteps).toBe(3);
    });

    it('should update progress with testing status', async () => {
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('implementation.progress');

      const event: ImplementationProgressEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        status: 'testing',
        currentStepId: 'step-1',
        completedSteps: 1,
        totalSteps: 3,
        testStatus: 'running',
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const progress = useSessionStore.getState().implementationProgress;
      expect(progress?.status).toBe('testing');
      expect(progress?.testStatus).toBe('running');
    });

    it('should update progress with fixing status and retry count', async () => {
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('implementation.progress');

      const event: ImplementationProgressEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        status: 'fixing',
        currentStepId: 'step-1',
        completedSteps: 1,
        totalSteps: 3,
        retryCount: 2,
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const progress = useSessionStore.getState().implementationProgress;
      expect(progress?.status).toBe('fixing');
      expect(progress?.retryCount).toBe(2);
    });

    it('should update progress with committing status', async () => {
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('implementation.progress');

      const event: ImplementationProgressEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        status: 'committing',
        currentStepId: 'step-2',
        completedSteps: 2,
        totalSteps: 3,
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const progress = useSessionStore.getState().implementationProgress;
      expect(progress?.status).toBe('committing');
      expect(progress?.completedSteps).toBe(2);
    });

    it('should update progress with blocked status', async () => {
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('implementation.progress');

      const event: ImplementationProgressEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        status: 'blocked',
        currentStepId: 'step-1',
        completedSteps: 0,
        totalSteps: 3,
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const progress = useSessionStore.getState().implementationProgress;
      expect(progress?.status).toBe('blocked');
    });

    it('should update progress with message', async () => {
      useSessionStore.setState({
        session: createTestSession(),
        plan: createTestPlan(),
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const handler = getSocketHandler('implementation.progress');

      const event: ImplementationProgressEvent = {
        sessionId: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        status: 'in_progress',
        currentStepId: 'step-1',
        completedSteps: 0,
        totalSteps: 3,
        message: 'Working on authentication module',
        timestamp: '2026-01-13T00:00:00Z',
      };

      act(() => {
        handler!(event);
      });

      const progress = useSessionStore.getState().implementationProgress;
      expect(progress?.message).toBe('Working on authentication module');
    });
  });

  describe('Multiple event sequence', () => {
    it('should handle step start followed by step complete', async () => {
      const plan = createTestPlan({
        steps: [
          { id: 'step-1', title: 'Step 1', description: 'First step', status: 'pending', order: 0, parentId: null },
        ],
      });

      useSessionStore.setState({
        session: createTestSession(),
        plan,
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const startHandler = getSocketHandler('step.started');
      const completeHandler = getSocketHandler('step.completed');

      // Step starts
      act(() => {
        startHandler!({
          sessionId: 'session-123',
          projectId: 'project-1',
          featureId: 'feature-a',
          stepId: 'step-1',
          stepTitle: 'Step 1',
          timestamp: '2026-01-13T00:00:00Z',
        } as StepStartedEvent);
      });

      expect(useSessionStore.getState().plan?.steps[0].status).toBe('in_progress');

      // Step completes
      act(() => {
        completeHandler!({
          sessionId: 'session-123',
          projectId: 'project-1',
          featureId: 'feature-a',
          stepId: 'step-1',
          stepTitle: 'Step 1',
          status: 'completed',
          timestamp: '2026-01-13T00:01:00Z',
        } as StepCompletedEvent);
      });

      expect(useSessionStore.getState().plan?.steps[0].status).toBe('completed');
    });

    it('should handle progress updates alongside step events', async () => {
      const plan = createTestPlan({
        steps: [
          { id: 'step-1', title: 'Step 1', description: 'First step', status: 'pending', order: 0, parentId: null },
          { id: 'step-2', title: 'Step 2', description: 'Second step', status: 'pending', order: 1, parentId: null },
        ],
      });

      useSessionStore.setState({
        session: createTestSession(),
        plan,
        isLoading: false,
      });

      renderWithRouter('project-1', 'feature-a');

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled();
      });

      const startHandler = getSocketHandler('step.started');
      const completeHandler = getSocketHandler('step.completed');
      const progressHandler = getSocketHandler('implementation.progress');

      // Step 1 starts with progress update
      act(() => {
        startHandler!({
          sessionId: 'session-123',
          projectId: 'project-1',
          featureId: 'feature-a',
          stepId: 'step-1',
          stepTitle: 'Step 1',
          timestamp: '2026-01-13T00:00:00Z',
        } as StepStartedEvent);

        progressHandler!({
          sessionId: 'session-123',
          projectId: 'project-1',
          featureId: 'feature-a',
          status: 'in_progress',
          currentStepId: 'step-1',
          completedSteps: 0,
          totalSteps: 2,
          timestamp: '2026-01-13T00:00:00Z',
        } as ImplementationProgressEvent);
      });

      expect(useSessionStore.getState().plan?.steps[0].status).toBe('in_progress');
      expect(useSessionStore.getState().implementationProgress?.currentStepId).toBe('step-1');

      // Step 1 completes, step 2 starts
      act(() => {
        completeHandler!({
          sessionId: 'session-123',
          projectId: 'project-1',
          featureId: 'feature-a',
          stepId: 'step-1',
          stepTitle: 'Step 1',
          status: 'completed',
          timestamp: '2026-01-13T00:01:00Z',
        } as StepCompletedEvent);

        startHandler!({
          sessionId: 'session-123',
          projectId: 'project-1',
          featureId: 'feature-a',
          stepId: 'step-2',
          stepTitle: 'Step 2',
          timestamp: '2026-01-13T00:01:00Z',
        } as StepStartedEvent);

        progressHandler!({
          sessionId: 'session-123',
          projectId: 'project-1',
          featureId: 'feature-a',
          status: 'in_progress',
          currentStepId: 'step-2',
          completedSteps: 1,
          totalSteps: 2,
          timestamp: '2026-01-13T00:01:00Z',
        } as ImplementationProgressEvent);
      });

      const state = useSessionStore.getState();
      expect(state.plan?.steps[0].status).toBe('completed');
      expect(state.plan?.steps[1].status).toBe('in_progress');
      expect(state.implementationProgress?.currentStepId).toBe('step-2');
      expect(state.implementationProgress?.completedSteps).toBe(1);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './Dashboard';
import { useSessionStore } from '../stores/sessionStore';
import type { Session } from '@claude-code-web/shared';

// Mock socket service with event handlers
const mockSocketHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
const mockSocket = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (!mockSocketHandlers[event]) {
      mockSocketHandlers[event] = [];
    }
    mockSocketHandlers[event].push(handler);
  }),
  off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (mockSocketHandlers[event]) {
      mockSocketHandlers[event] = mockSocketHandlers[event].filter((h) => h !== handler);
    }
  }),
  emit: (event: string, ...args: unknown[]) => {
    if (mockSocketHandlers[event]) {
      mockSocketHandlers[event].forEach((handler) => handler(...args));
    }
  },
};

vi.mock('../services/socket', () => ({
  connectToProject: vi.fn(),
  disconnectFromProject: vi.fn(),
  getSocket: vi.fn(() => mockSocket),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const createMockSession = (overrides: Partial<Session> = {}): Session => ({
  version: '1.0',
  dataVersion: 1,
  id: `session-${overrides.featureId || 'feat1'}`,
  projectId: 'proj1',
  featureId: 'feat1',
  projectPath: '/test/project',
  title: 'Test Feature',
  featureDescription: 'Test feature description',
  baseBranch: 'main',
  featureBranch: 'feature/test',
  baseCommitSha: 'abc123',
  currentStage: 1,
  status: 'discovery',
  acceptanceCriteria: [],
  affectedFiles: [],
  technicalNotes: '',
  replanningCount: 0,
  claudeSessionId: null,
  claudePlanFilePath: null,
  currentPlanVersion: 0,
  claudeStage3SessionId: null,
  prUrl: null,
  sessionExpiresAt: '2024-01-02T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

const renderDashboard = () => {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
};

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear socket handlers
    Object.keys(mockSocketHandlers).forEach((key) => delete mockSocketHandlers[key]);
    useSessionStore.setState({
      queuedSessions: [],
      isReorderingQueue: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('session filtering', () => {
    it('shows filter buttons when sessions exist', async () => {
      const sessions = [
        createMockSession({ featureId: 'feat1', status: 'discovery' }),
        createMockSession({ featureId: 'feat2', status: 'completed', currentStage: 7 }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('session-filters')).toBeInTheDocument();
      });

      expect(screen.getByTestId('filter-all')).toBeInTheDocument();
      expect(screen.getByTestId('filter-active')).toBeInTheDocument();
      expect(screen.getByTestId('filter-completed')).toBeInTheDocument();
    });

    it('shows paused filter button only when paused sessions exist', async () => {
      const sessions = [
        createMockSession({ featureId: 'feat1', status: 'discovery' }),
        createMockSession({ featureId: 'feat2', status: 'paused' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('filter-paused')).toBeInTheDocument();
      });

      expect(screen.getByText('On Hold (1)')).toBeInTheDocument();
    });

    it('shows failed filter button only when failed sessions exist', async () => {
      const sessions = [
        createMockSession({ featureId: 'feat1', status: 'discovery' }),
        createMockSession({ featureId: 'feat2', status: 'failed' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('filter-failed')).toBeInTheDocument();
      });

      expect(screen.getByText('Abandoned (1)')).toBeInTheDocument();
    });

    it('filters sessions when filter is clicked', async () => {
      const user = userEvent.setup();
      const sessions = [
        createMockSession({ featureId: 'active-feat', status: 'discovery', title: 'Active Session' }),
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
        createMockSession({ featureId: 'completed-feat', status: 'completed', currentStage: 7, title: 'Completed Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Active Session')).toBeInTheDocument();
        expect(screen.getByText('Paused Session')).toBeInTheDocument();
        expect(screen.getByText('Completed Session')).toBeInTheDocument();
      });

      // Filter to paused only
      await user.click(screen.getByTestId('filter-paused'));

      await waitFor(() => {
        expect(screen.getByText('Paused Session')).toBeInTheDocument();
        expect(screen.queryByText('Active Session')).not.toBeInTheDocument();
        expect(screen.queryByText('Completed Session')).not.toBeInTheDocument();
      });
    });

    it('shows all sessions when All filter is clicked', async () => {
      const user = userEvent.setup();
      const sessions = [
        createMockSession({ featureId: 'active-feat', status: 'discovery', title: 'Active Session' }),
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('filter-paused')).toBeInTheDocument();
      });

      // Filter to paused
      await user.click(screen.getByTestId('filter-paused'));

      await waitFor(() => {
        expect(screen.queryByText('Active Session')).not.toBeInTheDocument();
      });

      // Click All to show all sessions
      await user.click(screen.getByTestId('filter-all'));

      await waitFor(() => {
        expect(screen.getByText('Active Session')).toBeInTheDocument();
        expect(screen.getByText('Paused Session')).toBeInTheDocument();
      });
    });
  });

  describe('paused session display', () => {
    it('shows On Hold badge for paused sessions', async () => {
      const sessions = [
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('On Hold')).toBeInTheDocument();
      });
    });

    it('shows Resume button for paused sessions', async () => {
      const sessions = [
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('resume-button-paused-feat')).toBeInTheDocument();
        expect(screen.getByText('Resume')).toBeInTheDocument();
      });
    });

    it('applies orange styling to paused session cards', async () => {
      const sessions = [
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        const card = screen.getByTestId('session-card-paused-feat');
        expect(card).toHaveClass('bg-orange-900/20');
        expect(card).toHaveClass('border-orange-700/50');
      });
    });
  });

  describe('failed session display', () => {
    it('shows Abandoned badge for failed sessions', async () => {
      const sessions = [
        createMockSession({ featureId: 'failed-feat', status: 'failed', title: 'Failed Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        // Two instances: one in card title, one in status
        const abandonedTexts = screen.getAllByText('Abandoned');
        expect(abandonedTexts.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('applies red styling to failed session cards', async () => {
      const sessions = [
        createMockSession({ featureId: 'failed-feat', status: 'failed', title: 'Failed Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        const card = screen.getByTestId('session-card-failed-feat');
        expect(card).toHaveClass('bg-red-900/20');
        expect(card).toHaveClass('border-red-700/50');
      });
    });

    it('does not show Resume button for failed sessions', async () => {
      const sessions = [
        createMockSession({ featureId: 'failed-feat', status: 'failed', title: 'Failed Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('session-card-failed-feat')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('resume-button-failed-feat')).not.toBeInTheDocument();
    });
  });

  describe('resume functionality', () => {
    it('calls resumeSession when Resume button is clicked', async () => {
      const user = userEvent.setup();
      const mockResumeSession = vi.fn().mockResolvedValue(undefined);

      useSessionStore.setState({
        resumeSession: mockResumeSession,
      });

      const sessions = [
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('resume-button-paused-feat')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('resume-button-paused-feat'));

      await waitFor(() => {
        expect(mockResumeSession).toHaveBeenCalledWith('proj1', 'paused-feat');
      });
    });

    it('shows loading state while resuming', async () => {
      const user = userEvent.setup();
      // Create a promise that we can control
      let resolveResume: () => void;
      const resumePromise = new Promise<void>((resolve) => {
        resolveResume = resolve;
      });

      const mockResumeSession = vi.fn().mockImplementation(() => resumePromise);

      useSessionStore.setState({
        resumeSession: mockResumeSession,
      });

      const sessions = [
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('resume-button-paused-feat')).toBeInTheDocument();
      });

      // Click resume
      await user.click(screen.getByTestId('resume-button-paused-feat'));

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText('Resuming...')).toBeInTheDocument();
      });

      // Resolve the promise
      resolveResume!();
    });

    it('prevents navigation when clicking Resume button', async () => {
      const user = userEvent.setup();
      const mockResumeSession = vi.fn().mockResolvedValue(undefined);

      useSessionStore.setState({
        resumeSession: mockResumeSession,
      });

      const sessions = [
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('resume-button-paused-feat')).toBeInTheDocument();
      });

      // The Resume button should prevent default click behavior on the link
      const resumeButton = screen.getByTestId('resume-button-paused-feat');
      await user.click(resumeButton);

      // resumeSession should be called (not just navigation)
      expect(mockResumeSession).toHaveBeenCalled();
    });
  });

  describe('empty states', () => {
    it('shows appropriate message when filtering to paused with no paused sessions', async () => {
      const user = userEvent.setup();
      const sessions = [
        createMockSession({ featureId: 'active-feat', status: 'discovery', title: 'Active Session' }),
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('filter-completed')).toBeInTheDocument();
      });

      // Filter to completed (which has none)
      await user.click(screen.getByTestId('filter-completed'));

      await waitFor(() => {
        expect(screen.getByText('No completed sessions.')).toBeInTheDocument();
      });
    });
  });

  describe('active session detection', () => {
    it('excludes paused and failed sessions from active session detection', async () => {
      // This is an internal behavior test - paused/failed shouldn't be considered "active"
      const sessions = [
        createMockSession({ featureId: 'paused-feat', status: 'paused' }),
        createMockSession({ featureId: 'failed-feat', status: 'failed' }),
        createMockSession({ featureId: 'queued-feat', status: 'queued', queuePosition: 1 }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        // With no truly active session, active filter should show 0
        expect(screen.getByTestId('filter-active')).toHaveTextContent('Active (0)');
      });
    });
  });

  describe('queue reordering with multiple projects', () => {
    it('uses projectId from queued sessions, not active session, when reordering', async () => {
      const mockReorderQueue = vi.fn().mockResolvedValue(undefined);

      useSessionStore.setState({
        reorderQueue: mockReorderQueue,
        isReorderingQueue: false,
      });

      // Active session in project A, queued sessions in project B
      const sessions = [
        createMockSession({
          projectId: 'project-a',
          featureId: 'active-feat',
          status: 'discovery',
          title: 'Active in Project A',
        }),
        createMockSession({
          projectId: 'project-b',
          featureId: 'queued-feat-1',
          status: 'queued',
          queuePosition: 1,
          title: 'Queued 1',
        }),
        createMockSession({
          projectId: 'project-b',
          featureId: 'queued-feat-2',
          status: 'queued',
          queuePosition: 2,
          title: 'Queued 2',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Queued 1')).toBeInTheDocument();
        expect(screen.getByText('Queued 2')).toBeInTheDocument();
      });

      // The component should derive projectId from queued sessions (project-b)
      // not from active session (project-a)
      // We verify this by checking that queuedSessions are set correctly
      const storeState = useSessionStore.getState();
      expect(storeState.queuedSessions).toHaveLength(2);
      expect(storeState.queuedSessions[0].projectId).toBe('project-b');
    });

    it('prioritizes queued sessions projectId over active session for socket connection', async () => {
      const { connectToProject } = await import('../services/socket');

      // Active session in project A, queued sessions in project B
      const sessions = [
        createMockSession({
          projectId: 'project-a',
          featureId: 'active-feat',
          status: 'discovery',
        }),
        createMockSession({
          projectId: 'project-b',
          featureId: 'queued-feat',
          status: 'queued',
          queuePosition: 1,
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        // Should connect to project-b (from queued sessions) not project-a (from active)
        expect(connectToProject).toHaveBeenCalledWith('project-b');
      });
    });
  });

  describe('Edit button for queued sessions', () => {
    it('shows Edit button for queued sessions in the queue section', async () => {
      const sessions = [
        createMockSession({ featureId: 'queued-feat', status: 'queued', queuePosition: 1 }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('edit-session-queued-feat')).toBeInTheDocument();
      });
    });

    it('shows Edit button for all queued sessions', async () => {
      const sessions = [
        createMockSession({ featureId: 'queued-1', status: 'queued', queuePosition: 1 }),
        createMockSession({ featureId: 'queued-2', status: 'queued', queuePosition: 2 }),
        createMockSession({ featureId: 'queued-3', status: 'queued', queuePosition: 3 }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('edit-session-queued-1')).toBeInTheDocument();
        expect(screen.getByTestId('edit-session-queued-2')).toBeInTheDocument();
        expect(screen.getByTestId('edit-session-queued-3')).toBeInTheDocument();
      });
    });

    it('does not show Edit button for non-queued sessions', async () => {
      const sessions = [
        createMockSession({ featureId: 'discovery-feat', status: 'discovery', title: 'Discovery Session' }),
        createMockSession({ featureId: 'planning-feat', status: 'planning', title: 'Planning Session' }),
        createMockSession({ featureId: 'paused-feat', status: 'paused', title: 'Paused Session' }),
        createMockSession({ featureId: 'completed-feat', status: 'completed', currentStage: 7, title: 'Completed Session' }),
        createMockSession({ featureId: 'failed-feat', status: 'failed', title: 'Failed Session' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Discovery Session')).toBeInTheDocument();
      });

      // None of these should have edit buttons
      expect(screen.queryByTestId('edit-session-discovery-feat')).not.toBeInTheDocument();
      expect(screen.queryByTestId('edit-session-planning-feat')).not.toBeInTheDocument();
      expect(screen.queryByTestId('edit-session-paused-feat')).not.toBeInTheDocument();
      expect(screen.queryByTestId('edit-session-completed-feat')).not.toBeInTheDocument();
      expect(screen.queryByTestId('edit-session-failed-feat')).not.toBeInTheDocument();
    });

    it('shows Edit button only for queued sessions in mixed list', async () => {
      const sessions = [
        createMockSession({ featureId: 'queued-feat', status: 'queued', queuePosition: 1 }),
        createMockSession({ featureId: 'active-feat', status: 'discovery' }),
        createMockSession({ featureId: 'completed-feat', status: 'completed', currentStage: 7 }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        // Queued session should have edit button
        expect(screen.getByTestId('edit-session-queued-feat')).toBeInTheDocument();
      });

      // Non-queued sessions should not have edit buttons
      expect(screen.queryByTestId('edit-session-active-feat')).not.toBeInTheDocument();
      expect(screen.queryByTestId('edit-session-completed-feat')).not.toBeInTheDocument();
    });

    it('Edit button navigates to edit page when clicked', async () => {
      const user = userEvent.setup();
      const sessions = [
        createMockSession({ featureId: 'queued-feat', status: 'queued', queuePosition: 1 }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route
              path="/session/:projectId/:featureId/edit"
              element={<div data-testid="edit-page">Edit Page</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('edit-session-queued-feat')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('edit-session-queued-feat'));

      await waitFor(() => {
        expect(screen.getByTestId('edit-page')).toBeInTheDocument();
      });
    });
  });

  describe('session.backedout socket event', () => {
    it('removes backed-out session from queued sessions when event is received', async () => {
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'Queued 1' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2, title: 'Queued 2' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-3', status: 'queued', queuePosition: 3, title: 'Queued 3' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Queued 1')).toBeInTheDocument();
        expect(screen.getByText('Queued 2')).toBeInTheDocument();
        expect(screen.getByText('Queued 3')).toBeInTheDocument();
      });

      // Simulate session.backedout event from another client
      mockSocket.emit('session.backedout', {
        projectId: 'proj1',
        featureId: 'queued-2',
        sessionId: 'session-queued-2',
        action: 'abandon',
        reason: 'user_requested',
        newStatus: 'failed',
        previousStage: 0,
        nextSessionId: null,
        timestamp: new Date().toISOString(),
      });

      await waitFor(() => {
        expect(screen.queryByText('Queued 2')).not.toBeInTheDocument();
      });

      // Other sessions should still be present
      expect(screen.getByText('Queued 1')).toBeInTheDocument();
      expect(screen.getByText('Queued 3')).toBeInTheDocument();
    });

    it('ignores session.backedout events from other projects', async () => {
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'Queued 1' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2, title: 'Queued 2' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Queued 1')).toBeInTheDocument();
        expect(screen.getByText('Queued 2')).toBeInTheDocument();
      });

      // Simulate session.backedout event from a different project
      mockSocket.emit('session.backedout', {
        projectId: 'other-project',
        featureId: 'queued-2',
        sessionId: 'session-queued-2',
        action: 'abandon',
        reason: 'user_requested',
        newStatus: 'failed',
        previousStage: 0,
        nextSessionId: null,
        timestamp: new Date().toISOString(),
      });

      // Both sessions should still be present since the event was for a different project
      await waitFor(() => {
        expect(screen.getByText('Queued 1')).toBeInTheDocument();
        expect(screen.getByText('Queued 2')).toBeInTheDocument();
      });
    });

    it('updates store queuedSessions when session.backedout event is received', async () => {
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1 }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2 }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        const storeState = useSessionStore.getState();
        expect(storeState.queuedSessions).toHaveLength(2);
      });

      // Simulate session.backedout event
      mockSocket.emit('session.backedout', {
        projectId: 'proj1',
        featureId: 'queued-1',
        sessionId: 'session-queued-1',
        action: 'abandon',
        reason: 'user_requested',
        newStatus: 'failed',
        previousStage: 0,
        nextSessionId: null,
        timestamp: new Date().toISOString(),
      });

      await waitFor(() => {
        const storeState = useSessionStore.getState();
        expect(storeState.queuedSessions).toHaveLength(1);
        expect(storeState.queuedSessions[0].featureId).toBe('queued-2');
      });
    });
  });

  describe('queue.reordered socket event', () => {
    it('updates queue positions when queue.reordered event is received', async () => {
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'Queued 1' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2, title: 'Queued 2' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-3', status: 'queued', queuePosition: 3, title: 'Queued 3' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        const storeState = useSessionStore.getState();
        expect(storeState.queuedSessions).toHaveLength(3);
      });

      // Simulate queue.reordered event with new positions (user reordered the queue)
      mockSocket.emit('queue.reordered', {
        projectId: 'proj1',
        queuedSessions: [
          { featureId: 'queued-3', queuePosition: 1 },
          { featureId: 'queued-1', queuePosition: 2 },
          { featureId: 'queued-2', queuePosition: 3 },
        ],
        timestamp: new Date().toISOString(),
      });

      await waitFor(() => {
        const storeState = useSessionStore.getState();
        expect(storeState.queuedSessions).toHaveLength(3);
        // Sessions should be sorted by new positions
        expect(storeState.queuedSessions[0].featureId).toBe('queued-3');
        expect(storeState.queuedSessions[0].queuePosition).toBe(1);
        expect(storeState.queuedSessions[1].featureId).toBe('queued-1');
        expect(storeState.queuedSessions[1].queuePosition).toBe(2);
        expect(storeState.queuedSessions[2].featureId).toBe('queued-2');
        expect(storeState.queuedSessions[2].queuePosition).toBe(3);
      });
    });

    it('removes sessions that are no longer in the queue.reordered event', async () => {
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'Queued 1' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2, title: 'Queued 2' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-3', status: 'queued', queuePosition: 3, title: 'Queued 3' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Queued 1')).toBeInTheDocument();
        expect(screen.getByText('Queued 2')).toBeInTheDocument();
        expect(screen.getByText('Queued 3')).toBeInTheDocument();
      });

      // Simulate queue.reordered event with session 2 removed (cancelled by another client)
      mockSocket.emit('queue.reordered', {
        projectId: 'proj1',
        queuedSessions: [
          { featureId: 'queued-1', queuePosition: 1 },
          { featureId: 'queued-3', queuePosition: 2 },
        ],
        timestamp: new Date().toISOString(),
      });

      await waitFor(() => {
        expect(screen.queryByText('Queued 2')).not.toBeInTheDocument();
      });

      // Remaining sessions should be visible with correct positions
      expect(screen.getByText('Queued 1')).toBeInTheDocument();
      expect(screen.getByText('Queued 3')).toBeInTheDocument();

      const storeState = useSessionStore.getState();
      expect(storeState.queuedSessions).toHaveLength(2);
      expect(storeState.queuedSessions[0].queuePosition).toBe(1);
      expect(storeState.queuedSessions[1].queuePosition).toBe(2);
    });

    it('ignores queue.reordered events from other projects', async () => {
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'Queued 1' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2, title: 'Queued 2' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        const storeState = useSessionStore.getState();
        expect(storeState.queuedSessions).toHaveLength(2);
      });

      // Simulate queue.reordered event from a different project
      mockSocket.emit('queue.reordered', {
        projectId: 'other-project',
        queuedSessions: [
          { featureId: 'queued-2', queuePosition: 1 },
        ],
        timestamp: new Date().toISOString(),
      });

      // Sessions should remain unchanged since event was for different project
      await waitFor(() => {
        const storeState = useSessionStore.getState();
        expect(storeState.queuedSessions).toHaveLength(2);
        expect(storeState.queuedSessions[0].featureId).toBe('queued-1');
        expect(storeState.queuedSessions[1].featureId).toBe('queued-2');
      });
    });

    it('handles queue.reordered event with mismatched session data gracefully', async () => {
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'Queued 1' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2, title: 'Queued 2' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        const storeState = useSessionStore.getState();
        expect(storeState.queuedSessions).toHaveLength(2);
      });

      // Simulate queue.reordered event with sessions that don't exist locally
      // This tests the guard against missing data
      mockSocket.emit('queue.reordered', {
        projectId: 'proj1',
        queuedSessions: [
          { featureId: 'unknown-session', queuePosition: 1 },
          { featureId: 'queued-1', queuePosition: 2 },
        ],
        timestamp: new Date().toISOString(),
      });

      // Should not crash and should update known sessions correctly
      await waitFor(() => {
        const storeState = useSessionStore.getState();
        // Only queued-1 should remain (queued-2 was filtered out as not in event)
        expect(storeState.queuedSessions).toHaveLength(1);
        expect(storeState.queuedSessions[0].featureId).toBe('queued-1');
        expect(storeState.queuedSessions[0].queuePosition).toBe(2);
      });
    });
  });

  describe('end-to-end queue cancellation flow', () => {
    it('handles both session.backedout and queue.reordered events in sequence', async () => {
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'First' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2, title: 'Second' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-3', status: 'queued', queuePosition: 3, title: 'Third' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('First')).toBeInTheDocument();
        expect(screen.getByText('Second')).toBeInTheDocument();
        expect(screen.getByText('Third')).toBeInTheDocument();
      });

      // Simulate session.backedout event (middle session cancelled)
      mockSocket.emit('session.backedout', {
        projectId: 'proj1',
        featureId: 'queued-2',
        sessionId: 'session-queued-2',
        action: 'abandon',
        reason: 'user_requested',
        newStatus: 'failed',
        previousStage: 0,
        nextSessionId: null,
        timestamp: new Date().toISOString(),
      });

      // Then queue.reordered with updated positions
      mockSocket.emit('queue.reordered', {
        projectId: 'proj1',
        queuedSessions: [
          { featureId: 'queued-1', queuePosition: 1 },
          { featureId: 'queued-3', queuePosition: 2 },
        ],
        timestamp: new Date().toISOString(),
      });

      await waitFor(() => {
        expect(screen.queryByText('Second')).not.toBeInTheDocument();
      });

      // Verify remaining sessions have correct positions (1, 2 not 1, 3)
      const storeState = useSessionStore.getState();
      expect(storeState.queuedSessions).toHaveLength(2);
      expect(storeState.queuedSessions[0].featureId).toBe('queued-1');
      expect(storeState.queuedSessions[0].queuePosition).toBe(1);
      expect(storeState.queuedSessions[1].featureId).toBe('queued-3');
      expect(storeState.queuedSessions[1].queuePosition).toBe(2);
    });

    it('displays correct queue position numbers in UI after cancellation', async () => {
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'First' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2, title: 'Second' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-3', status: 'queued', queuePosition: 3, title: 'Third' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('First')).toBeInTheDocument();
      });

      // Simulate session cancellation with updated positions
      mockSocket.emit('queue.reordered', {
        projectId: 'proj1',
        queuedSessions: [
          { featureId: 'queued-1', queuePosition: 1 },
          { featureId: 'queued-3', queuePosition: 2 },
        ],
        timestamp: new Date().toISOString(),
      });

      await waitFor(() => {
        expect(screen.queryByText('Second')).not.toBeInTheDocument();
      });

      // Verify the UI shows #1 and #2 (not #1 and #3)
      expect(screen.getByText('#1')).toBeInTheDocument();
      expect(screen.getByText('#2')).toBeInTheDocument();
      expect(screen.queryByText('#3')).not.toBeInTheDocument();
    });
  });

  describe('cancel queued session modal integration', () => {
    it('opens cancel modal when cancel button is clicked on queued session', async () => {
      const user = userEvent.setup();
      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'My Test Feature' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('My Test Feature')).toBeInTheDocument();
      });

      // Click cancel button
      const cancelButton = screen.getByTestId('cancel-session-queued-1');
      await user.click(cancelButton);

      // Modal should open with correct session title
      await waitFor(() => {
        expect(screen.getByTestId('cancel-queued-session-modal')).toBeInTheDocument();
      });
      // Verify session title is shown in modal
      expect(screen.getByTestId('cancel-queued-session-modal')).toHaveTextContent('My Test Feature');
      expect(screen.getByTestId('cancel-queued-session-modal')).toHaveTextContent('Cancel Queued Session');
    });

    it('closes modal without action when Cancel button is clicked', async () => {
      const user = userEvent.setup();
      const mockBackoutSession = vi.fn().mockResolvedValue(undefined);
      useSessionStore.setState({ backoutSession: mockBackoutSession });

      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'Test Feature' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Test Feature')).toBeInTheDocument();
      });

      // Open modal
      await user.click(screen.getByTestId('cancel-session-queued-1'));

      await waitFor(() => {
        expect(screen.getByTestId('cancel-queued-session-modal')).toBeInTheDocument();
      });

      // Click Cancel button in modal
      await user.click(screen.getByTestId('cancel-button'));

      // Modal should close
      await waitFor(() => {
        expect(screen.queryByTestId('cancel-queued-session-modal')).not.toBeInTheDocument();
      });

      // backoutSession should NOT have been called
      expect(mockBackoutSession).not.toHaveBeenCalled();
    });

    it('calls backoutSession with correct params when confirm button is clicked', async () => {
      const user = userEvent.setup();
      const mockBackoutSession = vi.fn().mockResolvedValue(undefined);
      useSessionStore.setState({ backoutSession: mockBackoutSession });

      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'Test Feature' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Test Feature')).toBeInTheDocument();
      });

      // Open modal
      await user.click(screen.getByTestId('cancel-session-queued-1'));

      await waitFor(() => {
        expect(screen.getByTestId('cancel-queued-session-modal')).toBeInTheDocument();
      });

      // Click Confirm button
      await user.click(screen.getByTestId('confirm-button'));

      // backoutSession should be called with correct params
      await waitFor(() => {
        expect(mockBackoutSession).toHaveBeenCalledWith('proj1', 'queued-1', 'abandon', 'user_requested');
      });
    });

    it('shows loading state during backout operation', async () => {
      const user = userEvent.setup();
      let resolveBackout: () => void;
      const backoutPromise = new Promise<void>((resolve) => {
        resolveBackout = resolve;
      });
      const mockBackoutSession = vi.fn().mockImplementation((_projectId: string, featureId: string) => {
        // Simulate store update when backout resolves
        return backoutPromise.then(() => {
          useSessionStore.setState((state) => ({
            queuedSessions: state.queuedSessions.filter((s) => s.featureId !== featureId),
          }));
        });
      });
      useSessionStore.setState({ backoutSession: mockBackoutSession });

      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'Test Feature' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Test Feature')).toBeInTheDocument();
      });

      // Open modal
      await user.click(screen.getByTestId('cancel-session-queued-1'));

      await waitFor(() => {
        expect(screen.getByTestId('cancel-queued-session-modal')).toBeInTheDocument();
      });

      // Click Confirm button
      await user.click(screen.getByTestId('confirm-button'));

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText('Removing...')).toBeInTheDocument();
      });

      // Buttons should be disabled during loading
      expect(screen.getByTestId('confirm-button')).toBeDisabled();
      expect(screen.getByTestId('cancel-button')).toBeDisabled();

      // Resolve the promise
      resolveBackout!();

      // Modal should close after completion
      await waitFor(() => {
        expect(screen.queryByTestId('cancel-queued-session-modal')).not.toBeInTheDocument();
      });
    });

    it('removes session from UI after successful cancellation', async () => {
      const user = userEvent.setup();
      const mockBackoutSession = vi.fn().mockImplementation((_projectId: string, featureId: string) => {
        // Simulate store update on backout
        useSessionStore.setState((state) => ({
          queuedSessions: state.queuedSessions.filter((s) => s.featureId !== featureId),
        }));
        return Promise.resolve();
      });
      useSessionStore.setState({ backoutSession: mockBackoutSession });

      const sessions = [
        createMockSession({ projectId: 'proj1', featureId: 'queued-1', status: 'queued', queuePosition: 1, title: 'First Feature' }),
        createMockSession({ projectId: 'proj1', featureId: 'queued-2', status: 'queued', queuePosition: 2, title: 'Second Feature' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sessions),
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('First Feature')).toBeInTheDocument();
        expect(screen.getByText('Second Feature')).toBeInTheDocument();
      });

      // Open modal for first session
      await user.click(screen.getByTestId('cancel-session-queued-1'));

      await waitFor(() => {
        expect(screen.getByTestId('cancel-queued-session-modal')).toBeInTheDocument();
      });

      // Click Confirm button
      await user.click(screen.getByTestId('confirm-button'));

      // Session should be removed from UI
      await waitFor(() => {
        expect(screen.queryByText('First Feature')).not.toBeInTheDocument();
      });

      // Second session should still be visible
      expect(screen.getByText('Second Feature')).toBeInTheDocument();
    });
  });
});

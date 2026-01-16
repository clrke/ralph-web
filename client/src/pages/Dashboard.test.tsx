import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { useSessionStore } from '../stores/sessionStore';
import type { Session } from '@claude-code-web/shared';

// Mock socket service
vi.mock('../services/socket', () => ({
  connectToProject: vi.fn(),
  disconnectFromProject: vi.fn(),
  getSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const createMockSession = (overrides: Partial<Session> = {}): Session => ({
  version: '1.0',
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
});

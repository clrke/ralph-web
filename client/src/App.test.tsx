import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { useSessionStore } from './stores/sessionStore';
import type { Session } from '@claude-code-web/shared';

// Mock fetch globally
beforeEach(() => {
  vi.restoreAllMocks();
  // Reset store state
  useSessionStore.setState({
    session: null,
    plan: null,
    questions: [],
    conversations: [],
    queuedSessions: [],
    isReorderingQueue: false,
    executionStatus: null,
    liveOutput: '',
    isOutputComplete: true,
    implementationProgress: null,
    isAwaitingClaudeResponse: false,
    isLoading: false,
    error: null,
  });
});

const mockQueuedSession: Session = {
  id: 'session-123',
  version: '1.0',
  dataVersion: 1,
  projectId: 'proj-abc',
  featureId: 'feat-xyz',
  title: 'Test Feature',
  featureDescription: 'Test description',
  projectPath: '/path/to/project',
  acceptanceCriteria: [],
  affectedFiles: [],
  technicalNotes: '',
  baseBranch: 'main',
  featureBranch: 'feature/test',
  baseCommitSha: 'abc123',
  status: 'queued',
  currentStage: 0,
  queuePosition: 1,
  queuedAt: '2024-01-01T00:00:00Z',
  replanningCount: 0,
  claudeSessionId: null,
  claudeStage3SessionId: null,
  claudePlanFilePath: null,
  currentPlanVersion: 0,
  prUrl: null,
  sessionExpiresAt: '2024-01-02T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('App routing', () => {
  describe('route configuration', () => {
    it('should render Dashboard at root path', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      );

      await waitFor(() => {
        // Dashboard renders "Claude Code Web" as the header
        expect(screen.getByText(/claude code web/i)).toBeInTheDocument();
      });
    });

    it('should render NewSession at /new path', () => {
      render(
        <MemoryRouter initialEntries={['/new']}>
          <App />
        </MemoryRouter>
      );

      expect(screen.getByText(/new feature session/i)).toBeInTheDocument();
    });

    it('should render EditSession at /session/:projectId/:featureId/edit path', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockQueuedSession),
      });

      render(
        <MemoryRouter initialEntries={['/session/proj-abc/feat-xyz/edit']}>
          <App />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/edit session/i)).toBeInTheDocument();
      });
    });

    it('should render SessionView at /session/:projectId/:featureId path', async () => {
      // SessionView makes multiple API calls - mock all of them
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/plan')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ steps: [] }),
          });
        }
        if (url.includes('/questions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ questions: [] }),
          });
        }
        if (url.includes('/conversations')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ entries: [] }),
          });
        }
        // Session fetch
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockQueuedSession, status: 'discovery' }),
        });
      });

      render(
        <MemoryRouter initialEntries={['/session/proj-abc/feat-xyz']}>
          <App />
        </MemoryRouter>
      );

      // SessionView shows the feature title after loading
      await waitFor(() => {
        expect(screen.getByText(/test feature/i)).toBeInTheDocument();
      });
    });

    it('should route to EditSession before SessionView for /edit path', async () => {
      // This tests that the edit route takes precedence
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockQueuedSession),
      });

      render(
        <MemoryRouter initialEntries={['/session/proj-abc/feat-xyz/edit']}>
          <App />
        </MemoryRouter>
      );

      await waitFor(() => {
        // Should show EditSession, not SessionView
        expect(screen.getByText(/edit session/i)).toBeInTheDocument();
        expect(screen.queryByText(/conversation/i)).not.toBeInTheDocument();
      });
    });
  });
});

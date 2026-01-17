import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import QueuedSessionsList from './QueuedSessionsList';
import type { Session } from '@claude-code-web/shared';

const createMockSession = (featureId: string, queuePosition: number): Session => ({
  id: `session-${featureId}`,
  version: '1.0',
  dataVersion: 1,
  projectId: 'test-project',
  featureId,
  title: `Feature ${featureId}`,
  featureDescription: 'Test description',
  projectPath: '/test/path',
  acceptanceCriteria: [],
  affectedFiles: [],
  technicalNotes: '',
  baseBranch: 'main',
  featureBranch: `feature/${featureId}`,
  baseCommitSha: 'abc123',
  status: 'queued',
  currentStage: 0,
  queuePosition,
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
});

const mockFormatRelativeTime = vi.fn(() => 'active just now');
const mockOnCancelSession = vi.fn();

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

describe('QueuedSessionsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnCancelSession.mockClear();
  });

  it('renders queued sessions in correct order', () => {
    const sessions = [
      createMockSession('feature-2', 2),
      createMockSession('feature-1', 1),
      createMockSession('feature-3', 3),
    ];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    const sessionCards = screen.getAllByTestId(/queued-session-/);
    expect(sessionCards).toHaveLength(3);

    // Should be sorted by queue position
    expect(sessionCards[0]).toHaveAttribute('data-testid', 'queued-session-feature-1');
    expect(sessionCards[1]).toHaveAttribute('data-testid', 'queued-session-feature-2');
    expect(sessionCards[2]).toHaveAttribute('data-testid', 'queued-session-feature-3');
  });

  it('displays queue position for each session', () => {
    const sessions = [
      createMockSession('feature-1', 1),
      createMockSession('feature-2', 2),
    ];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('displays session titles', () => {
    const sessions = [
      createMockSession('feature-1', 1),
      createMockSession('feature-2', 2),
    ];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    expect(screen.getByText('Feature feature-1')).toBeInTheDocument();
    expect(screen.getByText('Feature feature-2')).toBeInTheDocument();
  });

  it('shows drag handles when multiple sessions exist', () => {
    const sessions = [
      createMockSession('feature-1', 1),
      createMockSession('feature-2', 2),
    ];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    const dragHandles = screen.getAllByTestId('drag-handle');
    expect(dragHandles).toHaveLength(2);
  });

  it('does not show drag handles for single session', () => {
    const sessions = [createMockSession('feature-1', 1)];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    expect(screen.queryByTestId('drag-handle')).not.toBeInTheDocument();
  });

  it('renders empty list when no sessions', () => {
    renderWithRouter(
      <QueuedSessionsList
        sessions={[]}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    expect(screen.queryByTestId(/queued-session-/)).not.toBeInTheDocument();
  });

  it('links to correct session view URL', () => {
    const sessions = [createMockSession('my-feature', 1)];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/session/test-project/my-feature');
  });

  it('calls formatRelativeTime with session updatedAt', () => {
    const sessions = [createMockSession('feature-1', 1)];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    expect(mockFormatRelativeTime).toHaveBeenCalled();
    expect(screen.getByText('active just now')).toBeInTheDocument();
  });

  it('displays sortable list container when multiple sessions', () => {
    const sessions = [
      createMockSession('feature-1', 1),
      createMockSession('feature-2', 2),
    ];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    expect(screen.getByTestId('queued-sessions-list')).toBeInTheDocument();
  });

  it('does not render sortable container for single session', () => {
    const sessions = [createMockSession('feature-1', 1)];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    expect(screen.queryByTestId('queued-sessions-list')).not.toBeInTheDocument();
  });

  it('displays Queued status badge', () => {
    const sessions = [createMockSession('feature-1', 1)];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('displays project path', () => {
    const sessions = [createMockSession('feature-1', 1)];

    renderWithRouter(
      <QueuedSessionsList
        sessions={sessions}
        onReorder={vi.fn()}
        formatRelativeTime={mockFormatRelativeTime}
        onCancelSession={mockOnCancelSession}
      />
    );

    expect(screen.getByText('/test/path')).toBeInTheDocument();
  });

  describe('drag-and-drop behavior', () => {
    it('passes onReorder callback to be triggered on drag end', () => {
      const mockOnReorder = vi.fn().mockResolvedValue(undefined);
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
      ];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={mockOnReorder}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      // Verify drag handles are present (reordering is possible)
      const dragHandles = screen.getAllByTestId('drag-handle');
      expect(dragHandles).toHaveLength(2);

      // The onReorder prop is passed correctly (component renders without error)
      expect(mockOnReorder).not.toHaveBeenCalled();
    });

    it('disables pointer events when isReordering is true', () => {
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
      ];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
          isReordering={true}
        />
      );

      const sessionCards = screen.getAllByTestId(/queued-session-/);
      // When isReordering, cards should have pointer-events-none class
      sessionCards.forEach((card) => {
        expect(card).toHaveClass('pointer-events-none');
      });
    });

    it('enables pointer events when isReordering is false', () => {
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
      ];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
          isReordering={false}
        />
      );

      const sessionCards = screen.getAllByTestId(/queued-session-/);
      sessionCards.forEach((card) => {
        expect(card).not.toHaveClass('pointer-events-none');
      });
    });
  });

  describe('optimistic updates support', () => {
    it('re-renders with updated queue positions when sessions prop changes', () => {
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
      ];

      const { rerender } = renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      // Initial order: feature-1, feature-2
      let cards = screen.getAllByTestId(/queued-session-/);
      expect(cards[0]).toHaveAttribute('data-testid', 'queued-session-feature-1');
      expect(cards[1]).toHaveAttribute('data-testid', 'queued-session-feature-2');

      // Simulate optimistic update: swap positions
      const reorderedSessions = [
        { ...sessions[1], queuePosition: 1 },
        { ...sessions[0], queuePosition: 2 },
      ];

      rerender(
        <MemoryRouter>
          <QueuedSessionsList
            sessions={reorderedSessions}
            onReorder={vi.fn()}
            formatRelativeTime={mockFormatRelativeTime}
            onCancelSession={mockOnCancelSession}
          />
        </MemoryRouter>
      );

      // After reorder: feature-2, feature-1
      cards = screen.getAllByTestId(/queued-session-/);
      expect(cards[0]).toHaveAttribute('data-testid', 'queued-session-feature-2');
      expect(cards[1]).toHaveAttribute('data-testid', 'queued-session-feature-1');

      // Verify position badges update
      expect(screen.getByText('#1')).toBeInTheDocument();
      expect(screen.getByText('#2')).toBeInTheDocument();
    });

    it('handles empty sessions array during reordering', () => {
      renderWithRouter(
        <QueuedSessionsList
          sessions={[]}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
          isReordering={true}
        />
      );

      expect(screen.queryByTestId(/queued-session-/)).not.toBeInTheDocument();
    });

    it('maintains stable rendering during rapid updates', () => {
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
        createMockSession('feature-3', 3),
      ];

      const { rerender } = renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      // Simulate multiple rapid updates
      for (let i = 0; i < 5; i++) {
        const shuffled = [...sessions].sort(() => Math.random() - 0.5);
        shuffled.forEach((s, idx) => {
          s.queuePosition = idx + 1;
        });

        rerender(
          <MemoryRouter>
            <QueuedSessionsList
              sessions={shuffled}
              onReorder={vi.fn()}
              formatRelativeTime={mockFormatRelativeTime}
              onCancelSession={mockOnCancelSession}
            />
          </MemoryRouter>
        );

        // Should always render all 3 sessions
        const cards = screen.getAllByTestId(/queued-session-/);
        expect(cards).toHaveLength(3);
      }
    });
  });

  describe('error handling', () => {
    it('handles async onReorder error gracefully (component still renders)', async () => {
      const mockOnReorder = vi.fn().mockRejectedValue(new Error('Network error'));
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
      ];

      // Component should render without issues even if onReorder will fail
      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={mockOnReorder}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      // Sessions are rendered
      expect(screen.getByText('Feature feature-1')).toBeInTheDocument();
      expect(screen.getByText('Feature feature-2')).toBeInTheDocument();
    });

    it('displays sessions even when positions are null', () => {
      const sessionWithNullPosition = {
        ...createMockSession('feature-null', 1),
        queuePosition: null as unknown as number,
      };
      const sessions = [
        sessionWithNullPosition,
        createMockSession('feature-2', 2),
      ];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      // Both sessions should render
      expect(screen.getByText('Feature feature-null')).toBeInTheDocument();
      expect(screen.getByText('Feature feature-2')).toBeInTheDocument();
    });
  });

  describe('edit button', () => {
    it('renders edit button for each queued session', () => {
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
      ];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      expect(screen.getByTestId('edit-session-feature-1')).toBeInTheDocument();
      expect(screen.getByTestId('edit-session-feature-2')).toBeInTheDocument();
    });

    it('renders edit button for single session (no drag-and-drop)', () => {
      const sessions = [createMockSession('feature-1', 1)];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      expect(screen.getByTestId('edit-session-feature-1')).toBeInTheDocument();
    });

    it('edit button has correct aria-label', () => {
      const sessions = [createMockSession('my-feature', 1)];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      const editButton = screen.getByTestId('edit-session-my-feature');
      expect(editButton).toHaveAttribute('aria-label', 'Edit Feature my-feature');
    });

    it('navigates to edit page when edit button is clicked', async () => {
      const user = userEvent.setup();
      const sessions = [createMockSession('my-feature', 1)];

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <QueuedSessionsList
                  sessions={sessions}
                  onReorder={vi.fn()}
                  formatRelativeTime={mockFormatRelativeTime}
                  onCancelSession={mockOnCancelSession}
                />
              }
            />
            <Route
              path="/session/:projectId/:featureId/edit"
              element={<div data-testid="edit-page">Edit Page</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      const editButton = screen.getByTestId('edit-session-my-feature');
      await user.click(editButton);

      expect(screen.getByTestId('edit-page')).toBeInTheDocument();
    });

    it('clicking edit button does not navigate to session view', async () => {
      const user = userEvent.setup();
      const sessions = [createMockSession('my-feature', 1)];

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <QueuedSessionsList
                  sessions={sessions}
                  onReorder={vi.fn()}
                  formatRelativeTime={mockFormatRelativeTime}
                  onCancelSession={mockOnCancelSession}
                />
              }
            />
            <Route
              path="/session/:projectId/:featureId"
              element={<div data-testid="session-view">Session View</div>}
            />
            <Route
              path="/session/:projectId/:featureId/edit"
              element={<div data-testid="edit-page">Edit Page</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      const editButton = screen.getByTestId('edit-session-my-feature');
      await user.click(editButton);

      // Should navigate to edit page, not session view
      expect(screen.getByTestId('edit-page')).toBeInTheDocument();
      expect(screen.queryByTestId('session-view')).not.toBeInTheDocument();
    });

    it('edit button works in multi-session drag-and-drop mode', async () => {
      const user = userEvent.setup();
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
      ];

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <QueuedSessionsList
                  sessions={sessions}
                  onReorder={vi.fn()}
                  formatRelativeTime={mockFormatRelativeTime}
                  onCancelSession={mockOnCancelSession}
                />
              }
            />
            <Route
              path="/session/:projectId/:featureId/edit"
              element={<div data-testid="edit-page">Edit Page</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      // Click edit button on second session
      const editButton = screen.getByTestId('edit-session-feature-2');
      await user.click(editButton);

      expect(screen.getByTestId('edit-page')).toBeInTheDocument();
    });
  });

  describe('cancel button', () => {
    it('renders cancel button for each queued session', () => {
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
      ];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      expect(screen.getByTestId('cancel-session-feature-1')).toBeInTheDocument();
      expect(screen.getByTestId('cancel-session-feature-2')).toBeInTheDocument();
    });

    it('renders cancel button for single session (no drag-and-drop)', () => {
      const sessions = [createMockSession('feature-1', 1)];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      expect(screen.getByTestId('cancel-session-feature-1')).toBeInTheDocument();
    });

    it('cancel button has correct aria-label', () => {
      const sessions = [createMockSession('my-feature', 1)];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      const cancelButton = screen.getByTestId('cancel-session-my-feature');
      expect(cancelButton).toHaveAttribute('aria-label', 'Cancel Feature my-feature');
    });

    it('calls onCancelSession with session when cancel button is clicked', async () => {
      const user = userEvent.setup();
      const sessions = [createMockSession('my-feature', 1)];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      const cancelButton = screen.getByTestId('cancel-session-my-feature');
      await user.click(cancelButton);

      expect(mockOnCancelSession).toHaveBeenCalledTimes(1);
      expect(mockOnCancelSession).toHaveBeenCalledWith(sessions[0]);
    });

    it('clicking cancel button does not navigate to session view', async () => {
      const user = userEvent.setup();
      const sessions = [createMockSession('my-feature', 1)];

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <QueuedSessionsList
                  sessions={sessions}
                  onReorder={vi.fn()}
                  formatRelativeTime={mockFormatRelativeTime}
                  onCancelSession={mockOnCancelSession}
                />
              }
            />
            <Route
              path="/session/:projectId/:featureId"
              element={<div data-testid="session-view">Session View</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      const cancelButton = screen.getByTestId('cancel-session-my-feature');
      await user.click(cancelButton);

      // Should NOT navigate to session view
      expect(screen.queryByTestId('session-view')).not.toBeInTheDocument();
      // Should call the callback
      expect(mockOnCancelSession).toHaveBeenCalled();
    });

    it('cancel button works in multi-session drag-and-drop mode', async () => {
      const user = userEvent.setup();
      const sessions = [
        createMockSession('feature-1', 1),
        createMockSession('feature-2', 2),
      ];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      // Click cancel button on second session
      const cancelButton = screen.getByTestId('cancel-session-feature-2');
      await user.click(cancelButton);

      expect(mockOnCancelSession).toHaveBeenCalledTimes(1);
      expect(mockOnCancelSession).toHaveBeenCalledWith(sessions[1]);
    });

    it('cancel button has red hover style', () => {
      const sessions = [createMockSession('feature-1', 1)];

      renderWithRouter(
        <QueuedSessionsList
          sessions={sessions}
          onReorder={vi.fn()}
          formatRelativeTime={mockFormatRelativeTime}
          onCancelSession={mockOnCancelSession}
        />
      );

      const cancelButton = screen.getByTestId('cancel-session-feature-1');
      expect(cancelButton).toHaveClass('hover:bg-red-600');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QueuedSessionsList from './QueuedSessionsList';
import type { Session } from '@claude-code-web/shared';

const createMockSession = (featureId: string, queuePosition: number): Session => ({
  id: `session-${featureId}`,
  version: '1.0',
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

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

describe('QueuedSessionsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        />
      );

      // Both sessions should render
      expect(screen.getByText('Feature feature-null')).toBeInTheDocument();
      expect(screen.getByText('Feature feature-2')).toBeInTheDocument();
    });
  });
});

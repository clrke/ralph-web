import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SessionView from './SessionView';
import { useSessionStore } from '../stores/sessionStore';
import type { Session, Plan, PlanStep, UserPreferences } from '@claude-code-web/shared';
import userEvent from '@testing-library/user-event';

// Mock socket service
vi.mock('../services/socket', () => ({
  connectToSession: vi.fn(),
  disconnectFromSession: vi.fn(),
  getSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Wrapper to provide router context with params
const renderWithRouter = (ui: React.ReactElement, route = '/session/proj1/feat1') => {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/session/:projectId/:featureId" element={ui} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
};

// Helper to create a valid Session object
const createMockSession = (overrides: Partial<Session> = {}): Session => ({
  version: '1.0',
  id: 'sess1',
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
  acceptanceCriteria: [{ text: 'Test passes', checked: false, type: 'manual' }],
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

// Helper to create a valid PlanStep object
const createMockStep = (overrides: Partial<PlanStep>): PlanStep => ({
  id: 'step-1',
  parentId: null,
  orderIndex: 0,
  title: 'Test Step',
  description: 'Test description',
  status: 'pending',
  metadata: {},
  complexity: 'medium',
  ...overrides,
});

const mockSession = createMockSession();

describe('SessionView', () => {
  const originalFetchSession = useSessionStore.getState().fetchSession;
  const originalFetchConversations = useSessionStore.getState().fetchConversations;

  beforeEach(() => {
    vi.restoreAllMocks();

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
      fetchSession: vi.fn(),
      fetchConversations: vi.fn(),
    });
  });

  afterEach(() => {
    useSessionStore.setState({
      fetchSession: originalFetchSession,
      fetchConversations: originalFetchConversations,
    });
    vi.restoreAllMocks();
  });

  describe('StageStatusBadge integration', () => {
    it('renders StageStatusBadge with session stage', async () => {
      useSessionStore.setState({
        session: mockSession,
        isLoading: false,
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        const badge = screen.getByRole('status');
        expect(badge).toHaveAttribute('aria-label', expect.stringContaining('Stage 1'));
        expect(badge).toHaveAttribute('aria-label', expect.stringContaining('Discovery'));
      });
    });

    it('renders StageStatusBadge with execution status action', async () => {
      useSessionStore.setState({
        session: mockSession,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage1_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 1,
        },
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Stage 1/i)).toBeInTheDocument();
      });
    });

    it('renders StageStatusBadge with subState', async () => {
      useSessionStore.setState({
        session: mockSession,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage1_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 1,
          subState: 'spawning_agent',
        },
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Stage 1/i)).toBeInTheDocument();
      });
    });

    it('updates StageStatusBadge when executionStatus changes', async () => {
      useSessionStore.setState({
        session: mockSession,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage1_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 1,
        },
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Stage 1/i)).toBeInTheDocument();
      });

      useSessionStore.setState({
        session: createMockSession({ currentStage: 2, status: 'planning' }),
        executionStatus: {
          status: 'running',
          action: 'stage2_started',
          timestamp: '2024-01-01T00:01:00Z',
          stage: 2,
          subState: 'spawning_agent',
        },
      });

      await waitFor(() => {
        expect(screen.getByText(/Stage 2/i)).toBeInTheDocument();
      });
    });

    it('renders StageStatusBadge with idle status', async () => {
      useSessionStore.setState({
        session: createMockSession({ currentStage: 2, status: 'planning' }),
        isLoading: false,
        executionStatus: {
          status: 'idle',
          action: 'stage2_complete',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 2,
        },
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Stage 2/i)).toBeInTheDocument();
      });
    });

    it('renders StageStatusBadge with error status', async () => {
      useSessionStore.setState({
        session: mockSession,
        isLoading: false,
        executionStatus: {
          status: 'error',
          action: 'stage1_error',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 1,
        },
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Stage 1/i)).toBeInTheDocument();
      });
    });

    it.skip('renders StageStatusBadge for stage 3 with progress', async () => {
      const stage3Session = createMockSession({ currentStage: 3, status: 'implementing' });

      useSessionStore.setState({
        session: stage3Session,
        isLoading: false,
        plan: {
          version: '1.0',
          planVersion: 1,
          sessionId: 'sess1',
          isApproved: true,
          reviewCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          steps: [],
        },
        executionStatus: {
          status: 'running',
          action: 'stage3_progress',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 3,
          subState: 'processing_output',
          stepId: 'step-1',
          progress: { current: 2, total: 5 },
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      const storeState = useSessionStore.getState();
      expect(storeState.session?.currentStage).toBe(3);

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Stage 3/i)).toBeInTheDocument();
        expect(screen.getByText(/Implementation/i)).toBeInTheDocument();
      });
    });

    it.skip('renders StageStatusBadge without executionStatus', async () => {
      const stage4Session = createMockSession({ currentStage: 4, status: 'pr_creation' });

      useSessionStore.setState({
        session: stage4Session,
        isLoading: false,
        executionStatus: null,
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      const storeState = useSessionStore.getState();
      expect(storeState.session?.currentStage).toBe(4);

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Stage 4/i)).toBeInTheDocument();
      });
    });
  });

  describe('loading and error states', () => {
    it('shows loading spinner when loading', () => {
      useSessionStore.setState({
        session: null,
        isLoading: true,
      });

      renderWithRouter(<SessionView />);

      expect(screen.getByText(/Loading session/i)).toBeInTheDocument();
    });

    it('shows error message when session is null and not loading', async () => {
      useSessionStore.setState({
        session: null,
        error: 'Session not found',
        isLoading: false,
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Session not found/i)).toBeInTheDocument();
      });
    });
  });

  describe('ImplementationSection step progress indicator', () => {
    const stage3Session = createMockSession({ currentStage: 3, status: 'implementing' });

    const mockPlan: Plan = {
      version: '1.0',
      planVersion: 1,
      sessionId: 'sess1',
      isApproved: true,
      reviewCount: 0,
      createdAt: '2024-01-01T00:00:00Z',
      steps: [
        createMockStep({ id: 'step-1', orderIndex: 0, title: 'Setup project structure', description: 'Create folders', status: 'completed', complexity: 'low' }),
        createMockStep({ id: 'step-2', orderIndex: 1, title: 'Implement core logic', description: 'Write main code', status: 'in_progress', complexity: 'medium' }),
        createMockStep({ id: 'step-3', orderIndex: 2, title: 'Add tests', description: 'Write tests', status: 'pending', complexity: 'medium' }),
        createMockStep({ id: 'step-4', orderIndex: 3, title: 'Update documentation', description: 'Add docs', status: 'pending', complexity: 'low' }),
      ],
    };

    it('shows step progress indicator when step is active', async () => {
      useSessionStore.setState({
        session: stage3Session,
        plan: mockPlan,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage3_progress',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 3,
          stepId: 'step-2',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      // Check for the step progress indicator title - use getAllByText since step title appears in multiple places
      await waitFor(() => {
        const stepTexts = screen.getAllByText(/Implement core logic/i);
        expect(stepTexts.length).toBeGreaterThanOrEqual(1);
      });

      // Verify the step indicator banner is shown by checking for its parent container class
      const stepBanner = document.querySelector('.bg-blue-900\\/30.border-blue-500\\/30');
      expect(stepBanner).toBeInTheDocument();
    });

    it('shows retry count badge when retryCount > 0', async () => {
      useSessionStore.setState({
        session: stage3Session,
        plan: mockPlan,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage3_progress',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 3,
          stepId: 'step-2',
        },
        implementationProgress: {
          stepId: 'step-2',
          status: 'in_progress',
          filesModified: [],
          testsStatus: null,
          retryCount: 2,
          message: 'Retrying...',
          timestamp: '2024-01-01T00:00:00Z',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        // Look for retry badge - find span with yellow styling containing retry info
        const retryBadge = document.querySelector('.text-yellow-400.bg-yellow-900\\/30');
        expect(retryBadge).toBeInTheDocument();
        expect(retryBadge?.textContent).toContain('Retry');
        expect(retryBadge?.textContent).toContain('2/3');
      });
    });

    it('does not show step progress indicator when idle', async () => {
      useSessionStore.setState({
        session: stage3Session,
        plan: mockPlan,
        isLoading: false,
        executionStatus: {
          status: 'idle',
          action: 'stage3_complete',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 3,
          stepId: 'step-2',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      // Wait for component to render - use heading selector to be specific
      await waitFor(() => {
        const heading = screen.getByRole('heading', { name: /Implementation Progress/i });
        expect(heading).toBeInTheDocument();
      });

      // The step progress indicator banner should not be visible when idle
      // The banner uses bg-blue-900/30 class and has the step label
      const stepLabel = document.querySelector('.text-blue-300.font-medium');
      expect(stepLabel).not.toBeInTheDocument();
    });

    it('shows sub-task progress when available', async () => {
      useSessionStore.setState({
        session: stage3Session,
        plan: mockPlan,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage3_progress',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 3,
          stepId: 'step-2',
          progress: { current: 3, total: 5 },
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        // Check for sub-task progress label
        expect(screen.getByText(/Sub-task progress/i)).toBeInTheDocument();
      });
    });

    it('renders plan steps in timeline view', async () => {
      useSessionStore.setState({
        session: stage3Session,
        plan: mockPlan,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage3_progress',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 3,
          stepId: 'step-2',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      // Wait for component to render and check step titles appear
      // Use getAllByText since some step titles may appear multiple times (in progress banner + timeline)
      await waitFor(() => {
        expect(screen.getAllByText(/Setup project structure/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/Implement core logic/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/Add tests/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/Update documentation/i).length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('loading state context-aware messages', () => {
    it('shows context-aware loading message for stage 1 spawning_agent', async () => {
      useSessionStore.setState({
        session: mockSession,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage1_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 1,
          subState: 'spawning_agent',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Starting Claude agent for codebase analysis/i)).toBeInTheDocument();
      });
    });

    it('shows context-aware loading message for stage 1 processing_output', async () => {
      useSessionStore.setState({
        session: mockSession,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage1_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 1,
          subState: 'processing_output',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Analyzing project structure and gathering context/i)).toBeInTheDocument();
      });
    });

    it('shows context-aware loading message for stage 1 validating_output', async () => {
      useSessionStore.setState({
        session: mockSession,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage1_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 1,
          subState: 'validating_output',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Validating analysis results/i)).toBeInTheDocument();
      });
    });

    it('shows context-aware loading message for stage 2 spawning_agent', async () => {
      const stage2Session = createMockSession({ currentStage: 2, status: 'planning' });

      useSessionStore.setState({
        session: stage2Session,
        plan: {
          version: '1.0',
          planVersion: 1,
          sessionId: 'sess1',
          isApproved: false,
          reviewCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          steps: [],
        },
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage2_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 2,
          subState: 'spawning_agent',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Starting Claude agent for plan review/i)).toBeInTheDocument();
      });
    });

    it('shows context-aware loading message for stage 2 validating_output', async () => {
      const stage2Session = createMockSession({ currentStage: 2, status: 'planning' });

      useSessionStore.setState({
        session: stage2Session,
        plan: {
          version: '1.0',
          planVersion: 1,
          sessionId: 'sess1',
          isApproved: false,
          reviewCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          steps: [],
        },
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage2_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 2,
          subState: 'validating_output',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Validating plan structure and completeness/i)).toBeInTheDocument();
      });
    });

    it('shows context-aware loading message for stage 4 processing_output', async () => {
      const stage4Session = createMockSession({ currentStage: 4, status: 'pr_creation' });

      useSessionStore.setState({
        session: stage4Session,
        plan: {
          version: '1.0',
          planVersion: 1,
          sessionId: 'sess1',
          isApproved: true,
          reviewCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          steps: [
            createMockStep({ id: 'step-1', orderIndex: 0, title: 'Test Step', status: 'completed' }),
          ],
        },
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage4_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 4,
          subState: 'processing_output',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Generating PR description and summary/i)).toBeInTheDocument();
      });
    });

    it('shows context-aware loading message for stage 4 spawning_agent', async () => {
      const stage4Session = createMockSession({ currentStage: 4, status: 'pr_creation' });

      useSessionStore.setState({
        session: stage4Session,
        plan: {
          version: '1.0',
          planVersion: 1,
          sessionId: 'sess1',
          isApproved: true,
          reviewCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          steps: [
            createMockStep({ id: 'step-1', orderIndex: 0, title: 'Test Step', status: 'completed' }),
          ],
        },
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage4_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 4,
          subState: 'spawning_agent',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Starting Claude agent for PR creation/i)).toBeInTheDocument();
      });
    });

    it('shows context-aware loading message for stage 5 processing_output', async () => {
      const stage5Session = createMockSession({ currentStage: 5, status: 'pr_review' });

      useSessionStore.setState({
        session: stage5Session,
        plan: {
          version: '1.0',
          planVersion: 1,
          sessionId: 'sess1',
          isApproved: true,
          reviewCount: 0,
          createdAt: '2024-01-01T00:00:00Z',
          steps: [
            createMockStep({ id: 'step-1', orderIndex: 0, title: 'Test Step', status: 'completed' }),
          ],
        },
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage5_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 5,
          subState: 'processing_output',
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByText(/Analyzing CI results and PR feedback/i)).toBeInTheDocument();
      });
    });

    it('shows default loading message when no subState is set', async () => {
      useSessionStore.setState({
        session: mockSession,
        isLoading: false,
        executionStatus: {
          status: 'running',
          action: 'stage1_started',
          timestamp: '2024-01-01T00:00:00Z',
          stage: 1,
        },
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        // Without subState, it should show the default message for stage 1
        expect(screen.getByText(/Claude is analyzing your project/i)).toBeInTheDocument();
      });
    });
  });

  describe('preferences display', () => {
    const mockPreferences: UserPreferences = {
      riskComfort: 'high',
      speedVsQuality: 'quality',
      scopeFlexibility: 'open',
      detailLevel: 'detailed',
      autonomyLevel: 'autonomous',
    };

    it('does not show preferences button when session has no preferences', async () => {
      useSessionStore.setState({
        session: createMockSession({ preferences: undefined }),
        isLoading: false,
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Test Feature/i })).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /preferences/i })).not.toBeInTheDocument();
    });

    it('shows collapsed preferences button when session has preferences', async () => {
      useSessionStore.setState({
        session: createMockSession({ preferences: mockPreferences }),
        isLoading: false,
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /preferences/i })).toBeInTheDocument();
      });

      // Badges should not be visible when collapsed
      expect(screen.queryByTestId('preferences-badges')).not.toBeInTheDocument();
    });

    it('expands preferences to show badges when clicked', async () => {
      const user = userEvent.setup();

      useSessionStore.setState({
        session: createMockSession({ preferences: mockPreferences }),
        isLoading: false,
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /preferences/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /preferences/i }));

      await waitFor(() => {
        expect(screen.getByTestId('preferences-badges')).toBeInTheDocument();
      });

      // Check that all 5 badges are rendered by counting badges in the container
      const badgesContainer = screen.getByTestId('preferences-badges');
      const badges = badgesContainer.querySelectorAll('span.inline-flex');
      expect(badges.length).toBe(5);
    });

    it('shows correct preference labels', async () => {
      const user = userEvent.setup();

      useSessionStore.setState({
        session: createMockSession({ preferences: mockPreferences }),
        isLoading: false,
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /preferences/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /preferences/i }));

      await waitFor(() => {
        expect(screen.getByText(/Risk:/i)).toBeInTheDocument();
        expect(screen.getByText(/Speed\/Quality:/i)).toBeInTheDocument();
        expect(screen.getByText(/Scope:/i)).toBeInTheDocument();
        expect(screen.getByText(/Detail:/i)).toBeInTheDocument();
        expect(screen.getByText(/Autonomy:/i)).toBeInTheDocument();
      });
    });

    it('collapses preferences when clicked again', async () => {
      const user = userEvent.setup();

      useSessionStore.setState({
        session: createMockSession({ preferences: mockPreferences }),
        isLoading: false,
        fetchSession: vi.fn(),
        fetchConversations: vi.fn(),
      });

      renderWithRouter(<SessionView />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /preferences/i })).toBeInTheDocument();
      });

      // Expand
      await user.click(screen.getByRole('button', { name: /preferences/i }));
      await waitFor(() => {
        expect(screen.getByTestId('preferences-badges')).toBeInTheDocument();
      });

      // Collapse
      await user.click(screen.getByRole('button', { name: /preferences/i }));
      await waitFor(() => {
        expect(screen.queryByTestId('preferences-badges')).not.toBeInTheDocument();
      });
    });
  });
});

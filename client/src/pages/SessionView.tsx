import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useSessionStore, type ExecutionStatus } from '../stores/sessionStore';
import BackoutModal from '../components/BackoutModal';
import type { BackoutAction, BackoutReason } from '@claude-code-web/shared';
import { TimelineView } from '../components/PlanEditor';
import { ConversationPanel } from '../components/ConversationPanel';
import { connectToSession, disconnectFromSession, getSocket } from '../services/socket';
import type {
  ImplementationProgressEvent,
  PlanUpdatedEvent,
  QuestionsBatchEvent,
  ExecutionStatusEvent,
  ClaudeOutputEvent,
  StageChangedEvent,
  StepStartedEvent,
  StepCompletedEvent,
  Session,
  Plan,
  PlanStep,
  Question,
  ComposablePlan,
  PlanValidationStatus,
  UserPreferences,
} from '@claude-code-web/shared';
import { ComplexityBadge } from '../components/PlanEditor/PlanNode';
import { StageStatusBadge } from '../components/StageStatusBadge';
import type { ExecutionSubState } from '@claude-code-web/shared';

/**
 * Human-readable loading messages for sub-state values by stage.
 */
const SUBSTATE_LOADING_MESSAGES: Partial<Record<ExecutionSubState, Record<number, string>>> = {
  spawning_agent: {
    1: 'Starting Claude agent for codebase analysis...',
    2: 'Starting Claude agent for plan review...',
    3: 'Starting Claude agent for implementation...',
    4: 'Starting Claude agent for PR creation...',
    5: 'Starting Claude agent for PR review...',
    6: 'Processing final approval...',
    7: 'Finalizing session...',
  },
  processing_output: {
    1: 'Analyzing project structure and gathering context...',
    2: 'Analyzing plan and generating feedback...',
    3: 'Implementing changes...',
    4: 'Generating PR description and summary...',
    5: 'Analyzing CI results and PR feedback...',
    6: 'Processing approval decision...',
    7: 'Completing session...',
  },
  parsing_response: {
    1: 'Processing discovery findings...',
    2: 'Processing review findings...',
    3: 'Processing implementation results...',
    4: 'Processing PR details...',
    5: 'Processing review comments...',
    6: 'Processing approval response...',
    7: 'Processing completion status...',
  },
  validating_output: {
    1: 'Validating analysis results...',
    2: 'Validating plan structure and completeness...',
    3: 'Validating implementation changes...',
    4: 'Verifying PR was created successfully...',
    5: 'Validating review completeness...',
    6: 'Validating approval...',
    7: 'Validating completion...',
  },
  saving_results: {
    1: 'Saving discovery findings...',
    2: 'Saving review results...',
    3: 'Saving implementation progress...',
    4: 'Saving PR information...',
    5: 'Saving review results...',
    6: 'Saving approval decision...',
    7: 'Saving final session state...',
  },
};

/**
 * Get a context-aware loading message based on sub-state and stage.
 */
function getLoadingMessage(subState: ExecutionSubState | undefined, stage: number, defaultMessage: string): string {
  if (!subState) return defaultMessage;
  const stageMessages = SUBSTATE_LOADING_MESSAGES[subState];
  if (!stageMessages) return defaultMessage;
  return stageMessages[stage] || defaultMessage;
}

const STAGE_LABELS: Record<number, string> = {
  1: 'Feature Discovery',
  2: 'Plan Review',
  3: 'Implementation',
  4: 'PR Creation',
  5: 'PR Review',
  6: 'Final Approval',
};

const RETRY_MIN_IDLE_MINUTES = 5; // Minimum minutes idle before retry is enabled
const RETRY_COOLDOWN_MS = 30000; // 30 second cooldown after clicking retry

/**
 * Smart retry button with safeguards against accidental double-clicks
 */
function RetryButton({
  executionStatus,
  unansweredQuestionsCount,
  currentStage,
  isRetrying,
  onRetry,
  lastActivityTimestamp,
}: {
  executionStatus: { status: string; timestamp: string } | null;
  unansweredQuestionsCount: number;
  currentStage: number;
  isRetrying: boolean;
  onRetry: () => Promise<void>;
  /** Timestamp of the last conversation entry (actual Claude activity) */
  lastActivityTimestamp: string | null;
}) {
  const [lastRetryTime, setLastRetryTime] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Update current time every 10 seconds to recalculate idle duration
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  // Don't show if running, has questions, or completed
  if (executionStatus?.status === 'running' || unansweredQuestionsCount > 0 || currentStage >= 6) {
    return null;
  }

  // Calculate how long since last actual Claude activity (from conversations, not execution status)
  // Use the more recent of lastRetryTime or lastActivityTimestamp to reset idle after clicking retry
  const lastActivityTime = lastActivityTimestamp ? new Date(lastActivityTimestamp).getTime() : null;
  const effectiveLastActivity = lastRetryTime && (!lastActivityTime || lastRetryTime > lastActivityTime)
    ? lastRetryTime
    : lastActivityTime;
  const idleMinutes = effectiveLastActivity ? Math.floor((now - effectiveLastActivity) / 60000) : 0;
  const isIdleLongEnough = idleMinutes >= RETRY_MIN_IDLE_MINUTES;

  // Check cooldown
  const isInCooldown = lastRetryTime !== null && (now - lastRetryTime) < RETRY_COOLDOWN_MS;
  const cooldownRemaining = lastRetryTime ? Math.ceil((RETRY_COOLDOWN_MS - (now - lastRetryTime)) / 1000) : 0;

  // Determine if button should be disabled
  const isDisabled = isRetrying || !isIdleLongEnough || isInCooldown;

  // Build tooltip message
  let tooltipMessage = 'Retry current stage if session appears stuck';
  if (!isIdleLongEnough) {
    tooltipMessage = `Wait ${RETRY_MIN_IDLE_MINUTES - idleMinutes} more minute(s) before retrying (idle: ${idleMinutes}m)`;
  } else if (isInCooldown) {
    tooltipMessage = `Cooldown: ${cooldownRemaining}s remaining`;
  }

  const handleClick = async () => {
    // Confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to retry?\n\nThis will restart the current stage. Only use this if the session appears stuck.\n\nIdle time: ${idleMinutes} minutes`
    );
    if (!confirmed) return;

    setLastRetryTime(Date.now());
    await onRetry();
  };

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className={`px-3 py-1 rounded-full text-sm transition-colors flex items-center gap-2 ${
        isDisabled
          ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
          : 'bg-yellow-600 hover:bg-yellow-700 text-white'
      }`}
      title={tooltipMessage}
    >
      {isRetrying ? (
        <>
          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Retrying...
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Retry {isIdleLongEnough ? `(${idleMinutes}m idle)` : `(${idleMinutes}/${RETRY_MIN_IDLE_MINUTES}m)`}
        </>
      )}
    </button>
  );
}

/**
 * Preference labels for display
 */
const PREFERENCE_LABELS: Record<keyof UserPreferences, string> = {
  riskComfort: 'Risk',
  speedVsQuality: 'Speed/Quality',
  scopeFlexibility: 'Scope',
  detailLevel: 'Detail',
  autonomyLevel: 'Autonomy',
};

/**
 * Badge-style display for a single preference value
 */
function PreferenceBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-gray-700 text-xs">
      <span className="text-gray-400">{label}:</span>
      <span className="text-gray-200 capitalize">{value}</span>
    </span>
  );
}

/**
 * Collapsible read-only preferences display
 */
function PreferencesDisplay({ preferences }: { preferences: UserPreferences }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-300 transition-colors"
        aria-expanded={expanded}
      >
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Preferences
      </button>
      {expanded && (
        <div className="mt-2 flex flex-wrap gap-2" data-testid="preferences-badges">
          {(Object.entries(preferences) as [keyof UserPreferences, string][]).map(([key, value]) => (
            <PreferenceBadge key={key} label={PREFERENCE_LABELS[key]} value={value} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SessionView() {
  const { projectId, featureId } = useParams<{ projectId: string; featureId: string }>();
  const {
    session,
    plan,
    questions,
    conversations,
    isLoading,
    error,
    executionStatus,
    fetchSession,
    fetchConversations,
    setSession,
    setPlan,
    addQuestion,
    setExecutionStatus,
    appendLiveOutput,
    updateStepStatus,
    setImplementationProgress,
    retrySession,
    backoutSession,
    resumeSession,
  } = useSessionStore();

  const navigate = useNavigate();

  // Modal state (must be before early returns to maintain hooks order)
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [showBackoutModal, setShowBackoutModal] = useState(false);
  const [isBackingOut, setIsBackingOut] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  // Socket.IO event handlers
  const handleExecutionStatus = useCallback((data: ExecutionStatusEvent) => {
    // Skip intermediate updates to prevent UI flickering from rapid updates
    if (data.isIntermediate) return;
    setExecutionStatus(data);

    // Update session status when session is completed (Stage 7)
    if (data.action === 'session_completed') {
      const currentSession = useSessionStore.getState().session;
      if (currentSession) {
        setSession({ ...currentSession, status: 'completed', currentStage: 7 });
      }
    }
  }, [setExecutionStatus, setSession]);

  const handleClaudeOutput = useCallback((data: ClaudeOutputEvent) => {
    appendLiveOutput(data.output, data.isComplete);
    // Refresh conversations when output is complete
    if (data.isComplete && projectId && featureId) {
      fetchConversations(projectId, featureId);
    }
  }, [appendLiveOutput, fetchConversations, projectId, featureId]);

  const handleQuestionsBatch = useCallback((data: QuestionsBatchEvent) => {
    // Add new questions to the list
    data.questions.forEach(q => addQuestion(q));
  }, [addQuestion]);

  const handlePlanUpdated = useCallback((data: PlanUpdatedEvent) => {
    const currentPlan = useSessionStore.getState().plan;
    if (currentPlan) {
      setPlan({ ...currentPlan, ...data });
    }
  }, [setPlan]);

  const handleStageChanged = useCallback((data: StageChangedEvent) => {
    const currentSession = useSessionStore.getState().session;
    if (currentSession) {
      setSession({ ...currentSession, currentStage: data.currentStage, status: data.status as Session['status'] });
    }
  }, [setSession]);

  // Stage 3 event handlers
  const handleStepStarted = useCallback((data: StepStartedEvent) => {
    updateStepStatus(data.stepId, 'in_progress');
  }, [updateStepStatus]);

  const handleStepCompleted = useCallback((data: StepCompletedEvent) => {
    updateStepStatus(data.stepId, data.status);
  }, [updateStepStatus]);

  const handleImplementationProgress = useCallback((data: ImplementationProgressEvent) => {
    setImplementationProgress(data);
  }, [setImplementationProgress]);

  // Stage transition handler
  const handleTransition = useCallback(async (targetStage: number) => {
    if (!projectId || !featureId || isTransitioning) return;

    setIsTransitioning(true);
    try {
      const response = await fetch(`/api/sessions/${projectId}/${featureId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStage }),
      });

      if (!response.ok) {
        throw new Error('Failed to transition stage');
      }

      const updatedSession = await response.json();
      setSession(updatedSession);
    } catch (error) {
      console.error('Stage transition failed:', error);
    } finally {
      setIsTransitioning(false);
    }
  }, [projectId, featureId, isTransitioning, setSession]);

  // Backout handler
  const handleBackout = useCallback(async (action: BackoutAction, reason: BackoutReason) => {
    if (!projectId || !featureId) return;

    setIsBackingOut(true);
    try {
      await backoutSession(projectId, featureId, action, reason);
      setShowBackoutModal(false);
      // Navigate to dashboard after successful backout
      navigate('/');
    } catch (error) {
      console.error('Backout failed:', error);
    } finally {
      setIsBackingOut(false);
    }
  }, [projectId, featureId, backoutSession, navigate]);

  // Resume handler
  const handleResume = useCallback(async () => {
    if (!projectId || !featureId) return;

    setIsResuming(true);
    try {
      await resumeSession(projectId, featureId);
    } catch (error) {
      console.error('Resume failed:', error);
    } finally {
      setIsResuming(false);
    }
  }, [projectId, featureId, resumeSession]);

  // Fetch session data and conversations
  useEffect(() => {
    if (projectId && featureId) {
      fetchSession(projectId, featureId);
      fetchConversations(projectId, featureId);
    }
  }, [projectId, featureId, fetchSession, fetchConversations]);

  // Socket.IO connection
  useEffect(() => {
    if (!projectId || !featureId) return;

    connectToSession(projectId, featureId);
    const socket = getSocket();

    socket.on('execution.status', handleExecutionStatus);
    socket.on('claude.output', handleClaudeOutput);
    socket.on('questions.batch', handleQuestionsBatch);
    socket.on('plan.updated', handlePlanUpdated);
    socket.on('stage.changed', handleStageChanged);
    socket.on('step.started', handleStepStarted);
    socket.on('step.completed', handleStepCompleted);
    socket.on('implementation.progress', handleImplementationProgress);

    return () => {
      socket.off('execution.status', handleExecutionStatus);
      socket.off('claude.output', handleClaudeOutput);
      socket.off('questions.batch', handleQuestionsBatch);
      socket.off('plan.updated', handlePlanUpdated);
      socket.off('stage.changed', handleStageChanged);
      socket.off('step.started', handleStepStarted);
      socket.off('step.completed', handleStepCompleted);
      socket.off('implementation.progress', handleImplementationProgress);
      disconnectFromSession(projectId, featureId);
    };
  }, [projectId, featureId, handleExecutionStatus, handleClaudeOutput, handleQuestionsBatch, handlePlanUpdated, handleStageChanged, handleStepStarted, handleStepCompleted, handleImplementationProgress]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading session...</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || 'Session not found'}</p>
          <Link to="/" className="text-blue-400 hover:text-blue-300">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const unansweredQuestions = questions.filter(q => !q.answeredAt);
  const currentStage = session.currentStage;

  return (
    <>
    {/* Plan Modal */}
    {showPlanModal && plan && (
      <PlanModal plan={plan} onClose={() => setShowPlanModal(false)} />
    )}
    {/* Backout Modal */}
    <BackoutModal
      isOpen={showBackoutModal}
      onClose={() => setShowBackoutModal(false)}
      onConfirm={handleBackout}
      sessionTitle={session.title}
      isLoading={isBackingOut}
    />
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <Link to="/" className="text-gray-400 hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          {session.status === 'queued' ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-yellow-600/20 text-yellow-300 border-yellow-500/30">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">Queued</span>
              {session.queuePosition && (
                <span className="text-sm opacity-80">#{session.queuePosition} in queue</span>
              )}
            </div>
          ) : session.status === 'paused' ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-orange-600/20 text-orange-300 border-orange-500/30" data-testid="paused-badge">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">On Hold</span>
            </div>
          ) : session.status === 'failed' ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-red-600/20 text-red-300 border-red-500/30" data-testid="failed-badge">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">Abandoned</span>
            </div>
          ) : currentStage === 7 || session.status === 'completed' ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-green-600/20 text-green-300 border-green-500/30">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">Stage 7: Completed</span>
            </div>
          ) : (
            <StageStatusBadge
              stage={currentStage}
              action={executionStatus?.action}
              subState={executionStatus?.subState}
              status={executionStatus?.status ?? 'idle'}
            />
          )}
          {/* Retry button - show when session appears stuck */}
          <RetryButton
            executionStatus={executionStatus}
            unansweredQuestionsCount={unansweredQuestions.length}
            currentStage={currentStage}
            isRetrying={isRetrying}
            onRetry={async () => {
              setIsRetrying(true);
              try {
                await retrySession();
              } finally {
                setIsRetrying(false);
              }
            }}
            lastActivityTimestamp={
              conversations.length > 0
                ? conversations[conversations.length - 1].timestamp
                : null
            }
          />
          {/* Back Out button - visible for active sessions in stages 1-6 */}
          {currentStage >= 1 && currentStage <= 6 && session.status !== 'paused' && session.status !== 'failed' && session.status !== 'completed' && session.status !== 'queued' && (
            <button
              onClick={() => setShowBackoutModal(true)}
              className="px-3 py-1 rounded-full text-sm transition-colors flex items-center gap-2 bg-gray-600 hover:bg-gray-500 text-white"
              data-testid="backout-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Back Out
            </button>
          )}
          {/* Resume button - visible for paused sessions */}
          {session.status === 'paused' && (
            <button
              onClick={handleResume}
              disabled={isResuming}
              className={`px-3 py-1 rounded-full text-sm transition-colors flex items-center gap-2 ${
                isResuming
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-500 text-white'
              }`}
              data-testid="resume-button"
            >
              {isResuming ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Resuming...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Resume Session
                </>
              )}
            </button>
          )}
        </div>
        <h1 className="text-3xl font-bold">{session.title}</h1>
        <p className="text-gray-400 mt-2 line-clamp-2" title={session.featureDescription}>
          {session.featureDescription}
        </p>
        {session.prUrl && (
          <a
            href={session.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-3 text-blue-400 hover:text-blue-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 16 16">
              <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
            </svg>
            View Pull Request
          </a>
        )}
        {session.preferences && (
          <PreferencesDisplay preferences={session.preferences} />
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Queued Session - waiting for active session to complete */}
          {session.status === 'queued' && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-yellow-600/30 rounded-full">
                  <svg className="w-6 h-6 text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-yellow-200 text-lg">Session Queued</h3>
                  <p className="text-yellow-300/80 mt-1">
                    This session is waiting for another session to complete on this project.
                    {session.queuePosition && (
                      <span className="block mt-1">
                        Position in queue: <span className="font-medium">#{session.queuePosition}</span>
                      </span>
                    )}
                  </p>
                  <p className="text-yellow-300/60 text-sm mt-3">
                    Discovery will start automatically when the current session completes.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Paused Session - on hold */}
          {session.status === 'paused' && (
            <div className="bg-orange-900/20 border border-orange-700/50 rounded-lg p-6" data-testid="paused-section">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-orange-600/30 rounded-full">
                  <svg className="w-6 h-6 text-orange-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-orange-200 text-lg">Session On Hold</h3>
                  <p className="text-orange-300/80 mt-1">
                    This session has been put on hold. All progress has been preserved.
                  </p>
                  <p className="text-orange-300/60 text-sm mt-3">
                    Click the "Resume Session" button above to continue work on this feature.
                    The session will be placed at the front of the queue.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Failed/Abandoned Session */}
          {session.status === 'failed' && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-6" data-testid="failed-section">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-red-600/30 rounded-full">
                  <svg className="w-6 h-6 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-red-200 text-lg">Session Abandoned</h3>
                  <p className="text-red-300/80 mt-1">
                    This session was marked as "Won't Do" and has been abandoned.
                  </p>
                  <p className="text-red-300/60 text-sm mt-3">
                    This action cannot be undone. You can create a new session if you want to implement this feature later.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Unanswered Questions - show in any stage */}
          {unansweredQuestions.length > 0 && (
            <QuestionsSection questions={unansweredQuestions} stage={currentStage} />
          )}

          {/* Stage 1: Discovery - show loading state if no questions */}
          {currentStage === 1 && unansweredQuestions.length === 0 && (
            <DiscoveryLoadingSection executionStatus={executionStatus} />
          )}

          {/* Stage 2: Plan Review */}
          {currentStage === 2 && plan && (
            <PlanReviewSection plan={plan} isRunning={executionStatus?.status === 'running'} executionStatus={executionStatus} />
          )}

          {/* Stage 3: Implementation Progress */}
          {currentStage === 3 && (
            <ImplementationSection plan={plan} executionStatus={executionStatus} />
          )}

          {/* Stage 4: PR Creation */}
          {currentStage === 4 && (
            <PRCreationSection plan={plan} isRunning={executionStatus?.status === 'running'} executionStatus={executionStatus} />
          )}

          {/* Stage 5: PR Review */}
          {currentStage === 5 && (
            <PRReviewSection plan={plan} isRunning={executionStatus?.status === 'running'} projectId={projectId} featureId={featureId} executionStatus={executionStatus} />
          )}

          {/* Stage 6: Final Approval */}
          {currentStage === 6 && session.status !== 'completed' && projectId && featureId && (
            <FinalApprovalSection session={session} projectId={projectId} featureId={featureId} />
          )}

          {/* Stage 7: Session Completed */}
          {(currentStage === 7 || session.status === 'completed') && (
            <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-green-600/30 rounded-full">
                  <svg className="w-6 h-6 text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-green-200 text-lg">Session Completed</h3>
                  <p className="text-green-300/80 mt-1">
                    This session has been completed. The PR is ready to be merged.
                  </p>
                  {session.prUrl && (
                    <a
                      href={session.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-3 text-green-400 hover:text-green-300 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 16 16">
                        <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
                      </svg>
                      View Pull Request
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Conversation Panel */}
          {projectId && featureId && (
            <ConversationPanel projectId={projectId} featureId={featureId} />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Session Info */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Session Info</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-400">Project</dt>
                <dd className="font-mono text-sm truncate">{session.projectPath}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Branch</dt>
                <dd className="font-mono">{session.featureBranch || 'Not created yet'}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Base Branch</dt>
                <dd className="font-mono">{session.baseBranch}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Status</dt>
                <dd className="capitalize">{session.status}</dd>
              </div>
            </dl>

            {/* View Plan Button */}
            {plan && plan.steps.length > 0 && (
              <button
                onClick={() => setShowPlanModal(true)}
                className="mt-4 w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                View Full Plan ({plan.steps.length} steps)
              </button>
            )}
          </div>

          {/* Acceptance Criteria */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Acceptance Criteria</h2>
            <ul className="space-y-2">
              {session.acceptanceCriteria.map((criterion, index) => (
                <li key={index} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={criterion.checked}
                    readOnly
                    className="mt-1"
                  />
                  <span className={criterion.checked ? 'text-gray-500 line-through' : ''}>
                    {criterion.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Debug Panel */}
          <div className="bg-gray-800 rounded-lg p-6">
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="w-full flex items-center justify-between text-sm text-gray-400 hover:text-gray-300 transition-colors"
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Debug Tools
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${showDebug ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showDebug && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-gray-500">Force transition to stage:</p>
                <div className="grid grid-cols-6 gap-1">
                  {[1, 2, 3, 4, 5, 6].map((stage) => (
                    <button
                      key={stage}
                      onClick={() => handleTransition(stage)}
                      disabled={isTransitioning || currentStage === stage}
                      className={`px-2 py-1.5 text-xs rounded transition-colors ${
                        currentStage === stage
                          ? 'bg-blue-600 text-white cursor-default'
                          : isTransitioning
                          ? 'bg-gray-700 text-gray-500 cursor-wait'
                          : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                      }`}
                      title={STAGE_LABELS[stage]}
                    >
                      {stage}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Current: Stage {currentStage} ({STAGE_LABELS[currentStage]})
                </p>
                {isTransitioning && (
                  <p className="text-xs text-yellow-400 flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                    Transitioning...
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

function DiscoveryLoadingSection({ executionStatus }: { executionStatus?: ExecutionStatus | null }) {
  // Get context-aware loading message based on sub-state
  const loadingMessage = getLoadingMessage(
    executionStatus?.subState,
    1,
    'Claude is analyzing your project...'
  );

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Feature Discovery</h2>
      <div className="text-center py-8 text-gray-400">
        <div className="animate-pulse mb-4">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p>{loadingMessage}</p>
        <p className="text-sm mt-2">Questions will appear here as they're generated.</p>
      </div>
    </div>
  );
}

const STAGE_QUESTION_TITLES: Record<number, string> = {
  1: 'Discovery Questions',
  2: 'Plan Review Questions',
  3: 'Implementation Questions',
  4: 'PR Questions',
  5: 'Review Questions',
};

function QuestionsSection({ questions, stage }: { questions: Question[]; stage: number }) {
  const { submitAllAnswers, plan } = useSessionStore();
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const allAnswered = questions.every(q => selectedAnswers[q.id]);
  const answeredCount = Object.keys(selectedAnswers).length;

  const handleSelectAnswer = (questionId: string, value: string) => {
    setSelectedAnswers(prev => ({ ...prev, [questionId]: value }));
    setSubmitError(null);
  };

  const handleSubmitAll = async () => {
    if (!allAnswered) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const answers = questions.map(q => ({
        questionId: q.id,
        answer: { value: selectedAnswers[q.id] },
      }));
      await submitAllAnswers(answers, remarks.trim() || undefined);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to submit answers');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{STAGE_QUESTION_TITLES[stage] || 'Questions from Claude'}</h2>
        <span className="text-sm text-gray-400">
          {answeredCount} of {questions.length} answered
        </span>
      </div>
      <p className="text-gray-400 text-sm">Please answer all questions, then submit:</p>

      {questions.map(question => (
        <QuestionCard
          key={question.id}
          question={question}
          selectedValue={selectedAnswers[question.id]}
          onSelect={(value) => handleSelectAnswer(question.id, value)}
          plan={plan}
        />
      ))}

      {/* Additional concerns/remarks textarea */}
      <div className="space-y-2">
        <label htmlFor="remarks" className="block text-sm font-medium text-gray-300">
          Additional concerns or requested changes (optional)
        </label>
        <textarea
          id="remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Any other concerns about the plan? Changes you'd like to request?"
          rows={3}
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-100 placeholder-gray-500"
        />
      </div>

      {submitError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-400 text-sm">
          {submitError}
        </div>
      )}

      <button
        onClick={handleSubmitAll}
        disabled={!allAnswered || isSubmitting}
        className={`w-full py-3 rounded-lg font-medium transition-colors ${
          allAnswered && !isSubmitting
            ? 'bg-blue-600 hover:bg-blue-700 text-white'
            : 'bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
      >
        {isSubmitting ? 'Submitting...' : `Submit All ${questions.length} Answers`}
      </button>
    </div>
  );
}

/**
 * Tooltip component for displaying step details on hover
 */
function StepTooltip({ step, leftOffset, arrowOffset }: { step: PlanStep; leftOffset: number; arrowOffset: number }) {
  return (
    <div
      className="absolute z-50 w-96 max-w-[90vw] p-4 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-sm bottom-full mb-2"
      style={{ left: `${leftOffset}px` }}
    >
      <div className="font-medium text-white mb-2">
        Step {step.orderIndex + 1}: {step.title}
      </div>
      <div className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">
        {step.description}
      </div>
      {step.complexity && (
        <div className="mt-2">
          <ComplexityBadge complexity={step.complexity} />
        </div>
      )}
      {/* Arrow pointing down */}
      <div
        className="absolute top-full w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-gray-700"
        style={{ left: `${arrowOffset}px` }}
      />
    </div>
  );
}

const TOOLTIP_WIDTH = 384; // w-96 = 24rem = 384px
const TOOLTIP_PADDING = 16; // padding from viewport edge

/**
 * Highlighted step reference with hover tooltip
 */
function StepReference({ stepNumber, plan }: { stepNumber: number; plan?: Plan | null }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipOffset, setTooltipOffset] = useState({ left: 0, arrow: 16 });
  const spanRef = useRef<HTMLSpanElement>(null);

  // Find the step by orderIndex (0-based), stepNumber in text is 1-based
  const step = plan?.steps.find((s) => s.orderIndex === stepNumber - 1);

  const handleMouseEnter = useCallback(() => {
    if (spanRef.current) {
      const rect = spanRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      // Default: tooltip starts at left edge of the step reference
      let leftOffset = 0;
      let arrowOffset = 16; // default arrow position

      // Check if tooltip would overflow right edge
      const tooltipRight = rect.left + TOOLTIP_WIDTH;
      if (tooltipRight > viewportWidth - TOOLTIP_PADDING) {
        // Shift tooltip left to fit within viewport
        const overflow = tooltipRight - (viewportWidth - TOOLTIP_PADDING);
        leftOffset = -overflow;
        // Adjust arrow to still point at the step reference
        arrowOffset = 16 + overflow;
      }

      setTooltipOffset({ left: leftOffset, arrow: arrowOffset });
    }
    setShowTooltip(true);
  }, []);

  if (!step) {
    // If no step found, just render the text normally
    return <span>Step {stepNumber}</span>;
  }

  return (
    <span
      ref={spanRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span className="text-blue-400 hover:text-blue-300 cursor-help underline decoration-dotted underline-offset-2">
        Step {stepNumber}
      </span>
      {showTooltip && <StepTooltip step={step} leftOffset={tooltipOffset.left} arrowOffset={tooltipOffset.arrow} />}
    </span>
  );
}

/**
 * Renders simple markdown: **bold**, `code`, and newlines
 * Also detects "Step X" references and highlights them with tooltips when plan is provided
 */
function SimpleMarkdown({ text, className = '', plan }: { text: string; className?: string; plan?: Plan | null }) {
  const rendered = useMemo(() => {
    // Split by newlines first
    return text.split('\n').map((line, lineIndex) => {
      // Process inline markdown: **bold**, `code`, and Step X references
      const parts: (string | JSX.Element)[] = [];
      let lastIndex = 0;
      // Added Step X pattern (case insensitive, captures the number)
      // Matches "Step 4" or "Step-4" formats
      const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)|(\bStep[\s-](\d+)\b)/gi;
      let match;

      while ((match = regex.exec(line)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          parts.push(line.slice(lastIndex, match.index));
        }

        if (match[2]) {
          // Bold: **text**
          parts.push(<strong key={`${lineIndex}-${match.index}`}>{match[2]}</strong>);
        } else if (match[4]) {
          // Code: `text`
          parts.push(
            <code key={`${lineIndex}-${match.index}`} className="bg-gray-700 px-1 rounded text-sm">
              {match[4]}
            </code>
          );
        } else if (match[6]) {
          // Step X reference
          const stepNumber = parseInt(match[6], 10);
          parts.push(
            <StepReference key={`${lineIndex}-${match.index}`} stepNumber={stepNumber} plan={plan} />
          );
        }

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < line.length) {
        parts.push(line.slice(lastIndex));
      }

      return (
        <span key={lineIndex}>
          {parts.length > 0 ? parts : line}
          {lineIndex < text.split('\n').length - 1 && <br />}
        </span>
      );
    });
  }, [text, plan]);

  return <span className={className}>{rendered}</span>;
}

function QuestionCard({
  question,
  selectedValue,
  onSelect,
  plan,
}: {
  question: Question;
  selectedValue?: string;
  onSelect: (value: string) => void;
  plan?: Plan | null;
}) {
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState('');

  // Check if selected value is a custom "other" answer (not in options)
  const isOtherSelected = selectedValue && !question.options.some(o => o.value === selectedValue);

  const handleOtherToggle = () => {
    setShowOther(true);
    if (otherText) {
      onSelect(`other: ${otherText}`);
    }
  };

  const handleOtherTextChange = (text: string) => {
    setOtherText(text);
    if (text) {
      onSelect(`other: ${text}`);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="font-medium mb-4">
        <SimpleMarkdown text={question.questionText} plan={plan} />
      </div>
      <div className="space-y-2">
        {question.options.map(option => {
          const isSelected = selectedValue === option.value;
          return (
            <button
              key={option.value}
              onClick={() => {
                setShowOther(false);
                onSelect(option.value);
              }}
              className={`w-full text-left px-4 py-3 rounded-lg transition-colors border-2 ${
                isSelected
                  ? 'bg-blue-900/50 border-blue-500'
                  : 'bg-gray-700 hover:bg-gray-600 border-transparent'
              }`}
            >
              <span className="font-medium">
                <SimpleMarkdown text={option.label} />
              </span>
              {option.recommended && (
                <span className="ml-2 text-xs text-green-400">(Recommended)</span>
              )}
              {isSelected && (
                <span className="float-right text-blue-400">✓</span>
              )}
            </button>
          );
        })}

        {/* Other option */}
        <button
          onClick={handleOtherToggle}
          className={`w-full text-left px-4 py-3 rounded-lg transition-colors border-2 ${
            showOther || isOtherSelected
              ? 'bg-blue-900/50 border-blue-500'
              : 'bg-gray-700 hover:bg-gray-600 border-transparent'
          }`}
        >
          <span className="font-medium">Other (custom answer)</span>
          {(showOther || isOtherSelected) && (
            <span className="float-right text-blue-400">✓</span>
          )}
        </button>

        {/* Other text input */}
        {(showOther || isOtherSelected) && (
          <div className="mt-2">
            <textarea
              value={otherText || (isOtherSelected ? selectedValue?.replace('other: ', '') : '')}
              onChange={(e) => handleOtherTextChange(e.target.value)}
              placeholder="Type your custom answer..."
              className="w-full px-4 py-3 bg-gray-700 border-2 border-blue-500 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PlanReviewSection({ plan, isRunning, executionStatus }: { plan: Plan; isRunning?: boolean; executionStatus?: ExecutionStatus | null }) {
  const { approvePlan, requestPlanChanges, questions, isAwaitingClaudeResponse } = useSessionStore();
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('timeline');
  const [selectedStep, setSelectedStep] = useState<PlanStep | null>(null);

  // Check if there are any unanswered questions (hide approval buttons until all answered)
  const hasUnansweredQuestions = questions.some(q => !q.answer);

  // Get context-aware loading message
  const loadingMessage = getLoadingMessage(
    executionStatus?.subState,
    2,
    'Claude is reviewing the implementation plan.'
  );

  // While plan review is running, show a loading state instead of the plan
  if (isRunning) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <h2 className="text-xl font-semibold">Reviewing Plan...</h2>
        </div>
        <p className="text-gray-400">
          {loadingMessage}
        </p>
        <div className="mt-4 p-3 bg-gray-700/50 rounded-lg">
          <p className="text-sm text-gray-400">
            Plan version: <span className="text-gray-300">v{plan.planVersion}</span> |
            Steps: <span className="text-gray-300">{plan.steps.length}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Implementation Plan</h2>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">v{plan.planVersion}</span>
            <div className="flex bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setViewMode('timeline')}
                className={`px-3 py-1 text-sm rounded ${
                  viewMode === 'timeline' ? 'bg-blue-600 text-white' : 'text-gray-400'
                }`}
              >
                Timeline
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 text-sm rounded ${
                  viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400'
                }`}
              >
                List
              </button>
            </div>
          </div>
        </div>

        {viewMode === 'timeline' ? (
          <TimelineView plan={plan} onStepSelect={setSelectedStep} selectedStepId={selectedStep?.id} />
        ) : (
          <div className="space-y-4">
            {plan.steps.map((step, index) => (
              <div
                key={step.id}
                className={`flex gap-4 p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedStep?.id === step.id ? 'bg-blue-900/30' : 'hover:bg-gray-700/50'
                }`}
                onClick={() => setSelectedStep(step)}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-medium">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{step.title}</h3>
                    <ComplexityBadge complexity={step.complexity} />
                  </div>
                  {step.description && (
                    <p className="text-gray-400 text-sm mt-1">{step.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedStep && (
          <div className="mt-4 p-4 bg-gray-700/50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-medium">Selected: {selectedStep.title}</h3>
              <ComplexityBadge complexity={selectedStep.complexity} />
            </div>
            <p className="text-gray-400 text-sm">{selectedStep.description || 'No description'}</p>
          </div>
        )}
      </div>

      {/* Plan validation status */}
      <PlanValidationStatusPanel plan={plan} />

      {/* Only show approval buttons when plan is not approved, no pending questions, and not waiting for Claude */}
      {!plan.isApproved && !hasUnansweredQuestions && !isRunning && !isAwaitingClaudeResponse && (
        <div className="flex gap-4">
          <button
            onClick={() => {
              const feedback = prompt('What changes would you like?');
              if (feedback) requestPlanChanges(feedback);
            }}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
          >
            Request Changes
          </button>
          <button
            onClick={approvePlan}
            className="flex-1 px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors"
          >
            Approve Plan
          </button>
        </div>
      )}
    </div>
  );
}

function ImplementationSection({
  plan,
  executionStatus,
}: {
  plan: Plan | null;
  executionStatus: ExecutionStatus | null;
}) {
  const { implementationProgress } = useSessionStore();
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('timeline');

  if (!plan) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <p className="text-gray-400">Loading plan...</p>
      </div>
    );
  }

  // Find the currently executing step based on executionStatus.stepId or implementationProgress.stepId
  const activeStepId = executionStatus?.stepId || implementationProgress?.stepId;
  const activeStepIndex = activeStepId
    ? plan.steps.findIndex(s => s.id === activeStepId)
    : -1;
  const activeStep = activeStepIndex >= 0 ? plan.steps[activeStepIndex] : null;
  const totalSteps = plan.steps.length;
  const retryCount = implementationProgress?.retryCount ?? 0;
  const isRunning = executionStatus?.status === 'running';

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Implementation Progress</h2>
          <div className="flex bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1 text-sm rounded ${
                viewMode === 'timeline' ? 'bg-blue-600 text-white' : 'text-gray-400'
              }`}
            >
              Timeline
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-sm rounded ${
                viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400'
              }`}
            >
              List
            </button>
          </div>
        </div>

        {/* Step Progress Indicator - shown when a step is active */}
        {activeStep && isRunning && (
          <div className="mb-4 p-3 bg-blue-900/30 border border-blue-500/30 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <div>
                  <span className="text-blue-300 font-medium">
                    Step {activeStepIndex + 1} of {totalSteps}:
                  </span>
                  <span className="ml-2 text-gray-200">{activeStep.title}</span>
                </div>
              </div>
              {retryCount > 0 && (
                <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-1 rounded flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Retry {retryCount}/3
                </span>
              )}
            </div>
            {/* Progress bar within step if available */}
            {executionStatus?.progress && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Sub-task progress</span>
                  <span>{executionStatus.progress.current} / {executionStatus.progress.total}</span>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${(executionStatus.progress.current / executionStatus.progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {viewMode === 'timeline' ? (
          <TimelineView
            plan={plan}
            implementationProgress={implementationProgress ? {
              stepId: implementationProgress.stepId,
              retryCount: implementationProgress.retryCount,
              message: implementationProgress.message,
            } : null}
          />
        ) : (
          <ImplementationListView plan={plan} activeStepId={activeStepId} retryCount={retryCount} />
        )}
      </div>
    </div>
  );
}

function ImplementationListView({
  plan,
  activeStepId,
  retryCount = 0,
}: {
  plan: Plan;
  activeStepId?: string;
  retryCount?: number;
}) {
  const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
  const totalSteps = plan.steps.length;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <>
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span>{completedSteps} of {totalSteps} steps completed</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {plan.steps.map((step, index) => {
          const isActiveStep = step.id === activeStepId;
          return (
            <div
              key={step.id}
              className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                isActiveStep
                  ? 'bg-blue-900/40 ring-2 ring-blue-500/50'
                  : step.status === 'completed'
                  ? 'bg-green-900/20'
                  : step.status === 'in_progress'
                  ? 'bg-blue-900/20'
                  : step.status === 'blocked' || step.status === 'needs_review'
                  ? 'bg-yellow-900/20'
                  : 'bg-gray-700/50'
              }`}
            >
              <div className="flex-shrink-0">
                {step.status === 'completed' ? (
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : step.status === 'in_progress' || isActiveStep ? (
                  <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                ) : step.status === 'blocked' || step.status === 'needs_review' ? (
                  <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-gray-500" />
                )}
              </div>
              <div className="flex-1 flex items-center justify-between">
                <div>
                  <span className={step.status === 'completed' ? 'text-gray-400' : ''}>
                    {index + 1}. {step.title}
                  </span>
                  {(step.status === 'blocked' || step.status === 'needs_review') && (
                    <span className="ml-2 text-xs text-yellow-400">
                      {step.status === 'blocked' ? 'Waiting for input' : 'Needs review'}
                    </span>
                  )}
                </div>
                {/* Show retry count for the active step */}
                {isActiveStep && retryCount > 0 && (
                  <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded">
                    Retry {retryCount}/3
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function PRCreationSection({ plan, isRunning, executionStatus }: { plan: Plan | null; isRunning?: boolean; executionStatus?: ExecutionStatus | null }) {
  const completedSteps = plan?.steps.filter(s => s.status === 'completed').length ?? 0;
  const totalSteps = plan?.steps.length ?? 0;

  // Get context-aware loading message
  const loadingMessage = getLoadingMessage(
    executionStatus?.subState,
    4,
    'Claude is preparing your changes for review...'
  );

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">PR Creation</h2>

        {/* Implementation summary */}
        <div className="mb-6 p-4 bg-green-900/20 rounded-lg">
          <div className="flex items-center gap-2 text-green-400 mb-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Implementation Complete</span>
          </div>
          <p className="text-gray-400 text-sm">
            {completedSteps} of {totalSteps} steps completed successfully.
          </p>
        </div>

        {/* PR creation status */}
        <div className={`flex items-center gap-3 p-4 rounded-lg ${isRunning ? 'bg-gray-700/50' : 'bg-yellow-900/20'}`}>
          {isRunning ? (
            <>
              <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <div>
                <p className="font-medium">Creating Pull Request</p>
                <p className="text-gray-400 text-sm">{loadingMessage}</p>
              </div>
            </>
          ) : (
            <>
              <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-medium text-yellow-400">PR Creation Incomplete</p>
                <p className="text-gray-400 text-sm">Check the conversation panel for details.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PRReviewSection({ plan, isRunning, projectId, featureId, executionStatus }: { plan: Plan | null; isRunning?: boolean; projectId?: string; featureId?: string; executionStatus?: ExecutionStatus | null }) {
  const { questions, isAwaitingClaudeResponse } = useSessionStore();
  const completedSteps = plan?.steps.filter(s => s.status === 'completed').length ?? 0;
  const totalSteps = plan?.steps.length ?? 0;
  const needsReviewSteps = plan?.steps.filter(s => s.status === 'needs_review').length ?? 0;

  // Hide actions when there are active conversations
  const hasUnansweredQuestions = questions.some(q => !q.answer);
  const hasActiveConversation = isRunning || isAwaitingClaudeResponse || hasUnansweredQuestions;

  const [showReReviewForm, setShowReReviewForm] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get context-aware loading message
  const loadingMessage = getLoadingMessage(
    executionStatus?.subState,
    5,
    'Claude is checking CI status and reviewing the PR...'
  );

  const handleRequestReReview = async () => {
    if (!projectId || !featureId) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/sessions/${projectId}/${featureId}/re-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remarks }),
      });

      if (!response.ok) {
        throw new Error('Failed to request re-review');
      }

      setShowReReviewForm(false);
      setRemarks('');
    } catch (error) {
      console.error('Re-review request failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">PR Review</h2>

        {/* Implementation summary */}
        <div className="mb-6 p-4 bg-green-900/20 rounded-lg">
          <div className="flex items-center gap-2 text-green-400 mb-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Pull Request Created</span>
          </div>
          <p className="text-gray-400 text-sm">
            {completedSteps} of {totalSteps} steps completed.
            {needsReviewSteps > 0 && ` ${needsReviewSteps} step(s) need review.`}
          </p>
        </div>

        {/* PR review status */}
        <div className={`flex items-center gap-3 p-4 rounded-lg ${isRunning ? 'bg-gray-700/50' : 'bg-blue-900/20'}`}>
          {isRunning ? (
            <>
              <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
              <div>
                <p className="font-medium">Reviewing Changes</p>
                <p className="text-gray-400 text-sm">{loadingMessage}</p>
              </div>
            </>
          ) : (
            <>
              <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-medium text-blue-400">Review Complete</p>
                <p className="text-gray-400 text-sm">Check the conversation panel for review results.</p>
              </div>
            </>
          )}
        </div>

        {/* Re-review request form - hidden during active conversations */}
        {!hasActiveConversation && (
          <div className="mt-4">
            {!showReReviewForm ? (
              <button
                onClick={() => setShowReReviewForm(true)}
                className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Request Re-Review
              </button>
            ) : (
              <div className="space-y-3 p-4 bg-gray-700/50 rounded-lg">
                <label className="block text-sm font-medium">Additional Remarks (optional)</label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add any specific areas to focus on, concerns, or additional context..."
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowReReviewForm(false);
                      setRemarks('');
                    }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm font-medium transition-colors"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRequestReReview}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {isSubmitting ? 'Requesting...' : 'Start Re-Review'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Steps that need review */}
        {needsReviewSteps > 0 && plan && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-yellow-400 mb-2">Steps Needing Review:</h3>
            <div className="space-y-2">
              {plan.steps.filter(s => s.status === 'needs_review').map((step) => (
                <div key={step.id} className="flex items-center gap-2 p-2 bg-yellow-900/20 rounded">
                  <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-sm">{step.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FinalApprovalSection({ session, projectId, featureId }: { session: Session; projectId: string; featureId: string }) {
  const { questions, isAwaitingClaudeResponse, executionStatus } = useSessionStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedAction, setSelectedAction] = useState<'merge' | 'plan_changes' | 're_review' | null>(null);
  const [feedback, setFeedback] = useState('');

  // Hide actions when there are active conversations
  const hasUnansweredQuestions = questions.some(q => !q.answer);
  const isRunning = executionStatus?.status === 'running';
  const hasActiveConversation = isRunning || isAwaitingClaudeResponse || hasUnansweredQuestions;

  const handleAction = async (action: 'merge' | 'plan_changes' | 're_review') => {
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/sessions/${projectId}/${featureId}/final-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback: feedback || undefined }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process action');
      }

      // Reset form on success
      setSelectedAction(null);
      setFeedback('');
    } catch (error) {
      console.error('Final approval action failed:', error);
      alert(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Final Approval</h2>

        {/* Success message */}
        <div className="mb-6 p-4 bg-green-900/20 rounded-lg">
          <div className="flex items-center gap-2 text-green-400 mb-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">PR Review Complete</span>
          </div>
          <p className="text-sm text-gray-300">
            Claude has reviewed the PR and found no issues. The implementation is ready for your final review.
          </p>
        </div>

        {/* PR Link */}
        {session.prUrl && (
          <div className="mb-6 p-4 bg-gray-700/50 rounded-lg">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 16 16">
                <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
              </svg>
              <div>
                <p className="text-sm text-gray-400">Pull Request</p>
                <a
                  href={session.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {session.prUrl}
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons - hidden during active conversations */}
        {!hasActiveConversation && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">What would you like to do?</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Merge button */}
              <button
                onClick={() => setSelectedAction('merge')}
                disabled={isSubmitting}
                className={`p-4 rounded-lg border-2 transition-all ${
                  selectedAction === 'merge'
                    ? 'border-green-500 bg-green-900/30'
                    : 'border-gray-600 hover:border-green-500/50 hover:bg-green-900/10'
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-medium text-green-400">Complete Session</span>
                  <span className="text-xs text-gray-400 text-center">Mark as complete - ready to merge</span>
                </div>
              </button>

              {/* Return to Plan Review button */}
              <button
                onClick={() => setSelectedAction('plan_changes')}
                disabled={isSubmitting}
                className={`p-4 rounded-lg border-2 transition-all ${
                  selectedAction === 'plan_changes'
                    ? 'border-blue-500 bg-blue-900/30'
                    : 'border-gray-600 hover:border-blue-500/50 hover:bg-blue-900/10'
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span className="font-medium text-blue-400">Request Changes</span>
                  <span className="text-xs text-gray-400 text-center">Return to Stage 2 for plan updates</span>
                </div>
              </button>

              {/* Re-review button */}
              <button
                onClick={() => setSelectedAction('re_review')}
                disabled={isSubmitting}
                className={`p-4 rounded-lg border-2 transition-all ${
                  selectedAction === 're_review'
                    ? 'border-yellow-500 bg-yellow-900/30'
                    : 'border-gray-600 hover:border-yellow-500/50 hover:bg-yellow-900/10'
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="font-medium text-yellow-400">Re-Review PR</span>
                  <span className="text-xs text-gray-400 text-center">Return to Stage 5 for another review</span>
                </div>
              </button>
            </div>

            {/* Feedback form (shown when action selected) */}
            {selectedAction && (
              <div className="mt-4 p-4 bg-gray-700/50 rounded-lg space-y-3">
                <label className="block text-sm font-medium">
                  {selectedAction === 'merge' ? 'Any final notes? (optional)' :
                   selectedAction === 'plan_changes' ? 'What changes do you need?' :
                   'What should Claude focus on in the re-review?'}
                </label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={
                    selectedAction === 'merge' ? 'Add any notes about the implementation...' :
                    selectedAction === 'plan_changes' ? 'Describe the changes you want to make to the plan...' :
                    'Describe specific areas to focus on...'
                  }
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedAction(null);
                      setFeedback('');
                    }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm font-medium transition-colors"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleAction(selectedAction)}
                    disabled={isSubmitting || (selectedAction !== 'merge' && !feedback.trim())}
                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                      selectedAction === 'merge' ? 'bg-green-600 hover:bg-green-700' :
                      selectedAction === 'plan_changes' ? 'bg-blue-600 hover:bg-blue-700' :
                      'bg-yellow-600 hover:bg-yellow-700'
                    }`}
                  >
                    {isSubmitting ? 'Processing...' :
                     selectedAction === 'merge' ? 'Complete Session' :
                     selectedAction === 'plan_changes' ? 'Return to Plan Review' :
                     'Start Re-Review'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Check if a plan is in ComposablePlan format (has validationStatus)
 */
function isComposablePlan(plan: Plan | ComposablePlan): plan is ComposablePlan {
  return 'validationStatus' in plan && 'meta' in plan;
}

/**
 * Get validation status from a plan (ComposablePlan or legacy Plan)
 */
function getPlanValidationStatus(plan: Plan | ComposablePlan): PlanValidationStatus | null {
  if (isComposablePlan(plan)) {
    return plan.validationStatus;
  }
  return null;
}

/**
 * Component to display plan validation status
 */
function PlanValidationStatusPanel({ plan }: { plan: Plan | ComposablePlan }) {
  const validationStatus = getPlanValidationStatus(plan);

  if (!validationStatus) {
    return null; // Legacy plan, no validation status
  }

  const sections = [
    { key: 'meta', label: 'Metadata', valid: validationStatus.meta },
    { key: 'steps', label: 'Steps', valid: validationStatus.steps },
    { key: 'dependencies', label: 'Dependencies', valid: validationStatus.dependencies },
    { key: 'testCoverage', label: 'Test Coverage', valid: validationStatus.testCoverage },
    { key: 'acceptanceMapping', label: 'Acceptance Mapping', valid: validationStatus.acceptanceMapping },
  ];

  const invalidSections = sections.filter(s => !s.valid);
  const allValid = validationStatus.overall;

  return (
    <div className="bg-gray-800 rounded-lg p-4" data-testid="plan-validation-status">
      <div className="flex items-center gap-2 mb-3">
        {allValid ? (
          <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        )}
        <h3 className="font-medium">
          Plan Validation: {allValid ? (
            <span className="text-green-400">Complete</span>
          ) : (
            <span className="text-yellow-400">Incomplete</span>
          )}
        </h3>
      </div>

      {!allValid && invalidSections.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">Missing sections:</p>
          <ul className="space-y-1">
            {invalidSections.map(section => (
              <li key={section.key} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-yellow-300">{section.label}</span>
              </li>
            ))}
          </ul>
          {validationStatus.errors && Object.keys(validationStatus.errors).length > 0 && (
            <div className="mt-3 p-2 bg-gray-700/50 rounded text-xs">
              <p className="text-gray-400 mb-1">Validation errors:</p>
              {Object.entries(validationStatus.errors).map(([section, errors]) => (
                <div key={section} className="mb-1">
                  <span className="text-gray-500">{section}:</span>
                  <ul className="ml-2 text-red-400">
                    {errors.map((err, i) => (
                      <li key={i}>- {err}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section status indicators */}
      <div className="flex flex-wrap gap-2 mt-3">
        {sections.map(section => (
          <span
            key={section.key}
            className={`text-xs px-2 py-1 rounded ${
              section.valid
                ? 'bg-green-900/40 text-green-400'
                : 'bg-yellow-900/40 text-yellow-400'
            }`}
          >
            {section.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function PlanModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const completedCount = plan.steps.filter(s => s.status === 'completed').length;
  const inProgressCount = plan.steps.filter(s => s.status === 'in_progress').length;
  const needsReviewCount = plan.steps.filter(s => s.status === 'needs_review').length;

  const STATUS_ICONS: Record<string, JSX.Element> = {
    completed: (
      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    in_progress: (
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
    ),
    needs_review: (
      <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    blocked: (
      <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
    pending: (
      <div className="w-5 h-5 rounded-full border-2 border-gray-500" />
    ),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-xl max-w-3xl w-full max-h-[80vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-semibold">Implementation Plan</h2>
            <p className="text-sm text-gray-400 mt-1">
              v{plan.planVersion} | {completedCount}/{plan.steps.length} completed
              {inProgressCount > 0 && ` | ${inProgressCount} in progress`}
              {needsReviewCount > 0 && ` | ${needsReviewCount} needs review`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Plan Steps */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
          <div className="space-y-4">
            {plan.steps.map((step, index) => (
              <div
                key={step.id}
                className={`p-4 rounded-lg ${
                  step.status === 'completed'
                    ? 'bg-green-900/20 border border-green-800/50'
                    : step.status === 'in_progress'
                    ? 'bg-blue-900/20 border border-blue-800/50'
                    : step.status === 'needs_review'
                    ? 'bg-yellow-900/20 border border-yellow-800/50'
                    : step.status === 'blocked'
                    ? 'bg-red-900/20 border border-red-800/50'
                    : 'bg-gray-800/50 border border-gray-700/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {STATUS_ICONS[step.status] || STATUS_ICONS.pending}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-500 text-sm font-mono">#{index + 1}</span>
                      <h3 className="font-medium">{step.title}</h3>
                      <ComplexityBadge complexity={step.complexity} />
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        step.status === 'completed' ? 'bg-green-900/50 text-green-400' :
                        step.status === 'in_progress' ? 'bg-blue-900/50 text-blue-400' :
                        step.status === 'needs_review' ? 'bg-yellow-900/50 text-yellow-400' :
                        step.status === 'blocked' ? 'bg-red-900/50 text-red-400' :
                        'bg-gray-700 text-gray-400'
                      }`}>
                        {step.status.replace('_', ' ')}
                      </span>
                    </div>
                    {step.description && (
                      <p className="text-gray-400 text-sm mt-2 whitespace-pre-wrap">{step.description}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { TimelineView } from '../components/PlanEditor';
import { ConversationPanel } from '../components/ConversationPanel';
import { connectToSession, disconnectFromSession, getSocket } from '../services/socket';
import type { PlanStepStatus, ImplementationProgressEvent } from '@claude-code-web/shared';

const STAGE_LABELS: Record<number, string> = {
  1: 'Feature Discovery',
  2: 'Plan Review',
  3: 'Implementation',
  4: 'PR Creation',
  5: 'PR Review',
};

const STAGE_COLORS: Record<number, string> = {
  1: 'bg-stage-discovery',
  2: 'bg-stage-planning',
  3: 'bg-stage-implementation',
  4: 'bg-stage-pr',
  5: 'bg-stage-review',
};

export default function SessionView() {
  const { projectId, featureId } = useParams<{ projectId: string; featureId: string }>();
  const {
    session,
    plan,
    questions,
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
  } = useSessionStore();

  // Modal state (must be before early returns to maintain hooks order)
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Socket.IO event handlers
  const handleExecutionStatus = useCallback((data: { status: 'running' | 'idle' | 'error'; action: string; timestamp: string }) => {
    setExecutionStatus(data);
  }, [setExecutionStatus]);

  const handleClaudeOutput = useCallback((data: { output: string; isComplete: boolean }) => {
    appendLiveOutput(data.output, data.isComplete);
    // Refresh conversations when output is complete
    if (data.isComplete && projectId && featureId) {
      fetchConversations(projectId, featureId);
    }
  }, [appendLiveOutput, fetchConversations, projectId, featureId]);

  const handleQuestionsBatch = useCallback((data: { questions: Question[] }) => {
    // Add new questions to the list
    data.questions.forEach(q => addQuestion(q));
  }, [addQuestion]);

  const handlePlanUpdated = useCallback((data: { planVersion: number; steps: Plan['steps']; isApproved: boolean }) => {
    const currentPlan = useSessionStore.getState().plan;
    if (currentPlan) {
      setPlan({ ...currentPlan, ...data });
    }
  }, [setPlan]);

  const handleStageChanged = useCallback((data: { currentStage: number; status: string }) => {
    const currentSession = useSessionStore.getState().session;
    if (currentSession) {
      setSession({ ...currentSession, currentStage: data.currentStage, status: data.status as Session['status'] });
    }
  }, [setSession]);

  // Stage 3 event handlers
  const handleStepStarted = useCallback((data: { stepId: string }) => {
    updateStepStatus(data.stepId, 'in_progress');
  }, [updateStepStatus]);

  const handleStepCompleted = useCallback((data: { stepId: string; status: PlanStepStatus }) => {
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

  // Fetch session data
  useEffect(() => {
    if (projectId && featureId) {
      fetchSession(projectId, featureId);
    }
  }, [projectId, featureId, fetchSession]);

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
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <Link to="/" className="text-gray-400 hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <span className={`px-3 py-1 rounded-full text-sm ${STAGE_COLORS[currentStage] || 'bg-gray-600'}`}>
            Stage {currentStage}: {STAGE_LABELS[currentStage]}
          </span>
        </div>
        <h1 className="text-3xl font-bold">{session.title}</h1>
        <p className="text-gray-400 mt-2">{session.featureDescription}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Unanswered Questions - show in any stage */}
          {unansweredQuestions.length > 0 && (
            <QuestionsSection questions={unansweredQuestions} stage={currentStage} />
          )}

          {/* Stage 1: Discovery - show loading state if no questions */}
          {currentStage === 1 && unansweredQuestions.length === 0 && (
            <DiscoveryLoadingSection />
          )}

          {/* Stage 2: Plan Review */}
          {currentStage === 2 && plan && (
            <PlanReviewSection plan={plan} isRunning={executionStatus?.status === 'running'} />
          )}

          {/* Stage 3: Implementation Progress */}
          {currentStage === 3 && (
            <ImplementationSection plan={plan} />
          )}

          {/* Stage 4: PR Creation */}
          {currentStage === 4 && (
            <PRCreationSection plan={plan} isRunning={executionStatus?.status === 'running'} />
          )}

          {/* Stage 5: PR Review */}
          {currentStage === 5 && (
            <PRReviewSection plan={plan} isRunning={executionStatus?.status === 'running'} projectId={projectId} featureId={featureId} />
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
                <div className="grid grid-cols-5 gap-1">
                  {[1, 2, 3, 4, 5].map((stage) => (
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

function DiscoveryLoadingSection() {
  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Feature Discovery</h2>
      <div className="text-center py-8 text-gray-400">
        <div className="animate-pulse mb-4">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p>Claude is analyzing your project...</p>
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
  const { submitAllAnswers } = useSessionStore();
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
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
      await submitAllAnswers(answers);
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
        />
      ))}

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

function QuestionCard({
  question,
  selectedValue,
  onSelect,
}: {
  question: Question;
  selectedValue?: string;
  onSelect: (value: string) => void;
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
      <p className="font-medium mb-4">{question.questionText}</p>
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
              <span className="font-medium">{option.label}</span>
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

function PlanReviewSection({ plan, isRunning }: { plan: Plan; isRunning?: boolean }) {
  const { approvePlan, requestPlanChanges } = useSessionStore();
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('timeline');
  const [selectedStep, setSelectedStep] = useState<PlanStep | null>(null);

  // While plan review is running, show a loading state instead of the plan
  if (isRunning) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <h2 className="text-xl font-semibold">Reviewing Plan...</h2>
        </div>
        <p className="text-gray-400">
          Claude is reviewing the implementation plan. The plan will be shown once the review is complete.
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
                  <h3 className="font-medium">{step.title}</h3>
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
            <h3 className="font-medium mb-2">Selected: {selectedStep.title}</h3>
            <p className="text-gray-400 text-sm">{selectedStep.description || 'No description'}</p>
          </div>
        )}
      </div>

      {!plan.isApproved && (
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
}: {
  plan: Plan | null;
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
          <ImplementationListView plan={plan} />
        )}
      </div>
    </div>
  );
}

function ImplementationListView({ plan }: { plan: Plan }) {
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
        {plan.steps.map((step, index) => (
          <div
            key={step.id}
            className={`flex items-center gap-3 p-3 rounded-lg ${
              step.status === 'completed'
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
              ) : step.status === 'in_progress' ? (
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              ) : step.status === 'blocked' || step.status === 'needs_review' ? (
                <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-gray-500" />
              )}
            </div>
            <div className="flex-1">
              <span className={step.status === 'completed' ? 'text-gray-400' : ''}>
                {index + 1}. {step.title}
              </span>
              {(step.status === 'blocked' || step.status === 'needs_review') && (
                <span className="ml-2 text-xs text-yellow-400">
                  {step.status === 'blocked' ? 'Waiting for input' : 'Needs review'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PRCreationSection({ plan, isRunning }: { plan: Plan | null; isRunning?: boolean }) {
  const completedSteps = plan?.steps.filter(s => s.status === 'completed').length ?? 0;
  const totalSteps = plan?.steps.length ?? 0;

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
                <p className="text-gray-400 text-sm">Claude is preparing your changes for review...</p>
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

function PRReviewSection({ plan, isRunning, projectId, featureId }: { plan: Plan | null; isRunning?: boolean; projectId?: string; featureId?: string }) {
  const completedSteps = plan?.steps.filter(s => s.status === 'completed').length ?? 0;
  const totalSteps = plan?.steps.length ?? 0;
  const needsReviewSteps = plan?.steps.filter(s => s.status === 'needs_review').length ?? 0;

  const [showReReviewForm, setShowReReviewForm] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
                <p className="text-gray-400 text-sm">Claude is checking CI status and reviewing the PR...</p>
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

        {/* Re-review request form */}
        {!isRunning && (
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
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-sm font-mono">#{index + 1}</span>
                      <h3 className="font-medium">{step.title}</h3>
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

// Type imports for internal use
import type { Plan, PlanStep, Question, Session } from '@claude-code-web/shared';

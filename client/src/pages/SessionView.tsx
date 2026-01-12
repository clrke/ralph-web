import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { PlanEditor } from '../components/PlanEditor';
import { ConversationPanel } from '../components/ConversationPanel';
import { connectToSession, disconnectFromSession, getSocket } from '../services/socket';

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
    fetchSession,
    fetchConversations,
    setSession,
    setPlan,
    addQuestion,
    setExecutionStatus,
    appendLiveOutput,
  } = useSessionStore();

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

    return () => {
      socket.off('execution.status', handleExecutionStatus);
      socket.off('claude.output', handleClaudeOutput);
      socket.off('questions.batch', handleQuestionsBatch);
      socket.off('plan.updated', handlePlanUpdated);
      socket.off('stage.changed', handleStageChanged);
      disconnectFromSession(projectId, featureId);
    };
  }, [projectId, featureId, handleExecutionStatus, handleClaudeOutput, handleQuestionsBatch, handlePlanUpdated, handleStageChanged]);

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
            <PlanReviewSection plan={plan} />
          )}

          {/* Stage 3+: Implementation Progress */}
          {currentStage >= 3 && (
            <ImplementationSection plan={plan} />
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
        </div>
      </div>
    </div>
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
  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <p className="font-medium mb-4">{question.questionText}</p>
      <div className="space-y-2">
        {question.options.map(option => {
          const isSelected = selectedValue === option.value;
          return (
            <button
              key={option.value}
              onClick={() => onSelect(option.value)}
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
      </div>
    </div>
  );
}

function PlanReviewSection({ plan }: { plan: Plan }) {
  const { approvePlan, requestPlanChanges } = useSessionStore();
  const [viewMode, setViewMode] = useState<'list' | 'visual'>('visual');
  const [selectedStep, setSelectedStep] = useState<PlanStep | null>(null);

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Implementation Plan</h2>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">v{plan.planVersion}</span>
            <div className="flex bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setViewMode('visual')}
                className={`px-3 py-1 text-sm rounded ${
                  viewMode === 'visual' ? 'bg-blue-600 text-white' : 'text-gray-400'
                }`}
              >
                Visual
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

        {viewMode === 'visual' ? (
          <PlanEditor plan={plan} onStepSelect={setSelectedStep} />
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
  if (!plan) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <p className="text-gray-400">Loading plan...</p>
      </div>
    );
  }

  const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
  const totalSteps = plan.steps.length;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Implementation Progress</h2>

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
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-gray-500" />
                )}
              </div>
              <div className="flex-1">
                <span className={step.status === 'completed' ? 'text-gray-400' : ''}>
                  {index + 1}. {step.title}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Type imports for internal use
import type { Plan, PlanStep, Question, Session } from '@claude-code-web/shared';

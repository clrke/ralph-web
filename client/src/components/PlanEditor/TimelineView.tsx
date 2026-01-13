import { memo } from 'react';
import type { Plan, PlanStep, PlanStepStatus } from '@claude-code-web/shared';

interface TimelineViewProps {
  plan: Plan;
  onStepSelect?: (step: PlanStep) => void;
  selectedStepId?: string;
  implementationProgress?: {
    stepId: string;
    retryCount: number;
    message: string;
  } | null;
}

const statusConfig: Record<PlanStepStatus, {
  bg: string;
  border: string;
  text: string;
  icon: string;
  line: string;
}> = {
  pending: {
    bg: 'bg-gray-700',
    border: 'border-gray-600',
    text: 'text-gray-300',
    icon: '○',
    line: 'bg-gray-600'
  },
  in_progress: {
    bg: 'bg-blue-900/50',
    border: 'border-blue-500',
    text: 'text-blue-200',
    icon: '◐',
    line: 'bg-blue-500'
  },
  completed: {
    bg: 'bg-green-900/50',
    border: 'border-green-500',
    text: 'text-green-200',
    icon: '●',
    line: 'bg-green-500'
  },
  blocked: {
    bg: 'bg-yellow-900/50',
    border: 'border-yellow-500',
    text: 'text-yellow-200',
    icon: '⚠',
    line: 'bg-yellow-500'
  },
  needs_review: {
    bg: 'bg-orange-900/50',
    border: 'border-orange-500',
    text: 'text-orange-200',
    icon: '!',
    line: 'bg-orange-500'
  },
  skipped: {
    bg: 'bg-gray-600',
    border: 'border-gray-500',
    text: 'text-gray-400',
    icon: '−',
    line: 'bg-gray-500'
  },
};

function TimelineStep({
  step,
  index,
  isLast,
  isSelected,
  onSelect,
  retryCount,
  progressMessage,
}: {
  step: PlanStep;
  index: number;
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
  retryCount?: number;
  progressMessage?: string;
}) {
  const config = statusConfig[step.status] || statusConfig.pending;
  const isInProgress = step.status === 'in_progress';
  const isBlocked = step.status === 'blocked';
  const needsReview = step.status === 'needs_review';

  return (
    <div className="relative flex gap-4">
      {/* Timeline connector line */}
      <div className="flex flex-col items-center">
        {/* Step indicator */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${config.bg} ${config.border} ${config.text} font-bold text-sm z-10 relative`}
        >
          {isInProgress ? (
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          ) : step.status === 'completed' ? (
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : isBlocked ? (
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ) : needsReview ? (
            <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          ) : step.status === 'skipped' ? (
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          ) : (
            <span>{index + 1}</span>
          )}
        </div>

        {/* Connecting line to next step */}
        {!isLast && (
          <div className={`w-0.5 flex-1 min-h-[40px] ${
            step.status === 'completed' ? config.line : 'bg-gray-600'
          } ${isInProgress ? 'animate-pulse' : ''}`} />
        )}
      </div>

      {/* Step content */}
      <div
        className={`flex-1 pb-6 cursor-pointer transition-all ${
          isSelected ? 'transform scale-[1.02]' : ''
        }`}
        onClick={onSelect}
      >
        <div className={`rounded-lg border-2 p-4 ${config.bg} ${config.border} ${
          isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900' : ''
        }`}>
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${config.bg} ${config.text} border ${config.border}`}>
                Step {index + 1}
              </span>
              <span className={`text-xs ${config.text} capitalize`}>
                {step.status.replace('_', ' ')}
              </span>
            </div>
            {retryCount !== undefined && retryCount > 0 && (
              <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded">
                Retry {retryCount}/3
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className={`font-medium ${config.text}`}>{step.title}</h3>

          {/* Description */}
          {step.description && (
            <p className="text-gray-400 text-sm mt-2 line-clamp-2">{step.description}</p>
          )}

          {/* Progress message for in-progress steps */}
          {isInProgress && progressMessage && (
            <div className="mt-3 p-2 bg-blue-900/30 rounded text-xs text-blue-300">
              {progressMessage}
            </div>
          )}

          {/* Blocked message */}
          {isBlocked && (
            <div className="mt-3 p-2 bg-yellow-900/30 rounded text-xs text-yellow-300 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Waiting for user input
            </div>
          )}

          {/* Needs review message */}
          {needsReview && (
            <div className="mt-3 p-2 bg-orange-900/30 rounded text-xs text-orange-300 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Needs review
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineView({ plan, onStepSelect, selectedStepId, implementationProgress }: TimelineViewProps) {
  // Calculate overall progress
  const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
  const totalSteps = plan.steps.length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <div className="w-full bg-gray-900 rounded-lg p-6 overflow-auto max-h-[600px]">
      {/* Progress header */}
      <div className="mb-6 p-4 bg-gray-800 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">Implementation Progress</span>
          <span className="text-sm font-medium text-gray-200">
            {completedSteps} / {totalSteps} steps ({progressPercent}%)
          </span>
        </div>
        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {plan.steps.map((step, index) => (
          <TimelineStep
            key={step.id}
            step={step}
            index={index}
            isLast={index === plan.steps.length - 1}
            isSelected={selectedStepId === step.id}
            onSelect={() => onStepSelect?.(step)}
            retryCount={
              implementationProgress?.stepId === step.id
                ? implementationProgress.retryCount
                : undefined
            }
            progressMessage={
              implementationProgress?.stepId === step.id
                ? implementationProgress.message
                : undefined
            }
          />
        ))}
      </div>

      {/* Summary footer */}
      {completedSteps === totalSteps && totalSteps > 0 && (
        <div className="mt-4 p-4 bg-green-900/30 border border-green-600 rounded-lg">
          <div className="flex items-center gap-2 text-green-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">All steps completed!</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(TimelineView);

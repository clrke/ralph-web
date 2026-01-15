import type { ExecutionSubState } from '@shared/events';
import { getActivityLabel, getStageName, isErrorAction, isWaitingAction } from '@shared-utils/stageActivity';

export interface StageStatusBadgeProps {
  /** Current stage number (1-6) */
  stage: number;
  /** Execution status */
  status: 'running' | 'idle' | 'error';
  /** Action string for activity context */
  action?: string;
  /** Optional sub-state for granular activity display */
  subState?: ExecutionSubState;
  /** Optional step ID for Stage 3 context */
  stepId?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Badge component for displaying stage status with activity context.
 *
 * Displays: "Stage {N}: {StageLabel} → {ActivityLabel}"
 * - Running: Blue with animated spinner
 * - Idle: Gray
 * - Error: Red
 * - Waiting: Amber with pulse indicator
 */
export function StageStatusBadge({
  stage,
  status,
  action,
  subState,
  stepId,
  className = '',
}: StageStatusBadgeProps) {
  const stageName = getStageName(stage);
  const activityLabel = action ? getActivityLabel(action, subState, stage) : undefined;

  // Determine styling based on status and action
  const isError = status === 'error' || (action && isErrorAction(action));
  const isWaiting = status === 'idle' && action && isWaitingAction(action);
  const isRunning = status === 'running';

  // Color scheme based on state
  const colorClasses = isError
    ? 'bg-red-600/20 text-red-300 border-red-500/30'
    : isWaiting
      ? 'bg-amber-600/20 text-amber-300 border-amber-500/30'
      : isRunning
        ? 'bg-blue-600/20 text-blue-300 border-blue-500/30'
        : 'bg-gray-600/20 text-gray-300 border-gray-500/30';

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${colorClasses} ${className}`}
      role="status"
      aria-label={`Stage ${stage}: ${stageName}${activityLabel ? ` - ${activityLabel}` : ''}`}
    >
      {/* Status indicator */}
      {isRunning && <Spinner />}
      {isWaiting && <PulseIndicator />}
      {isError && <ErrorIcon />}
      {!isRunning && !isWaiting && !isError && <IdleIndicator />}

      {/* Stage label */}
      <span className="font-medium">
        Stage {stage}: {stageName}
      </span>

      {/* Activity label with arrow separator */}
      {activityLabel && (
        <>
          <span className="text-gray-500">→</span>
          <span className="text-sm opacity-90">
            {activityLabel}
            {stepId && <span className="ml-1 opacity-70">[{stepId}]</span>}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Animated spinner for running state
 */
function Spinner() {
  return (
    <svg
      className="w-4 h-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/**
 * Pulsing indicator for waiting state
 */
function PulseIndicator() {
  return (
    <span
      className="w-3 h-3 rounded-full bg-amber-400 animate-pulse"
      aria-hidden="true"
    />
  );
}

/**
 * Error icon for error state
 */
function ErrorIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

/**
 * Small dot indicator for idle state
 */
function IdleIndicator() {
  return (
    <span
      className="w-2 h-2 rounded-full bg-current opacity-50"
      aria-hidden="true"
    />
  );
}

export default StageStatusBadge;

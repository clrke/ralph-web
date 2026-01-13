import type { ValidationAction } from '../../stores/sessionStore';
import { getValidationActionLabel } from './labelUtils';

interface ValidationActionBadgeProps {
  action: ValidationAction;
}

/**
 * Badge component for displaying validation action results.
 * - Passed: Green badge
 * - Filtered: Red badge
 * - Repurposed: Yellow/amber badge
 */
export function ValidationActionBadge({ action }: ValidationActionBadgeProps) {
  const label = getValidationActionLabel(action);

  const colorClass = {
    pass: 'bg-green-600 text-green-100',
    filter: 'bg-red-600 text-red-100',
    repurpose: 'bg-amber-600 text-amber-100',
  }[action] || 'bg-gray-600 text-gray-100';

  return (
    <span className={`px-1.5 py-0.5 text-xs rounded ${colorClass}`}>
      {label}
    </span>
  );
}

interface QuestionStatusBadgeProps {
  status: 'pending' | 'answered';
}

/**
 * Badge component for displaying question answer status.
 * - Pending: Yellow pulsing indicator
 * - Answered: Green checkmark
 */
export function QuestionStatusBadge({ status }: QuestionStatusBadgeProps) {
  if (status === 'answered') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-green-600/30 text-green-300">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Answered
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-amber-600/30 text-amber-300">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      Pending
    </span>
  );
}

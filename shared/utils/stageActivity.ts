import type { ExecutionSubState } from '../types';

/**
 * Human-readable labels for sub-state values.
 * These provide granular activity context within each stage.
 */
export const SUBSTATE_LABELS: Record<ExecutionSubState, string> = {
  spawning_agent: 'Starting Claude agent',
  processing_output: 'Processing response',
  parsing_response: 'Parsing output',
  validating_output: 'Validating results',
  saving_results: 'Saving results',
  waiting_for_input: 'Waiting for input',
  retrying: 'Retrying operation',
};

/**
 * Stage-specific activity labels based on action strings.
 * Maps internal action codes to user-friendly descriptions.
 */
export const STAGE_ACTIVITY_MAP: Record<string, string> = {
  // Stage 1: Discovery
  stage1_started: 'Analyzing codebase',
  stage1_complete: 'Discovery complete',
  stage1_spawn_error: 'Discovery failed',
  stage1_retry: 'Retrying discovery',
  stage1_retry_error: 'Retry failed',

  // Stage 2: Planning
  stage2_started: 'Generating plan',
  stage2_complete: 'Plan generated',
  stage2_spawn_error: 'Planning failed',
  stage2_blocker_review: 'Awaiting plan review',
  stage2_replanning_needed: 'Replanning required',
  stage2_retry: 'Retrying planning',

  // Stage 3: Implementation
  stage3_started: 'Starting implementation',
  stage3_progress: 'Implementing changes',
  stage3_complete: 'Implementation complete',
  stage3_error: 'Implementation error',
  stage3_spawn_error: 'Implementation failed to start',
  stage3_blocked: 'Blocked - awaiting input',
  stage3_waiting: 'Waiting for next step',
  stage3_retry: 'Retrying implementation',
  stage3_retry_error: 'Retry failed',
  stage3_restart_error: 'Restart failed',
  step_spawn_error: 'Step failed to start',

  // Stage 4: PR Creation
  stage4_started: 'Creating pull request',
  stage4_git_prep: 'Preparing git state',
  stage4_git_error: 'Git preparation failed',
  stage4_complete: 'PR created',
  stage4_no_pr_url: 'PR created (no URL)',
  stage4_spawn_error: 'PR creation failed',
  stage4_retry: 'Retrying PR creation',

  // Stage 5: PR Review
  stage5_started: 'Reviewing pull request',
  stage5_complete: 'Review complete',
  stage5_awaiting_user: 'Awaiting your review',
  stage5_spawn_error: 'PR review failed',
  stage5_retry: 'Retrying review',

  // Stage 6: Merge
  stage6_awaiting_approval: 'Awaiting merge approval',

  // Session lifecycle
  session_completed: 'Session completed',

  // Batch/Resume operations
  batch_answers_resume: 'Resuming with answers',
  batch_resume_error: 'Resume failed',

  // Plan revision
  plan_revision_started: 'Revising plan',
  plan_revision_complete: 'Plan revision complete',
  plan_revision_spawn_error: 'Plan revision failed',
};

/**
 * Stage names for display.
 */
export const STAGE_NAMES: Record<number, string> = {
  1: 'Discovery',
  2: 'Planning',
  3: 'Implementation',
  4: 'PR Creation',
  5: 'PR Review',
  6: 'Merge',
};

/**
 * Get a human-readable activity label from the execution status.
 *
 * @param action - The action string from ExecutionStatusEvent
 * @param subState - Optional sub-state for granular activity
 * @param stage - Optional stage number for context
 * @returns A user-friendly activity label
 *
 * @example
 * getActivityLabel('stage1_started') // "Analyzing codebase"
 * getActivityLabel('stage3_progress', 'parsing_response') // "Parsing output"
 * getActivityLabel('unknown_action', undefined, 2) // "Processing..."
 */
export function getActivityLabel(
  action: string,
  subState?: ExecutionSubState,
  stage?: number
): string {
  // If subState is provided and has a label, prioritize it for granular context
  if (subState && SUBSTATE_LABELS[subState]) {
    return SUBSTATE_LABELS[subState];
  }

  // Check if action has a known label
  if (STAGE_ACTIVITY_MAP[action]) {
    return STAGE_ACTIVITY_MAP[action];
  }

  // Fallback: generate a label based on stage or action
  if (stage !== undefined && STAGE_NAMES[stage]) {
    return `${STAGE_NAMES[stage]}...`;
  }

  // Last resort: capitalize and clean up the action string
  return formatActionString(action);
}

/**
 * Format an unknown action string into a readable label.
 * Converts snake_case to Title Case.
 */
function formatActionString(action: string): string {
  if (!action) return 'Processing...';

  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || 'Processing...';
}

/**
 * Get the stage name for a given stage number.
 *
 * @param stage - Stage number (1-6)
 * @returns Stage name or "Unknown" for invalid stages
 */
export function getStageName(stage: number): string {
  return STAGE_NAMES[stage] || 'Unknown';
}

/**
 * Check if an action string indicates an error state.
 */
export function isErrorAction(action: string): boolean {
  return action.includes('error') || action.includes('failed');
}

/**
 * Check if an action string indicates a waiting/blocked state.
 */
export function isWaitingAction(action: string): boolean {
  return (
    action.includes('waiting') ||
    action.includes('blocked') ||
    action.includes('awaiting')
  );
}

/**
 * Check if an action string indicates completion.
 */
export function isCompleteAction(action: string): boolean {
  return action.includes('complete') || action.includes('completed');
}

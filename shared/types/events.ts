import { PlanStepStatus, Plan } from './plan';
import { Question, QuestionAnswer } from './questions';
import { Session, BackoutReason, ChangeComplexity } from './session';

/**
 * Socket Event Types
 * Per README WebSocket Events spec (lines 1050-1139)
 */

// =============================================================================
// Stage Change Events
// =============================================================================

export interface StageChangedEvent {
  sessionId: string;
  previousStage: number;
  currentStage: number;
  status: Session['status'];
  timestamp: string;
}

// =============================================================================
// Question Events
// =============================================================================

export interface QuestionsBatchEvent {
  count: number;
  questions: Question[];
  timestamp: string;
}

export interface QuestionAskedEvent extends Question {
  timestamp: string;
}

export interface QuestionAnsweredEvent {
  id: string;
  answer: QuestionAnswer;
  answeredAt: string;
  timestamp: string;
}

// =============================================================================
// Plan Events
// =============================================================================

export interface PlanUpdatedEvent {
  planVersion: number;
  stepCount: number;
  isApproved: boolean;
  reviewCount?: number;
  steps: Plan['steps'];
  timestamp: string;
}

export interface PlanApprovedEvent {
  planVersion: number;
  timestamp: string;
}

// =============================================================================
// Execution Status Events
// =============================================================================

/**
 * Progress tracking for step-level execution (Stage 3)
 */
export interface StepProgress {
  current: number;
  total: number;
}

/**
 * Sub-state values for granular activity tracking during Claude execution.
 * These represent internal states within each stage.
 */
export type ExecutionSubState =
  | 'spawning_agent'
  | 'processing_output'
  | 'parsing_response'
  | 'validating_output'
  | 'saving_results'
  | 'waiting_for_input'
  | 'retrying';

export interface ExecutionStatusEvent {
  status: 'running' | 'idle' | 'error';
  action: string;
  timestamp: string;
  /** Current stage number (1-7) for context */
  stage?: number;
  /** Granular sub-state within the current action */
  subState?: ExecutionSubState;
  /** Current step ID (for Stage 3 implementation) */
  stepId?: string;
  /** Step-level progress tracking */
  progress?: StepProgress;
  /** Marks rapid intermediate updates for client-side batching/filtering */
  isIntermediate?: boolean;
  /** Target stage for auto-transitions (e.g., plan_changes_detected) */
  autoTransitionTo?: number;
  /** Reason for the status change (e.g., plan_changes_detected) */
  reason?: string;
}

export interface ClaudeOutputEvent {
  output: string;
  isComplete: boolean;
  timestamp: string;
}

// =============================================================================
// Stage 3 Implementation Events
// =============================================================================

export interface StepStartedEvent {
  stepId: string;
  timestamp: string;
}

export interface StepCompletedEvent {
  stepId: string;
  status: PlanStepStatus;
  summary: string;
  filesModified: string[];
  timestamp: string;
}

export interface ImplementationProgressEvent {
  stepId: string;
  status: string;
  filesModified: string[];
  testsStatus: string | null;
  retryCount: number;
  message: string;
  timestamp: string;
}

// =============================================================================
// Plan Review Iteration Events
// =============================================================================

/**
 * Event emitted during plan review iterations to track iteration progress.
 * Used when continuing review after [PLAN_APPROVED] with pending [DECISION_NEEDED] markers.
 */
export interface PlanReviewIterationEvent {
  /** Current iteration number (1-based) */
  currentIteration: number;
  /** Maximum allowed iterations before forced approval */
  maxIterations: number;
  /** Whether the result contained any DECISION_NEEDED markers */
  hasDecisionNeeded: boolean;
  /** Whether the plan is approved (via state or marker) */
  planApproved: boolean;
  /** Decision made: continue reviewing, transition to Stage 3, or skipped due to lock contention */
  decision: 'continue' | 'transition_to_stage_3' | 'lock_contention_skipped';
  /** Number of pending decisions (if hasDecisionNeeded is true) */
  pendingDecisionCount?: number;
  /** Timestamp of the event */
  timestamp: string;
}

// =============================================================================
// Queue Events
// =============================================================================

export interface QueueReorderedEvent {
  projectId: string;
  queuedSessions: Array<{
    featureId: string;
    queuePosition: number;
  }>;
  timestamp: string;
}

// =============================================================================
// Session Backout/Resume Events
// =============================================================================

/** Action taken when backing out from a session */
export type BackoutAction = 'pause' | 'abandon';

/**
 * Event emitted when a session is backed out (paused or abandoned)
 */
export interface SessionBackedOutEvent {
  /** The project ID */
  projectId: string;
  /** The feature ID of the backed out session */
  featureId: string;
  /** The session ID */
  sessionId: string;
  /** The action taken: 'pause' or 'abandon' */
  action: BackoutAction;
  /** The reason for backing out */
  reason: BackoutReason;
  /** The new status of the session ('paused' or 'failed') */
  newStatus: Session['status'];
  /** The stage the session was at when backed out */
  previousStage: number;
  /** Feature ID of the next session that was auto-started (if any) */
  nextSessionId: string | null;
  /** Timestamp of the backout */
  timestamp: string;
}

/**
 * Event emitted when a paused session is resumed
 */
export interface SessionResumedEvent {
  /** The project ID */
  projectId: string;
  /** The feature ID of the resumed session */
  featureId: string;
  /** The session ID */
  sessionId: string;
  /** The new status of the session */
  newStatus: Session['status'];
  /** The stage the session resumed to */
  resumedStage: number;
  /** Whether the session was queued (true) or immediately started (false) */
  wasQueued: boolean;
  /** Queue position if queued (null if not queued) */
  queuePosition: number | null;
  /** Timestamp of the resume */
  timestamp: string;
}

/**
 * Partial session fields that can be updated when editing a queued session
 */
export interface SessionUpdatedFields {
  title?: string;
  featureDescription?: string;
  acceptanceCriteria?: Session['acceptanceCriteria'];
  affectedFiles?: string[];
  technicalNotes?: string;
  baseBranch?: string;
  preferences?: Session['preferences'];
}

/**
 * Event emitted when a queued session is edited
 */
export interface SessionUpdatedEvent {
  /** The project ID */
  projectId: string;
  /** The feature ID of the updated session */
  featureId: string;
  /** The session ID */
  sessionId: string;
  /** The fields that were updated (partial session) */
  updatedFields: SessionUpdatedFields;
  /** The new dataVersion after the update */
  dataVersion: number;
  /** Timestamp of the update */
  timestamp: string;
}

// =============================================================================
// Complexity Assessment Events
// =============================================================================

/**
 * Event emitted when a session's complexity has been assessed
 */
export interface ComplexityAssessedEvent {
  /** The project ID */
  projectId: string;
  /** The feature ID of the assessed session */
  featureId: string;
  /** The session ID */
  sessionId: string;
  /** The assessed complexity level */
  complexity: ChangeComplexity;
  /** Explanation of why this complexity was assigned */
  reason: string;
  /** Suggested agent types based on complexity */
  suggestedAgents: string[];
  /** Whether to use lean prompts for this complexity level */
  useLeanPrompts: boolean;
  /** Duration of the assessment in milliseconds */
  durationMs: number;
  /** Timestamp of the assessment */
  timestamp: string;
}

// =============================================================================
// Server-to-Client Socket Event Map
// =============================================================================

export interface ServerToClientEvents {
  'stage.changed': (data: StageChangedEvent) => void;
  'questions.batch': (data: QuestionsBatchEvent) => void;
  'question.asked': (data: QuestionAskedEvent) => void;
  'question.answered': (data: QuestionAnsweredEvent) => void;
  'plan.updated': (data: PlanUpdatedEvent) => void;
  'plan.approved': (data: PlanApprovedEvent) => void;
  'plan.review.iteration': (data: PlanReviewIterationEvent) => void;
  'execution.status': (data: ExecutionStatusEvent) => void;
  'claude.output': (data: ClaudeOutputEvent) => void;
  'step.started': (data: StepStartedEvent) => void;
  'step.completed': (data: StepCompletedEvent) => void;
  'implementation.progress': (data: ImplementationProgressEvent) => void;
  'queue.reordered': (data: QueueReorderedEvent) => void;
  'session.backedout': (data: SessionBackedOutEvent) => void;
  'session.resumed': (data: SessionResumedEvent) => void;
  'session.updated': (data: SessionUpdatedEvent) => void;
  'complexity.assessed': (data: ComplexityAssessedEvent) => void;
}

// =============================================================================
// Client-to-Server Socket Event Map
// =============================================================================

export interface ClientToServerEvents {
  'join-session': (room: string) => void;
  'leave-session': (room: string) => void;
}

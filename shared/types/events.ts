import { PlanStepStatus, Plan } from './plan';
import { Question, QuestionAnswer } from './questions';
import { Session } from './session';

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
  /** Current stage number (1-5) for context */
  stage?: number;
  /** Granular sub-state within the current action */
  subState?: ExecutionSubState;
  /** Current step ID (for Stage 3 implementation) */
  stepId?: string;
  /** Step-level progress tracking */
  progress?: StepProgress;
  /** Marks rapid intermediate updates for client-side batching/filtering */
  isIntermediate?: boolean;
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
// Server-to-Client Socket Event Map
// =============================================================================

export interface ServerToClientEvents {
  'stage.changed': (data: StageChangedEvent) => void;
  'questions.batch': (data: QuestionsBatchEvent) => void;
  'question.asked': (data: QuestionAskedEvent) => void;
  'question.answered': (data: QuestionAnsweredEvent) => void;
  'plan.updated': (data: PlanUpdatedEvent) => void;
  'plan.approved': (data: PlanApprovedEvent) => void;
  'execution.status': (data: ExecutionStatusEvent) => void;
  'claude.output': (data: ClaudeOutputEvent) => void;
  'step.started': (data: StepStartedEvent) => void;
  'step.completed': (data: StepCompletedEvent) => void;
  'implementation.progress': (data: ImplementationProgressEvent) => void;
}

// =============================================================================
// Client-to-Server Socket Event Map
// =============================================================================

export interface ClientToServerEvents {
  'join-session': (room: string) => void;
  'leave-session': (room: string) => void;
}

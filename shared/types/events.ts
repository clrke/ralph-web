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

export interface ExecutionStatusEvent {
  status: 'running' | 'idle' | 'error';
  action: string;
  timestamp: string;
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

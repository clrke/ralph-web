import { PlanStepStatus } from './plan';

/**
 * Stage 3 Implementation Events
 * These interfaces define the event payloads for real-time step tracking
 */

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

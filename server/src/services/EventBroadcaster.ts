import { Server } from 'socket.io';
import {
  Question,
  Plan,
  PlanStep,
  Session,
  StepStartedEvent,
  StepCompletedEvent,
  ImplementationProgressEvent,
  ExecutionStatusEvent,
  ExecutionSubState,
  StepProgress,
  QueueReorderedEvent,
  SessionBackedOutEvent,
  SessionResumedEvent,
  SessionUpdatedEvent,
  SessionUpdatedFields,
  BackoutReason,
  BackoutAction,
  PlanReviewIterationEvent,
  ComplexityAssessedEvent,
  ChangeComplexity,
} from '@claude-code-web/shared';

/**
 * Optional parameters for extended execution status
 */
export interface ExecutionStatusOptions {
  stage?: number;
  subState?: ExecutionSubState;
  stepId?: string;
  progress?: StepProgress;
  isIntermediate?: boolean;
  queuePosition?: number | null;
  /** Target stage for auto-transitions (e.g., plan_changes_detected) */
  autoTransitionTo?: number;
  /** Reason for the status change (e.g., plan_changes_detected) */
  reason?: string;
  /** Step IDs added during Stage 5 PR Review */
  addedStepIds?: string[];
  /** Step IDs removed during Stage 5 PR Review */
  removedStepIds?: string[];
  /** Step IDs reset to pending due to content changes */
  resetStepIds?: string[];
  /** Current iteration number for plan review iterations */
  iteration?: number;
  /** Maximum iterations for plan review */
  maxIterations?: number;
}

/**
 * Broadcasts real-time events to connected clients via Socket.IO.
 * Per README lines 1050-1139 (WebSocket Events spec)
 */
export class EventBroadcaster {
  constructor(private readonly io: Server) {}

  /**
   * Get the room name for a session
   */
  private getRoom(projectId: string, featureId: string): string {
    return `${projectId}/${featureId}`;
  }

  /**
   * Broadcast stage change event
   */
  stageChanged(session: Session, previousStage: number): void {
    const room = this.getRoom(session.projectId, session.featureId);
    this.io.to(room).emit('stage.changed', {
      sessionId: session.id,
      previousStage,
      currentStage: session.currentStage,
      status: session.status,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast new question(s) asked by Claude
   */
  questionsAsked(projectId: string, featureId: string, questions: Question[]): void {
    const room = this.getRoom(projectId, featureId);

    // Emit batch event with all required Question fields
    this.io.to(room).emit('questions.batch', {
      count: questions.length,
      questions: questions.map(q => ({
        id: q.id,
        stage: q.stage,
        questionType: q.questionType,
        category: q.category,
        priority: q.priority,
        questionText: q.questionText,
        options: q.options,
        answer: q.answer,
        isRequired: q.isRequired,
        askedAt: q.askedAt,
        answeredAt: q.answeredAt,
      })),
      timestamp: new Date().toISOString(),
    });

    // Also emit individual events for each question
    for (const question of questions) {
      this.io.to(room).emit('question.asked', {
        id: question.id,
        stage: question.stage,
        questionType: question.questionType,
        category: question.category,
        priority: question.priority,
        questionText: question.questionText,
        options: question.options,
        answer: question.answer,
        isRequired: question.isRequired,
        askedAt: question.askedAt,
        answeredAt: question.answeredAt,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Broadcast question answered
   */
  questionAnswered(projectId: string, featureId: string, question: Question): void {
    const room = this.getRoom(projectId, featureId);
    this.io.to(room).emit('question.answered', {
      id: question.id,
      answer: question.answer,
      answeredAt: question.answeredAt,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast plan created/updated
   */
  planUpdated(projectId: string, featureId: string, plan: Plan): void {
    const room = this.getRoom(projectId, featureId);
    this.io.to(room).emit('plan.updated', {
      planVersion: plan.planVersion,
      stepCount: plan.steps.length,
      isApproved: plan.isApproved,
      reviewCount: plan.reviewCount,
      steps: plan.steps.map(s => ({
        id: s.id,
        parentId: s.parentId,
        orderIndex: s.orderIndex,
        title: s.title,
        description: s.description,
        status: s.status,
        metadata: s.metadata,
      })),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast plan approved
   */
  planApproved(projectId: string, featureId: string, plan: Plan): void {
    const room = this.getRoom(projectId, featureId);
    this.io.to(room).emit('plan.approved', {
      planVersion: plan.planVersion,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast plan review iteration progress
   * Used when continuing review after [PLAN_APPROVED] with pending [DECISION_NEEDED] markers.
   */
  planReviewIteration(
    projectId: string,
    featureId: string,
    currentIteration: number,
    maxIterations: number,
    hasDecisionNeeded: boolean,
    planApproved: boolean,
    decision: 'continue' | 'transition_to_stage_3' | 'lock_contention_skipped',
    pendingDecisionCount?: number
  ): void {
    const room = this.getRoom(projectId, featureId);
    const event: PlanReviewIterationEvent = {
      currentIteration,
      maxIterations,
      hasDecisionNeeded,
      planApproved,
      decision,
      ...(pendingDecisionCount !== undefined && { pendingDecisionCount }),
      timestamp: new Date().toISOString(),
    };
    this.io.to(room).emit('plan.review.iteration', event);
  }

  /**
   * Broadcast Claude execution status with optional sub-state tracking
   */
  executionStatus(
    projectId: string,
    featureId: string,
    status: 'running' | 'idle' | 'error',
    action: string,
    options?: ExecutionStatusOptions
  ): void {
    const room = this.getRoom(projectId, featureId);
    const event: ExecutionStatusEvent = {
      status,
      action,
      timestamp: new Date().toISOString(),
      ...(options?.stage !== undefined && { stage: options.stage }),
      ...(options?.subState && { subState: options.subState }),
      ...(options?.stepId && { stepId: options.stepId }),
      ...(options?.progress && { progress: options.progress }),
      ...(options?.isIntermediate !== undefined && { isIntermediate: options.isIntermediate }),
      ...(options?.autoTransitionTo !== undefined && { autoTransitionTo: options.autoTransitionTo }),
      ...(options?.reason && { reason: options.reason }),
    };
    this.io.to(room).emit('execution.status', event);
  }

  /**
   * Broadcast Claude output (streaming)
   */
  claudeOutput(projectId: string, featureId: string, output: string, isComplete: boolean): void {
    const room = this.getRoom(projectId, featureId);
    this.io.to(room).emit('claude.output', {
      output,
      isComplete,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast step started event (Stage 3)
   */
  stepStarted(projectId: string, featureId: string, stepId: string): void {
    const room = this.getRoom(projectId, featureId);
    const event: StepStartedEvent = {
      stepId,
      timestamp: new Date().toISOString(),
    };
    this.io.to(room).emit('step.started', event);
  }

  /**
   * Broadcast step completed event (Stage 3)
   */
  stepCompleted(
    projectId: string,
    featureId: string,
    step: PlanStep,
    summary: string,
    filesModified: string[]
  ): void {
    const room = this.getRoom(projectId, featureId);
    const event: StepCompletedEvent = {
      stepId: step.id,
      status: step.status,
      summary,
      filesModified,
      timestamp: new Date().toISOString(),
    };
    this.io.to(room).emit('step.completed', event);
  }

  /**
   * Broadcast implementation progress event (Stage 3 real-time status)
   */
  implementationProgress(
    projectId: string,
    featureId: string,
    progress: Omit<ImplementationProgressEvent, 'timestamp'>
  ): void {
    const room = this.getRoom(projectId, featureId);
    const event: ImplementationProgressEvent = {
      ...progress,
      timestamp: new Date().toISOString(),
    };
    this.io.to(room).emit('implementation.progress', event);
  }

  /**
   * Broadcast queue reordered event (for all sessions in project)
   */
  queueReordered(projectId: string, reorderedSessions: Session[]): void {
    // Broadcast to project room (all clients watching this project)
    const event: QueueReorderedEvent = {
      projectId,
      queuedSessions: reorderedSessions.map(s => ({
        featureId: s.featureId,
        queuePosition: s.queuePosition ?? 0,
      })),
      timestamp: new Date().toISOString(),
    };
    this.io.to(projectId).emit('queue.reordered', event);
  }

  /**
   * Broadcast session backed out event
   */
  sessionBackedOut(
    projectId: string,
    featureId: string,
    sessionId: string,
    action: BackoutAction,
    reason: BackoutReason,
    newStatus: Session['status'],
    previousStage: number,
    nextSessionId: string | null
  ): void {
    const room = this.getRoom(projectId, featureId);
    const event: SessionBackedOutEvent = {
      projectId,
      featureId,
      sessionId,
      action,
      reason,
      newStatus,
      previousStage,
      nextSessionId,
      timestamp: new Date().toISOString(),
    };
    this.io.to(room).emit('session.backedout', event);
    // Also emit to project room so all watchers know about queue changes
    this.io.to(projectId).emit('session.backedout', event);
  }

  /**
   * Broadcast session resumed event
   */
  sessionResumed(
    projectId: string,
    featureId: string,
    sessionId: string,
    newStatus: Session['status'],
    resumedStage: number,
    wasQueued: boolean,
    queuePosition: number | null
  ): void {
    const room = this.getRoom(projectId, featureId);
    const event: SessionResumedEvent = {
      projectId,
      featureId,
      sessionId,
      newStatus,
      resumedStage,
      wasQueued,
      queuePosition,
      timestamp: new Date().toISOString(),
    };
    this.io.to(room).emit('session.resumed', event);
    // Also emit to project room so all watchers know about queue changes
    this.io.to(projectId).emit('session.resumed', event);
  }

  /**
   * Broadcast session updated event (when a queued session is edited)
   */
  sessionUpdated(
    projectId: string,
    featureId: string,
    sessionId: string,
    updatedFields: SessionUpdatedFields,
    dataVersion: number
  ): void {
    const room = this.getRoom(projectId, featureId);
    const event: SessionUpdatedEvent = {
      projectId,
      featureId,
      sessionId,
      updatedFields,
      dataVersion,
      timestamp: new Date().toISOString(),
    };
    this.io.to(room).emit('session.updated', event);
    // Also emit to project room so all watchers (e.g., Dashboard) know about the update
    this.io.to(projectId).emit('session.updated', event);
  }

  /**
   * Broadcast complexity assessed event (at session creation/edit time)
   */
  complexityAssessed(
    projectId: string,
    featureId: string,
    sessionId: string,
    complexity: ChangeComplexity,
    reason: string,
    suggestedAgents: string[],
    useLeanPrompts: boolean,
    durationMs: number
  ): void {
    const room = this.getRoom(projectId, featureId);
    const event: ComplexityAssessedEvent = {
      projectId,
      featureId,
      sessionId,
      complexity,
      reason,
      suggestedAgents,
      useLeanPrompts,
      durationMs,
      timestamp: new Date().toISOString(),
    };
    this.io.to(room).emit('complexity.assessed', event);
    // Also emit to project room so dashboard can show complexity info
    this.io.to(projectId).emit('complexity.assessed', event);
  }
}

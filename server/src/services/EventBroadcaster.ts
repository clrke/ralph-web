import { Server } from 'socket.io';
import { Question, Plan, Session } from '@claude-code-web/shared';

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

    // Emit batch event
    this.io.to(room).emit('questions.batch', {
      count: questions.length,
      questions: questions.map(q => ({
        id: q.id,
        priority: q.priority,
        questionType: q.questionType,
        questionText: q.questionText,
        options: q.options,
        category: q.category,
      })),
      timestamp: new Date().toISOString(),
    });

    // Also emit individual events for each question
    for (const question of questions) {
      this.io.to(room).emit('question.asked', {
        id: question.id,
        priority: question.priority,
        questionType: question.questionType,
        questionText: question.questionText,
        options: question.options,
        category: question.category,
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
      steps: plan.steps.map(s => ({
        id: s.id,
        title: s.title,
        status: s.status,
        parentId: s.parentId,
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
   * Broadcast Claude execution status
   */
  executionStatus(
    projectId: string,
    featureId: string,
    status: 'running' | 'idle' | 'error',
    action: string
  ): void {
    const room = this.getRoom(projectId, featureId);
    this.io.to(room).emit('execution.status', {
      status,
      action,
      timestamp: new Date().toISOString(),
    });
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
}

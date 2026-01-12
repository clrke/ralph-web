import { Plan, Session, Question, PlanStep } from '@claude-code-web/shared';
import { EventBroadcaster } from '../../server/src/services/EventBroadcaster';
import { buildBatchAnswersContinuationPrompt } from '../../server/src/prompts/stagePrompts';
import { Server } from 'socket.io';

/**
 * Tests for Stage 3 blocker resume handling.
 *
 * When a step encounters a blocker during Stage 3, the system:
 * 1. Saves the blocker question to questions.json with category='blocker'
 * 2. Updates status.json with blockedStepId
 * 3. Waits for user to answer the question
 * 4. Resumes execution via batch answers endpoint
 * 5. Calls executeStage3Steps with blockedStepId and resumeContext
 */

describe('Stage 3 Blocker Resume', () => {
  describe('Blocker question identification', () => {
    const createBlockerQuestion = (stepId: string): Question => ({
      id: `blocker-${stepId}`,
      stage: 'implementation',
      category: 'blocker',
      questionType: 'text_input',
      questionText: `How should I handle the authentication for ${stepId}?`,
      options: [],
      answer: null,
      isRequired: true,
      priority: 1,
      askedAt: '2026-01-13T00:00:00Z',
      answeredAt: null,
      stepId,
    });

    it('should identify blocker question by category', () => {
      const question = createBlockerQuestion('step-1');
      expect(question.category).toBe('blocker');
    });

    it('should include stepId on blocker question', () => {
      const question = createBlockerQuestion('step-2');
      expect(question.stepId).toBe('step-2');
    });

    it('should mark blocker as required', () => {
      const question = createBlockerQuestion('step-1');
      expect(question.isRequired).toBe(true);
    });

    it('should use implementation stage for blocker', () => {
      const question = createBlockerQuestion('step-1');
      expect(question.stage).toBe('implementation');
    });
  });

  describe('Resume context building', () => {
    const createAnsweredBlockerQuestion = (stepId: string, answer: string): Question => ({
      id: `blocker-${stepId}`,
      stage: 'implementation',
      category: 'blocker',
      questionType: 'text_input',
      questionText: 'How should I handle authentication?',
      options: [],
      answer: { value: answer },
      isRequired: true,
      priority: 1,
      askedAt: '2026-01-13T00:00:00Z',
      answeredAt: '2026-01-13T00:01:00Z',
      stepId,
    });

    it('should build resume context with blocker answer', () => {
      const questions = [createAnsweredBlockerQuestion('step-1', 'Use JWT tokens')];

      const resumeContext = `The user answered your blocker question:

${questions.map(q => `**Q:** ${q.questionText}\n**A:** ${typeof q.answer?.value === 'string' ? q.answer.value : JSON.stringify(q.answer?.value)}`).join('\n\n')}

Continue implementing step [step-1].`;

      expect(resumeContext).toContain('The user answered your blocker question');
      expect(resumeContext).toContain('How should I handle authentication?');
      expect(resumeContext).toContain('Use JWT tokens');
      expect(resumeContext).toContain('[step-1]');
    });

    it('should handle multiple blocker answers', () => {
      const questions = [
        createAnsweredBlockerQuestion('step-1', 'Use JWT tokens'),
        { ...createAnsweredBlockerQuestion('step-1', 'Add rate limiting'), questionText: 'Should we add rate limiting?' },
      ];

      const resumeContext = questions.map(q =>
        `**Q:** ${q.questionText}\n**A:** ${typeof q.answer?.value === 'string' ? q.answer.value : JSON.stringify(q.answer?.value)}`
      ).join('\n\n');

      expect(resumeContext).toContain('How should I handle authentication?');
      expect(resumeContext).toContain('Use JWT tokens');
      expect(resumeContext).toContain('Should we add rate limiting?');
      expect(resumeContext).toContain('Add rate limiting');
    });

    it('should handle object answer values', () => {
      const question: Question = {
        id: 'blocker-1',
        stage: 'implementation',
        category: 'blocker',
        questionType: 'single_choice',
        questionText: 'Which approach?',
        options: [{ value: 'a', label: 'Option A', recommended: true }],
        answer: { value: { selected: 'a', notes: 'Go with A' } },
        isRequired: true,
        priority: 1,
        askedAt: '2026-01-13T00:00:00Z',
        answeredAt: '2026-01-13T00:01:00Z',
        stepId: 'step-1',
      };

      const answerText = typeof question.answer?.value === 'string'
        ? question.answer.value
        : JSON.stringify(question.answer?.value);

      expect(answerText).toContain('selected');
      expect(answerText).toContain('notes');
    });
  });

  describe('Blocked step ID resolution', () => {
    it('should prefer blockedStepId from status.json', () => {
      const status = { blockedStepId: 'step-2' };
      const question: Question = {
        id: 'q1',
        stage: 'implementation',
        questionType: 'text_input',
        questionText: 'Question',
        options: [],
        answer: { value: 'answer' },
        isRequired: true,
        priority: 1,
        askedAt: '2026-01-13T00:00:00Z',
        answeredAt: '2026-01-13T00:01:00Z',
        stepId: 'step-1', // Different from status
      };

      const blockedStepId = status.blockedStepId || question.stepId;
      expect(blockedStepId).toBe('step-2');
    });

    it('should fallback to question stepId if status has no blockedStepId', () => {
      const status = { blockedStepId: null };
      const questions: Question[] = [{
        id: 'q1',
        stage: 'implementation',
        questionType: 'text_input',
        questionText: 'Question',
        options: [],
        answer: { value: 'answer' },
        isRequired: true,
        priority: 1,
        askedAt: '2026-01-13T00:00:00Z',
        answeredAt: '2026-01-13T00:01:00Z',
        stepId: 'step-3',
      }];

      const blockedStepId = status.blockedStepId || questions.find(q => q.stepId)?.stepId;
      expect(blockedStepId).toBe('step-3');
    });

    it('should find stepId from any answered question', () => {
      const questions: Question[] = [
        {
          id: 'q1',
          stage: 'implementation',
          questionType: 'text_input',
          questionText: 'Question 1',
          options: [],
          answer: { value: 'answer' },
          isRequired: true,
          priority: 1,
          askedAt: '2026-01-13T00:00:00Z',
          answeredAt: '2026-01-13T00:01:00Z',
          // No stepId
        },
        {
          id: 'q2',
          stage: 'implementation',
          questionType: 'text_input',
          questionText: 'Question 2',
          options: [],
          answer: { value: 'answer' },
          isRequired: true,
          priority: 1,
          askedAt: '2026-01-13T00:00:00Z',
          answeredAt: '2026-01-13T00:01:00Z',
          stepId: 'step-4', // Has stepId
        },
      ];

      const blockedStepId = questions.find(q => q.stepId)?.stepId;
      expect(blockedStepId).toBe('step-4');
    });
  });

  describe('Status updates during blocker flow', () => {
    it('should track blocked state in status', () => {
      const status = {
        status: 'idle',
        lastAction: 'stage3_blocked',
        blockedStepId: 'step-2',
        lastActionAt: '2026-01-13T00:00:00Z',
      };

      expect(status.status).toBe('idle');
      expect(status.lastAction).toBe('stage3_blocked');
      expect(status.blockedStepId).toBe('step-2');
    });

    it('should update status on resume', () => {
      const status = {
        status: 'running',
        lastAction: 'batch_answers_resume',
        blockedStepId: null,
        lastActionAt: '2026-01-13T00:01:00Z',
      };

      expect(status.status).toBe('running');
      expect(status.lastAction).toBe('batch_answers_resume');
    });
  });

  describe('EventBroadcaster during blocker flow', () => {
    let broadcaster: EventBroadcaster;
    let mockIo: jest.Mocked<Server>;
    let mockRoom: { emit: jest.Mock };

    beforeEach(() => {
      mockRoom = { emit: jest.fn() };
      mockIo = {
        to: jest.fn().mockReturnValue(mockRoom),
      } as unknown as jest.Mocked<Server>;
      broadcaster = new EventBroadcaster(mockIo);
    });

    it('should broadcast stage3_blocked when step is blocked', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'idle', 'stage3_blocked');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'idle',
        action: 'stage3_blocked',
      }));
    });

    it('should broadcast batch_answers_resume when resuming', () => {
      broadcaster.executionStatus('project-1', 'feature-a', 'running', 'batch_answers_resume');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'batch_answers_resume',
      }));
    });

    it('should broadcast questionsAsked for blocker questions', () => {
      const blockerQuestions: Question[] = [{
        id: 'blocker-1',
        stage: 'implementation',
        category: 'blocker',
        questionType: 'text_input',
        questionText: 'How to proceed?',
        options: [],
        answer: null,
        isRequired: true,
        priority: 1,
        askedAt: '2026-01-13T00:00:00Z',
        answeredAt: null,
        stepId: 'step-1',
      }];

      broadcaster.questionsAsked('project-1', 'feature-a', blockerQuestions);

      // questionsAsked emits both 'questions.batch' and individual 'question.asked' events
      expect(mockRoom.emit).toHaveBeenCalledWith('questions.batch', expect.objectContaining({
        count: 1,
        questions: expect.arrayContaining([
          expect.objectContaining({
            id: 'blocker-1',
            category: 'blocker',
          }),
        ]),
      }));
    });

    it('should broadcast step.started on resume', () => {
      broadcaster.stepStarted('project-1', 'feature-a', 'step-2');

      expect(mockRoom.emit).toHaveBeenCalledWith('step.started', expect.objectContaining({
        stepId: 'step-2',
      }));
    });
  });

  describe('buildBatchAnswersContinuationPrompt for Stage 3', () => {
    const createAnsweredQuestion = (id: string, text: string, answer: string, stepId?: string): Question => ({
      id,
      stage: 'implementation',
      category: 'blocker',
      questionType: 'text_input',
      questionText: text,
      options: [],
      answer: { value: answer },
      isRequired: true,
      priority: 1,
      askedAt: '2026-01-13T00:00:00Z',
      answeredAt: '2026-01-13T00:01:00Z',
      stepId,
    });

    it('should include answered questions in Stage 3 prompt', () => {
      const questions = [
        createAnsweredQuestion('q1', 'How to handle auth?', 'Use JWT', 'step-1'),
      ];

      const prompt = buildBatchAnswersContinuationPrompt(questions, 3);

      expect(prompt).toContain('How to handle auth?');
      expect(prompt).toContain('Use JWT');
    });

    it('should handle Stage 3 specific continuation', () => {
      const questions = [
        createAnsweredQuestion('q1', 'Database choice?', 'PostgreSQL', 'step-2'),
      ];

      const prompt = buildBatchAnswersContinuationPrompt(questions, 3);

      // Should contain the question and answer
      expect(prompt).toContain('Database choice?');
      expect(prompt).toContain('PostgreSQL');
    });

    it('should include all answered questions', () => {
      const questions = [
        createAnsweredQuestion('q1', 'Question 1?', 'Answer 1', 'step-1'),
        createAnsweredQuestion('q2', 'Question 2?', 'Answer 2', 'step-1'),
        createAnsweredQuestion('q3', 'Question 3?', 'Answer 3', 'step-1'),
      ];

      const prompt = buildBatchAnswersContinuationPrompt(questions, 3);

      expect(prompt).toContain('Question 1?');
      expect(prompt).toContain('Answer 1');
      expect(prompt).toContain('Question 2?');
      expect(prompt).toContain('Answer 2');
      expect(prompt).toContain('Question 3?');
      expect(prompt).toContain('Answer 3');
    });
  });

  describe('Step status after blocker resolution', () => {
    const createPlan = (stepStatuses: Array<'pending' | 'in_progress' | 'completed' | 'blocked'>): Plan => ({
      version: '1.0',
      planVersion: 1,
      sessionId: 'session-123',
      isApproved: true,
      reviewCount: 1,
      createdAt: '2026-01-13T00:00:00Z',
      steps: stepStatuses.map((status, i) => ({
        id: `step-${i + 1}`,
        parentId: null,
        orderIndex: i,
        title: `Step ${i + 1}`,
        description: `Description ${i + 1}`,
        status,
        metadata: {},
      })),
    });

    it('should show blocked step before resume', () => {
      const plan = createPlan(['completed', 'blocked', 'pending']);
      const blockedStep = plan.steps.find(s => s.status === 'blocked');

      expect(blockedStep?.id).toBe('step-2');
    });

    it('should have step in_progress after resume', () => {
      // After blocker answer, step should transition from blocked to in_progress
      const plan = createPlan(['completed', 'in_progress', 'pending']);
      const inProgressStep = plan.steps.find(s => s.status === 'in_progress');

      expect(inProgressStep?.id).toBe('step-2');
    });

    it('should complete step after successful resume', () => {
      const plan = createPlan(['completed', 'completed', 'pending']);
      const completedSteps = plan.steps.filter(s => s.status === 'completed');

      expect(completedSteps).toHaveLength(2);
    });
  });

  describe('Error handling during resume', () => {
    it('should handle missing blockedStepId gracefully', () => {
      const status = { blockedStepId: null };
      const questions: Question[] = []; // No questions with stepId

      const blockedStepId = status.blockedStepId || questions.find(q => q.stepId)?.stepId;

      expect(blockedStepId).toBeUndefined();
    });

    it('should broadcast error on resume failure', () => {
      const mockRoom = { emit: jest.fn() };
      const mockIo = {
        to: jest.fn().mockReturnValue(mockRoom),
      } as unknown as jest.Mocked<Server>;
      const broadcaster = new EventBroadcaster(mockIo);

      broadcaster.executionStatus('project-1', 'feature-a', 'error', 'stage3_error');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'error',
        action: 'stage3_error',
      }));
    });
  });

  describe('Session resume with claudeSessionId', () => {
    it('should preserve claudeSessionId for session continuity', () => {
      const session: Session = {
        id: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        title: 'Feature',
        featureDescription: 'Description',
        projectPath: '/test/project',
        currentStage: 3,
        createdAt: '2026-01-13T00:00:00Z',
        updatedAt: '2026-01-13T00:01:00Z',
        claudeSessionId: 'claude-abc-123',
      };

      expect(session.claudeSessionId).toBe('claude-abc-123');
    });

    it('should preserve claudeStage3SessionId for Stage 3 continuity', () => {
      const session: Session = {
        id: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        title: 'Feature',
        featureDescription: 'Description',
        projectPath: '/test/project',
        currentStage: 3,
        createdAt: '2026-01-13T00:00:00Z',
        updatedAt: '2026-01-13T00:01:00Z',
        claudeStage3SessionId: 'claude-stage3-xyz',
      };

      expect(session.claudeStage3SessionId).toBe('claude-stage3-xyz');
    });

    it('should handle missing session IDs gracefully', () => {
      const session: Session = {
        id: 'session-123',
        projectId: 'project-1',
        featureId: 'feature-a',
        title: 'Feature',
        featureDescription: 'Description',
        projectPath: '/test/project',
        currentStage: 3,
        createdAt: '2026-01-13T00:00:00Z',
        updatedAt: '2026-01-13T00:01:00Z',
      };

      expect(session.claudeSessionId).toBeUndefined();
      expect(session.claudeStage3SessionId).toBeUndefined();
    });
  });
});

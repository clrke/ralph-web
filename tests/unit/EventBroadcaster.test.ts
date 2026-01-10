import { Server } from 'socket.io';
import { EventBroadcaster } from '../../server/src/services/EventBroadcaster';
import { Session, Plan, Question } from '@claude-code-web/shared';

describe('EventBroadcaster', () => {
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

  const mockSession: Session = {
    version: '1.0',
    id: 'session-123',
    projectId: 'project-abc',
    featureId: 'add-auth',
    title: 'Add Authentication',
    featureDescription: 'Add JWT auth',
    projectPath: '/test/project',
    acceptanceCriteria: [],
    affectedFiles: [],
    technicalNotes: '',
    baseBranch: 'main',
    featureBranch: 'feature/add-auth',
    baseCommitSha: 'abc123',
    status: 'discovery',
    currentStage: 1,
    replanningCount: 0,
    claudeSessionId: null,
    claudePlanFilePath: null,
    currentPlanVersion: 0,
    sessionExpiresAt: '2026-01-12T00:00:00Z',
    createdAt: '2026-01-11T00:00:00Z',
    updatedAt: '2026-01-11T00:00:00Z',
  };

  describe('stageChanged', () => {
    it('should emit stage.changed event to the correct room', () => {
      broadcaster.stageChanged(mockSession, 0);

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('stage.changed', expect.objectContaining({
        sessionId: 'session-123',
        previousStage: 0,
        currentStage: 1,
        status: 'discovery',
      }));
    });
  });

  describe('questionsAsked', () => {
    const mockQuestions: Question[] = [
      {
        id: 'q1',
        stage: 'discovery',
        questionType: 'single_choice',
        category: 'scope',
        priority: 1,
        questionText: 'Which auth method?',
        options: [
          { value: 'jwt', label: 'JWT tokens', recommended: true },
          { value: 'session', label: 'Session cookies' },
        ],
        answer: null,
        isRequired: true,
        askedAt: '2026-01-11T00:00:00Z',
        answeredAt: null,
      },
    ];

    it('should emit questions.batch event', () => {
      broadcaster.questionsAsked('project-abc', 'add-auth', mockQuestions);

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('questions.batch', expect.objectContaining({
        count: 1,
        questions: expect.arrayContaining([
          expect.objectContaining({
            id: 'q1',
            priority: 1,
            questionText: 'Which auth method?',
          }),
        ]),
      }));
    });

    it('should emit individual question.asked events', () => {
      broadcaster.questionsAsked('project-abc', 'add-auth', mockQuestions);

      expect(mockRoom.emit).toHaveBeenCalledWith('question.asked', expect.objectContaining({
        id: 'q1',
        priority: 1,
        questionType: 'single_choice',
      }));
    });
  });

  describe('questionAnswered', () => {
    const answeredQuestion: Question = {
      id: 'q1',
      stage: 'discovery',
      questionType: 'single_choice',
      category: 'scope',
      priority: 1,
      questionText: 'Which auth method?',
      options: [],
      answer: { value: 'jwt' },
      isRequired: true,
      askedAt: '2026-01-11T00:00:00Z',
      answeredAt: '2026-01-11T01:00:00Z',
    };

    it('should emit question.answered event', () => {
      broadcaster.questionAnswered('project-abc', 'add-auth', answeredQuestion);

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('question.answered', expect.objectContaining({
        id: 'q1',
        answer: { value: 'jwt' },
        answeredAt: '2026-01-11T01:00:00Z',
      }));
    });
  });

  describe('planUpdated', () => {
    const mockPlan: Plan = {
      version: '1.0',
      planVersion: 2,
      sessionId: 'session-123',
      isApproved: false,
      reviewCount: 1,
      createdAt: '2026-01-11T00:00:00Z',
      steps: [
        {
          id: 'step-1',
          parentId: null,
          orderIndex: 0,
          title: 'Create auth middleware',
          description: 'Set up JWT validation',
          status: 'pending',
          metadata: {},
        },
      ],
    };

    it('should emit plan.updated event', () => {
      broadcaster.planUpdated('project-abc', 'add-auth', mockPlan);

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('plan.updated', expect.objectContaining({
        planVersion: 2,
        stepCount: 1,
        isApproved: false,
        steps: expect.arrayContaining([
          expect.objectContaining({
            id: 'step-1',
            title: 'Create auth middleware',
            status: 'pending',
          }),
        ]),
      }));
    });
  });

  describe('planApproved', () => {
    const approvedPlan: Plan = {
      version: '1.0',
      planVersion: 3,
      sessionId: 'session-123',
      isApproved: true,
      reviewCount: 10,
      createdAt: '2026-01-11T00:00:00Z',
      steps: [],
    };

    it('should emit plan.approved event', () => {
      broadcaster.planApproved('project-abc', 'add-auth', approvedPlan);

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('plan.approved', expect.objectContaining({
        planVersion: 3,
      }));
    });
  });

  describe('executionStatus', () => {
    it('should emit execution.status event with running status', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage1_started');

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage1_started',
      }));
    });

    it('should emit execution.status event with error status', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'error', 'stage1_error');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'error',
        action: 'stage1_error',
      }));
    });
  });

  describe('claudeOutput', () => {
    it('should emit claude.output event', () => {
      broadcaster.claudeOutput('project-abc', 'add-auth', 'Exploring codebase...', false);

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('claude.output', expect.objectContaining({
        output: 'Exploring codebase...',
        isComplete: false,
      }));
    });

    it('should emit claude.output event with complete flag', () => {
      broadcaster.claudeOutput('project-abc', 'add-auth', 'Done!', true);

      expect(mockRoom.emit).toHaveBeenCalledWith('claude.output', expect.objectContaining({
        output: 'Done!',
        isComplete: true,
      }));
    });
  });
});

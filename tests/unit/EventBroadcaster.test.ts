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

    it('should include stage when provided in options', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage2_started', { stage: 2 });

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage2_started',
        stage: 2,
      }));
    });

    it('should include subState when provided in options', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage1_started', {
        stage: 1,
        subState: 'spawning_agent',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage1_started',
        stage: 1,
        subState: 'spawning_agent',
      }));
    });

    it('should include stepId when provided in options', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage3_progress', {
        stage: 3,
        stepId: 'step-5',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage3_progress',
        stage: 3,
        stepId: 'step-5',
      }));
    });

    it('should include progress when provided in options', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage3_progress', {
        stage: 3,
        stepId: 'step-3',
        progress: { current: 3, total: 10 },
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage3_progress',
        stage: 3,
        stepId: 'step-3',
        progress: { current: 3, total: 10 },
      }));
    });

    it('should include isIntermediate when provided in options', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage1_started', {
        stage: 1,
        isIntermediate: true,
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage1_started',
        stage: 1,
        isIntermediate: true,
      }));
    });

    it('should include all options together', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage3_progress', {
        stage: 3,
        subState: 'validating_output',
        stepId: 'step-7',
        progress: { current: 7, total: 12 },
        isIntermediate: false,
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'stage3_progress',
        stage: 3,
        subState: 'validating_output',
        stepId: 'step-7',
        progress: { current: 7, total: 12 },
        isIntermediate: false,
      }));
    });

    it('should not include undefined options in event', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'idle', 'stage2_complete', { stage: 2 });

      const emitCall = mockRoom.emit.mock.calls.find(call => call[0] === 'execution.status');
      expect(emitCall).toBeDefined();
      const eventData = emitCall![1];

      expect(eventData.stage).toBe(2);
      expect(eventData).not.toHaveProperty('subState');
      expect(eventData).not.toHaveProperty('stepId');
      expect(eventData).not.toHaveProperty('progress');
      expect(eventData).not.toHaveProperty('isIntermediate');
    });

    it('should work without options for backward compatibility', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'legacy_action');

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'legacy_action',
        timestamp: expect.any(String),
      }));
    });

    it('should include autoTransitionTo and reason for plan_changes_detected', () => {
      broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'plan_changes_detected', {
        stage: 5,
        autoTransitionTo: 2,
        reason: 'Plan steps modified during PR Review',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
        status: 'running',
        action: 'plan_changes_detected',
        stage: 5,
        autoTransitionTo: 2,
        reason: 'Plan steps modified during PR Review',
      }));
    });

    describe('granular sub-states', () => {
      it('should emit spawning_agent sub-state', () => {
        broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage1_started', {
          stage: 1,
          subState: 'spawning_agent',
        });

        expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
          status: 'running',
          action: 'stage1_started',
          stage: 1,
          subState: 'spawning_agent',
        }));
      });

      it('should emit processing_output sub-state', () => {
        broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage2_started', {
          stage: 2,
          subState: 'processing_output',
        });

        expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
          status: 'running',
          action: 'stage2_started',
          stage: 2,
          subState: 'processing_output',
        }));
      });

      it('should emit parsing_response sub-state', () => {
        broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage3_started', {
          stage: 3,
          subState: 'parsing_response',
        });

        expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
          status: 'running',
          action: 'stage3_started',
          stage: 3,
          subState: 'parsing_response',
        }));
      });

      it('should emit validating_output sub-state', () => {
        broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage4_started', {
          stage: 4,
          subState: 'validating_output',
        });

        expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
          status: 'running',
          action: 'stage4_started',
          stage: 4,
          subState: 'validating_output',
        }));
      });

      it('should emit saving_results sub-state', () => {
        broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage5_started', {
          stage: 5,
          subState: 'saving_results',
        });

        expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
          status: 'running',
          action: 'stage5_started',
          stage: 5,
          subState: 'saving_results',
        }));
      });

      it('should emit sub-state with stepId for step execution', () => {
        broadcaster.executionStatus('project-abc', 'add-auth', 'running', 'stage3_progress', {
          stage: 3,
          stepId: 'step-3',
          subState: 'processing_output',
        });

        expect(mockRoom.emit).toHaveBeenCalledWith('execution.status', expect.objectContaining({
          status: 'running',
          action: 'stage3_progress',
          stage: 3,
          stepId: 'step-3',
          subState: 'processing_output',
        }));
      });
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

  describe('stepStarted', () => {
    it('should emit step.started event to the correct room', () => {
      broadcaster.stepStarted('project-abc', 'add-auth', 'step-1');

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('step.started', expect.objectContaining({
        stepId: 'step-1',
      }));
    });

    it('should include timestamp in step.started event', () => {
      broadcaster.stepStarted('project-abc', 'add-auth', 'step-2');

      expect(mockRoom.emit).toHaveBeenCalledWith('step.started', expect.objectContaining({
        stepId: 'step-2',
        timestamp: expect.any(String),
      }));
    });

    it('should emit to different rooms for different sessions', () => {
      broadcaster.stepStarted('project-1', 'feature-a', 'step-1');
      broadcaster.stepStarted('project-2', 'feature-b', 'step-1');

      expect(mockIo.to).toHaveBeenCalledWith('project-1/feature-a');
      expect(mockIo.to).toHaveBeenCalledWith('project-2/feature-b');
    });
  });

  describe('stepCompleted', () => {
    const mockStep = {
      id: 'step-1',
      parentId: null,
      orderIndex: 0,
      title: 'Create auth middleware',
      description: 'Set up JWT validation',
      status: 'completed' as const,
      metadata: { completedAt: '2026-01-11T01:00:00Z' },
    };

    it('should emit step.completed event to the correct room', () => {
      broadcaster.stepCompleted(
        'project-abc',
        'add-auth',
        mockStep,
        'Implemented JWT validation middleware',
        ['src/auth/middleware.ts', 'src/auth/types.ts']
      );

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('step.completed', expect.objectContaining({
        stepId: 'step-1',
        status: 'completed',
        summary: 'Implemented JWT validation middleware',
        filesModified: ['src/auth/middleware.ts', 'src/auth/types.ts'],
      }));
    });

    it('should include timestamp in step.completed event', () => {
      broadcaster.stepCompleted(
        'project-abc',
        'add-auth',
        mockStep,
        'Done',
        []
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('step.completed', expect.objectContaining({
        timestamp: expect.any(String),
      }));
    });

    it('should handle empty filesModified array', () => {
      broadcaster.stepCompleted(
        'project-abc',
        'add-auth',
        mockStep,
        'Documentation only change',
        []
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('step.completed', expect.objectContaining({
        filesModified: [],
      }));
    });

    it('should handle blocked step status', () => {
      const blockedStep = {
        ...mockStep,
        status: 'blocked' as const,
        metadata: { blockedReason: 'Tests failing after 3 retries' },
      };

      broadcaster.stepCompleted(
        'project-abc',
        'add-auth',
        blockedStep,
        'Step blocked due to test failures',
        ['src/auth/middleware.ts']
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('step.completed', expect.objectContaining({
        stepId: 'step-1',
        status: 'blocked',
      }));
    });

    it('should handle large file lists', () => {
      const manyFiles = Array.from({ length: 50 }, (_, i) => `src/file-${i}.ts`);

      broadcaster.stepCompleted(
        'project-abc',
        'add-auth',
        mockStep,
        'Large refactoring',
        manyFiles
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('step.completed', expect.objectContaining({
        filesModified: expect.arrayContaining(['src/file-0.ts', 'src/file-49.ts']),
      }));
    });
  });

  describe('implementationProgress', () => {
    it('should emit implementation.progress event to the correct room', () => {
      broadcaster.implementationProgress('project-abc', 'add-auth', {
        stepId: 'step-1',
        status: 'in_progress',
        filesModified: ['src/auth/middleware.ts'],
        testsStatus: null,
        retryCount: 0,
        message: 'Writing authentication logic',
      });

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        stepId: 'step-1',
        status: 'in_progress',
        filesModified: ['src/auth/middleware.ts'],
        testsStatus: null,
        retryCount: 0,
        message: 'Writing authentication logic',
      }));
    });

    it('should include timestamp in implementation.progress event', () => {
      broadcaster.implementationProgress('project-abc', 'add-auth', {
        stepId: 'step-1',
        status: 'implementing',
        filesModified: [],
        testsStatus: null,
        retryCount: 0,
        message: 'Starting',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        timestamp: expect.any(String),
      }));
    });

    it('should handle testing status with passing tests', () => {
      broadcaster.implementationProgress('project-abc', 'add-auth', {
        stepId: 'step-2',
        status: 'testing',
        filesModified: ['src/auth/middleware.ts', 'tests/auth.test.ts'],
        testsStatus: 'passing',
        retryCount: 0,
        message: 'All tests passing',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        status: 'testing',
        testsStatus: 'passing',
        retryCount: 0,
      }));
    });

    it('should handle testing status with failing tests and retry count', () => {
      broadcaster.implementationProgress('project-abc', 'add-auth', {
        stepId: 'step-2',
        status: 'fixing',
        filesModified: ['src/auth/middleware.ts'],
        testsStatus: 'failing',
        retryCount: 2,
        message: 'Fixing test failures (attempt 2 of 3)',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        status: 'fixing',
        testsStatus: 'failing',
        retryCount: 2,
        message: 'Fixing test failures (attempt 2 of 3)',
      }));
    });

    it('should handle committing status', () => {
      broadcaster.implementationProgress('project-abc', 'add-auth', {
        stepId: 'step-1',
        status: 'committing',
        filesModified: ['src/auth/middleware.ts', 'tests/auth.test.ts'],
        testsStatus: 'passing',
        retryCount: 0,
        message: 'Creating git commit',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        status: 'committing',
        testsStatus: 'passing',
      }));
    });

    it('should handle blocked status at max retries', () => {
      broadcaster.implementationProgress('project-abc', 'add-auth', {
        stepId: 'step-2',
        status: 'blocked',
        filesModified: ['src/auth/middleware.ts'],
        testsStatus: 'failing',
        retryCount: 3,
        message: 'Max retries exceeded - raising blocker',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        status: 'blocked',
        retryCount: 3,
      }));
    });

    it('should emit progress for different steps independently', () => {
      broadcaster.implementationProgress('project-abc', 'add-auth', {
        stepId: 'step-1',
        status: 'in_progress',
        filesModified: ['file1.ts'],
        testsStatus: null,
        retryCount: 0,
        message: 'Working on step 1',
      });

      broadcaster.implementationProgress('project-abc', 'add-auth', {
        stepId: 'step-2',
        status: 'in_progress',
        filesModified: ['file2.ts'],
        testsStatus: null,
        retryCount: 0,
        message: 'Working on step 2',
      });

      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        stepId: 'step-1',
        filesModified: ['file1.ts'],
      }));
      expect(mockRoom.emit).toHaveBeenCalledWith('implementation.progress', expect.objectContaining({
        stepId: 'step-2',
        filesModified: ['file2.ts'],
      }));
    });
  });

  describe('sessionUpdated', () => {
    it('should emit session.updated event to both session room and project room', () => {
      broadcaster.sessionUpdated(
        'project-abc',
        'add-auth',
        'session-123',
        { title: 'Updated Title' },
        2
      );

      // Should emit to session room
      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      // Should emit to project room
      expect(mockIo.to).toHaveBeenCalledWith('project-abc');
      expect(mockRoom.emit).toHaveBeenCalledWith('session.updated', expect.objectContaining({
        projectId: 'project-abc',
        featureId: 'add-auth',
        sessionId: 'session-123',
        updatedFields: { title: 'Updated Title' },
        dataVersion: 2,
      }));
    });

    it('should include timestamp in the event', () => {
      broadcaster.sessionUpdated(
        'project-abc',
        'add-auth',
        'session-123',
        { title: 'Test' },
        1
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('session.updated', expect.objectContaining({
        timestamp: expect.any(String),
      }));
    });

    it('should handle single field update', () => {
      broadcaster.sessionUpdated(
        'project-abc',
        'add-auth',
        'session-123',
        { featureDescription: 'New description' },
        3
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('session.updated', expect.objectContaining({
        updatedFields: { featureDescription: 'New description' },
        dataVersion: 3,
      }));
    });

    it('should handle multiple fields update', () => {
      const updatedFields = {
        title: 'New Title',
        featureDescription: 'New description',
        technicalNotes: 'New notes',
        baseBranch: 'develop',
      };

      broadcaster.sessionUpdated(
        'project-abc',
        'add-auth',
        'session-123',
        updatedFields,
        5
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('session.updated', expect.objectContaining({
        updatedFields,
        dataVersion: 5,
      }));
    });

    it('should handle acceptanceCriteria update', () => {
      const updatedFields = {
        acceptanceCriteria: [
          { text: 'AC 1', checked: false, type: 'manual' as const },
          { text: 'AC 2', checked: true, type: 'automated' as const },
        ],
      };

      broadcaster.sessionUpdated(
        'project-abc',
        'add-auth',
        'session-123',
        updatedFields,
        2
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('session.updated', expect.objectContaining({
        updatedFields: {
          acceptanceCriteria: expect.arrayContaining([
            expect.objectContaining({ text: 'AC 1' }),
            expect.objectContaining({ text: 'AC 2' }),
          ]),
        },
      }));
    });

    it('should handle affectedFiles update', () => {
      broadcaster.sessionUpdated(
        'project-abc',
        'add-auth',
        'session-123',
        { affectedFiles: ['src/app.ts', 'src/utils.ts'] },
        4
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('session.updated', expect.objectContaining({
        updatedFields: {
          affectedFiles: ['src/app.ts', 'src/utils.ts'],
        },
      }));
    });

    it('should handle preferences update', () => {
      const preferences = {
        riskComfort: 'high' as const,
        speedVsQuality: 'quality' as const,
        scopeFlexibility: 'open' as const,
        detailLevel: 'detailed' as const,
        autonomyLevel: 'autonomous' as const,
      };

      broadcaster.sessionUpdated(
        'project-abc',
        'add-auth',
        'session-123',
        { preferences },
        6
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('session.updated', expect.objectContaining({
        updatedFields: { preferences },
        dataVersion: 6,
      }));
    });

    it('should handle empty updatedFields', () => {
      broadcaster.sessionUpdated(
        'project-abc',
        'add-auth',
        'session-123',
        {},
        1
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('session.updated', expect.objectContaining({
        updatedFields: {},
        dataVersion: 1,
      }));
    });

    it('should emit to both rooms for dashboard synchronization', () => {
      broadcaster.sessionUpdated(
        'project-xyz',
        'feature-456',
        'session-789',
        { title: 'Dashboard Test' },
        2
      );

      // Verify both session room and project room receive the event
      const calls = mockIo.to.mock.calls;
      const roomNames = calls.map(call => call[0]);
      expect(roomNames).toContain('project-xyz/feature-456'); // Session room
      expect(roomNames).toContain('project-xyz'); // Project room
    });
  });

  describe('planReviewIteration', () => {
    it('should emit plan.review.iteration event to the correct room', () => {
      broadcaster.planReviewIteration(
        'project-abc',
        'add-auth',
        3,
        10,
        true,
        true,
        'continue',
        5
      );

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('plan.review.iteration', expect.objectContaining({
        currentIteration: 3,
        maxIterations: 10,
        hasDecisionNeeded: true,
        planApproved: true,
        decision: 'continue',
        pendingDecisionCount: 5,
      }));
    });

    it('should include timestamp in the event', () => {
      broadcaster.planReviewIteration(
        'project-abc',
        'add-auth',
        1,
        10,
        true,
        false,
        'continue'
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('plan.review.iteration', expect.objectContaining({
        timestamp: expect.any(String),
      }));
    });

    it('should omit pendingDecisionCount when undefined', () => {
      broadcaster.planReviewIteration(
        'project-abc',
        'add-auth',
        4,
        10,
        false,
        true,
        'transition_to_stage_3'
      );

      const emitCall = mockRoom.emit.mock.calls.find(call => call[0] === 'plan.review.iteration');
      expect(emitCall).toBeDefined();
      const eventData = emitCall![1];

      expect(eventData).not.toHaveProperty('pendingDecisionCount');
      expect(eventData.decision).toBe('transition_to_stage_3');
    });

    it('should handle continue decision with pending decisions', () => {
      broadcaster.planReviewIteration(
        'project-abc',
        'add-auth',
        5,
        10,
        true,
        true,
        'continue',
        3
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('plan.review.iteration', expect.objectContaining({
        currentIteration: 5,
        hasDecisionNeeded: true,
        planApproved: true,
        decision: 'continue',
        pendingDecisionCount: 3,
      }));
    });

    it('should handle transition_to_stage_3 decision when no decisions remain', () => {
      broadcaster.planReviewIteration(
        'project-abc',
        'add-auth',
        4,
        10,
        false,
        true,
        'transition_to_stage_3'
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('plan.review.iteration', expect.objectContaining({
        currentIteration: 4,
        hasDecisionNeeded: false,
        planApproved: true,
        decision: 'transition_to_stage_3',
      }));
    });

    it('should handle max iterations reached with decisions still pending', () => {
      broadcaster.planReviewIteration(
        'project-abc',
        'add-auth',
        10,
        10,
        true,
        true,
        'transition_to_stage_3',
        2
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('plan.review.iteration', expect.objectContaining({
        currentIteration: 10,
        maxIterations: 10,
        hasDecisionNeeded: true,
        decision: 'transition_to_stage_3',
        pendingDecisionCount: 2,
      }));
    });

    it('should handle first iteration', () => {
      broadcaster.planReviewIteration(
        'project-abc',
        'add-auth',
        1,
        10,
        true,
        false,
        'continue',
        1
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('plan.review.iteration', expect.objectContaining({
        currentIteration: 1,
        planApproved: false,
        decision: 'continue',
      }));
    });

    it('should handle custom maxIterations value', () => {
      broadcaster.planReviewIteration(
        'project-abc',
        'add-auth',
        3,
        5,
        true,
        true,
        'continue',
        2
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('plan.review.iteration', expect.objectContaining({
        maxIterations: 5,
      }));
    });
  });

  describe('complexityAssessed', () => {
    it('should emit complexity.assessed event to the correct room', () => {
      broadcaster.complexityAssessed(
        'project-abc',
        'add-auth',
        'session-123',
        'simple',
        'Frontend label change only',
        ['frontend'],
        true,
        1500
      );

      expect(mockIo.to).toHaveBeenCalledWith('project-abc/add-auth');
      expect(mockRoom.emit).toHaveBeenCalledWith('complexity.assessed', expect.objectContaining({
        projectId: 'project-abc',
        featureId: 'add-auth',
        sessionId: 'session-123',
        complexity: 'simple',
        reason: 'Frontend label change only',
        suggestedAgents: ['frontend'],
        useLeanPrompts: true,
        durationMs: 1500,
      }));
    });

    it('should include timestamp in the event', () => {
      broadcaster.complexityAssessed(
        'project-abc',
        'add-auth',
        'session-123',
        'trivial',
        'Single line change',
        ['frontend'],
        true,
        500
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('complexity.assessed', expect.objectContaining({
        timestamp: expect.any(String),
      }));
    });

    it('should emit to both session room and project room', () => {
      broadcaster.complexityAssessed(
        'project-xyz',
        'feature-456',
        'session-789',
        'normal',
        'Standard feature',
        ['frontend', 'backend', 'testing'],
        false,
        2000
      );

      // Verify both session room and project room receive the event
      const calls = mockIo.to.mock.calls;
      const roomNames = calls.map(call => call[0]);
      expect(roomNames).toContain('project-xyz/feature-456'); // Session room
      expect(roomNames).toContain('project-xyz'); // Project room
    });

    it('should handle trivial complexity', () => {
      broadcaster.complexityAssessed(
        'project-abc',
        'add-auth',
        'session-123',
        'trivial',
        'Typo fix in README',
        ['documentation'],
        true,
        800
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('complexity.assessed', expect.objectContaining({
        complexity: 'trivial',
        suggestedAgents: ['documentation'],
        useLeanPrompts: true,
      }));
    });

    it('should handle complex complexity with all agents', () => {
      broadcaster.complexityAssessed(
        'project-abc',
        'add-auth',
        'session-123',
        'complex',
        'Full authentication system with OAuth2',
        ['frontend', 'backend', 'database', 'testing', 'infrastructure', 'documentation'],
        false,
        3500
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('complexity.assessed', expect.objectContaining({
        complexity: 'complex',
        suggestedAgents: ['frontend', 'backend', 'database', 'testing', 'infrastructure', 'documentation'],
        useLeanPrompts: false,
      }));
    });

    it('should handle empty suggestedAgents array', () => {
      broadcaster.complexityAssessed(
        'project-abc',
        'add-auth',
        'session-123',
        'normal',
        'Standard feature',
        [],
        false,
        2000
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('complexity.assessed', expect.objectContaining({
        suggestedAgents: [],
      }));
    });

    it('should track durationMs accurately', () => {
      broadcaster.complexityAssessed(
        'project-abc',
        'add-auth',
        'session-123',
        'simple',
        'Quick change',
        ['frontend'],
        true,
        123
      );

      expect(mockRoom.emit).toHaveBeenCalledWith('complexity.assessed', expect.objectContaining({
        durationMs: 123,
      }));
    });
  });
});

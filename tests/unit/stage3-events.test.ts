import {
  StepStartedEvent,
  StepCompletedEvent,
  ImplementationProgressEvent,
  ServerToClientEvents,
  PlanStepStatus,
} from '@claude-code-web/shared';

describe('Stage 3 Event Types', () => {
  describe('StepStartedEvent', () => {
    it('should have required fields', () => {
      const event: StepStartedEvent = {
        stepId: 'step-1',
        timestamp: '2026-01-13T00:00:00Z',
      };

      expect(event.stepId).toBe('step-1');
      expect(event.timestamp).toBe('2026-01-13T00:00:00Z');
    });

    it('should accept any valid step ID format', () => {
      const validIds = ['step-1', 'step-10', 'custom-step-id', 'STEP_001'];

      validIds.forEach(stepId => {
        const event: StepStartedEvent = {
          stepId,
          timestamp: new Date().toISOString(),
        };
        expect(event.stepId).toBe(stepId);
      });
    });
  });

  describe('StepCompletedEvent', () => {
    it('should have all required fields', () => {
      const event: StepCompletedEvent = {
        stepId: 'step-1',
        status: 'completed',
        summary: 'Implemented authentication middleware',
        filesModified: ['src/middleware/auth.ts', 'src/routes/login.ts'],
        timestamp: '2026-01-13T01:00:00Z',
      };

      expect(event.stepId).toBe('step-1');
      expect(event.status).toBe('completed');
      expect(event.summary).toBe('Implemented authentication middleware');
      expect(event.filesModified).toHaveLength(2);
      expect(event.filesModified).toContain('src/middleware/auth.ts');
      expect(event.timestamp).toBe('2026-01-13T01:00:00Z');
    });

    it('should allow empty filesModified array', () => {
      const event: StepCompletedEvent = {
        stepId: 'step-1',
        status: 'completed',
        summary: 'Updated configuration only',
        filesModified: [],
        timestamp: '2026-01-13T01:00:00Z',
      };

      expect(event.filesModified).toHaveLength(0);
    });

    it('should support all PlanStepStatus values', () => {
      const statuses: PlanStepStatus[] = ['pending', 'in_progress', 'completed', 'blocked', 'needs_review'];

      statuses.forEach(status => {
        const event: StepCompletedEvent = {
          stepId: 'step-1',
          status,
          summary: `Step with status: ${status}`,
          filesModified: [],
          timestamp: new Date().toISOString(),
        };
        expect(event.status).toBe(status);
      });
    });

    it('should handle large file lists', () => {
      const manyFiles = Array.from({ length: 100 }, (_, i) => `file-${i}.ts`);

      const event: StepCompletedEvent = {
        stepId: 'step-1',
        status: 'completed',
        summary: 'Large refactoring',
        filesModified: manyFiles,
        timestamp: new Date().toISOString(),
      };

      expect(event.filesModified).toHaveLength(100);
    });
  });

  describe('ImplementationProgressEvent', () => {
    it('should have all required fields', () => {
      const event: ImplementationProgressEvent = {
        stepId: 'step-1',
        status: 'in_progress',
        filesModified: ['src/app.ts'],
        testsStatus: 'passing',
        retryCount: 0,
        message: 'Writing authentication logic',
        timestamp: '2026-01-13T00:30:00Z',
      };

      expect(event.stepId).toBe('step-1');
      expect(event.status).toBe('in_progress');
      expect(event.filesModified).toContain('src/app.ts');
      expect(event.testsStatus).toBe('passing');
      expect(event.retryCount).toBe(0);
      expect(event.message).toBe('Writing authentication logic');
      expect(event.timestamp).toBe('2026-01-13T00:30:00Z');
    });

    it('should allow null testsStatus', () => {
      const event: ImplementationProgressEvent = {
        stepId: 'step-1',
        status: 'implementing',
        filesModified: [],
        testsStatus: null,
        retryCount: 0,
        message: 'Starting implementation',
        timestamp: new Date().toISOString(),
      };

      expect(event.testsStatus).toBeNull();
    });

    it('should track retry counts', () => {
      const events: ImplementationProgressEvent[] = [
        {
          stepId: 'step-1',
          status: 'testing',
          filesModified: ['src/app.ts'],
          testsStatus: 'failing',
          retryCount: 0,
          message: 'Initial test run failed',
          timestamp: new Date().toISOString(),
        },
        {
          stepId: 'step-1',
          status: 'fixing',
          filesModified: ['src/app.ts'],
          testsStatus: 'failing',
          retryCount: 1,
          message: 'First fix attempt',
          timestamp: new Date().toISOString(),
        },
        {
          stepId: 'step-1',
          status: 'fixing',
          filesModified: ['src/app.ts'],
          testsStatus: 'failing',
          retryCount: 2,
          message: 'Second fix attempt',
          timestamp: new Date().toISOString(),
        },
        {
          stepId: 'step-1',
          status: 'blocked',
          filesModified: ['src/app.ts'],
          testsStatus: 'failing',
          retryCount: 3,
          message: 'Max retries reached, blocked',
          timestamp: new Date().toISOString(),
        },
      ];

      expect(events[0].retryCount).toBe(0);
      expect(events[1].retryCount).toBe(1);
      expect(events[2].retryCount).toBe(2);
      expect(events[3].retryCount).toBe(3);
    });

    it('should support various status strings', () => {
      const statuses = ['implementing', 'testing', 'fixing', 'committing', 'blocked', 'in_progress'];

      statuses.forEach(status => {
        const event: ImplementationProgressEvent = {
          stepId: 'step-1',
          status,
          filesModified: [],
          testsStatus: null,
          retryCount: 0,
          message: `Status: ${status}`,
          timestamp: new Date().toISOString(),
        };
        expect(event.status).toBe(status);
      });
    });
  });

  describe('ServerToClientEvents', () => {
    it('should include step.started event handler type', () => {
      // Type check: ServerToClientEvents should have step.started
      const eventMap: ServerToClientEvents = {
        'stage.changed': () => {},
        'questions.batch': () => {},
        'question.asked': () => {},
        'question.answered': () => {},
        'plan.updated': () => {},
        'plan.approved': () => {},
        'execution.status': () => {},
        'claude.output': () => {},
        'step.started': (data: StepStartedEvent) => {
          expect(data.stepId).toBeDefined();
          expect(data.timestamp).toBeDefined();
        },
        'step.completed': () => {},
        'implementation.progress': () => {},
      };

      expect(eventMap['step.started']).toBeDefined();
    });

    it('should include step.completed event handler type', () => {
      const handler: ServerToClientEvents['step.completed'] = (data: StepCompletedEvent) => {
        expect(data.stepId).toBeDefined();
        expect(data.status).toBeDefined();
        expect(data.summary).toBeDefined();
        expect(data.filesModified).toBeDefined();
        expect(data.timestamp).toBeDefined();
      };

      // Simulate calling the handler
      handler({
        stepId: 'step-1',
        status: 'completed',
        summary: 'Test completed',
        filesModified: [],
        timestamp: new Date().toISOString(),
      });
    });

    it('should include implementation.progress event handler type', () => {
      const handler: ServerToClientEvents['implementation.progress'] = (data: ImplementationProgressEvent) => {
        expect(data.stepId).toBeDefined();
        expect(data.status).toBeDefined();
        expect(data.filesModified).toBeDefined();
        expect(data.testsStatus).toBeDefined(); // can be null but key exists
        expect(data.retryCount).toBeDefined();
        expect(data.message).toBeDefined();
        expect(data.timestamp).toBeDefined();
      };

      // Simulate calling the handler
      handler({
        stepId: 'step-1',
        status: 'implementing',
        filesModified: ['file.ts'],
        testsStatus: 'passing',
        retryCount: 0,
        message: 'Test message',
        timestamp: new Date().toISOString(),
      });
    });
  });

  describe('Type exports from shared/types/index', () => {
    it('should export all Stage 3 event types', () => {
      // These imports would fail at compile time if types weren't exported
      const stepStarted: StepStartedEvent = {
        stepId: 'test',
        timestamp: new Date().toISOString(),
      };

      const stepCompleted: StepCompletedEvent = {
        stepId: 'test',
        status: 'completed',
        summary: 'test',
        filesModified: [],
        timestamp: new Date().toISOString(),
      };

      const implProgress: ImplementationProgressEvent = {
        stepId: 'test',
        status: 'implementing',
        filesModified: [],
        testsStatus: null,
        retryCount: 0,
        message: 'test',
        timestamp: new Date().toISOString(),
      };

      expect(stepStarted).toBeDefined();
      expect(stepCompleted).toBeDefined();
      expect(implProgress).toBeDefined();
    });
  });
});

import {
  ExecutionStatusEvent,
  ExecutionSubState,
  StepProgress,
  ServerToClientEvents,
} from '@claude-code-web/shared';

describe('ExecutionStatusEvent Extended Types', () => {
  describe('ExecutionStatusEvent base fields', () => {
    it('should have required base fields', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Analyzing codebase',
        timestamp: '2026-01-15T00:00:00Z',
      };

      expect(event.status).toBe('running');
      expect(event.action).toBe('Analyzing codebase');
      expect(event.timestamp).toBe('2026-01-15T00:00:00Z');
    });

    it('should support all status values', () => {
      const statuses: ExecutionStatusEvent['status'][] = ['running', 'idle', 'error'];

      statuses.forEach(status => {
        const event: ExecutionStatusEvent = {
          status,
          action: `Test action for ${status}`,
          timestamp: new Date().toISOString(),
        };
        expect(event.status).toBe(status);
      });
    });
  });

  describe('ExecutionStatusEvent optional stage field', () => {
    it('should accept stage number 1-5', () => {
      const stages = [1, 2, 3, 4, 5];

      stages.forEach(stage => {
        const event: ExecutionStatusEvent = {
          status: 'running',
          action: `Stage ${stage} action`,
          timestamp: new Date().toISOString(),
          stage,
        };
        expect(event.stage).toBe(stage);
      });
    });

    it('should allow undefined stage for backward compatibility', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Legacy action without stage',
        timestamp: new Date().toISOString(),
      };

      expect(event.stage).toBeUndefined();
    });
  });

  describe('ExecutionSubState type', () => {
    it('should support all defined sub-states', () => {
      const subStates: ExecutionSubState[] = [
        'spawning_agent',
        'processing_output',
        'parsing_response',
        'validating_output',
        'saving_results',
        'waiting_for_input',
        'retrying',
      ];

      subStates.forEach(subState => {
        const event: ExecutionStatusEvent = {
          status: 'running',
          action: 'Test action',
          timestamp: new Date().toISOString(),
          subState,
        };
        expect(event.subState).toBe(subState);
      });
    });

    it('should allow undefined subState for backward compatibility', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Legacy action without subState',
        timestamp: new Date().toISOString(),
      };

      expect(event.subState).toBeUndefined();
    });
  });

  describe('ExecutionStatusEvent stepId field', () => {
    it('should accept stepId for Stage 3 implementation tracking', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Implementing step',
        timestamp: new Date().toISOString(),
        stage: 3,
        stepId: 'step-5',
      };

      expect(event.stepId).toBe('step-5');
    });

    it('should accept various stepId formats', () => {
      const stepIds = ['step-1', 'step-10', 'custom-step-id', 'STEP_001'];

      stepIds.forEach(stepId => {
        const event: ExecutionStatusEvent = {
          status: 'running',
          action: 'Implementing step',
          timestamp: new Date().toISOString(),
          stage: 3,
          stepId,
        };
        expect(event.stepId).toBe(stepId);
      });
    });

    it('should allow undefined stepId for non-Stage-3 events', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Stage 1 action',
        timestamp: new Date().toISOString(),
        stage: 1,
      };

      expect(event.stepId).toBeUndefined();
    });
  });

  describe('StepProgress type', () => {
    it('should have current and total fields', () => {
      const progress: StepProgress = {
        current: 3,
        total: 10,
      };

      expect(progress.current).toBe(3);
      expect(progress.total).toBe(10);
    });

    it('should work within ExecutionStatusEvent', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Implementing step 3 of 10',
        timestamp: new Date().toISOString(),
        stage: 3,
        stepId: 'step-3',
        progress: {
          current: 3,
          total: 10,
        },
      };

      expect(event.progress?.current).toBe(3);
      expect(event.progress?.total).toBe(10);
    });

    it('should allow undefined progress for backward compatibility', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Action without progress',
        timestamp: new Date().toISOString(),
      };

      expect(event.progress).toBeUndefined();
    });
  });

  describe('ExecutionStatusEvent isIntermediate field', () => {
    it('should mark rapid updates as intermediate', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Processing',
        timestamp: new Date().toISOString(),
        stage: 1,
        subState: 'processing_output',
        isIntermediate: true,
      };

      expect(event.isIntermediate).toBe(true);
    });

    it('should allow false for final state updates', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Completed processing',
        timestamp: new Date().toISOString(),
        stage: 1,
        subState: 'saving_results',
        isIntermediate: false,
      };

      expect(event.isIntermediate).toBe(false);
    });

    it('should allow undefined isIntermediate for backward compatibility', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Legacy event',
        timestamp: new Date().toISOString(),
      };

      expect(event.isIntermediate).toBeUndefined();
    });
  });

  describe('ExecutionStatusEvent full event with all fields', () => {
    it('should support all optional fields together', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'Implementing authentication middleware',
        timestamp: '2026-01-15T12:30:00Z',
        stage: 3,
        subState: 'validating_output',
        stepId: 'step-5',
        progress: {
          current: 5,
          total: 12,
        },
        isIntermediate: false,
      };

      expect(event.status).toBe('running');
      expect(event.action).toBe('Implementing authentication middleware');
      expect(event.timestamp).toBe('2026-01-15T12:30:00Z');
      expect(event.stage).toBe(3);
      expect(event.subState).toBe('validating_output');
      expect(event.stepId).toBe('step-5');
      expect(event.progress?.current).toBe(5);
      expect(event.progress?.total).toBe(12);
      expect(event.isIntermediate).toBe(false);
    });

    it('should work with only base fields for backward compatibility', () => {
      const legacyEvent: ExecutionStatusEvent = {
        status: 'idle',
        action: 'Waiting for input',
        timestamp: new Date().toISOString(),
      };

      // All optional fields should be undefined
      expect(legacyEvent.stage).toBeUndefined();
      expect(legacyEvent.subState).toBeUndefined();
      expect(legacyEvent.stepId).toBeUndefined();
      expect(legacyEvent.progress).toBeUndefined();
      expect(legacyEvent.isIntermediate).toBeUndefined();
    });
  });

  describe('ServerToClientEvents execution.status handler', () => {
    it('should accept extended ExecutionStatusEvent in handler', () => {
      const handler: ServerToClientEvents['execution.status'] = (data: ExecutionStatusEvent) => {
        // Handler should accept extended event
        expect(data.status).toBeDefined();
        expect(data.action).toBeDefined();
        expect(data.timestamp).toBeDefined();
        // Optional fields may or may not be present
        if (data.stage !== undefined) {
          expect(typeof data.stage).toBe('number');
        }
        if (data.subState !== undefined) {
          expect(typeof data.subState).toBe('string');
        }
        if (data.stepId !== undefined) {
          expect(typeof data.stepId).toBe('string');
        }
        if (data.progress !== undefined) {
          expect(typeof data.progress.current).toBe('number');
          expect(typeof data.progress.total).toBe('number');
        }
        if (data.isIntermediate !== undefined) {
          expect(typeof data.isIntermediate).toBe('boolean');
        }
      };

      // Test with full event
      handler({
        status: 'running',
        action: 'Test action',
        timestamp: new Date().toISOString(),
        stage: 2,
        subState: 'spawning_agent',
        isIntermediate: true,
      });

      // Test with legacy event (no optional fields)
      handler({
        status: 'idle',
        action: 'Legacy action',
        timestamp: new Date().toISOString(),
      });
    });
  });

  describe('Type exports from shared/types/index', () => {
    it('should export ExecutionStatusEvent with extended fields', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'test',
        timestamp: new Date().toISOString(),
        stage: 1,
        subState: 'spawning_agent',
      };

      expect(event).toBeDefined();
    });

    it('should export StepProgress type', () => {
      const progress: StepProgress = {
        current: 1,
        total: 5,
      };

      expect(progress).toBeDefined();
    });

    it('should export ExecutionSubState type', () => {
      const subState: ExecutionSubState = 'parsing_response';

      expect(subState).toBe('parsing_response');
    });
  });
});

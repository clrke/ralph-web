import {
  // Types from events.ts
  ExecutionSubState,
  ExecutionStatusEvent,
  StepProgress,

  // Utils from stageActivity.ts
  getActivityLabel,
  getStageName,
  isErrorAction,
  isWaitingAction,
  isCompleteAction,
  STAGE_ACTIVITY_MAP,
  SUBSTATE_LABELS,
  STAGE_NAMES,
} from '../../index';

describe('shared package exports', () => {
  describe('ExecutionSubState type', () => {
    it('should allow valid sub-state values', () => {
      const validSubStates: ExecutionSubState[] = [
        'spawning_agent',
        'processing_output',
        'parsing_response',
        'validating_output',
        'saving_results',
        'waiting_for_input',
        'retrying',
      ];

      // Type check passes if this compiles
      validSubStates.forEach((subState) => {
        expect(typeof subState).toBe('string');
      });
    });
  });

  describe('ExecutionStatusEvent interface', () => {
    it('should accept valid ExecutionStatusEvent objects', () => {
      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'stage1_started',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 1,
        subState: 'spawning_agent',
      };

      expect(event.status).toBe('running');
      expect(event.action).toBe('stage1_started');
      expect(event.stage).toBe(1);
      expect(event.subState).toBe('spawning_agent');
    });

    it('should accept ExecutionStatusEvent with progress', () => {
      const progress: StepProgress = { current: 2, total: 5 };

      const event: ExecutionStatusEvent = {
        status: 'running',
        action: 'stage3_progress',
        timestamp: '2024-01-01T00:00:00Z',
        stage: 3,
        stepId: 'step-1',
        progress,
        isIntermediate: true,
      };

      expect(event.progress).toEqual({ current: 2, total: 5 });
      expect(event.stepId).toBe('step-1');
      expect(event.isIntermediate).toBe(true);
    });
  });

  describe('stageActivity utility exports', () => {
    it('should export getActivityLabel function', () => {
      expect(typeof getActivityLabel).toBe('function');
      expect(getActivityLabel('stage1_started')).toBe('Analyzing codebase');
    });

    it('should export getStageName function', () => {
      expect(typeof getStageName).toBe('function');
      expect(getStageName(1)).toBe('Discovery');
    });

    it('should export isErrorAction function', () => {
      expect(typeof isErrorAction).toBe('function');
      expect(isErrorAction('stage1_spawn_error')).toBe(true);
    });

    it('should export isWaitingAction function', () => {
      expect(typeof isWaitingAction).toBe('function');
      expect(isWaitingAction('stage3_blocked')).toBe(true);
    });

    it('should export isCompleteAction function', () => {
      expect(typeof isCompleteAction).toBe('function');
      expect(isCompleteAction('stage1_complete')).toBe(true);
    });

    it('should export STAGE_ACTIVITY_MAP constant', () => {
      expect(typeof STAGE_ACTIVITY_MAP).toBe('object');
      expect(STAGE_ACTIVITY_MAP['stage1_started']).toBe('Analyzing codebase');
    });

    it('should export SUBSTATE_LABELS constant', () => {
      expect(typeof SUBSTATE_LABELS).toBe('object');
      expect(SUBSTATE_LABELS['spawning_agent']).toBe('Starting Claude agent');
    });

    it('should export STAGE_NAMES constant', () => {
      expect(typeof STAGE_NAMES).toBe('object');
      expect(STAGE_NAMES[1]).toBe('Discovery');
      expect(STAGE_NAMES[6]).toBe('Final Approval');
      expect(STAGE_NAMES[7]).toBe('Completed');
    });
  });

  describe('integration: getActivityLabel with ExecutionSubState', () => {
    it('should work with ExecutionSubState values', () => {
      const subState: ExecutionSubState = 'spawning_agent';
      const label = getActivityLabel('stage1_started', subState);
      expect(label).toBe('Starting Claude agent');
    });

    it('should work with undefined subState', () => {
      const subState: ExecutionSubState | undefined = undefined;
      const label = getActivityLabel('stage1_started', subState);
      expect(label).toBe('Analyzing codebase');
    });
  });
});

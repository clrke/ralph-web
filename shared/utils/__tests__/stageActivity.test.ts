import {
  getActivityLabel,
  getStageName,
  isErrorAction,
  isWaitingAction,
  isCompleteAction,
  STAGE_ACTIVITY_MAP,
  SUBSTATE_LABELS,
  STAGE_NAMES,
} from '../stageActivity';
import type { ExecutionSubState } from '../../types';

describe('stageActivity utility', () => {
  describe('STAGE_ACTIVITY_MAP', () => {
    it('should have labels for all Stage 1 actions', () => {
      const stage1Actions = [
        'stage1_started',
        'stage1_complete',
        'stage1_spawn_error',
        'stage1_retry',
        'stage1_retry_error',
      ];

      stage1Actions.forEach((action) => {
        expect(STAGE_ACTIVITY_MAP[action]).toBeDefined();
        expect(typeof STAGE_ACTIVITY_MAP[action]).toBe('string');
        expect(STAGE_ACTIVITY_MAP[action].length).toBeGreaterThan(0);
      });
    });

    it('should have labels for all Stage 2 actions', () => {
      const stage2Actions = [
        'stage2_started',
        'stage2_complete',
        'stage2_spawn_error',
        'stage2_blocker_review',
        'stage2_replanning_needed',
        'stage2_retry',
      ];

      stage2Actions.forEach((action) => {
        expect(STAGE_ACTIVITY_MAP[action]).toBeDefined();
        expect(typeof STAGE_ACTIVITY_MAP[action]).toBe('string');
      });
    });

    it('should have labels for all Stage 3 actions', () => {
      const stage3Actions = [
        'stage3_started',
        'stage3_progress',
        'stage3_complete',
        'stage3_error',
        'stage3_spawn_error',
        'stage3_blocked',
        'stage3_waiting',
        'stage3_retry',
        'stage3_retry_error',
        'stage3_restart_error',
        'step_spawn_error',
      ];

      stage3Actions.forEach((action) => {
        expect(STAGE_ACTIVITY_MAP[action]).toBeDefined();
        expect(typeof STAGE_ACTIVITY_MAP[action]).toBe('string');
      });
    });

    it('should have labels for all Stage 4 actions', () => {
      const stage4Actions = [
        'stage4_started',
        'stage4_git_prep',
        'stage4_git_error',
        'stage4_complete',
        'stage4_no_pr_url',
        'stage4_spawn_error',
        'stage4_retry',
      ];

      stage4Actions.forEach((action) => {
        expect(STAGE_ACTIVITY_MAP[action]).toBeDefined();
        expect(typeof STAGE_ACTIVITY_MAP[action]).toBe('string');
      });
    });

    it('should have labels for all Stage 5 actions', () => {
      const stage5Actions = [
        'stage5_started',
        'stage5_complete',
        'stage5_awaiting_user',
        'stage5_spawn_error',
        'stage5_retry',
      ];

      stage5Actions.forEach((action) => {
        expect(STAGE_ACTIVITY_MAP[action]).toBeDefined();
        expect(typeof STAGE_ACTIVITY_MAP[action]).toBe('string');
      });
    });

    it('should have labels for Stage 6 actions', () => {
      expect(STAGE_ACTIVITY_MAP['stage6_awaiting_approval']).toBeDefined();
    });

    it('should have labels for session lifecycle actions', () => {
      expect(STAGE_ACTIVITY_MAP['session_completed']).toBe('Session completed');
    });

    it('should have labels for batch/resume actions', () => {
      const batchActions = ['batch_answers_resume', 'batch_resume_error'];

      batchActions.forEach((action) => {
        expect(STAGE_ACTIVITY_MAP[action]).toBeDefined();
      });
    });

    it('should have labels for plan revision actions', () => {
      const planActions = [
        'plan_revision_started',
        'plan_revision_complete',
        'plan_revision_spawn_error',
      ];

      planActions.forEach((action) => {
        expect(STAGE_ACTIVITY_MAP[action]).toBeDefined();
      });
    });

    it('should have at least 40 action mappings', () => {
      const actionCount = Object.keys(STAGE_ACTIVITY_MAP).length;
      expect(actionCount).toBeGreaterThanOrEqual(40);
    });
  });

  describe('SUBSTATE_LABELS', () => {
    it('should have labels for all ExecutionSubState values', () => {
      const subStates: ExecutionSubState[] = [
        'spawning_agent',
        'processing_output',
        'parsing_response',
        'validating_output',
        'saving_results',
        'waiting_for_input',
        'retrying',
      ];

      subStates.forEach((subState) => {
        expect(SUBSTATE_LABELS[subState]).toBeDefined();
        expect(typeof SUBSTATE_LABELS[subState]).toBe('string');
        expect(SUBSTATE_LABELS[subState].length).toBeGreaterThan(0);
      });
    });

    it('should have user-friendly labels', () => {
      expect(SUBSTATE_LABELS['spawning_agent']).toBe('Starting Claude agent');
      expect(SUBSTATE_LABELS['processing_output']).toBe('Processing response');
      expect(SUBSTATE_LABELS['parsing_response']).toBe('Parsing output');
      expect(SUBSTATE_LABELS['validating_output']).toBe('Validating results');
      expect(SUBSTATE_LABELS['saving_results']).toBe('Saving results');
      expect(SUBSTATE_LABELS['waiting_for_input']).toBe('Waiting for input');
      expect(SUBSTATE_LABELS['retrying']).toBe('Retrying operation');
    });
  });

  describe('STAGE_NAMES', () => {
    it('should have names for all stages including queued and completed', () => {
      expect(STAGE_NAMES[0]).toBe('Queued');
      expect(STAGE_NAMES[1]).toBe('Discovery');
      expect(STAGE_NAMES[2]).toBe('Planning');
      expect(STAGE_NAMES[3]).toBe('Implementation');
      expect(STAGE_NAMES[4]).toBe('PR Creation');
      expect(STAGE_NAMES[5]).toBe('PR Review');
      expect(STAGE_NAMES[6]).toBe('Final Approval');
      expect(STAGE_NAMES[7]).toBe('Completed');
    });
  });

  describe('getActivityLabel', () => {
    it('should return action label for known actions', () => {
      expect(getActivityLabel('stage1_started')).toBe('Analyzing codebase');
      expect(getActivityLabel('stage2_started')).toBe('Generating plan');
      expect(getActivityLabel('stage3_started')).toBe('Starting implementation');
      expect(getActivityLabel('stage4_started')).toBe('Creating pull request');
      expect(getActivityLabel('stage5_started')).toBe('Reviewing pull request');
    });

    it('should prioritize subState label when provided', () => {
      // Even with a known action, subState takes priority
      expect(getActivityLabel('stage1_started', 'spawning_agent')).toBe(
        'Starting Claude agent'
      );
      expect(getActivityLabel('stage3_progress', 'parsing_response')).toBe(
        'Parsing output'
      );
      expect(getActivityLabel('stage2_started', 'validating_output')).toBe(
        'Validating results'
      );
    });

    it('should return action label when subState is undefined', () => {
      expect(getActivityLabel('stage1_complete', undefined)).toBe(
        'Discovery complete'
      );
      expect(getActivityLabel('stage3_blocked', undefined)).toBe(
        'Blocked - awaiting input'
      );
    });

    it('should use stage-based fallback for unknown actions', () => {
      expect(getActivityLabel('unknown_action', undefined, 1)).toBe(
        'Discovery...'
      );
      expect(getActivityLabel('custom_stage2_action', undefined, 2)).toBe(
        'Planning...'
      );
      expect(getActivityLabel('some_random_action', undefined, 3)).toBe(
        'Implementation...'
      );
    });

    it('should format unknown actions without stage', () => {
      expect(getActivityLabel('custom_action')).toBe('Custom Action');
      expect(getActivityLabel('my_special_task')).toBe('My Special Task');
    });

    it('should handle empty action string', () => {
      expect(getActivityLabel('')).toBe('Processing...');
    });

    it('should handle all subState values correctly', () => {
      const subStates: ExecutionSubState[] = [
        'spawning_agent',
        'processing_output',
        'parsing_response',
        'validating_output',
        'saving_results',
        'waiting_for_input',
        'retrying',
      ];

      subStates.forEach((subState) => {
        const label = getActivityLabel('any_action', subState);
        expect(label).toBe(SUBSTATE_LABELS[subState]);
      });
    });
  });

  describe('getStageName', () => {
    it('should return correct stage names', () => {
      expect(getStageName(0)).toBe('Queued');
      expect(getStageName(1)).toBe('Discovery');
      expect(getStageName(2)).toBe('Planning');
      expect(getStageName(3)).toBe('Implementation');
      expect(getStageName(4)).toBe('PR Creation');
      expect(getStageName(5)).toBe('PR Review');
      expect(getStageName(6)).toBe('Final Approval');
      expect(getStageName(7)).toBe('Completed');
    });

    it('should return Unknown for invalid stages', () => {
      expect(getStageName(-1)).toBe('Unknown');
      expect(getStageName(8)).toBe('Unknown');
      expect(getStageName(100)).toBe('Unknown');
    });
  });

  describe('isErrorAction', () => {
    it('should return true for error actions', () => {
      expect(isErrorAction('stage1_spawn_error')).toBe(true);
      expect(isErrorAction('stage3_error')).toBe(true);
      expect(isErrorAction('batch_resume_error')).toBe(true);
      expect(isErrorAction('something_failed')).toBe(true);
    });

    it('should return false for non-error actions', () => {
      expect(isErrorAction('stage1_started')).toBe(false);
      expect(isErrorAction('stage3_complete')).toBe(false);
      expect(isErrorAction('session_completed')).toBe(false);
    });
  });

  describe('isWaitingAction', () => {
    it('should return true for waiting actions', () => {
      expect(isWaitingAction('stage3_waiting')).toBe(true);
      expect(isWaitingAction('stage3_blocked')).toBe(true);
      expect(isWaitingAction('stage5_awaiting_user')).toBe(true);
      expect(isWaitingAction('stage6_awaiting_approval')).toBe(true);
    });

    it('should return false for non-waiting actions', () => {
      expect(isWaitingAction('stage1_started')).toBe(false);
      expect(isWaitingAction('stage3_complete')).toBe(false);
      expect(isWaitingAction('stage3_progress')).toBe(false);
    });
  });

  describe('isCompleteAction', () => {
    it('should return true for complete actions', () => {
      expect(isCompleteAction('stage1_complete')).toBe(true);
      expect(isCompleteAction('stage3_complete')).toBe(true);
      expect(isCompleteAction('session_completed')).toBe(true);
      expect(isCompleteAction('plan_revision_complete')).toBe(true);
    });

    it('should return false for non-complete actions', () => {
      expect(isCompleteAction('stage1_started')).toBe(false);
      expect(isCompleteAction('stage3_progress')).toBe(false);
      expect(isCompleteAction('stage3_waiting')).toBe(false);
    });
  });

  describe('action label quality', () => {
    it('should have user-friendly labels (no underscores)', () => {
      Object.values(STAGE_ACTIVITY_MAP).forEach((label) => {
        expect(label).not.toContain('_');
      });
    });

    it('should have capitalized labels', () => {
      Object.values(STAGE_ACTIVITY_MAP).forEach((label) => {
        expect(label[0]).toBe(label[0].toUpperCase());
      });
    });

    it('should have descriptive labels (not just stage numbers)', () => {
      Object.values(STAGE_ACTIVITY_MAP).forEach((label) => {
        expect(label).not.toMatch(/^Stage \d$/);
      });
    });
  });
});

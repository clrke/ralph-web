import {
  CreateSessionInputSchema,
  UpdateSessionInputSchema,
  StageTransitionInputSchema,
  AnswerQuestionInputSchema,
  RequestChangesInputSchema,
  QueueReorderInputSchema,
  BackoutSessionInputSchema,
  BackoutActionSchema,
  BackoutReasonSchema,
  isBackoutAllowedForStatus,
  BACKOUT_ALLOWED_STATUS_LIST,
} from '../../server/src/validation/schemas';

describe('Validation Schemas', () => {
  describe('CreateSessionInputSchema', () => {
    const validInput = {
      title: 'Add user authentication',
      featureDescription: 'Implement JWT-based auth',
      projectPath: '/Users/test/project',
    };

    it('should accept valid input with required fields only', () => {
      const result = CreateSessionInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Add user authentication');
        expect(result.data.acceptanceCriteria).toEqual([]);
        expect(result.data.baseBranch).toBe('main');
      }
    });

    it('should accept valid input with all fields', () => {
      const fullInput = {
        ...validInput,
        acceptanceCriteria: [{ text: 'All tests pass', checked: false, type: 'automated' as const }],
        affectedFiles: ['src/auth.ts', 'src/middleware/auth.ts'],
        technicalNotes: 'Use JWT with refresh tokens',
        baseBranch: 'develop',
      };
      const result = CreateSessionInputSchema.safeParse(fullInput);
      expect(result.success).toBe(true);
    });

    it('should trim whitespace from title', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        title: '  Add feature  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Add feature');
      }
    });

    it('should reject empty title', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        title: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject title over 200 characters', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        title: 'a'.repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty feature description', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        featureDescription: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject feature description over 10000 characters', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        featureDescription: 'a'.repeat(10001),
      });
      expect(result.success).toBe(false);
    });

    it('should reject relative project path', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        projectPath: 'relative/path',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/absolute path/i);
      }
    });

    it('should reject absolute paths in affectedFiles', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        affectedFiles: ['/absolute/path.ts'],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/relative paths/i);
      }
    });

    it('should reject technical notes over 5000 characters', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        technicalNotes: 'a'.repeat(5001),
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid branch names', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        baseBranch: 'invalid branch with spaces',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/invalid branch name/i);
      }
    });

    it('should accept valid branch names with slashes', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        baseBranch: 'feature/add-auth',
      });
      expect(result.success).toBe(true);
    });

    it('should reject acceptance criteria over 500 characters', () => {
      const result = CreateSessionInputSchema.safeParse({
        ...validInput,
        acceptanceCriteria: [{ text: 'a'.repeat(501), checked: false, type: 'manual' }],
      });
      expect(result.success).toBe(false);
    });

    describe('insertAtPosition', () => {
      it('should accept "front" as insertAtPosition', () => {
        const result = CreateSessionInputSchema.safeParse({
          ...validInput,
          insertAtPosition: 'front',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.insertAtPosition).toBe('front');
        }
      });

      it('should accept "end" as insertAtPosition', () => {
        const result = CreateSessionInputSchema.safeParse({
          ...validInput,
          insertAtPosition: 'end',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.insertAtPosition).toBe('end');
        }
      });

      it('should accept positive integer as insertAtPosition', () => {
        const result = CreateSessionInputSchema.safeParse({
          ...validInput,
          insertAtPosition: 5,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.insertAtPosition).toBe(5);
        }
      });

      it('should accept 1 as insertAtPosition', () => {
        const result = CreateSessionInputSchema.safeParse({
          ...validInput,
          insertAtPosition: 1,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.insertAtPosition).toBe(1);
        }
      });

      it('should reject 0 as insertAtPosition', () => {
        const result = CreateSessionInputSchema.safeParse({
          ...validInput,
          insertAtPosition: 0,
        });
        expect(result.success).toBe(false);
      });

      it('should reject negative number as insertAtPosition', () => {
        const result = CreateSessionInputSchema.safeParse({
          ...validInput,
          insertAtPosition: -1,
        });
        expect(result.success).toBe(false);
      });

      it('should reject decimal number as insertAtPosition', () => {
        const result = CreateSessionInputSchema.safeParse({
          ...validInput,
          insertAtPosition: 1.5,
        });
        expect(result.success).toBe(false);
      });

      it('should reject invalid string as insertAtPosition', () => {
        const result = CreateSessionInputSchema.safeParse({
          ...validInput,
          insertAtPosition: 'middle',
        });
        expect(result.success).toBe(false);
      });

      it('should allow omitting insertAtPosition', () => {
        const result = CreateSessionInputSchema.safeParse(validInput);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.insertAtPosition).toBeUndefined();
        }
      });
    });
  });

  describe('UpdateSessionInputSchema', () => {
    it('should accept valid status update', () => {
      const result = UpdateSessionInputSchema.safeParse({
        status: 'planning',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid stage update', () => {
      const result = UpdateSessionInputSchema.safeParse({
        currentStage: 2,
      });
      expect(result.success).toBe(true);
    });

    it('should accept stage 6 (final_approval)', () => {
      const result = UpdateSessionInputSchema.safeParse({
        currentStage: 6,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currentStage).toBe(6);
      }
    });

    it('should accept stage 7 (completed)', () => {
      const result = UpdateSessionInputSchema.safeParse({
        currentStage: 7,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currentStage).toBe(7);
      }
    });

    it('should accept final_approval status', () => {
      const result = UpdateSessionInputSchema.safeParse({
        status: 'final_approval',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('final_approval');
      }
    });

    it('should accept queued status', () => {
      const result = UpdateSessionInputSchema.safeParse({
        status: 'queued',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('queued');
      }
    });

    it('should accept failed status', () => {
      const result = UpdateSessionInputSchema.safeParse({
        status: 'failed',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('failed');
      }
    });

    it('should reject invalid status', () => {
      const result = UpdateSessionInputSchema.safeParse({
        status: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject stage out of range', () => {
      const result = UpdateSessionInputSchema.safeParse({
        currentStage: 8,
      });
      expect(result.success).toBe(false);
    });

    it('should reject stage 0', () => {
      const result = UpdateSessionInputSchema.safeParse({
        currentStage: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative stage', () => {
      const result = UpdateSessionInputSchema.safeParse({
        currentStage: -1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject unknown fields', () => {
      const result = UpdateSessionInputSchema.safeParse({
        status: 'planning',
        unknownField: 'value',
      });
      expect(result.success).toBe(false);
    });

    describe('queuePosition', () => {
      it('should accept valid positive integer queuePosition', () => {
        const result = UpdateSessionInputSchema.safeParse({
          queuePosition: 1,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.queuePosition).toBe(1);
        }
      });

      it('should accept queuePosition of 1 (minimum)', () => {
        const result = UpdateSessionInputSchema.safeParse({
          queuePosition: 1,
        });
        expect(result.success).toBe(true);
      });

      it('should accept large positive queuePosition', () => {
        const result = UpdateSessionInputSchema.safeParse({
          queuePosition: 100,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.queuePosition).toBe(100);
        }
      });

      it('should accept null queuePosition (clears queue position)', () => {
        const result = UpdateSessionInputSchema.safeParse({
          queuePosition: null,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.queuePosition).toBeNull();
        }
      });

      it('should accept undefined queuePosition (field not included)', () => {
        const result = UpdateSessionInputSchema.safeParse({
          status: 'planning',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.queuePosition).toBeUndefined();
        }
      });

      it('should reject queuePosition of 0', () => {
        const result = UpdateSessionInputSchema.safeParse({
          queuePosition: 0,
        });
        expect(result.success).toBe(false);
      });

      it('should reject negative queuePosition', () => {
        const result = UpdateSessionInputSchema.safeParse({
          queuePosition: -1,
        });
        expect(result.success).toBe(false);
      });

      it('should reject non-integer queuePosition', () => {
        const result = UpdateSessionInputSchema.safeParse({
          queuePosition: 1.5,
        });
        expect(result.success).toBe(false);
      });

      it('should reject string queuePosition', () => {
        const result = UpdateSessionInputSchema.safeParse({
          queuePosition: '1',
        });
        expect(result.success).toBe(false);
      });

      it('should accept queuePosition with other valid fields', () => {
        const result = UpdateSessionInputSchema.safeParse({
          status: 'paused',
          queuePosition: 5,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBe('paused');
          expect(result.data.queuePosition).toBe(5);
        }
      });
    });
  });

  describe('StageTransitionInputSchema', () => {
    it('should accept valid stage', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 2,
      });
      expect(result.success).toBe(true);
    });

    it('should accept stage 6 (final_approval)', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 6,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.targetStage).toBe(6);
      }
    });

    it('should accept stage 7 (completed)', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 7,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.targetStage).toBe(7);
      }
    });

    it('should reject stage below 1', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative stage', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: -1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject stage above 7', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 8,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer stage', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 2.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AnswerQuestionInputSchema', () => {
    it('should accept single choice answer', () => {
      const result = AnswerQuestionInputSchema.safeParse({
        value: 'jwt',
      });
      expect(result.success).toBe(true);
    });

    it('should accept text input answer', () => {
      const result = AnswerQuestionInputSchema.safeParse({
        text: 'Use refresh tokens',
      });
      expect(result.success).toBe(true);
    });

    it('should accept multi-choice answer', () => {
      const result = AnswerQuestionInputSchema.safeParse({
        values: ['login', 'register'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty object', () => {
      const result = AnswerQuestionInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('RequestChangesInputSchema', () => {
    it('should accept valid feedback', () => {
      const result = RequestChangesInputSchema.safeParse({
        feedback: 'Please add more error handling',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty feedback', () => {
      const result = RequestChangesInputSchema.safeParse({
        feedback: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject feedback over 10000 characters', () => {
      const result = RequestChangesInputSchema.safeParse({
        feedback: 'a'.repeat(10001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('QueueReorderInputSchema', () => {
    it('should accept valid orderedFeatureIds array', () => {
      const result = QueueReorderInputSchema.safeParse({
        orderedFeatureIds: ['feature-one', 'feature-two', 'feature-three'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.orderedFeatureIds).toHaveLength(3);
      }
    });

    it('should accept empty orderedFeatureIds array', () => {
      const result = QueueReorderInputSchema.safeParse({
        orderedFeatureIds: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.orderedFeatureIds).toEqual([]);
      }
    });

    it('should reject missing orderedFeatureIds', () => {
      const result = QueueReorderInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject non-array orderedFeatureIds', () => {
      const result = QueueReorderInputSchema.safeParse({
        orderedFeatureIds: 'not-an-array',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty string feature IDs', () => {
      const result = QueueReorderInputSchema.safeParse({
        orderedFeatureIds: ['valid', ''],
      });
      expect(result.success).toBe(false);
    });

    it('should reject feature IDs over 100 characters', () => {
      const result = QueueReorderInputSchema.safeParse({
        orderedFeatureIds: ['a'.repeat(101)],
      });
      expect(result.success).toBe(false);
    });

    it('should accept feature IDs at max length (100 characters)', () => {
      const result = QueueReorderInputSchema.safeParse({
        orderedFeatureIds: ['a'.repeat(100)],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('BackoutSessionInputSchema', () => {
    describe('action field', () => {
      it('should accept "pause" action', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'pause',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.action).toBe('pause');
        }
      });

      it('should accept "abandon" action', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'abandon',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.action).toBe('abandon');
        }
      });

      it('should reject missing action field', () => {
        const result = BackoutSessionInputSchema.safeParse({});
        expect(result.success).toBe(false);
      });

      it('should reject invalid action value', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'cancel',
        });
        expect(result.success).toBe(false);
      });

      it('should reject empty string action', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: '',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('reason field', () => {
      it('should accept "user_requested" reason', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'pause',
          reason: 'user_requested',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.reason).toBe('user_requested');
        }
      });

      it('should accept "blocked" reason', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'pause',
          reason: 'blocked',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.reason).toBe('blocked');
        }
      });

      it('should accept "deprioritized" reason', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'abandon',
          reason: 'deprioritized',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.reason).toBe('deprioritized');
        }
      });

      it('should allow omitting reason (optional field)', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'pause',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.reason).toBeUndefined();
        }
      });

      it('should reject invalid reason value', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'pause',
          reason: 'invalid_reason',
        });
        expect(result.success).toBe(false);
      });

      it('should reject empty string reason', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'pause',
          reason: '',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('combined action and reason', () => {
      it('should accept pause with user_requested', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'pause',
          reason: 'user_requested',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.action).toBe('pause');
          expect(result.data.reason).toBe('user_requested');
        }
      });

      it('should accept abandon with blocked', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'abandon',
          reason: 'blocked',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.action).toBe('abandon');
          expect(result.data.reason).toBe('blocked');
        }
      });

      it('should accept abandon with deprioritized', () => {
        const result = BackoutSessionInputSchema.safeParse({
          action: 'abandon',
          reason: 'deprioritized',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.action).toBe('abandon');
          expect(result.data.reason).toBe('deprioritized');
        }
      });
    });
  });

  describe('BackoutActionSchema', () => {
    it('should accept "pause"', () => {
      const result = BackoutActionSchema.safeParse('pause');
      expect(result.success).toBe(true);
    });

    it('should accept "abandon"', () => {
      const result = BackoutActionSchema.safeParse('abandon');
      expect(result.success).toBe(true);
    });

    it('should reject other values', () => {
      expect(BackoutActionSchema.safeParse('cancel').success).toBe(false);
      expect(BackoutActionSchema.safeParse('stop').success).toBe(false);
      expect(BackoutActionSchema.safeParse('').success).toBe(false);
    });
  });

  describe('BackoutReasonSchema', () => {
    it('should accept "user_requested"', () => {
      const result = BackoutReasonSchema.safeParse('user_requested');
      expect(result.success).toBe(true);
    });

    it('should accept "blocked"', () => {
      const result = BackoutReasonSchema.safeParse('blocked');
      expect(result.success).toBe(true);
    });

    it('should accept "deprioritized"', () => {
      const result = BackoutReasonSchema.safeParse('deprioritized');
      expect(result.success).toBe(true);
    });

    it('should reject invalid reasons', () => {
      expect(BackoutReasonSchema.safeParse('invalid').success).toBe(false);
      expect(BackoutReasonSchema.safeParse('').success).toBe(false);
      expect(BackoutReasonSchema.safeParse('BLOCKED').success).toBe(false);
    });
  });

  describe('isBackoutAllowedForStatus', () => {
    describe('should allow backout for stages 1-6', () => {
      it('should allow queued status', () => {
        expect(isBackoutAllowedForStatus('queued')).toBe(true);
      });

      it('should allow discovery status (stage 1)', () => {
        expect(isBackoutAllowedForStatus('discovery')).toBe(true);
      });

      it('should allow planning status (stage 2)', () => {
        expect(isBackoutAllowedForStatus('planning')).toBe(true);
      });

      it('should allow implementing status (stage 3)', () => {
        expect(isBackoutAllowedForStatus('implementing')).toBe(true);
      });

      it('should allow pr_creation status (stage 4)', () => {
        expect(isBackoutAllowedForStatus('pr_creation')).toBe(true);
      });

      it('should allow pr_review status (stage 5)', () => {
        expect(isBackoutAllowedForStatus('pr_review')).toBe(true);
      });

      it('should allow final_approval status (stage 6)', () => {
        expect(isBackoutAllowedForStatus('final_approval')).toBe(true);
      });
    });

    describe('should NOT allow backout for terminal states', () => {
      it('should not allow completed status (stage 7)', () => {
        expect(isBackoutAllowedForStatus('completed')).toBe(false);
      });

      it('should not allow paused status (already backed out)', () => {
        expect(isBackoutAllowedForStatus('paused')).toBe(false);
      });

      it('should not allow failed status', () => {
        expect(isBackoutAllowedForStatus('failed')).toBe(false);
      });
    });

    describe('should handle invalid statuses', () => {
      it('should not allow invalid status', () => {
        expect(isBackoutAllowedForStatus('invalid')).toBe(false);
      });

      it('should not allow empty string', () => {
        expect(isBackoutAllowedForStatus('')).toBe(false);
      });
    });
  });

  describe('BACKOUT_ALLOWED_STATUS_LIST', () => {
    it('should contain all stages 1-6 statuses plus queued', () => {
      expect(BACKOUT_ALLOWED_STATUS_LIST).toContain('queued');
      expect(BACKOUT_ALLOWED_STATUS_LIST).toContain('discovery');
      expect(BACKOUT_ALLOWED_STATUS_LIST).toContain('planning');
      expect(BACKOUT_ALLOWED_STATUS_LIST).toContain('implementing');
      expect(BACKOUT_ALLOWED_STATUS_LIST).toContain('pr_creation');
      expect(BACKOUT_ALLOWED_STATUS_LIST).toContain('pr_review');
      expect(BACKOUT_ALLOWED_STATUS_LIST).toContain('final_approval');
    });

    it('should have exactly 7 allowed statuses', () => {
      expect(BACKOUT_ALLOWED_STATUS_LIST).toHaveLength(7);
    });

    it('should NOT contain terminal states', () => {
      expect(BACKOUT_ALLOWED_STATUS_LIST).not.toContain('completed');
      expect(BACKOUT_ALLOWED_STATUS_LIST).not.toContain('paused');
      expect(BACKOUT_ALLOWED_STATUS_LIST).not.toContain('failed');
    });

    it('should be a valid array for iteration', () => {
      expect(Array.isArray(BACKOUT_ALLOWED_STATUS_LIST)).toBe(true);
    });
  });
});

import {
  CreateSessionInputSchema,
  UpdateSessionInputSchema,
  StageTransitionInputSchema,
  AnswerQuestionInputSchema,
  RequestChangesInputSchema,
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

    it('should reject invalid status', () => {
      const result = UpdateSessionInputSchema.safeParse({
        status: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject stage out of range', () => {
      const result = UpdateSessionInputSchema.safeParse({
        currentStage: 6,
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
  });

  describe('StageTransitionInputSchema', () => {
    it('should accept valid stage', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 2,
      });
      expect(result.success).toBe(true);
    });

    it('should reject stage below 1', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject stage above 5', () => {
      const result = StageTransitionInputSchema.safeParse({
        targetStage: 6,
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
});

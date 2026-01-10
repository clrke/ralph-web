import { buildStage1Prompt, buildStage2Prompt } from '../../server/src/prompts/stagePrompts';
import { Session, Plan } from '@claude-code-web/shared';

describe('Stage Prompt Builders', () => {
  const mockSession: Session = {
    version: '1.0',
    id: 'test-session-id',
    projectId: 'test-project',
    featureId: 'add-auth',
    title: 'Add User Authentication',
    featureDescription: 'Implement JWT-based authentication for the API',
    projectPath: '/Users/test/project',
    acceptanceCriteria: [
      { text: 'Users can login with email/password', checked: false },
      { text: 'JWT tokens are issued on successful login', checked: false },
    ],
    affectedFiles: ['src/auth/middleware.ts', 'src/routes/login.ts'],
    technicalNotes: 'Use bcrypt for password hashing',
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

  describe('buildStage1Prompt', () => {
    it('should include feature title and description', () => {
      const prompt = buildStage1Prompt(mockSession);

      expect(prompt).toContain('Add User Authentication');
      expect(prompt).toContain('JWT-based authentication');
    });

    it('should include acceptance criteria', () => {
      const prompt = buildStage1Prompt(mockSession);

      expect(prompt).toContain('Users can login with email/password');
      expect(prompt).toContain('JWT tokens are issued');
    });

    it('should include affected files when provided', () => {
      const prompt = buildStage1Prompt(mockSession);

      expect(prompt).toContain('src/auth/middleware.ts');
      expect(prompt).toContain('src/routes/login.ts');
    });

    it('should include technical notes when provided', () => {
      const prompt = buildStage1Prompt(mockSession);

      expect(prompt).toContain('bcrypt for password hashing');
    });

    it('should use correct output markers per README spec', () => {
      const prompt = buildStage1Prompt(mockSession);

      // Should use [DECISION_NEEDED] NOT [QUESTION]
      expect(prompt).toContain('[DECISION_NEEDED');
      expect(prompt).not.toContain('[QUESTION');

      // Should use [PLAN_STEP] format
      expect(prompt).toContain('[PLAN_STEP');

      // Should reference plan mode markers
      expect(prompt).toContain('[PLAN_MODE_ENTERED]');
      expect(prompt).toContain('[PLAN_MODE_EXITED]');

      // Should reference plan file tracking
      expect(prompt).toContain('[PLAN_FILE');
    });

    it('should instruct Claude to enter plan mode', () => {
      const prompt = buildStage1Prompt(mockSession);

      expect(prompt).toContain('EnterPlanMode');
      expect(prompt).toContain('plan mode');
    });

    it('should handle session with no affected files', () => {
      const sessionNoFiles = { ...mockSession, affectedFiles: [] };
      const prompt = buildStage1Prompt(sessionNoFiles);

      expect(prompt).not.toContain('Affected Files');
    });

    it('should handle session with no technical notes', () => {
      const sessionNoNotes = { ...mockSession, technicalNotes: '' };
      const prompt = buildStage1Prompt(sessionNoNotes);

      expect(prompt).not.toContain('Technical Notes');
    });
  });

  describe('buildStage2Prompt', () => {
    const mockPlan: Plan = {
      version: '1.0',
      planVersion: 1,
      sessionId: 'test-session-id',
      isApproved: false,
      reviewCount: 0,
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
        {
          id: 'step-2',
          parentId: 'step-1',
          orderIndex: 1,
          title: 'Add login endpoint',
          description: 'POST /api/login',
          status: 'pending',
          metadata: {},
        },
      ],
    };

    it('should include current plan version', () => {
      const prompt = buildStage2Prompt(mockSession, mockPlan, 1);

      expect(prompt).toContain('v1');
    });

    it('should include plan steps', () => {
      const prompt = buildStage2Prompt(mockSession, mockPlan, 1);

      expect(prompt).toContain('Create auth middleware');
      expect(prompt).toContain('Add login endpoint');
    });

    it('should include review iteration count', () => {
      const prompt = buildStage2Prompt(mockSession, mockPlan, 3);

      expect(prompt).toContain('review 3');
    });

    it('should use DECISION_NEEDED for issues', () => {
      const prompt = buildStage2Prompt(mockSession, mockPlan, 1);

      expect(prompt).toContain('[DECISION_NEEDED');
    });

    it('should reference PLAN_APPROVED marker', () => {
      const prompt = buildStage2Prompt(mockSession, mockPlan, 1);

      expect(prompt).toContain('[PLAN_APPROVED]');
    });

    it('should include review categories', () => {
      const prompt = buildStage2Prompt(mockSession, mockPlan, 1);

      expect(prompt).toContain('Code Quality');
      expect(prompt).toContain('Architecture');
      expect(prompt).toContain('Security');
      expect(prompt).toContain('Performance');
    });
  });
});

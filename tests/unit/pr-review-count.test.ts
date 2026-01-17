import { Session } from '../../shared/types/session';

describe('prReviewCount field', () => {
  // Base session with all required fields
  const baseSession: Omit<Session, 'prReviewCount'> = {
    version: '1.0.0',
    dataVersion: 1,
    id: 'test-session-id',
    projectId: 'test-project',
    featureId: 'test-feature',
    title: 'Test Session',
    featureDescription: 'A test session',
    projectPath: '/test/path',
    acceptanceCriteria: [],
    affectedFiles: [],
    technicalNotes: '',
    baseBranch: 'main',
    featureBranch: 'feature/test',
    baseCommitSha: 'abc123',
    status: 'discovery',
    currentStage: 1,
    replanningCount: 0,
    claudeSessionId: null,
    claudePlanFilePath: null,
    currentPlanVersion: 1,
    claudeStage3SessionId: null,
    prUrl: null,
    sessionExpiresAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe('Session interface with prReviewCount', () => {
    it('should allow session without prReviewCount (optional field)', () => {
      const session: Session = { ...baseSession };
      expect(session.prReviewCount).toBeUndefined();
    });

    it('should allow session with prReviewCount set to 0', () => {
      const session: Session = {
        ...baseSession,
        prReviewCount: 0,
      };
      expect(session.prReviewCount).toBe(0);
    });

    it('should allow session with prReviewCount set to positive number', () => {
      const session: Session = {
        ...baseSession,
        prReviewCount: 1,
      };
      expect(session.prReviewCount).toBe(1);
    });

    it('should allow incrementing prReviewCount', () => {
      const session: Session = {
        ...baseSession,
        prReviewCount: 0,
      };
      session.prReviewCount = (session.prReviewCount || 0) + 1;
      expect(session.prReviewCount).toBe(1);
    });

    it('should handle undefined prReviewCount with default value pattern', () => {
      const session: Session = { ...baseSession };
      const count = session.prReviewCount || 0;
      expect(count).toBe(0);
    });

    it('should support multiple increments for multiple PR reviews', () => {
      const session: Session = {
        ...baseSession,
        prReviewCount: 0,
      };

      // Simulate multiple PR reviews
      session.prReviewCount = (session.prReviewCount || 0) + 1;
      expect(session.prReviewCount).toBe(1);

      session.prReviewCount = (session.prReviewCount || 0) + 1;
      expect(session.prReviewCount).toBe(2);

      session.prReviewCount = (session.prReviewCount || 0) + 1;
      expect(session.prReviewCount).toBe(3);
    });
  });

  describe('prReviewCount mirrors replanningCount pattern', () => {
    it('should have same optional behavior as replanningCount for backward compatibility', () => {
      // Both fields should work the same way for backward compatibility
      const sessionWithoutCounts: Session = { ...baseSession };

      // Both should default to 0 when undefined
      const replanCount = sessionWithoutCounts.replanningCount || 0;
      const prReviewCount = sessionWithoutCounts.prReviewCount || 0;

      expect(replanCount).toBe(0);
      expect(prReviewCount).toBe(0);
    });

    it('should track Stage 5 reviews like replanningCount tracks Stage 2 iterations', () => {
      const session: Session = {
        ...baseSession,
        status: 'pr_review',
        currentStage: 5,
        replanningCount: 2, // 2 Stage 2 iterations completed
        prReviewCount: 1,   // 1 Stage 5 review completed
      };

      expect(session.replanningCount).toBe(2);
      expect(session.prReviewCount).toBe(1);
    });
  });
});

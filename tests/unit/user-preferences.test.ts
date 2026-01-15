import {
  UserPreferences,
  DEFAULT_USER_PREFERENCES,
  Session,
} from '../../shared/types/session';

describe('UserPreferences', () => {
  describe('DEFAULT_USER_PREFERENCES', () => {
    it('should have all required preference fields', () => {
      expect(DEFAULT_USER_PREFERENCES).toHaveProperty('riskComfort');
      expect(DEFAULT_USER_PREFERENCES).toHaveProperty('speedVsQuality');
      expect(DEFAULT_USER_PREFERENCES).toHaveProperty('scopeFlexibility');
      expect(DEFAULT_USER_PREFERENCES).toHaveProperty('detailLevel');
      expect(DEFAULT_USER_PREFERENCES).toHaveProperty('autonomyLevel');
    });

    it('should have correct default values', () => {
      expect(DEFAULT_USER_PREFERENCES.riskComfort).toBe('medium');
      expect(DEFAULT_USER_PREFERENCES.speedVsQuality).toBe('balanced');
      expect(DEFAULT_USER_PREFERENCES.scopeFlexibility).toBe('flexible');
      expect(DEFAULT_USER_PREFERENCES.detailLevel).toBe('standard');
      expect(DEFAULT_USER_PREFERENCES.autonomyLevel).toBe('collaborative');
    });

    it('should be a valid UserPreferences object', () => {
      const prefs: UserPreferences = DEFAULT_USER_PREFERENCES;
      expect(prefs).toBeDefined();
    });
  });

  describe('UserPreferences type', () => {
    it('should accept valid riskComfort values', () => {
      const lowRisk: UserPreferences = { ...DEFAULT_USER_PREFERENCES, riskComfort: 'low' };
      const mediumRisk: UserPreferences = { ...DEFAULT_USER_PREFERENCES, riskComfort: 'medium' };
      const highRisk: UserPreferences = { ...DEFAULT_USER_PREFERENCES, riskComfort: 'high' };

      expect(lowRisk.riskComfort).toBe('low');
      expect(mediumRisk.riskComfort).toBe('medium');
      expect(highRisk.riskComfort).toBe('high');
    });

    it('should accept valid speedVsQuality values', () => {
      const speed: UserPreferences = { ...DEFAULT_USER_PREFERENCES, speedVsQuality: 'speed' };
      const balanced: UserPreferences = { ...DEFAULT_USER_PREFERENCES, speedVsQuality: 'balanced' };
      const quality: UserPreferences = { ...DEFAULT_USER_PREFERENCES, speedVsQuality: 'quality' };

      expect(speed.speedVsQuality).toBe('speed');
      expect(balanced.speedVsQuality).toBe('balanced');
      expect(quality.speedVsQuality).toBe('quality');
    });

    it('should accept valid scopeFlexibility values', () => {
      const fixed: UserPreferences = { ...DEFAULT_USER_PREFERENCES, scopeFlexibility: 'fixed' };
      const flexible: UserPreferences = { ...DEFAULT_USER_PREFERENCES, scopeFlexibility: 'flexible' };
      const open: UserPreferences = { ...DEFAULT_USER_PREFERENCES, scopeFlexibility: 'open' };

      expect(fixed.scopeFlexibility).toBe('fixed');
      expect(flexible.scopeFlexibility).toBe('flexible');
      expect(open.scopeFlexibility).toBe('open');
    });

    it('should accept valid detailLevel values', () => {
      const minimal: UserPreferences = { ...DEFAULT_USER_PREFERENCES, detailLevel: 'minimal' };
      const standard: UserPreferences = { ...DEFAULT_USER_PREFERENCES, detailLevel: 'standard' };
      const detailed: UserPreferences = { ...DEFAULT_USER_PREFERENCES, detailLevel: 'detailed' };

      expect(minimal.detailLevel).toBe('minimal');
      expect(standard.detailLevel).toBe('standard');
      expect(detailed.detailLevel).toBe('detailed');
    });

    it('should accept valid autonomyLevel values', () => {
      const guided: UserPreferences = { ...DEFAULT_USER_PREFERENCES, autonomyLevel: 'guided' };
      const collaborative: UserPreferences = { ...DEFAULT_USER_PREFERENCES, autonomyLevel: 'collaborative' };
      const autonomous: UserPreferences = { ...DEFAULT_USER_PREFERENCES, autonomyLevel: 'autonomous' };

      expect(guided.autonomyLevel).toBe('guided');
      expect(collaborative.autonomyLevel).toBe('collaborative');
      expect(autonomous.autonomyLevel).toBe('autonomous');
    });
  });

  describe('Session with preferences', () => {
    const baseSession: Omit<Session, 'preferences'> = {
      version: '1.0.0',
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

    it('should allow session without preferences (optional field)', () => {
      const session: Session = { ...baseSession };
      expect(session.preferences).toBeUndefined();
    });

    it('should allow session with preferences', () => {
      const session: Session = {
        ...baseSession,
        preferences: DEFAULT_USER_PREFERENCES,
      };
      expect(session.preferences).toEqual(DEFAULT_USER_PREFERENCES);
    });

    it('should allow session with custom preferences', () => {
      const customPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };
      const session: Session = {
        ...baseSession,
        preferences: customPrefs,
      };
      expect(session.preferences).toEqual(customPrefs);
    });
  });
});

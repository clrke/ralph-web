import { Session } from '../../shared/types/session';

describe('Session step modification tracking fields', () => {
  const baseSession: Session = {
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
    status: 'planning',
    currentStage: 2,
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

  describe('modifiedStepIds field', () => {
    it('should allow session without modifiedStepIds (optional field)', () => {
      const session: Session = { ...baseSession };
      expect(session.modifiedStepIds).toBeUndefined();
    });

    it('should allow session with empty modifiedStepIds array', () => {
      const session: Session = {
        ...baseSession,
        modifiedStepIds: [],
      };
      expect(session.modifiedStepIds).toEqual([]);
    });

    it('should allow session with modifiedStepIds containing step IDs', () => {
      const session: Session = {
        ...baseSession,
        modifiedStepIds: ['step-1', 'step-3', 'step-5'],
      };
      expect(session.modifiedStepIds).toEqual(['step-1', 'step-3', 'step-5']);
      expect(session.modifiedStepIds).toHaveLength(3);
    });

    it('should allow checking if a step was modified', () => {
      const session: Session = {
        ...baseSession,
        modifiedStepIds: ['step-2', 'step-4'],
      };
      expect(session.modifiedStepIds?.includes('step-2')).toBe(true);
      expect(session.modifiedStepIds?.includes('step-1')).toBe(false);
    });
  });

  describe('addedStepIds field', () => {
    it('should allow session without addedStepIds (optional field)', () => {
      const session: Session = { ...baseSession };
      expect(session.addedStepIds).toBeUndefined();
    });

    it('should allow session with empty addedStepIds array', () => {
      const session: Session = {
        ...baseSession,
        addedStepIds: [],
      };
      expect(session.addedStepIds).toEqual([]);
    });

    it('should allow session with addedStepIds containing new step IDs', () => {
      const session: Session = {
        ...baseSession,
        addedStepIds: ['step-new-1', 'step-new-2'],
      };
      expect(session.addedStepIds).toEqual(['step-new-1', 'step-new-2']);
      expect(session.addedStepIds).toHaveLength(2);
    });

    it('should allow checking if a step was added', () => {
      const session: Session = {
        ...baseSession,
        addedStepIds: ['step-new-1'],
      };
      expect(session.addedStepIds?.includes('step-new-1')).toBe(true);
      expect(session.addedStepIds?.includes('step-1')).toBe(false);
    });
  });

  describe('removedStepIds field', () => {
    it('should allow session without removedStepIds (optional field)', () => {
      const session: Session = { ...baseSession };
      expect(session.removedStepIds).toBeUndefined();
    });

    it('should allow session with empty removedStepIds array', () => {
      const session: Session = {
        ...baseSession,
        removedStepIds: [],
      };
      expect(session.removedStepIds).toEqual([]);
    });

    it('should allow session with removedStepIds containing deleted step IDs', () => {
      const session: Session = {
        ...baseSession,
        removedStepIds: ['step-3', 'step-4', 'step-5'],
      };
      expect(session.removedStepIds).toEqual(['step-3', 'step-4', 'step-5']);
      expect(session.removedStepIds).toHaveLength(3);
    });

    it('should allow checking if a step was removed', () => {
      const session: Session = {
        ...baseSession,
        removedStepIds: ['step-3'],
      };
      expect(session.removedStepIds?.includes('step-3')).toBe(true);
      expect(session.removedStepIds?.includes('step-1')).toBe(false);
    });
  });

  describe('combined step modification tracking', () => {
    it('should allow session with all step modification fields', () => {
      const session: Session = {
        ...baseSession,
        modifiedStepIds: ['step-1'],
        addedStepIds: ['step-new-1', 'step-new-2'],
        removedStepIds: ['step-3'],
      };
      expect(session.modifiedStepIds).toEqual(['step-1']);
      expect(session.addedStepIds).toEqual(['step-new-1', 'step-new-2']);
      expect(session.removedStepIds).toEqual(['step-3']);
    });

    it('should allow detecting any step modification', () => {
      const session: Session = {
        ...baseSession,
        modifiedStepIds: ['step-1'],
        addedStepIds: [],
        removedStepIds: [],
      };

      const hasModifications =
        (session.modifiedStepIds?.length ?? 0) > 0 ||
        (session.addedStepIds?.length ?? 0) > 0 ||
        (session.removedStepIds?.length ?? 0) > 0;

      expect(hasModifications).toBe(true);
    });

    it('should allow detecting no step modifications', () => {
      const session: Session = {
        ...baseSession,
        modifiedStepIds: [],
        addedStepIds: [],
        removedStepIds: [],
      };

      const hasModifications =
        (session.modifiedStepIds?.length ?? 0) > 0 ||
        (session.addedStepIds?.length ?? 0) > 0 ||
        (session.removedStepIds?.length ?? 0) > 0;

      expect(hasModifications).toBe(false);
    });

    it('should allow getting all affected step IDs', () => {
      const session: Session = {
        ...baseSession,
        modifiedStepIds: ['step-1', 'step-2'],
        addedStepIds: ['step-new-1'],
        removedStepIds: ['step-3'],
      };

      const allAffectedIds = [
        ...(session.modifiedStepIds ?? []),
        ...(session.addedStepIds ?? []),
        ...(session.removedStepIds ?? []),
      ];

      expect(allAffectedIds).toEqual(['step-1', 'step-2', 'step-new-1', 'step-3']);
      expect(allAffectedIds).toHaveLength(4);
    });
  });

  describe('Stage 2 to Stage 3 workflow', () => {
    it('should track modifications during Stage 2 revision', () => {
      // Simulate Stage 2 populating modification tracking fields
      const sessionAfterStage2: Session = {
        ...baseSession,
        status: 'implementing',
        currentStage: 3,
        modifiedStepIds: ['step-2'],
        addedStepIds: ['step-4'],
        removedStepIds: ['step-3'],
      };

      expect(sessionAfterStage2.currentStage).toBe(3);
      expect(sessionAfterStage2.modifiedStepIds).toContain('step-2');
      expect(sessionAfterStage2.addedStepIds).toContain('step-4');
      expect(sessionAfterStage2.removedStepIds).toContain('step-3');
    });

    it('should allow Stage 3 to identify steps needing re-implementation', () => {
      const session: Session = {
        ...baseSession,
        status: 'implementing',
        currentStage: 3,
        modifiedStepIds: ['step-1', 'step-2'],
        addedStepIds: ['step-new-1'],
        removedStepIds: [],
      };

      // Steps that need (re-)implementation in Stage 3
      const stepsToImplement = [
        ...(session.modifiedStepIds ?? []),
        ...(session.addedStepIds ?? []),
      ];

      expect(stepsToImplement).toContain('step-1');
      expect(stepsToImplement).toContain('step-2');
      expect(stepsToImplement).toContain('step-new-1');
    });

    it('should allow Stage 3 to skip removed steps', () => {
      const session: Session = {
        ...baseSession,
        status: 'implementing',
        currentStage: 3,
        modifiedStepIds: [],
        addedStepIds: [],
        removedStepIds: ['step-3', 'step-4'],
      };

      const isStepRemoved = (stepId: string) =>
        session.removedStepIds?.includes(stepId) ?? false;

      expect(isStepRemoved('step-3')).toBe(true);
      expect(isStepRemoved('step-4')).toBe(true);
      expect(isStepRemoved('step-1')).toBe(false);
    });
  });

  describe('isPlanModificationSession field', () => {
    it('should allow session without isPlanModificationSession (optional field)', () => {
      const session: Session = { ...baseSession };
      expect(session.isPlanModificationSession).toBeUndefined();
    });

    it('should allow session with isPlanModificationSession set to true', () => {
      const session: Session = {
        ...baseSession,
        isPlanModificationSession: true,
      };
      expect(session.isPlanModificationSession).toBe(true);
    });

    it('should allow session with isPlanModificationSession set to false', () => {
      const session: Session = {
        ...baseSession,
        isPlanModificationSession: false,
      };
      expect(session.isPlanModificationSession).toBe(false);
    });

    it('should indicate modification session context', () => {
      // Initial planning session
      const initialSession: Session = {
        ...baseSession,
        currentStage: 2,
        status: 'planning',
        isPlanModificationSession: undefined, // or false
      };
      expect(initialSession.isPlanModificationSession).toBeFalsy();

      // Modification session (returned from Stage 6)
      const modificationSession: Session = {
        ...baseSession,
        currentStage: 2,
        status: 'planning',
        isPlanModificationSession: true,
      };
      expect(modificationSession.isPlanModificationSession).toBe(true);
    });
  });

  describe('plan_changes action workflow', () => {
    it('should initialize modification tracking for plan_changes workflow', () => {
      // Simulates what plan_changes action does before spawning Stage 2
      const sessionBeforeModification: Session = {
        ...baseSession,
        currentStage: 6,
        status: 'final_approval',
        // Might have stale tracking from previous modification
        modifiedStepIds: ['old-step'],
        addedStepIds: ['old-added'],
        removedStepIds: ['old-removed'],
      };

      // After plan_changes initializes tracking
      const sessionAfterInit: Session = {
        ...sessionBeforeModification,
        currentStage: 2,
        status: 'planning',
        // Previous tracking cleared
        modifiedStepIds: undefined,
        addedStepIds: undefined,
        removedStepIds: undefined,
        // New tracking initialized
        isPlanModificationSession: true,
      };

      expect(sessionAfterInit.modifiedStepIds).toBeUndefined();
      expect(sessionAfterInit.addedStepIds).toBeUndefined();
      expect(sessionAfterInit.removedStepIds).toBeUndefined();
      expect(sessionAfterInit.isPlanModificationSession).toBe(true);
    });

    it('should clear tracking after Stage 3 completion', () => {
      // Session after Stage 3 completes all steps
      const sessionAfterStage3: Session = {
        ...baseSession,
        currentStage: 4,
        status: 'pr_creation',
        // All tracking should be cleared
        modifiedStepIds: undefined,
        addedStepIds: undefined,
        removedStepIds: undefined,
        isPlanModificationSession: undefined,
      };

      expect(sessionAfterStage3.modifiedStepIds).toBeUndefined();
      expect(sessionAfterStage3.addedStepIds).toBeUndefined();
      expect(sessionAfterStage3.removedStepIds).toBeUndefined();
      expect(sessionAfterStage3.isPlanModificationSession).toBeUndefined();
    });
  });
});

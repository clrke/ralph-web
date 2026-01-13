import {
  isLegacyPlan,
  isComposablePlan,
  migrateToComposablePlan,
  ensureComposablePlan,
  needsMigration,
  readPlanWithMigration,
  composablePlanToLegacy,
} from '../../server/src/utils/planMigration';
import {
  Plan,
  ComposablePlan,
  PlanStep,
} from '../../shared/types/plan';

describe('planMigration', () => {
  // Sample legacy plan for testing
  const createLegacyPlan = (overrides?: Partial<Plan>): Plan => ({
    version: '1.0',
    planVersion: 1,
    sessionId: 'test-session-123',
    isApproved: false,
    reviewCount: 2,
    createdAt: '2024-01-01T00:00:00.000Z',
    steps: [
      {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'First Step',
        description: 'This is the first step',
        status: 'pending',
        metadata: {},
      },
      {
        id: 'step-2',
        parentId: 'step-1',
        orderIndex: 1,
        title: 'Second Step',
        description: 'This depends on step 1',
        status: 'pending',
        metadata: {},
      },
    ],
    ...overrides,
  });

  // Sample composable plan for testing
  const createComposablePlan = (overrides?: Partial<ComposablePlan>): ComposablePlan => ({
    meta: {
      version: '1.0',
      sessionId: 'test-session-456',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      isApproved: true,
      reviewCount: 3,
    },
    steps: [
      {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'First Step',
        description: 'This is the first step',
        status: 'completed',
        metadata: {},
        complexity: 'low',
        acceptanceCriteriaIds: ['ac-1'],
        estimatedFiles: ['file1.ts'],
      },
    ],
    dependencies: {
      stepDependencies: [],
      externalDependencies: [],
    },
    testCoverage: {
      framework: 'jest',
      requiredTestTypes: ['unit'],
      stepCoverage: [],
      globalCoverageTarget: 80,
    },
    acceptanceMapping: {
      mappings: [],
      updatedAt: '2024-01-02T00:00:00.000Z',
    },
    validationStatus: {
      meta: true,
      steps: true,
      dependencies: true,
      testCoverage: true,
      acceptanceMapping: true,
      overall: true,
    },
    ...overrides,
  });

  describe('isLegacyPlan', () => {
    it('should return true for a legacy plan', () => {
      const legacyPlan = createLegacyPlan();
      expect(isLegacyPlan(legacyPlan)).toBe(true);
    });

    it('should return false for a composable plan', () => {
      const composablePlan = createComposablePlan();
      expect(isLegacyPlan(composablePlan)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isLegacyPlan(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isLegacyPlan(undefined)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isLegacyPlan('string')).toBe(false);
      expect(isLegacyPlan(123)).toBe(false);
      expect(isLegacyPlan([])).toBe(false);
    });

    it('should return false for object without planVersion', () => {
      expect(isLegacyPlan({ version: '1.0', steps: [] })).toBe(false);
    });

    it('should return false for object with meta section (composable)', () => {
      const hybridPlan = { ...createLegacyPlan(), meta: { version: '1.0' } };
      expect(isLegacyPlan(hybridPlan)).toBe(false);
    });
  });

  describe('isComposablePlan', () => {
    it('should return true for a composable plan', () => {
      const composablePlan = createComposablePlan();
      expect(isComposablePlan(composablePlan)).toBe(true);
    });

    it('should return false for a legacy plan', () => {
      const legacyPlan = createLegacyPlan();
      expect(isComposablePlan(legacyPlan)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isComposablePlan(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isComposablePlan(undefined)).toBe(false);
    });

    it('should return false for partial composable plan missing required sections', () => {
      const partial = {
        meta: createComposablePlan().meta,
        steps: [],
        // missing dependencies, testCoverage, acceptanceMapping, validationStatus
      };
      expect(isComposablePlan(partial)).toBe(false);
    });
  });

  describe('migrateToComposablePlan', () => {
    it('should create a valid ComposablePlan from legacy plan', () => {
      const legacyPlan = createLegacyPlan();
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(isComposablePlan(migrated)).toBe(true);
    });

    it('should preserve session ID in meta', () => {
      const legacyPlan = createLegacyPlan({ sessionId: 'my-session-id' });
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.meta.sessionId).toBe('my-session-id');
    });

    it('should preserve isApproved status', () => {
      const approvedPlan = createLegacyPlan({ isApproved: true });
      const migrated = migrateToComposablePlan(approvedPlan);

      expect(migrated.meta.isApproved).toBe(true);
    });

    it('should preserve reviewCount', () => {
      const legacyPlan = createLegacyPlan({ reviewCount: 5 });
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.meta.reviewCount).toBe(5);
    });

    it('should set default complexity to medium for steps without complexity', () => {
      const legacyPlan = createLegacyPlan();
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.steps[0].complexity).toBe('medium');
      expect(migrated.steps[1].complexity).toBe('medium');
    });

    it('should preserve existing complexity if already set', () => {
      const legacyPlan = createLegacyPlan({
        steps: [
          {
            id: 'step-1',
            parentId: null,
            orderIndex: 0,
            title: 'Complex Step',
            description: 'This is complex',
            status: 'pending',
            metadata: {},
            complexity: 'high',
          },
        ],
      });
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.steps[0].complexity).toBe('high');
    });

    it('should extract step dependencies from parentId relationships', () => {
      const legacyPlan = createLegacyPlan();
      const migrated = migrateToComposablePlan(legacyPlan);

      // step-2 depends on step-1 (parentId: 'step-1')
      expect(migrated.dependencies.stepDependencies).toContainEqual({
        stepId: 'step-2',
        dependsOn: 'step-1',
        reason: 'Parent-child relationship from legacy plan',
      });
    });

    it('should not create dependency for steps without parentId', () => {
      const legacyPlan = createLegacyPlan({
        steps: [
          {
            id: 'step-1',
            parentId: null,
            orderIndex: 0,
            title: 'Root Step',
            description: 'No parent',
            status: 'pending',
            metadata: {},
          },
        ],
      });
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.dependencies.stepDependencies).toHaveLength(0);
    });

    it('should create empty external dependencies', () => {
      const legacyPlan = createLegacyPlan();
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.dependencies.externalDependencies).toEqual([]);
    });

    it('should use testRequirement if available', () => {
      const legacyPlan = createLegacyPlan({
        testRequirement: {
          required: true,
          reason: 'Tests are important',
          testTypes: ['unit', 'integration'],
          existingFramework: 'vitest',
          suggestedCoverage: '90%',
          assessedAt: '2024-01-01T00:00:00.000Z',
        },
      });
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.testCoverage.framework).toBe('vitest');
      expect(migrated.testCoverage.requiredTestTypes).toEqual(['unit', 'integration']);
    });

    it('should create default test coverage if no testRequirement', () => {
      const legacyPlan = createLegacyPlan();
      delete legacyPlan.testRequirement;
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.testCoverage.framework).toBe('jest');
      expect(migrated.testCoverage.requiredTestTypes).toEqual(['unit']);
      expect(migrated.testCoverage.globalCoverageTarget).toBe(80);
    });

    it('should create empty acceptance mapping', () => {
      const legacyPlan = createLegacyPlan();
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.acceptanceMapping.mappings).toEqual([]);
    });

    it('should set validation status based on steps presence', () => {
      const legacyPlan = createLegacyPlan();
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.validationStatus.meta).toBe(true);
      expect(migrated.validationStatus.steps).toBe(true);
      expect(migrated.validationStatus.overall).toBe(true);
    });

    it('should set steps validation to false for empty steps', () => {
      const legacyPlan = createLegacyPlan({ steps: [] });
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.validationStatus.steps).toBe(false);
      expect(migrated.validationStatus.overall).toBe(false);
    });

    it('should initialize empty acceptanceCriteriaIds and estimatedFiles', () => {
      const legacyPlan = createLegacyPlan();
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.steps[0].acceptanceCriteriaIds).toEqual([]);
      expect(migrated.steps[0].estimatedFiles).toEqual([]);
    });

    it('should preserve existing acceptanceCriteriaIds and estimatedFiles', () => {
      const legacyPlan = createLegacyPlan({
        steps: [
          {
            id: 'step-1',
            parentId: null,
            orderIndex: 0,
            title: 'Step with criteria',
            description: 'Has acceptance criteria',
            status: 'pending',
            metadata: {},
            acceptanceCriteriaIds: ['ac-1', 'ac-2'],
            estimatedFiles: ['file1.ts', 'file2.ts'],
          },
        ],
      });
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.steps[0].acceptanceCriteriaIds).toEqual(['ac-1', 'ac-2']);
      expect(migrated.steps[0].estimatedFiles).toEqual(['file1.ts', 'file2.ts']);
    });

    it('should handle plan with null/undefined steps gracefully', () => {
      const legacyPlan = createLegacyPlan({ steps: undefined as unknown as PlanStep[] });
      const migrated = migrateToComposablePlan(legacyPlan);

      expect(migrated.steps).toEqual([]);
      expect(migrated.validationStatus.steps).toBe(false);
    });
  });

  describe('ensureComposablePlan', () => {
    it('should return composable plan as-is', () => {
      const composablePlan = createComposablePlan();
      const result = ensureComposablePlan(composablePlan);

      expect(result).toBe(composablePlan); // Same reference
    });

    it('should migrate legacy plan', () => {
      const legacyPlan = createLegacyPlan();
      const result = ensureComposablePlan(legacyPlan);

      expect(isComposablePlan(result)).toBe(true);
      expect(result.meta.sessionId).toBe(legacyPlan.sessionId);
    });
  });

  describe('needsMigration', () => {
    it('should return true for legacy plan', () => {
      const legacyPlan = createLegacyPlan();
      expect(needsMigration(legacyPlan)).toBe(true);
    });

    it('should return false for composable plan', () => {
      const composablePlan = createComposablePlan();
      expect(needsMigration(composablePlan)).toBe(false);
    });

    it('should return false for null', () => {
      expect(needsMigration(null)).toBe(false);
    });
  });

  describe('readPlanWithMigration', () => {
    it('should return null if plan does not exist', async () => {
      const mockStorage = {
        readJson: jest.fn().mockResolvedValue(null),
        writeJson: jest.fn(),
      };

      const result = await readPlanWithMigration(mockStorage, 'project/feature');

      expect(result).toBeNull();
      expect(mockStorage.readJson).toHaveBeenCalledWith('project/feature/plan.json');
      expect(mockStorage.writeJson).not.toHaveBeenCalled();
    });

    it('should return composable plan without modification', async () => {
      const composablePlan = createComposablePlan();
      const mockStorage = {
        readJson: jest.fn().mockResolvedValue(composablePlan),
        writeJson: jest.fn(),
      };

      const result = await readPlanWithMigration(mockStorage, 'project/feature');

      expect(result).toEqual(composablePlan);
      expect(mockStorage.writeJson).not.toHaveBeenCalled();
    });

    it('should migrate legacy plan and persist', async () => {
      const legacyPlan = createLegacyPlan();
      const mockStorage = {
        readJson: jest.fn().mockResolvedValue(legacyPlan),
        writeJson: jest.fn(),
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await readPlanWithMigration(mockStorage, 'project/feature');

      expect(isComposablePlan(result)).toBe(true);
      expect(result!.meta.sessionId).toBe(legacyPlan.sessionId);
      expect(mockStorage.writeJson).toHaveBeenCalledWith(
        'project/feature/plan.json',
        expect.objectContaining({
          meta: expect.objectContaining({ sessionId: legacyPlan.sessionId }),
        })
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migrated legacy plan')
      );

      consoleSpy.mockRestore();
    });

    it('should handle unknown plan format by treating as legacy', async () => {
      const unknownPlan = { version: '2.0', steps: [], unknownField: true };
      const mockStorage = {
        readJson: jest.fn().mockResolvedValue(unknownPlan),
        writeJson: jest.fn(),
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await readPlanWithMigration(mockStorage, 'project/feature');

      expect(isComposablePlan(result)).toBe(true);
      expect(mockStorage.writeJson).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migrated unknown plan format')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('composablePlanToLegacy', () => {
    it('should convert composable plan back to legacy format', () => {
      const composablePlan = createComposablePlan();
      const legacy = composablePlanToLegacy(composablePlan);

      expect(legacy.version).toBe(composablePlan.meta.version);
      expect(legacy.planVersion).toBe(1);
      expect(legacy.sessionId).toBe(composablePlan.meta.sessionId);
      expect(legacy.isApproved).toBe(composablePlan.meta.isApproved);
      expect(legacy.reviewCount).toBe(composablePlan.meta.reviewCount);
      expect(legacy.createdAt).toBe(composablePlan.meta.createdAt);
      expect(legacy.steps).toBe(composablePlan.steps);
    });

    it('should produce a valid legacy plan', () => {
      const composablePlan = createComposablePlan();
      const legacy = composablePlanToLegacy(composablePlan);

      expect(isLegacyPlan(legacy)).toBe(true);
    });
  });
});

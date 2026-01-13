import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  PlanCompletionChecker,
  planCompletionChecker,
  PlanCompletenessResult,
  RepromptContext,
} from '../../server/src/services/PlanCompletionChecker';
import {
  PlanValidator,
  PlanValidationResult,
} from '../../server/src/services/PlanValidator';
import type { ComposablePlan, PlanStep } from '@claude-code-web/shared';

describe('PlanCompletionChecker', () => {
  let checker: PlanCompletionChecker;
  let tempDir: string;

  // Helper to create a valid plan step
  const createValidStep = (id: string, parentId: string | null = null): PlanStep => ({
    id,
    parentId,
    orderIndex: 0,
    title: `Step ${id} Title`,
    description: 'This is a sufficiently detailed description that is more than 50 characters long for validation purposes.',
    status: 'pending',
    complexity: 'medium',
    acceptanceCriteriaIds: [],
    estimatedFiles: [],
    metadata: {},
  });

  // Helper to create a valid composable plan
  // Note: Field names must match the Zod schema exactly
  const createValidPlan = (): ComposablePlan => ({
    meta: {
      version: '1.0.0',
      sessionId: 'test-session',
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      isApproved: false,
      reviewCount: 1,
    },
    steps: [
      createValidStep('step-1'),
      createValidStep('step-2', 'step-1'),
    ],
    dependencies: {
      stepDependencies: [
        { stepId: 'step-2', dependsOn: 'step-1' },
      ],
      externalDependencies: [],
    },
    testCoverage: {
      framework: 'vitest',
      requiredTestTypes: ['unit'], // Correct field name
      stepCoverage: [
        { stepId: 'step-1', requiredTestTypes: ['unit'] }, // Correct field name
      ],
    },
    acceptanceMapping: {
      mappings: [ // Correct field name
        {
          criterionId: 'ac-1',
          criterionText: 'Feature works',
          implementingStepIds: ['step-1'],
          isFullyCovered: true,
        },
      ],
      updatedAt: '2024-01-15T10:00:00Z', // Required field
    },
    validationStatus: {
      meta: true,
      steps: true,
      dependencies: true,
      testCoverage: true,
      acceptanceMapping: true,
      overall: true,
    },
  });

  beforeEach(() => {
    checker = new PlanCompletionChecker();
    // Create a temp directory for file-based tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-completion-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Singleton Export Tests
  // =========================================================================

  describe('singleton export', () => {
    it('should export a singleton instance', () => {
      expect(planCompletionChecker).toBeInstanceOf(PlanCompletionChecker);
    });
  });

  // =========================================================================
  // checkPlanCompletenessSync Tests
  // =========================================================================

  describe('checkPlanCompletenessSync', () => {
    it('should return complete for a valid plan', () => {
      const plan = createValidPlan();
      const result = checker.checkPlanCompletenessSync(plan);

      expect(result.complete).toBe(true);
      expect(result.missingContext).toBe('');
      expect(result.validationResult.overall).toBe(true);
    });

    it('should return incomplete when plan is null', () => {
      const result = checker.checkPlanCompletenessSync(null);

      expect(result.complete).toBe(false);
      expect(result.missingContext).toContain('No plan provided');
      expect(result.validationResult.overall).toBe(false);
    });

    it('should return incomplete when plan is undefined', () => {
      const result = checker.checkPlanCompletenessSync(undefined);

      expect(result.complete).toBe(false);
      expect(result.missingContext).toContain('No plan provided');
    });

    it('should return incomplete when steps are missing', () => {
      const plan = createValidPlan();
      plan.steps = [];

      const result = checker.checkPlanCompletenessSync(plan);

      expect(result.complete).toBe(false);
      expect(result.validationResult.steps.valid).toBe(false);
    });

    it('should return incomplete when meta is invalid', () => {
      const plan = createValidPlan();
      (plan.meta as any).version = ''; // Invalid version

      const result = checker.checkPlanCompletenessSync(plan);

      expect(result.complete).toBe(false);
      expect(result.validationResult.meta.valid).toBe(false);
    });

    it('should include missing context when incomplete', () => {
      const plan = createValidPlan();
      plan.steps[0].description = 'Too short'; // Less than 50 chars

      const result = checker.checkPlanCompletenessSync(plan);

      expect(result.complete).toBe(false);
      expect(result.missingContext).not.toBe('');
      expect(result.missingContext).toContain('Plan');
    });
  });

  // =========================================================================
  // checkPlanCompleteness Tests (async, file-based)
  // =========================================================================

  describe('checkPlanCompleteness', () => {
    it('should return incomplete when session directory has no plan', async () => {
      const result = await checker.checkPlanCompleteness(tempDir);

      expect(result.complete).toBe(false);
      expect(result.missingContext).toContain('No plan found');
    });

    it('should read plan.json and validate it', async () => {
      const plan = createValidPlan();
      const planPath = path.join(tempDir, 'plan.json');
      await fs.promises.writeFile(planPath, JSON.stringify(plan));

      const result = await checker.checkPlanCompleteness(tempDir);

      expect(result.complete).toBe(true);
      expect(result.validationResult.overall).toBe(true);
    });

    it('should handle invalid JSON in plan.json gracefully', async () => {
      const planPath = path.join(tempDir, 'plan.json');
      await fs.promises.writeFile(planPath, 'not valid json');

      const result = await checker.checkPlanCompleteness(tempDir);

      expect(result.complete).toBe(false);
      expect(result.missingContext).toContain('No plan found');
    });

    it('should read from plan/ directory structure', async () => {
      const planDir = path.join(tempDir, 'plan');
      const stepsDir = path.join(planDir, 'steps');
      await fs.promises.mkdir(stepsDir, { recursive: true });

      // Write meta
      await fs.promises.writeFile(
        path.join(planDir, 'meta.json'),
        JSON.stringify({
          version: '1.0.0',
          sessionId: 'test',
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          isApproved: false,
          reviewCount: 1,
        })
      );

      // Write step
      await fs.promises.writeFile(
        path.join(stepsDir, 'step-1.json'),
        JSON.stringify(createValidStep('step-1'))
      );

      // Write dependencies
      await fs.promises.writeFile(
        path.join(planDir, 'dependencies.json'),
        JSON.stringify({ stepDependencies: [], externalDependencies: [] })
      );

      // Write test coverage (with correct field names matching Zod schema)
      await fs.promises.writeFile(
        path.join(planDir, 'test-coverage.json'),
        JSON.stringify({
          framework: 'vitest',
          requiredTestTypes: ['unit'],
          stepCoverage: [{ stepId: 'step-1', requiredTestTypes: ['unit'] }],
        })
      );

      // Write acceptance mapping (with correct field names matching Zod schema)
      await fs.promises.writeFile(
        path.join(planDir, 'acceptance-mapping.json'),
        JSON.stringify({
          mappings: [{
            criterionId: 'ac-1',
            criterionText: 'Test acceptance',
            implementingStepIds: ['step-1'],
            isFullyCovered: true,
          }],
          updatedAt: '2024-01-15T10:00:00Z',
        })
      );

      const result = await checker.checkPlanCompleteness(tempDir);

      expect(result.validationResult.meta.valid).toBe(true);
      expect(result.validationResult.steps.valid).toBe(true);
    });

    it('should convert legacy plan format', async () => {
      const legacyPlan = {
        sessionId: 'legacy-session',
        steps: [createValidStep('step-1')],
        isApproved: false,
      };
      const planPath = path.join(tempDir, 'plan.json');
      await fs.promises.writeFile(planPath, JSON.stringify(legacyPlan));

      const result = await checker.checkPlanCompleteness(tempDir);

      // Legacy plan should be converted but may not pass all validations
      expect(result.validationResult).toBeDefined();
      expect(result.validationResult.steps.valid).toBe(true);
    });
  });

  // =========================================================================
  // shouldReturnToStage2 Tests
  // =========================================================================

  describe('shouldReturnToStage2', () => {
    it('should return true when overall validation fails', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: true, errors: [] },
        steps: { valid: false, errors: ['Some error'] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: false,
      };

      expect(checker.shouldReturnToStage2(validationResult)).toBe(true);
    });

    it('should return false when overall validation passes', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: true, errors: [] },
        steps: { valid: true, errors: [] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: true,
      };

      expect(checker.shouldReturnToStage2(validationResult)).toBe(false);
    });

    it('should return true when any section is invalid', () => {
      const cases: Array<keyof Omit<PlanValidationResult, 'overall'>> = [
        'meta',
        'steps',
        'dependencies',
        'testCoverage',
        'acceptanceMapping',
      ];

      for (const section of cases) {
        const validationResult: PlanValidationResult = {
          meta: { valid: true, errors: [] },
          steps: { valid: true, errors: [] },
          dependencies: { valid: true, errors: [] },
          testCoverage: { valid: true, errors: [] },
          acceptanceMapping: { valid: true, errors: [] },
          overall: false,
        };
        validationResult[section] = { valid: false, errors: ['Error'] };

        expect(checker.shouldReturnToStage2(validationResult)).toBe(true);
      }
    });
  });

  // =========================================================================
  // buildRepromptContext Tests
  // =========================================================================

  describe('buildRepromptContext', () => {
    it('should identify incomplete sections', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: false, errors: ['version: Required'] },
        steps: { valid: true, errors: [] },
        dependencies: { valid: false, errors: ['circular dependency'] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: false,
      };

      const context = checker.buildRepromptContext(validationResult);

      expect(context.incompleteSections).toContain('meta');
      expect(context.incompleteSections).toContain('dependencies');
      expect(context.incompleteSections).not.toContain('steps');
    });

    it('should extract steps lacking complexity ratings', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: true, errors: [] },
        steps: { valid: false, errors: ['Steps missing complexity rating: step-1, step-3'] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: false,
      };

      const context = checker.buildRepromptContext(validationResult);

      expect(context.stepsLackingComplexity).toContain('step-1');
      expect(context.stepsLackingComplexity).toContain('step-3');
    });

    it('should extract unmapped acceptance criteria', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: true, errors: [] },
        steps: { valid: true, errors: [] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: {
          valid: false,
          errors: ['Acceptance criteria "AC-1" has no implementing steps'],
        },
        overall: false,
      };

      const context = checker.buildRepromptContext(validationResult);

      expect(context.unmappedAcceptanceCriteria).toContain('AC-1');
    });

    it('should extract steps with insufficient descriptions', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: true, errors: [] },
        steps: {
          valid: false,
          errors: ['Step 1 (step-1): description must be at least 50 characters'],
        },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: false,
      };

      const context = checker.buildRepromptContext(validationResult);

      expect(context.insufficientDescriptions).toContain('step-1');
    });

    it('should build a summary of issues', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: false, errors: ['version: Required'] },
        steps: { valid: false, errors: ['Steps missing complexity rating: step-1'] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: false,
      };

      const context = checker.buildRepromptContext(validationResult);

      expect(context.summary).toContain('incomplete');
      expect(context.summary).toContain('meta');
    });

    it('should return success summary when validation passes', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: true, errors: [] },
        steps: { valid: true, errors: [] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: true,
      };

      const context = checker.buildRepromptContext(validationResult);

      expect(context.summary).toContain('passed');
      expect(context.incompleteSections).toHaveLength(0);
    });

    it('should build detailed context string', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: false, errors: ['version: Required'] },
        steps: { valid: false, errors: ['Step 1 (step-1): description too short'] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: false,
      };

      const context = checker.buildRepromptContext(validationResult);

      expect(context.detailedContext).toContain('Plan Validation Failed');
      expect(context.detailedContext).toContain('Incomplete Sections');
      expect(context.detailedContext).toContain('Plan Metadata');
      expect(context.detailedContext).toContain('version: Required');
      expect(context.detailedContext).toContain('Instructions');
      expect(context.detailedContext).toContain('new-steps.json');
    });

    it('should include all new-*.json files in instructions', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: false, errors: ['Error'] },
        steps: { valid: true, errors: [] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: false,
      };

      const context = checker.buildRepromptContext(validationResult);

      expect(context.detailedContext).toContain('new-steps.json');
      expect(context.detailedContext).toContain('new-dependencies.json');
      expect(context.detailedContext).toContain('new-test-coverage.json');
      expect(context.detailedContext).toContain('new-acceptance.json');
    });
  });

  // =========================================================================
  // Custom Validator Injection Tests
  // =========================================================================

  describe('custom validator injection', () => {
    it('should use injected validator', () => {
      const mockValidator = new PlanValidator();
      const validatePlanSpy = jest.spyOn(mockValidator, 'validatePlan');
      validatePlanSpy.mockReturnValue({
        meta: { valid: true, errors: [] },
        steps: { valid: true, errors: [] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: true,
      });

      const customChecker = new PlanCompletionChecker(mockValidator);
      const result = customChecker.checkPlanCompletenessSync({});

      expect(validatePlanSpy).toHaveBeenCalled();
      expect(result.complete).toBe(true);
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('edge cases', () => {
    it('should handle empty plan object', () => {
      const result = checker.checkPlanCompletenessSync({});

      expect(result.complete).toBe(false);
      expect(result.validationResult.meta.valid).toBe(false);
      expect(result.validationResult.steps.valid).toBe(false);
    });

    it('should handle plan with only some sections', () => {
      const partialPlan = {
        meta: {
          version: '1.0.0',
          sessionId: 'test',
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          isApproved: false,
          reviewCount: 0,
        },
        steps: [createValidStep('step-1')],
        // Missing dependencies, testCoverage, acceptanceMapping
      };

      const result = checker.checkPlanCompletenessSync(partialPlan);

      expect(result.complete).toBe(false);
      expect(result.validationResult.meta.valid).toBe(true);
      expect(result.validationResult.steps.valid).toBe(true);
    });

    it('should handle non-existent session directory', async () => {
      const result = await checker.checkPlanCompleteness('/non/existent/path');

      expect(result.complete).toBe(false);
      expect(result.missingContext).toContain('No plan found');
    });

    it('should handle multiple errors per section', () => {
      const validationResult: PlanValidationResult = {
        meta: { valid: false, errors: ['version: Required', 'sessionId: Required'] },
        steps: { valid: false, errors: ['Step 1 (step-1): title too short', 'Step 1 (step-1): description too short'] },
        dependencies: { valid: true, errors: [] },
        testCoverage: { valid: true, errors: [] },
        acceptanceMapping: { valid: true, errors: [] },
        overall: false,
      };

      const context = checker.buildRepromptContext(validationResult);

      expect(context.detailedContext).toContain('version: Required');
      expect(context.detailedContext).toContain('sessionId: Required');
    });
  });

  // =========================================================================
  // Integration with PlanValidator
  // =========================================================================

  describe('integration with PlanValidator', () => {
    it('should correctly identify a complete plan', () => {
      const plan = createValidPlan();
      const result = checker.checkPlanCompletenessSync(plan);

      expect(result.complete).toBe(true);
      expect(result.validationResult.overall).toBe(true);
      expect(result.validationResult.meta.valid).toBe(true);
      expect(result.validationResult.steps.valid).toBe(true);
      expect(result.validationResult.dependencies.valid).toBe(true);
      expect(result.validationResult.testCoverage.valid).toBe(true);
      expect(result.validationResult.acceptanceMapping.valid).toBe(true);
    });

    it('should correctly identify circular dependencies', () => {
      const plan = createValidPlan();
      plan.dependencies.stepDependencies = [
        { stepId: 'step-1', dependsOn: 'step-2' },
        { stepId: 'step-2', dependsOn: 'step-1' }, // Circular!
      ];

      const result = checker.checkPlanCompletenessSync(plan);

      expect(result.complete).toBe(false);
      expect(result.validationResult.dependencies.valid).toBe(false);
      expect(result.validationResult.dependencies.errors.some(e =>
        e.toLowerCase().includes('circular')
      )).toBe(true);
    });

    it('should correctly identify orphaned step references', () => {
      const plan = createValidPlan();
      plan.steps[1].parentId = 'non-existent-step';

      const result = checker.checkPlanCompletenessSync(plan);

      expect(result.complete).toBe(false);
      expect(result.validationResult.steps.valid).toBe(false);
    });
  });
});

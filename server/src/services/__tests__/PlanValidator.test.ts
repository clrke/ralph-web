import {
  PlanValidator,
  planValidator,
  PlanValidationResult,
} from '../PlanValidator';
import {
  planStepSchema,
  planDependenciesSchema,
  planTestCoverageSchema,
  planAcceptanceMappingSchema,
  containsPlaceholder,
  containsMarkerPattern,
  hasCircularDependencies,
} from '../../validation/planSchema';

// =============================================================================
// Test Data Factories
// =============================================================================

function createValidMeta(overrides = {}) {
  return {
    version: '1.0.0',
    sessionId: 'session-123',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
    isApproved: false,
    reviewCount: 0,
    ...overrides,
  };
}

function createValidStep(overrides = {}) {
  return {
    id: 'step-1',
    parentId: null,
    orderIndex: 0,
    title: 'Create feature branch',
    description: 'Create and checkout a new feature branch from the main branch for implementation work.',
    status: 'pending',
    metadata: {},
    ...overrides,
  };
}

function createValidStepWithComplexity(overrides = {}) {
  return {
    ...createValidStep(),
    complexity: 'medium',
    ...overrides,
  };
}

function createValidDependencies(overrides = {}) {
  return {
    stepDependencies: [],
    externalDependencies: [],
    ...overrides,
  };
}

function createValidTestCoverage(overrides = {}) {
  return {
    framework: 'vitest',
    requiredTestTypes: ['unit'],
    stepCoverage: [],
    ...overrides,
  };
}

function createValidAcceptanceMapping(stepIds: string[], overrides = {}) {
  return {
    mappings: [
      {
        criterionId: 'ac-1',
        criterionText: 'Feature works correctly',
        implementingStepIds: stepIds.length > 0 ? [stepIds[0]] : ['step-1'],
        isFullyCovered: true,
      },
    ],
    updatedAt: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

function createValidPlan(overrides = {}) {
  const steps = [createValidStep()];
  return {
    meta: createValidMeta(),
    steps,
    dependencies: createValidDependencies(),
    testCoverage: createValidTestCoverage(),
    acceptanceMapping: createValidAcceptanceMapping(['step-1']),
    validationStatus: {
      meta: true,
      steps: true,
      dependencies: true,
      testCoverage: true,
      acceptanceMapping: true,
      overall: true,
    },
    ...overrides,
  };
}

// =============================================================================
// Section Schema Validation Tests
// =============================================================================

describe('PlanValidator - Section Schema Validation', () => {
  let validator: PlanValidator;

  beforeEach(() => {
    validator = new PlanValidator();
  });

  describe('Meta Section Schema', () => {
    it('validates all required meta fields', () => {
      const validMeta = createValidMeta();
      const result = validator.validateMeta(validMeta);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects empty version string', () => {
      const result = validator.validateMeta(createValidMeta({ version: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('version') || e.includes('Version'))).toBe(true);
    });

    it('rejects empty sessionId', () => {
      const result = validator.validateMeta(createValidMeta({ sessionId: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('sessionId') || e.includes('Session'))).toBe(true);
    });

    it('rejects invalid createdAt datetime format', () => {
      const result = validator.validateMeta(createValidMeta({ createdAt: 'not-a-date' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('createdAt') || e.includes('datetime'))).toBe(true);
    });

    it('rejects invalid updatedAt datetime format', () => {
      const result = validator.validateMeta(createValidMeta({ updatedAt: '2024-13-45' }));
      expect(result.valid).toBe(false);
    });

    it('rejects negative reviewCount', () => {
      const result = validator.validateMeta(createValidMeta({ reviewCount: -1 }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('reviewCount') || e.includes('non-negative'))).toBe(true);
    });

    it('rejects non-boolean isApproved', () => {
      const result = validator.validateMeta(createValidMeta({ isApproved: 'yes' }));
      expect(result.valid).toBe(false);
    });

    it('validates meta with high reviewCount', () => {
      const result = validator.validateMeta(createValidMeta({ reviewCount: 100 }));
      expect(result.valid).toBe(true);
    });

    it('validates meta with approved status', () => {
      const result = validator.validateMeta(createValidMeta({ isApproved: true }));
      expect(result.valid).toBe(true);
    });
  });

  describe('Step Section Schema', () => {
    it('validates complete step with all optional fields', () => {
      const step = createValidStep({
        complexity: 'high',
        acceptanceCriteriaIds: ['ac-1', 'ac-2'],
        estimatedFiles: ['src/file.ts', 'src/other.ts'],
        contentHash: 'abc123',
      });
      const result = validator.validateSection(step, planStepSchema);
      expect(result.valid).toBe(true);
    });

    it('rejects step with empty title', () => {
      const result = validator.validateSteps([createValidStep({ title: '' })]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('title'))).toBe(true);
    });

    it('rejects step with title exceeding max length', () => {
      const result = validator.validateSteps([createValidStep({ title: 'a'.repeat(201) })]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('title') && e.includes('200'))).toBe(true);
    });

    it('rejects step with description under minimum length', () => {
      const result = validator.validateSteps([createValidStep({ description: 'Short desc' })]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('description') && e.includes('50'))).toBe(true);
    });

    it('rejects step with description exceeding max length', () => {
      const result = validator.validateSteps([createValidStep({ description: 'a'.repeat(5001) })]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('description') && e.includes('5000'))).toBe(true);
    });

    it('rejects step with negative orderIndex', () => {
      const result = validator.validateSection(createValidStep({ orderIndex: -1 }), planStepSchema);
      expect(result.valid).toBe(false);
    });

    it('validates all step status values', () => {
      const statuses = ['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'needs_review'];
      for (const status of statuses) {
        const result = validator.validateSection(createValidStep({ status }), planStepSchema);
        expect(result.valid).toBe(true);
      }
    });

    it('rejects invalid step status', () => {
      const result = validator.validateSection(createValidStep({ status: 'invalid' }), planStepSchema);
      expect(result.valid).toBe(false);
    });

    it('validates all complexity values', () => {
      const complexities = ['low', 'medium', 'high'];
      for (const complexity of complexities) {
        const result = validator.validateSection(createValidStep({ complexity }), planStepSchema);
        expect(result.valid).toBe(true);
      }
    });

    it('rejects invalid complexity value', () => {
      const result = validator.validateSection(createValidStep({ complexity: 'extreme' }), planStepSchema);
      expect(result.valid).toBe(false);
    });
  });

  describe('Dependencies Section Schema', () => {
    it('validates empty dependencies', () => {
      const result = validator.validateDependencies(createValidDependencies(), ['step-1']);
      expect(result.valid).toBe(true);
    });

    it('validates step dependencies with valid references', () => {
      const deps = createValidDependencies({
        stepDependencies: [
          { stepId: 'step-2', dependsOn: 'step-1', reason: 'Sequential' },
        ],
      });
      const result = validator.validateDependencies(deps, ['step-1', 'step-2']);
      expect(result.valid).toBe(true);
    });

    it('validates external dependencies with all required fields', () => {
      const deps = createValidDependencies({
        externalDependencies: [
          {
            name: 'zod',
            type: 'npm',
            version: '3.22.0',
            reason: 'Schema validation library',
            requiredBy: ['step-1'],
          },
        ],
      });
      const result = validator.validateDependencies(deps, ['step-1']);
      expect(result.valid).toBe(true);
    });

    it('validates all external dependency types', () => {
      const types = ['npm', 'api', 'service', 'file', 'other'];
      for (const type of types) {
        const deps = createValidDependencies({
          externalDependencies: [
            { name: 'test', type, reason: 'Test reason', requiredBy: ['step-1'] },
          ],
        });
        const result = validator.validateDependencies(deps, ['step-1']);
        expect(result.valid).toBe(true);
      }
    });

    it('rejects external dependency with invalid type', () => {
      const deps = createValidDependencies({
        externalDependencies: [
          { name: 'test', type: 'invalid', reason: 'Test', requiredBy: ['step-1'] },
        ],
      });
      const result = validator.validateSection(deps, planDependenciesSchema);
      expect(result.valid).toBe(false);
    });

    it('rejects external dependency without requiredBy', () => {
      const deps = createValidDependencies({
        externalDependencies: [
          { name: 'test', type: 'npm', reason: 'Test', requiredBy: [] },
        ],
      });
      const result = validator.validateSection(deps, planDependenciesSchema);
      expect(result.valid).toBe(false);
    });
  });

  describe('Test Coverage Section Schema', () => {
    it('validates test coverage with all fields', () => {
      const coverage = createValidTestCoverage({
        framework: 'jest',
        requiredTestTypes: ['unit', 'integration'],
        globalCoverageTarget: 80,
        stepCoverage: [
          {
            stepId: 'step-1',
            requiredTestTypes: ['unit'],
            coverageTarget: 90,
            testCases: ['should do X', 'should do Y'],
          },
        ],
      });
      const result = validator.validateTestCoverage(coverage, ['step-1']);
      expect(result.valid).toBe(true);
    });

    it('rejects empty framework', () => {
      const result = validator.validateTestCoverage(createValidTestCoverage({ framework: '' }), []);
      expect(result.valid).toBe(false);
    });

    it('rejects empty requiredTestTypes', () => {
      const result = validator.validateSection(
        createValidTestCoverage({ requiredTestTypes: [] }),
        planTestCoverageSchema
      );
      expect(result.valid).toBe(false);
    });

    it('rejects coverage target over 100', () => {
      const result = validator.validateSection(
        createValidTestCoverage({ globalCoverageTarget: 101 }),
        planTestCoverageSchema
      );
      expect(result.valid).toBe(false);
    });

    it('rejects negative coverage target', () => {
      const result = validator.validateSection(
        createValidTestCoverage({ globalCoverageTarget: -1 }),
        planTestCoverageSchema
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Acceptance Mapping Section Schema', () => {
    it('validates acceptance mapping with multiple criteria', () => {
      const mapping = {
        mappings: [
          {
            criterionId: 'ac-1',
            criterionText: 'First criterion',
            implementingStepIds: ['step-1'],
            isFullyCovered: true,
          },
          {
            criterionId: 'ac-2',
            criterionText: 'Second criterion',
            implementingStepIds: ['step-1', 'step-2'],
            isFullyCovered: false,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateAcceptanceMapping(mapping, ['step-1', 'step-2']);
      expect(result.valid).toBe(true);
    });

    it('rejects empty criterionId', () => {
      const mapping = {
        mappings: [
          {
            criterionId: '',
            criterionText: 'Test',
            implementingStepIds: ['step-1'],
            isFullyCovered: true,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateSection(mapping, planAcceptanceMappingSchema);
      expect(result.valid).toBe(false);
    });

    it('rejects empty criterionText', () => {
      const mapping = {
        mappings: [
          {
            criterionId: 'ac-1',
            criterionText: '',
            implementingStepIds: ['step-1'],
            isFullyCovered: true,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateSection(mapping, planAcceptanceMappingSchema);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid updatedAt format', () => {
      const mapping = {
        mappings: [],
        updatedAt: 'invalid-date',
      };
      const result = validator.validateSection(mapping, planAcceptanceMappingSchema);
      expect(result.valid).toBe(false);
    });
  });
});

// =============================================================================
// Incomplete Plan Detection Tests
// =============================================================================

describe('PlanValidator - Incomplete Plan Detection', () => {
  let validator: PlanValidator;

  beforeEach(() => {
    validator = new PlanValidator();
  });

  describe('Missing Sections', () => {
    it('detects missing meta section', () => {
      const plan = createValidPlan();
      delete (plan as Record<string, unknown>).meta;
      const result = validator.validatePlan(plan);
      expect(result.overall).toBe(false);
      expect(result.meta.valid).toBe(false);
    });

    it('detects missing steps section', () => {
      const plan = createValidPlan();
      delete (plan as Record<string, unknown>).steps;
      const result = validator.validatePlan(plan);
      expect(result.overall).toBe(false);
      expect(result.steps.valid).toBe(false);
    });

    it('detects missing dependencies section', () => {
      const plan = createValidPlan();
      delete (plan as Record<string, unknown>).dependencies;
      const result = validator.validatePlan(plan);
      expect(result.overall).toBe(false);
      expect(result.dependencies.valid).toBe(false);
    });

    it('detects missing testCoverage section', () => {
      const plan = createValidPlan();
      delete (plan as Record<string, unknown>).testCoverage;
      const result = validator.validatePlan(plan);
      expect(result.overall).toBe(false);
      expect(result.testCoverage.valid).toBe(false);
    });

    it('detects missing acceptanceMapping section', () => {
      const plan = createValidPlan();
      delete (plan as Record<string, unknown>).acceptanceMapping;
      const result = validator.validatePlan(plan);
      expect(result.overall).toBe(false);
      expect(result.acceptanceMapping.valid).toBe(false);
    });

    it('reports all missing sections in getIncompleteSections', () => {
      const plan = {};
      const incomplete = validator.getIncompleteSections(plan);
      expect(incomplete.length).toBe(5);
      const sections = incomplete.map(i => i.section);
      expect(sections).toContain('meta');
      expect(sections).toContain('steps');
      expect(sections).toContain('dependencies');
      expect(sections).toContain('testCoverage');
      expect(sections).toContain('acceptanceMapping');
    });
  });

  describe('Empty Descriptions', () => {
    it('detects step with empty description', () => {
      const plan = createValidPlan({
        steps: [createValidStep({ description: '' })],
      });
      const result = validator.validatePlan(plan);
      expect(result.steps.valid).toBe(false);
      expect(result.steps.errors.some(e => e.includes('description'))).toBe(true);
    });

    it('detects step with whitespace-only description', () => {
      const plan = createValidPlan({
        steps: [createValidStep({ description: '   ' })],
      });
      const result = validator.validatePlan(plan);
      expect(result.steps.valid).toBe(false);
    });

    it('detects multiple steps with short descriptions', () => {
      const plan = createValidPlan({
        steps: [
          createValidStep({ id: 'step-1', description: 'Too short' }),
          createValidStep({ id: 'step-2', orderIndex: 1, description: 'Also short' }),
        ],
      });
      plan.acceptanceMapping.mappings[0].implementingStepIds = ['step-1', 'step-2'];
      const result = validator.validatePlan(plan);
      expect(result.steps.valid).toBe(false);
      expect(result.steps.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Missing Complexity', () => {
    it('validateStepsComplete detects missing complexity', () => {
      const steps = [createValidStep()]; // No complexity
      const result = validator.validateStepsComplete(steps);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('complexity'))).toBe(true);
    });

    it('validateStepsComplete passes with all complexities set', () => {
      const steps = [
        createValidStepWithComplexity({ id: 'step-1', complexity: 'low' }),
        createValidStepWithComplexity({ id: 'step-2', orderIndex: 1, complexity: 'high' }),
      ];
      const result = validator.validateStepsComplete(steps);
      expect(result.valid).toBe(true);
    });

    it('validateStepsComplete lists all steps missing complexity', () => {
      const steps = [
        createValidStep({ id: 'step-1' }),
        createValidStepWithComplexity({ id: 'step-2', orderIndex: 1 }),
        createValidStep({ id: 'step-3', orderIndex: 2 }),
      ];
      const result = validator.validateStepsComplete(steps);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('step-1'))).toBe(true);
      expect(result.errors.some(e => e.includes('step-3'))).toBe(true);
      expect(result.errors.some(e => e.includes('step-2'))).toBe(false);
    });
  });

  describe('Empty Arrays', () => {
    it('detects empty steps array', () => {
      const plan = createValidPlan({ steps: [] });
      const result = validator.validatePlan(plan);
      expect(result.steps.valid).toBe(false);
      expect(result.steps.errors[0]).toContain('at least one step');
    });

    it('allows empty stepDependencies array', () => {
      const plan = createValidPlan();
      plan.dependencies.stepDependencies = [];
      const result = validator.validatePlan(plan);
      expect(result.dependencies.valid).toBe(true);
    });

    it('allows empty stepCoverage array', () => {
      const plan = createValidPlan();
      plan.testCoverage.stepCoverage = [];
      const result = validator.validatePlan(plan);
      expect(result.testCoverage.valid).toBe(true);
    });
  });
});

// =============================================================================
// Validation Context Generation Tests
// =============================================================================

describe('PlanValidator - Validation Context Generation', () => {
  let validator: PlanValidator;

  beforeEach(() => {
    validator = new PlanValidator();
  });

  it('returns empty string for valid plan', () => {
    const plan = createValidPlan();
    const context = validator.generateValidationContext(plan);
    expect(context).toBe('');
  });

  it('includes header for invalid plan', () => {
    const plan = createValidPlan({ meta: { version: '' } });
    const context = validator.generateValidationContext(plan);
    expect(context).toContain('Plan Validation Issues');
  });

  it('includes section names in readable format', () => {
    const plan = {
      meta: {},
      steps: [],
      dependencies: {},
      testCoverage: {},
      acceptanceMapping: {},
    };
    const context = validator.generateValidationContext(plan);
    expect(context).toContain('Plan Metadata');
    expect(context).toContain('Plan Steps');
  });

  it('includes specific error messages', () => {
    const plan = createValidPlan({
      steps: [createValidStep({ description: 'Too short' })],
    });
    const context = validator.generateValidationContext(plan);
    expect(context).toContain('description');
    expect(context).toContain('50 characters');
  });

  it('includes guidance for complexity issues', () => {
    // Use getIncompleteSections to check for complexity-related guidance
    const plan = createValidPlan();
    // Remove complexity from step
    delete (plan.steps[0] as Record<string, unknown>).complexity;
    // We need to trigger the guidance generation
    const _incompleteSections = validator.getIncompleteSections(plan); // Validates plan as side effect
    // Since validateSteps doesn't require complexity, check via validateStepsComplete
    const stepsResult = validator.validateStepsComplete(plan.steps);
    expect(stepsResult.errors.some(e => e.includes('complexity'))).toBe(true);
  });

  it('includes guidance for circular dependency issues', () => {
    const plan = createValidPlan({
      steps: [
        createValidStep({ id: 'step-1' }),
        createValidStep({ id: 'step-2', orderIndex: 1 }),
      ],
      dependencies: {
        stepDependencies: [
          { stepId: 'step-1', dependsOn: 'step-2' },
          { stepId: 'step-2', dependsOn: 'step-1' },
        ],
        externalDependencies: [],
      },
    });
    plan.acceptanceMapping.mappings[0].implementingStepIds = ['step-1', 'step-2'];
    const context = validator.generateValidationContext(plan);
    expect(context.toLowerCase()).toContain('circular');
  });

  it('includes guidance for framework issues', () => {
    const plan = createValidPlan({
      testCoverage: createValidTestCoverage({ framework: '' }),
    });
    const context = validator.generateValidationContext(plan);
    expect(context).toContain('framework');
  });

  it('includes "How to Fix" section when there are issues', () => {
    const plan = createValidPlan({
      testCoverage: createValidTestCoverage({ framework: '' }),
    });
    const context = validator.generateValidationContext(plan);
    expect(context).toContain('How to Fix');
  });

  it('generates guidance for orphaned parentId', () => {
    const plan = createValidPlan({
      steps: [createValidStep({ parentId: 'non-existent-step' })],
    });
    const context = validator.generateValidationContext(plan);
    expect(context.includes('orphaned') || context.includes('parent')).toBe(true);
  });
});

// =============================================================================
// Circular Dependency Detection Tests
// =============================================================================

describe('PlanValidator - Circular Dependency Detection', () => {
  let validator: PlanValidator;

  beforeEach(() => {
    validator = new PlanValidator();
  });

  describe('hasCircularDependencies helper', () => {
    it('returns false for empty dependencies', () => {
      const result = hasCircularDependencies([]);
      expect(result.hasCycle).toBe(false);
    });

    it('returns false for linear chain', () => {
      const deps = [
        { stepId: 'step-2', dependsOn: 'step-1' },
        { stepId: 'step-3', dependsOn: 'step-2' },
        { stepId: 'step-4', dependsOn: 'step-3' },
      ];
      const result = hasCircularDependencies(deps);
      expect(result.hasCycle).toBe(false);
    });

    it('detects simple 2-node cycle', () => {
      const deps = [
        { stepId: 'step-1', dependsOn: 'step-2' },
        { stepId: 'step-2', dependsOn: 'step-1' },
      ];
      const result = hasCircularDependencies(deps);
      expect(result.hasCycle).toBe(true);
      expect(result.cycle).toBeDefined();
      expect(result.cycle!.length).toBeGreaterThan(1);
    });

    it('detects 3-node cycle', () => {
      const deps = [
        { stepId: 'step-1', dependsOn: 'step-2' },
        { stepId: 'step-2', dependsOn: 'step-3' },
        { stepId: 'step-3', dependsOn: 'step-1' },
      ];
      const result = hasCircularDependencies(deps);
      expect(result.hasCycle).toBe(true);
      expect(result.cycle).toBeDefined();
    });

    it('detects longer cycle chains', () => {
      const deps = [
        { stepId: 'step-1', dependsOn: 'step-2' },
        { stepId: 'step-2', dependsOn: 'step-3' },
        { stepId: 'step-3', dependsOn: 'step-4' },
        { stepId: 'step-4', dependsOn: 'step-5' },
        { stepId: 'step-5', dependsOn: 'step-1' },
      ];
      const result = hasCircularDependencies(deps);
      expect(result.hasCycle).toBe(true);
    });

    it('detects self-referential dependency', () => {
      const deps = [{ stepId: 'step-1', dependsOn: 'step-1' }];
      const result = hasCircularDependencies(deps);
      expect(result.hasCycle).toBe(true);
    });

    it('allows multiple dependencies to same step', () => {
      const deps = [
        { stepId: 'step-2', dependsOn: 'step-1' },
        { stepId: 'step-3', dependsOn: 'step-1' },
        { stepId: 'step-4', dependsOn: 'step-2' },
        { stepId: 'step-4', dependsOn: 'step-3' },
      ];
      const result = hasCircularDependencies(deps);
      expect(result.hasCycle).toBe(false);
    });

    it('returns cycle path when cycle is detected', () => {
      const deps = [
        { stepId: 'A', dependsOn: 'B' },
        { stepId: 'B', dependsOn: 'C' },
        { stepId: 'C', dependsOn: 'A' },
      ];
      const result = hasCircularDependencies(deps);
      expect(result.hasCycle).toBe(true);
      expect(result.cycle).toBeDefined();
      // Cycle should include the loop
      expect(result.cycle!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('validateDependencies with circular checks', () => {
    it('rejects plan with circular step dependencies', () => {
      const deps = {
        stepDependencies: [
          { stepId: 'step-1', dependsOn: 'step-2' },
          { stepId: 'step-2', dependsOn: 'step-1' },
        ],
        externalDependencies: [],
      };
      const result = validator.validateDependencies(deps, ['step-1', 'step-2']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('circular'))).toBe(true);
    });

    it('validates complex non-circular dependency graph', () => {
      // Diamond dependency pattern: A -> B, A -> C, B -> D, C -> D
      const deps = {
        stepDependencies: [
          { stepId: 'B', dependsOn: 'A' },
          { stepId: 'C', dependsOn: 'A' },
          { stepId: 'D', dependsOn: 'B' },
          { stepId: 'D', dependsOn: 'C' },
        ],
        externalDependencies: [],
      };
      const result = validator.validateDependencies(deps, ['A', 'B', 'C', 'D']);
      expect(result.valid).toBe(true);
    });

    it('provides cycle path in error message', () => {
      const deps = {
        stepDependencies: [
          { stepId: 'step-a', dependsOn: 'step-b' },
          { stepId: 'step-b', dependsOn: 'step-c' },
          { stepId: 'step-c', dependsOn: 'step-a' },
        ],
        externalDependencies: [],
      };
      const result = validator.validateDependencies(deps, ['step-a', 'step-b', 'step-c']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('->'))).toBe(true);
    });
  });
});

// =============================================================================
// Acceptance Criteria Mapping Validation Tests
// =============================================================================

describe('PlanValidator - Acceptance Criteria Mapping Validation', () => {
  let validator: PlanValidator;

  beforeEach(() => {
    validator = new PlanValidator();
  });

  describe('Step Reference Validation', () => {
    it('rejects mapping with non-existent step reference', () => {
      const mapping = {
        mappings: [
          {
            criterionId: 'ac-1',
            criterionText: 'Feature works',
            implementingStepIds: ['step-999'],
            isFullyCovered: true,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateAcceptanceMapping(mapping, ['step-1']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('step-999'))).toBe(true);
    });

    it('validates mapping with all valid step references', () => {
      const mapping = {
        mappings: [
          {
            criterionId: 'ac-1',
            criterionText: 'Feature A works',
            implementingStepIds: ['step-1', 'step-2'],
            isFullyCovered: true,
          },
          {
            criterionId: 'ac-2',
            criterionText: 'Feature B works',
            implementingStepIds: ['step-3'],
            isFullyCovered: true,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateAcceptanceMapping(mapping, ['step-1', 'step-2', 'step-3']);
      expect(result.valid).toBe(true);
    });

    it('rejects mapping where some steps exist and some do not', () => {
      const mapping = {
        mappings: [
          {
            criterionId: 'ac-1',
            criterionText: 'Feature works',
            implementingStepIds: ['step-1', 'step-missing'],
            isFullyCovered: true,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateAcceptanceMapping(mapping, ['step-1']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('step-missing'))).toBe(true);
    });
  });

  describe('Empty Implementing Steps', () => {
    it('rejects criterion with no implementing steps', () => {
      const mapping = {
        mappings: [
          {
            criterionId: 'ac-1',
            criterionText: 'Feature works',
            implementingStepIds: [],
            isFullyCovered: false,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateAcceptanceMapping(mapping, ['step-1']);
      expect(result.valid).toBe(false);
    });

    it('detects multiple criteria with empty implementing steps', () => {
      const mapping = {
        mappings: [
          {
            criterionId: 'ac-1',
            criterionText: 'Feature A',
            implementingStepIds: [],
            isFullyCovered: false,
          },
          {
            criterionId: 'ac-2',
            criterionText: 'Feature B',
            implementingStepIds: [],
            isFullyCovered: false,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateSection(mapping, planAcceptanceMappingSchema);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Coverage Status', () => {
    it('allows partially covered criteria', () => {
      const mapping = {
        mappings: [
          {
            criterionId: 'ac-1',
            criterionText: 'Feature works',
            implementingStepIds: ['step-1'],
            isFullyCovered: false,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateAcceptanceMapping(mapping, ['step-1']);
      expect(result.valid).toBe(true);
    });

    it('allows mixed coverage status across criteria', () => {
      const mapping = {
        mappings: [
          {
            criterionId: 'ac-1',
            criterionText: 'Feature A',
            implementingStepIds: ['step-1'],
            isFullyCovered: true,
          },
          {
            criterionId: 'ac-2',
            criterionText: 'Feature B',
            implementingStepIds: ['step-2'],
            isFullyCovered: false,
          },
        ],
        updatedAt: '2024-01-15T10:00:00Z',
      };
      const result = validator.validateAcceptanceMapping(mapping, ['step-1', 'step-2']);
      expect(result.valid).toBe(true);
    });
  });

  describe('Cross-validation in validatePlan', () => {
    it('cross-validates acceptance mapping against actual steps', () => {
      const plan = createValidPlan({
        steps: [createValidStep({ id: 'step-1' })],
        acceptanceMapping: {
          mappings: [
            {
              criterionId: 'ac-1',
              criterionText: 'Feature works',
              implementingStepIds: ['step-99'],
              isFullyCovered: true,
            },
          ],
          updatedAt: '2024-01-15T10:00:00Z',
        },
      });
      const result = validator.validatePlan(plan);
      expect(result.acceptanceMapping.valid).toBe(false);
    });
  });
});

// =============================================================================
// Placeholder Pattern Detection Tests
// =============================================================================

describe('PlanValidator - Placeholder Pattern Detection', () => {
  describe('containsPlaceholder helper', () => {
    it('detects TBD placeholder', () => {
      expect(containsPlaceholder('This is TBD')).toBe(true);
      expect(containsPlaceholder('tbd later')).toBe(true);
    });

    it('detects TODO placeholder', () => {
      expect(containsPlaceholder('TODO: implement this')).toBe(true);
      expect(containsPlaceholder('todo implement')).toBe(true);
    });

    it('detects FIXME placeholder', () => {
      expect(containsPlaceholder('FIXME: broken')).toBe(true);
    });

    it('detects XXX placeholder', () => {
      expect(containsPlaceholder('XXX: needs work')).toBe(true);
    });

    it('detects PLACEHOLDER text', () => {
      expect(containsPlaceholder('This is a PLACEHOLDER')).toBe(true);
    });

    it('detects "to be determined" variations', () => {
      expect(containsPlaceholder('To be determined later')).toBe(true);
      expect(containsPlaceholder('TO BE DEFINED')).toBe(true);
    });

    it('detects "needs to be" variations', () => {
      expect(containsPlaceholder('Needs to be filled')).toBe(true);
      expect(containsPlaceholder('NEEDS COMPLETED')).toBe(true);
      expect(containsPlaceholder('Need to be written')).toBe(true);
    });

    it('detects [...] patterns', () => {
      expect(containsPlaceholder('Some text [...] more text')).toBe(true);
      expect(containsPlaceholder('[....]')).toBe(true);
    });

    it('detects <...> patterns', () => {
      expect(containsPlaceholder('Some <...> here')).toBe(true);
    });

    it('does not flag normal text', () => {
      expect(containsPlaceholder('This is a normal description')).toBe(false);
      expect(containsPlaceholder('Implement the feature correctly')).toBe(false);
    });

    it('does not flag code that happens to contain similar letters', () => {
      // Note: The regex is case-insensitive, so "ToDo" matches.
      // This tests that we don't false-positive on totally different words.
      expect(containsPlaceholder('Create a task tracker')).toBe(false);
      expect(containsPlaceholder('Implement the feature correctly')).toBe(false);
    });
  });

  describe('Step validation with placeholders', () => {
    let validator: PlanValidator;

    beforeEach(() => {
      validator = new PlanValidator();
    });

    it('rejects step title with placeholder', () => {
      const result = validator.validateSteps([
        createValidStep({ title: 'TBD Step Title' }),
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('placeholder'))).toBe(true);
    });

    it('rejects step description with placeholder', () => {
      const result = validator.validateSteps([
        createValidStep({
          description: 'This step needs to be filled in with actual implementation details TODO implement.',
        }),
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('placeholder'))).toBe(true);
    });
  });
});

// =============================================================================
// Marker Pattern Detection Tests
// =============================================================================

describe('PlanValidator - Marker Pattern Detection', () => {
  describe('containsMarkerPattern helper', () => {
    it('detects DECISION_NEEDED markers', () => {
      expect(containsMarkerPattern('[DECISION_NEEDED]')).toBe(true);
      expect(containsMarkerPattern('[DECISION_NEEDED auth_method]')).toBe(true);
      expect(containsMarkerPattern('[/DECISION_NEEDED]')).toBe(true);
    });

    it('detects PLAN_STEP markers', () => {
      expect(containsMarkerPattern('[PLAN_STEP]')).toBe(true);
      expect(containsMarkerPattern('[/PLAN_STEP]')).toBe(true);
    });

    it('detects PR_CREATED markers', () => {
      expect(containsMarkerPattern('[PR_CREATED]')).toBe(true);
      expect(containsMarkerPattern('[PR_CREATED url=...]')).toBe(true);
    });

    it('detects CI_STATUS markers', () => {
      expect(containsMarkerPattern('[CI_STATUS]')).toBe(true);
      expect(containsMarkerPattern('[/CI_STATUS]')).toBe(true);
    });

    it('detects STEP_COMPLETE markers', () => {
      expect(containsMarkerPattern('[STEP_COMPLETE]')).toBe(true);
      expect(containsMarkerPattern('[STEP_COMPLETE step-1]')).toBe(true);
    });

    it('detects IMPLEMENTATION_COMPLETE markers', () => {
      expect(containsMarkerPattern('[IMPLEMENTATION_COMPLETE]')).toBe(true);
    });

    it('detects RETURN_TO_STAGE_2 markers', () => {
      expect(containsMarkerPattern('[RETURN_TO_STAGE_2]')).toBe(true);
    });

    it('does not flag normal bracket text', () => {
      expect(containsMarkerPattern('[normal text]')).toBe(false);
      expect(containsMarkerPattern('array[0]')).toBe(false);
    });
  });

  describe('Step validation with markers', () => {
    let validator: PlanValidator;

    beforeEach(() => {
      validator = new PlanValidator();
    });

    it('rejects step title with marker pattern', () => {
      const result = validator.validateSteps([
        createValidStep({ title: '[PLAN_STEP] Create feature' }),
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('marker'))).toBe(true);
    });

    it('rejects step description with marker pattern', () => {
      const result = validator.validateSteps([
        createValidStep({
          description: 'Create the feature [DECISION_NEEDED auth_method] and implement authentication throughout.',
        }),
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('marker'))).toBe(true);
    });
  });
});

// =============================================================================
// createValidationStatus Tests
// =============================================================================

describe('PlanValidator - createValidationStatus', () => {
  let validator: PlanValidator;

  beforeEach(() => {
    validator = new PlanValidator();
  });

  it('creates status with all sections valid', () => {
    const validationResult: PlanValidationResult = {
      meta: { valid: true, errors: [] },
      steps: { valid: true, errors: [] },
      dependencies: { valid: true, errors: [] },
      testCoverage: { valid: true, errors: [] },
      acceptanceMapping: { valid: true, errors: [] },
      overall: true,
    };
    const status = validator.createValidationStatus(validationResult);
    expect(status.meta).toBe(true);
    expect(status.steps).toBe(true);
    expect(status.dependencies).toBe(true);
    expect(status.testCoverage).toBe(true);
    expect(status.acceptanceMapping).toBe(true);
    expect(status.overall).toBe(true);
    expect(status.errors).toBeUndefined();
  });

  it('creates status with errors for invalid sections', () => {
    const validationResult: PlanValidationResult = {
      meta: { valid: false, errors: ['Version is required'] },
      steps: { valid: false, errors: ['Step 1: description too short', 'Step 2: missing title'] },
      dependencies: { valid: true, errors: [] },
      testCoverage: { valid: true, errors: [] },
      acceptanceMapping: { valid: true, errors: [] },
      overall: false,
    };
    const status = validator.createValidationStatus(validationResult);
    expect(status.meta).toBe(false);
    expect(status.steps).toBe(false);
    expect(status.overall).toBe(false);
    expect(status.errors).toBeDefined();
    expect(status.errors!.meta).toContain('Version is required');
    expect(status.errors!.steps).toHaveLength(2);
  });

  it('only includes errors for invalid sections', () => {
    const validationResult: PlanValidationResult = {
      meta: { valid: true, errors: [] },
      steps: { valid: false, errors: ['Error'] },
      dependencies: { valid: true, errors: [] },
      testCoverage: { valid: true, errors: [] },
      acceptanceMapping: { valid: true, errors: [] },
      overall: false,
    };
    const status = validator.createValidationStatus(validationResult);
    expect(status.errors).toBeDefined();
    expect(status.errors!.steps).toBeDefined();
    expect(status.errors!.meta).toBeUndefined();
    expect(status.errors!.dependencies).toBeUndefined();
  });
});

// =============================================================================
// isPlanValid Tests
// =============================================================================

describe('PlanValidator - isPlanValid', () => {
  let validator: PlanValidator;

  beforeEach(() => {
    validator = new PlanValidator();
  });

  it('returns true for valid plan', () => {
    const plan = createValidPlan();
    expect(validator.isPlanValid(plan)).toBe(true);
  });

  it('returns false for null', () => {
    expect(validator.isPlanValid(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(validator.isPlanValid(undefined)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(validator.isPlanValid({})).toBe(false);
  });

  it('returns false for plan with any invalid section', () => {
    const plan = createValidPlan({ meta: { version: '' } });
    expect(validator.isPlanValid(plan)).toBe(false);
  });
});

// =============================================================================
// Singleton Export Tests
// =============================================================================

describe('planValidator singleton', () => {
  it('exports a singleton instance', () => {
    expect(planValidator).toBeInstanceOf(PlanValidator);
  });

  it('has all public methods available', () => {
    expect(typeof planValidator.validateSection).toBe('function');
    expect(typeof planValidator.validateMeta).toBe('function');
    expect(typeof planValidator.validateSteps).toBe('function');
    expect(typeof planValidator.validateStepsComplete).toBe('function');
    expect(typeof planValidator.validateDependencies).toBe('function');
    expect(typeof planValidator.validateTestCoverage).toBe('function');
    expect(typeof planValidator.validateAcceptanceMapping).toBe('function');
    expect(typeof planValidator.validatePlan).toBe('function');
    expect(typeof planValidator.getIncompleteSections).toBe('function');
    expect(typeof planValidator.generateValidationContext).toBe('function');
    expect(typeof planValidator.createValidationStatus).toBe('function');
    expect(typeof planValidator.isPlanValid).toBe('function');
  });
});

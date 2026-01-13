import { OutputParser, ParsedMarker } from '../../server/src/services/OutputParser';

describe('OutputParser', () => {
  let parser: OutputParser;

  beforeEach(() => {
    parser = new OutputParser();
  });

  describe('parseDecisionNeeded', () => {
    it('should parse DECISION_NEEDED marker with all attributes', () => {
      const input = `
Some text before
[DECISION_NEEDED priority="1" category="blocker"]
Should we use JWT or session-based auth?
- Option A: JWT tokens (recommended)
- Option B: Session cookies
- Option C: OAuth2
[/DECISION_NEEDED]
Some text after
`;
      const result = parser.parse(input);

      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0]).toMatchObject({
        priority: 1,
        category: 'blocker',
        questionText: expect.stringContaining('JWT or session-based auth'),
        options: [
          { label: 'JWT tokens', recommended: true },
          { label: 'Session cookies', recommended: false },
          { label: 'OAuth2', recommended: false },
        ],
      });
    });

    it('should parse multiple DECISION_NEEDED markers', () => {
      const input = `
[DECISION_NEEDED priority="1" category="scope"]
Question 1?
- Option A
[/DECISION_NEEDED]

[DECISION_NEEDED priority="2" category="technical"]
Question 2?
- Option A
- Option B
[/DECISION_NEEDED]
`;
      const result = parser.parse(input);

      expect(result.decisions).toHaveLength(2);
      expect(result.decisions[0].priority).toBe(1);
      expect(result.decisions[1].priority).toBe(2);
    });

    it('should handle file and line attributes', () => {
      const input = `
[DECISION_NEEDED priority="2" category="major" file="src/auth.ts" line="42"]
Issue in file
- Option A
[/DECISION_NEEDED]
`;
      const result = parser.parse(input);

      expect(result.decisions[0]).toMatchObject({
        file: 'src/auth.ts',
        line: 42,
      });
    });

    it('should not treat bullet points as options unless they have Option prefix', () => {
      const input = `
[DECISION_NEEDED priority="2" category="technical"]
**Issue: Missing Test Coverage**
Three critical gaps:
- \`handleStage3Result()\` - No tests for retry tracking
- \`EventBroadcaster\` - Zero tests for stage 3 methods
- \`buildStage3Prompt()\` - Only sanitization tested
**How should we address this?**
- Option A: Add comprehensive tests now (recommended)
- Option B: Add minimal tests
- Option C: Defer to separate PR
[/DECISION_NEEDED]
`;
      const result = parser.parse(input);

      expect(result.decisions).toHaveLength(1);
      // Question text should include the bullet points (not parsed as options)
      expect(result.decisions[0].questionText).toContain('handleStage3Result()');
      expect(result.decisions[0].questionText).toContain('EventBroadcaster');
      expect(result.decisions[0].questionText).toContain('buildStage3Prompt()');
      // Only the actual Option A/B/C should be parsed as options
      expect(result.decisions[0].options).toHaveLength(3);
      expect(result.decisions[0].options[0].label).toContain('Add comprehensive tests');
      expect(result.decisions[0].options[0].recommended).toBe(true);
    });
  });

  describe('parsePlanStep', () => {
    it('should parse PLAN_STEP markers', () => {
      const input = `
[PLAN_STEP id="1" parent="null" status="pending"]
Create authentication middleware
This step sets up the JWT validation middleware.
[/PLAN_STEP]

[PLAN_STEP id="2" parent="1" status="pending"]
Add login endpoint
[/PLAN_STEP]
`;
      const result = parser.parse(input);

      expect(result.planSteps).toHaveLength(2);
      expect(result.planSteps[0]).toMatchObject({
        id: '1',
        parentId: null,
        status: 'pending',
        title: 'Create authentication middleware',
        description: expect.stringContaining('JWT validation'),
      });
      expect(result.planSteps[1].parentId).toBe('1');
    });
  });

  describe('parseStepComplete', () => {
    it('should parse STEP_COMPLETE marker', () => {
      const input = `
[STEP_COMPLETE id="step-1"]
Created the authentication middleware with JWT validation.
Added tests for token expiry.
[/STEP_COMPLETE]
`;
      const result = parser.parse(input);

      expect(result.stepCompleted).toMatchObject({
        id: 'step-1',
        summary: expect.stringContaining('JWT validation'),
      });
    });
  });

  describe('parsePlanModeState', () => {
    it('should detect PLAN_MODE_ENTERED', () => {
      const input = `Starting analysis...\n[PLAN_MODE_ENTERED]\nNow in plan mode.`;
      const result = parser.parse(input);

      expect(result.planModeEntered).toBe(true);
      expect(result.planModeExited).toBe(false);
    });

    it('should detect PLAN_MODE_EXITED', () => {
      const input = `Plan complete.\n[PLAN_MODE_EXITED]\nReady for approval.`;
      const result = parser.parse(input);

      expect(result.planModeExited).toBe(true);
    });
  });

  describe('parsePlanFile', () => {
    it('should extract PLAN_FILE path', () => {
      const input = `[PLAN_FILE path="/Users/arke/.claude/plans/my-plan.md"]`;
      const result = parser.parse(input);

      expect(result.planFilePath).toBe('/Users/arke/.claude/plans/my-plan.md');
    });
  });

  describe('parseImplementationComplete', () => {
    it('should parse IMPLEMENTATION_COMPLETE marker', () => {
      const input = `
[IMPLEMENTATION_COMPLETE]
All changes have been made:
- Added auth middleware
- Created login endpoint
- Added tests
[/IMPLEMENTATION_COMPLETE]
`;
      const result = parser.parse(input);

      expect(result.implementationComplete).toBe(true);
      expect(result.implementationSummary).toContain('auth middleware');
    });
  });

  describe('parseImplementationStatus', () => {
    it('should parse IMPLEMENTATION_STATUS marker', () => {
      const input = `
[IMPLEMENTATION_STATUS]
step_id: step-2
status: IN_PROGRESS
files_modified: 3
tests_status: PASSING
work_type: IMPLEMENTATION
progress: 60
message: Working on login endpoint
[/IMPLEMENTATION_STATUS]
`;
      const result = parser.parse(input);

      expect(result.implementationStatus).toMatchObject({
        stepId: 'step-2',
        status: 'IN_PROGRESS',
        filesModified: 3,
        testsStatus: 'PASSING',
        workType: 'IMPLEMENTATION',
        progress: 60,
        message: 'Working on login endpoint',
      });
    });
  });

  describe('parsePRCreated', () => {
    it('should parse PR_CREATED marker', () => {
      const input = `
[PR_CREATED]
Title: Add user authentication
Branch: feature/auth → main
[/PR_CREATED]
`;
      const result = parser.parse(input);

      expect(result.prCreated).toMatchObject({
        title: 'Add user authentication',
        sourceBranch: 'feature/auth',
        targetBranch: 'main',
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', () => {
      const result = parser.parse('');

      expect(result.decisions).toEqual([]);
      expect(result.planSteps).toEqual([]);
      expect(result.stepCompleted).toBeNull();
    });

    it('should handle input with no markers', () => {
      const result = parser.parse('Just some plain text output from Claude.');

      expect(result.decisions).toEqual([]);
      expect(result.planSteps).toEqual([]);
    });

    it('should handle malformed markers gracefully', () => {
      const input = `[DECISION_NEEDED]\nMissing attributes\n[/DECISION_NEEDED]`;

      expect(() => parser.parse(input)).not.toThrow();
    });
  });

  describe('multiple STEP_COMPLETE handling', () => {
    it('should capture all STEP_COMPLETE markers', () => {
      const input = `
[STEP_COMPLETE id="step-1"]
First step done
[/STEP_COMPLETE]

[STEP_COMPLETE id="step-2"]
Second step done
[/STEP_COMPLETE]

[STEP_COMPLETE id="step-3"]
Third step done
[/STEP_COMPLETE]
`;
      const result = parser.parse(input);

      // Should return all completed steps, not just the first
      expect(result.stepsCompleted).toHaveLength(3);
      expect(result.stepsCompleted[0].id).toBe('step-1');
      expect(result.stepsCompleted[1].id).toBe('step-2');
      expect(result.stepsCompleted[2].id).toBe('step-3');
    });

    it('should still return stepCompleted for backwards compatibility (last one)', () => {
      const input = `
[STEP_COMPLETE id="step-1"]
First step done
[/STEP_COMPLETE]

[STEP_COMPLETE id="step-2"]
Last step done
[/STEP_COMPLETE]
`;
      const result = parser.parse(input);

      // stepCompleted should be the last one for backwards compatibility
      expect(result.stepCompleted).toMatchObject({
        id: 'step-2',
        summary: 'Last step done',
      });
    });

    it('should detect plain text "**Step X Complete**" pattern', () => {
      const input = `
**Step 10 Complete**

I've completed the GPS Tracking Vue component tests. Here's a summary:

## What was done:
- Added 43 test cases
`;
      const result = parser.parse(input);

      expect(result.stepsCompleted).toHaveLength(1);
      expect(result.stepsCompleted[0].id).toBe('10');
      expect(result.stepsCompleted[0].summary).toContain('completed the GPS Tracking');
    });

    it('should detect plain text "## Step X Complete" pattern', () => {
      const input = `
## Step 5 Complete

Implementation finished successfully.
`;
      const result = parser.parse(input);

      expect(result.stepsCompleted).toHaveLength(1);
      expect(result.stepsCompleted[0].id).toBe('5');
    });

    it('should detect "Step X Done" pattern', () => {
      const input = `
Step 3 Done

All tests passing.
`;
      const result = parser.parse(input);

      expect(result.stepsCompleted).toHaveLength(1);
      expect(result.stepsCompleted[0].id).toBe('3');
    });

    it('should not duplicate if both formal marker and plain text exist', () => {
      const input = `
**Step 5 Complete**

[STEP_COMPLETE id="5"]
Summary here
[/STEP_COMPLETE]
`;
      const result = parser.parse(input);

      // Should only have one entry, not duplicated
      expect(result.stepsCompleted).toHaveLength(1);
      expect(result.stepsCompleted[0].id).toBe('5');
      // Formal marker should take precedence (has summary)
      expect(result.stepsCompleted[0].summary).toBe('Summary here');
    });

    it('should detect step-X format IDs in plain text', () => {
      const input = `
**Step step-3 Complete**

Done with step 3.
`;
      const result = parser.parse(input);

      expect(result.stepsCompleted).toHaveLength(1);
      expect(result.stepsCompleted[0].id).toBe('step-3');
    });
  });

  describe('escaped quotes in attributes', () => {
    it('should handle escaped quotes in attribute values', () => {
      const input = `
[DECISION_NEEDED priority="1" category="blocker"]
Should we use the "legacy" API?
- Option A: Yes
- Option B: No
[/DECISION_NEEDED]
`;
      const result = parser.parse(input);

      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].questionText).toContain('"legacy"');
    });

    it('should handle plan step with quotes in title', () => {
      const input = `
[PLAN_STEP id="1" parent="null" status="pending"]
Implement "login" feature
Add the new login endpoint.
[/PLAN_STEP]
`;
      const result = parser.parse(input);

      expect(result.planSteps).toHaveLength(1);
      expect(result.planSteps[0].title).toContain('"login"');
    });
  });

  describe('parsePlanApproved', () => {
    it('should detect PLAN_APPROVED marker', () => {
      const input = `
Review complete. No issues found.
[PLAN_APPROVED]
The plan is ready for implementation.
`;
      const result = parser.parse(input);

      expect(result.planApproved).toBe(true);
    });

    it('should return false when PLAN_APPROVED not present', () => {
      const input = `Still reviewing the plan...`;
      const result = parser.parse(input);

      expect(result.planApproved).toBe(false);
    });
  });

  describe('number parsing robustness', () => {
    it('should default to 0 when progress is not a number', () => {
      const input = `
[IMPLEMENTATION_STATUS]
step_id: step-1
status: IN_PROGRESS
files_modified: invalid
tests_status: PASSING
work_type: IMPLEMENTATION
progress: not-a-number
message: Working
[/IMPLEMENTATION_STATUS]
`;
      const result = parser.parse(input);

      expect(result.implementationStatus).not.toBeNull();
      expect(result.implementationStatus!.filesModified).toBe(0);
      expect(result.implementationStatus!.progress).toBe(0);
      expect(Number.isNaN(result.implementationStatus!.filesModified)).toBe(false);
      expect(Number.isNaN(result.implementationStatus!.progress)).toBe(false);
    });

    it('should default to valid priority when missing', () => {
      const input = `
[DECISION_NEEDED category="technical"]
Question?
- Option A
[/DECISION_NEEDED]
`;
      const result = parser.parse(input);

      expect(result.decisions).toHaveLength(1);
      expect(Number.isNaN(result.decisions[0].priority)).toBe(false);
      expect(result.decisions[0].priority).toBe(3); // default
    });

    it('should handle line attribute that is not a number', () => {
      const input = `
[DECISION_NEEDED priority="1" category="major" file="test.ts" line="abc"]
Issue in file
- Option A
[/DECISION_NEEDED]
`;
      const result = parser.parse(input);

      // line should be undefined or 0, not NaN
      expect(Number.isNaN(result.decisions[0].line)).toBe(false);
    });
  });

  // =========================================================================
  // Composable Plan Parsing Tests
  // =========================================================================

  describe('parsePlanSteps with complexity', () => {
    it('should parse complexity attribute from PLAN_STEP', () => {
      const input = `
[PLAN_STEP id="step-1" parent="null" status="pending" complexity="low"]
Create feature branch
Simple git checkout operation.
[/PLAN_STEP]

[PLAN_STEP id="step-2" parent="step-1" status="pending" complexity="high"]
Implement core logic
Complex implementation requiring significant work.
[/PLAN_STEP]
`;
      const result = parser.parsePlanSteps(input);

      expect(result).toHaveLength(2);
      expect(result[0].complexity).toBe('low');
      expect(result[1].complexity).toBe('high');
    });

    it('should handle missing complexity attribute', () => {
      const input = `
[PLAN_STEP id="step-1" parent="null" status="pending"]
Step without complexity
Description here.
[/PLAN_STEP]
`;
      const result = parser.parsePlanSteps(input);

      expect(result).toHaveLength(1);
      expect(result[0].complexity).toBeUndefined();
    });

    it('should parse acceptanceCriteria attribute', () => {
      const input = `
[PLAN_STEP id="step-1" parent="null" status="pending" acceptanceCriteria="ac-1, ac-2, ac-3"]
Step with acceptance criteria
Description here.
[/PLAN_STEP]
`;
      const result = parser.parsePlanSteps(input);

      expect(result).toHaveLength(1);
      expect(result[0].acceptanceCriteriaIds).toEqual(['ac-1', 'ac-2', 'ac-3']);
    });

    it('should parse estimatedFiles attribute', () => {
      const input = `
[PLAN_STEP id="step-1" parent="null" status="pending" estimatedFiles="src/auth.ts, src/utils.ts"]
Step with estimated files
Description here.
[/PLAN_STEP]
`;
      const result = parser.parsePlanSteps(input);

      expect(result).toHaveLength(1);
      expect(result[0].estimatedFiles).toEqual(['src/auth.ts', 'src/utils.ts']);
    });
  });

  describe('parsePlanMeta', () => {
    it('should parse PLAN_META marker', () => {
      const input = `
[PLAN_META]
version: 1.0.0
sessionId: session-123
createdAt: 2024-01-15T10:00:00Z
updatedAt: 2024-01-15T11:00:00Z
isApproved: false
reviewCount: 2
[/PLAN_META]
`;
      const result = parser.parsePlanMeta(input);

      expect(result).not.toBeNull();
      expect(result!.version).toBe('1.0.0');
      expect(result!.sessionId).toBe('session-123');
      expect(result!.isApproved).toBe(false);
      expect(result!.reviewCount).toBe(2);
    });

    it('should handle snake_case keys', () => {
      const input = `
[PLAN_META]
version: 2.0.0
session_id: session-456
created_at: 2024-01-15T10:00:00Z
updated_at: 2024-01-15T11:00:00Z
is_approved: true
review_count: 5
[/PLAN_META]
`;
      const result = parser.parsePlanMeta(input);

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe('session-456');
      expect(result!.isApproved).toBe(true);
      expect(result!.reviewCount).toBe(5);
    });

    it('should return null when no PLAN_META marker', () => {
      const result = parser.parsePlanMeta('No plan meta here');
      expect(result).toBeNull();
    });
  });

  describe('parsePlanDependencies', () => {
    it('should parse step dependencies with arrow format', () => {
      const input = `
[PLAN_DEPENDENCIES]
step-2 -> step-1
step-3 -> step-2
step-4 -> step-1: Must complete setup first
[/PLAN_DEPENDENCIES]
`;
      const result = parser.parsePlanDependencies(input);

      expect(result).not.toBeNull();
      expect(result!.stepDependencies).toHaveLength(3);
      expect(result!.stepDependencies[0]).toEqual({
        stepId: 'step-2',
        dependsOn: 'step-1',
        reason: undefined,
      });
      expect(result!.stepDependencies[2].reason).toBe('Must complete setup first');
    });

    it('should parse "depends on" format', () => {
      const input = `
[PLAN_DEPENDENCIES]
step-2 depends on step-1
step-3 depends on step-2
[/PLAN_DEPENDENCIES]
`;
      const result = parser.parsePlanDependencies(input);

      expect(result).not.toBeNull();
      expect(result!.stepDependencies).toHaveLength(2);
    });

    it('should parse external dependencies', () => {
      const input = `
[PLAN_DEPENDENCIES]
External dependencies:
- zod (npm) @ ^3.22.0: Schema validation [required by: step-3, step-4]
- express (npm): Web framework [required by: step-2]
[/PLAN_DEPENDENCIES]
`;
      const result = parser.parsePlanDependencies(input);

      expect(result).not.toBeNull();
      expect(result!.externalDependencies).toHaveLength(2);
      expect(result!.externalDependencies[0]).toMatchObject({
        name: 'zod',
        type: 'npm',
        version: '^3.22.0',
        reason: 'Schema validation',
        requiredBy: ['step-3', 'step-4'],
      });
    });

    it('should return null when no PLAN_DEPENDENCIES marker', () => {
      const result = parser.parsePlanDependencies('No dependencies here');
      expect(result).toBeNull();
    });
  });

  describe('parsePlanTestCoverage', () => {
    it('should parse test coverage configuration', () => {
      const input = `
[PLAN_TEST_COVERAGE]
framework: vitest
requiredTestTypes: unit, integration
globalCoverageTarget: 80
- step-3: unit, integration
- step-5: unit
[/PLAN_TEST_COVERAGE]
`;
      const result = parser.parsePlanTestCoverage(input);

      expect(result).not.toBeNull();
      expect(result!.framework).toBe('vitest');
      expect(result!.requiredTestTypes).toEqual(['unit', 'integration']);
      expect(result!.globalCoverageTarget).toBe(80);
      expect(result!.stepCoverage).toHaveLength(2);
      expect(result!.stepCoverage[0]).toMatchObject({
        stepId: 'step-3',
        requiredTestTypes: ['unit', 'integration'],
      });
    });

    it('should handle snake_case keys', () => {
      const input = `
[PLAN_TEST_COVERAGE]
framework: jest
required_test_types: unit, e2e
coverage_target: 90
[/PLAN_TEST_COVERAGE]
`;
      const result = parser.parsePlanTestCoverage(input);

      expect(result).not.toBeNull();
      expect(result!.framework).toBe('jest');
      expect(result!.requiredTestTypes).toEqual(['unit', 'e2e']);
      expect(result!.globalCoverageTarget).toBe(90);
    });

    it('should return null when no PLAN_TEST_COVERAGE marker', () => {
      const result = parser.parsePlanTestCoverage('No test coverage here');
      expect(result).toBeNull();
    });
  });

  describe('parsePlanAcceptanceMapping', () => {
    it('should parse acceptance criteria mappings', () => {
      const input = `
[PLAN_ACCEPTANCE_MAPPING]
AC-1: 'Feature works correctly' -> step-3, step-4 [fully covered]
AC-2: 'Tests pass' -> step-5 [partial]
[/PLAN_ACCEPTANCE_MAPPING]
`;
      const result = parser.parsePlanAcceptanceMapping(input);

      expect(result).not.toBeNull();
      expect(result!.mappings).toHaveLength(2);
      expect(result!.mappings[0]).toMatchObject({
        criterionId: 'AC-1',
        criterionText: 'Feature works correctly',
        implementingStepIds: ['step-3', 'step-4'],
        isFullyCovered: true,
      });
      expect(result!.mappings[1].isFullyCovered).toBe(false);
    });

    it('should parse mappings without quotes', () => {
      const input = `
[PLAN_ACCEPTANCE_MAPPING]
ac-1: Feature works -> step-1, step-2
[/PLAN_ACCEPTANCE_MAPPING]
`;
      const result = parser.parsePlanAcceptanceMapping(input);

      expect(result).not.toBeNull();
      expect(result!.mappings).toHaveLength(1);
      expect(result!.mappings[0].criterionText).toBe('Feature works');
    });

    it('should return null when no PLAN_ACCEPTANCE_MAPPING marker', () => {
      const result = parser.parsePlanAcceptanceMapping('No mapping here');
      expect(result).toBeNull();
    });
  });

  describe('parseComposablePlan', () => {
    it('should parse a complete composable plan', () => {
      const input = `
[PLAN_META]
version: 1.0.0
sessionId: session-123
isApproved: false
reviewCount: 1
[/PLAN_META]

[PLAN_STEP id="step-1" parent="null" status="pending" complexity="low"]
Create feature branch
Create and checkout a new feature branch from main.
[/PLAN_STEP]

[PLAN_STEP id="step-2" parent="step-1" status="pending" complexity="medium"]
Implement core logic
Build the main functionality with proper error handling.
[/PLAN_STEP]

[PLAN_DEPENDENCIES]
step-2 -> step-1
[/PLAN_DEPENDENCIES]

[PLAN_TEST_COVERAGE]
framework: vitest
requiredTestTypes: unit
[/PLAN_TEST_COVERAGE]

[PLAN_ACCEPTANCE_MAPPING]
AC-1: 'Feature complete' -> step-2 [fully covered]
[/PLAN_ACCEPTANCE_MAPPING]
`;
      const result = parser.parseComposablePlan(input, 'session-123');

      expect(result).not.toBeNull();
      expect(result!.meta!.version).toBe('1.0.0');
      expect(result!.steps).toHaveLength(2);
      expect(result!.steps![0].complexity).toBe('low');
      expect(result!.steps![1].complexity).toBe('medium');
      expect(result!.dependencies!.stepDependencies).toHaveLength(1);
      expect(result!.testCoverage!.framework).toBe('vitest');
      expect(result!.acceptanceMapping!.mappings).toHaveLength(1);
    });

    it('should return null when no plan steps found', () => {
      const input = `
[PLAN_META]
version: 1.0.0
[/PLAN_META]

No plan steps here, just some text.
`;
      const result = parser.parseComposablePlan(input);
      expect(result).toBeNull();
    });

    it('should provide defaults for missing sections', () => {
      const input = `
[PLAN_STEP id="step-1" parent="null" status="pending"]
Just a step
With a description that spans multiple lines.
[/PLAN_STEP]
`;
      const result = parser.parseComposablePlan(input, 'session-456');

      expect(result).not.toBeNull();
      expect(result!.meta!.sessionId).toBe('session-456');
      expect(result!.dependencies!.stepDependencies).toEqual([]);
      expect(result!.testCoverage!.framework).toBe('unknown');
      expect(result!.acceptanceMapping!.mappings).toEqual([]);
    });

    it('should set correct validation status based on parsed sections', () => {
      const inputWithAllSections = `
[PLAN_META]
version: 1.0.0
[/PLAN_META]

[PLAN_STEP id="step-1" parent="null" status="pending"]
Step title
Step description here.
[/PLAN_STEP]

[PLAN_DEPENDENCIES]
[/PLAN_DEPENDENCIES]

[PLAN_TEST_COVERAGE]
framework: vitest
[/PLAN_TEST_COVERAGE]

[PLAN_ACCEPTANCE_MAPPING]
[/PLAN_ACCEPTANCE_MAPPING]
`;
      const result = parser.parseComposablePlan(inputWithAllSections);

      expect(result).not.toBeNull();
      expect(result!.validationStatus!.meta).toBe(true);
      expect(result!.validationStatus!.steps).toBe(true);
      expect(result!.validationStatus!.dependencies).toBe(true);
      expect(result!.validationStatus!.testCoverage).toBe(true);
      expect(result!.validationStatus!.acceptanceMapping).toBe(true);
    });
  });

  describe('hasComposablePlanMarkers', () => {
    it('should detect PLAN_META marker', () => {
      expect(parser.hasComposablePlanMarkers('[PLAN_META]')).toBe(true);
    });

    it('should detect PLAN_DEPENDENCIES marker', () => {
      expect(parser.hasComposablePlanMarkers('Some text [PLAN_DEPENDENCIES] more text')).toBe(true);
    });

    it('should detect PLAN_TEST_COVERAGE marker', () => {
      expect(parser.hasComposablePlanMarkers('[PLAN_TEST_COVERAGE]')).toBe(true);
    });

    it('should detect PLAN_ACCEPTANCE_MAPPING marker', () => {
      expect(parser.hasComposablePlanMarkers('[PLAN_ACCEPTANCE_MAPPING]')).toBe(true);
    });

    it('should return false for text without composable plan markers', () => {
      expect(parser.hasComposablePlanMarkers('Just regular text')).toBe(false);
      expect(parser.hasComposablePlanMarkers('[PLAN_STEP id="1"]')).toBe(false);
    });
  });

  describe('backward compatibility', () => {
    it('should still parse old format PLAN_STEP markers without new attributes', () => {
      const input = `
[PLAN_STEP id="1" parent="null" status="pending"]
Old format step
Description without complexity or other new attributes.
[/PLAN_STEP]
`;
      const result = parser.parse(input);

      expect(result.planSteps).toHaveLength(1);
      expect(result.planSteps[0].id).toBe('1');
      expect(result.planSteps[0].complexity).toBeUndefined();
      expect(result.planSteps[0].acceptanceCriteriaIds).toBeUndefined();
      expect(result.planSteps[0].estimatedFiles).toBeUndefined();
    });
  });
});

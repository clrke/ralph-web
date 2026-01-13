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
});

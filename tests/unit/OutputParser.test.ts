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
});

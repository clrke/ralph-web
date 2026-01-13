import { HaikuPostProcessor, PostProcessingType } from '../../server/src/services/HaikuPostProcessor';
import { OutputParser } from '../../server/src/services/OutputParser';
import { EventEmitter } from 'events';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('HaikuPostProcessor', () => {
  let postProcessor: HaikuPostProcessor;
  let outputParser: OutputParser;

  beforeEach(() => {
    jest.clearAllMocks();
    outputParser = new OutputParser();
    postProcessor = new HaikuPostProcessor(outputParser);
  });

  // Helper to create mock process
  function createMockProcess(stdout: string, exitCode: number = 0): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    // Simulate async output
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from(JSON.stringify({ result: stdout })));
      proc.emit('close', exitCode);
    });

    return proc;
  }

  describe('extractQuestions', () => {
    it('should extract questions from unformatted output', async () => {
      const output = `[DECISION_NEEDED priority="1" category="scope"]
How should we handle authentication?
- Option A: Use JWT tokens (recommended)
- Option B: Use session cookies
[/DECISION_NEEDED]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(output) as any);

      const result = await postProcessor.extractQuestions(
        'This is a test output with questions about authentication that is long enough',
        '/test/project'
      );

      expect(result).not.toBeNull();
      expect(result?.data).toHaveLength(1);
      expect(result?.data[0].priority).toBe(1);
      expect(result?.data[0].category).toBe('scope');
    });

    it('should return null for [NO_QUESTIONS] response', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('[NO_QUESTIONS]') as any);

      const result = await postProcessor.extractQuestions(
        'This is a test output with no questions that is long enough to process',
        '/test/project'
      );

      expect(result).toBeNull();
    });

    it('should return null for short output', async () => {
      const result = await postProcessor.extractQuestions('Hi', '/test/project');
      expect(result).toBeNull();
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('extractPlanSteps', () => {
    it('should extract plan steps from prose', async () => {
      const output = `[PLAN_STEP id="step-1" parent="null" status="pending"]
Create feature branch
Create and checkout feature branch from main
[/PLAN_STEP]

[PLAN_STEP id="step-2" parent="step-1" status="pending"]
Implement authentication
Add JWT token handling to the API
[/PLAN_STEP]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(output) as any);

      const result = await postProcessor.extractPlanSteps(
        'First, create a feature branch. Then implement authentication. This should be long enough.',
        '/test/project'
      );

      expect(result).not.toBeNull();
      expect(result?.data).toHaveLength(2);
      expect(result?.data[0].id).toBe('step-1');
      expect(result?.data[0].title).toBe('Create feature branch');
      expect(result?.data[1].parentId).toBe('step-1');
    });

    it('should return null for [NO_STEPS] response', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('[NO_STEPS]') as any);

      const result = await postProcessor.extractPlanSteps(
        'This output has no implementation steps but is long enough to process',
        '/test/project'
      );

      expect(result).toBeNull();
    });
  });

  describe('extractPRInfo', () => {
    it('should extract PR information from description', async () => {
      // OutputParser expects "Branch: source → target" format
      const output = `[PR_CREATED]
Title: Add user authentication
Branch: feature/auth → main
[/PR_CREATED]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(output) as any);

      const result = await postProcessor.extractPRInfo(
        'I created a PR titled "Add user authentication" from feature/auth to main which is long enough',
        '/test/project'
      );

      expect(result).not.toBeNull();
      expect(result?.data.title).toBe('Add user authentication');
      expect(result?.data.sourceBranch).toBe('feature/auth');
      expect(result?.data.targetBranch).toBe('main');
    });

    it('should return null for [NO_PR] response', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('[NO_PR]') as any);

      const result = await postProcessor.extractPRInfo(
        'No PR was created yet but this message needs to be long enough to process',
        '/test/project'
      );

      expect(result).toBeNull();
    });
  });

  describe('extractImplementationStatus', () => {
    it('should extract implementation status from prose', async () => {
      const output = `[IMPLEMENTATION_STATUS]
step_id: step-3
status: working
files_modified: 5
tests_status: passing
work_type: implementing
progress: 75
message: Almost done with the feature
[/IMPLEMENTATION_STATUS]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(output) as any);

      const result = await postProcessor.extractImplementationStatus(
        'I am working on step 3, modified 5 files, tests are passing, about 75% done with implementation',
        '/test/project'
      );

      expect(result).not.toBeNull();
      expect(result?.data.stepId).toBe('step-3');
      expect(result?.data.status).toBe('working');
      expect(result?.data.filesModified).toBe(5);
      expect(result?.data.testsStatus).toBe('passing');
    });

    it('should return null for [NO_STATUS] response', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('[NO_STATUS]') as any);

      const result = await postProcessor.extractImplementationStatus(
        'Just some general discussion that needs to be long enough to process by the system',
        '/test/project'
      );

      expect(result).toBeNull();
    });
  });

  describe('extractTestResults', () => {
    it('should extract test results from output', async () => {
      const output = `{
  "testsPassing": true,
  "testsRun": true,
  "testFiles": ["auth.test.ts", "user.test.ts"],
  "failingTests": [],
  "summary": "All 15 tests passing"
}`;

      mockSpawn.mockReturnValueOnce(createMockProcess(output) as any);

      const result = await postProcessor.extractTestResults(
        'Ran 15 tests, all passing. Test files: auth.test.ts, user.test.ts that is long enough',
        '/test/project'
      );

      expect(result).not.toBeNull();
      expect(result?.data.testsPassing).toBe(true);
      expect(result?.data.testsRun).toBe(true);
      expect(result?.data.testFiles).toEqual(['auth.test.ts', 'user.test.ts']);
    });

    it('should return null for [NO_TESTS] response', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('[NO_TESTS]') as any);

      const result = await postProcessor.extractTestResults(
        'No tests were run but this message needs to be long enough to process',
        '/test/project'
      );

      expect(result).toBeNull();
    });
  });

  describe('extractReviewFindings', () => {
    it('should extract review findings as decisions', async () => {
      const output = `[DECISION_NEEDED priority="1" category="security"]
SQL injection vulnerability found. Could allow unauthorized data access.

How should we address this?
- Option A: Use parameterized queries (recommended)
- Option B: Add input sanitization
- Option C: Accept risk
[/DECISION_NEEDED]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(output) as any);

      const result = await postProcessor.extractReviewFindings(
        'Found potential SQL injection in the login handler that needs to be addressed',
        '/test/project'
      );

      expect(result).not.toBeNull();
      expect(result?.data).toHaveLength(1);
      expect(result?.data[0].category).toBe('security');
      expect(result?.data[0].priority).toBe(1);
    });

    it('should return null for [NO_FINDINGS] response', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('[NO_FINDINGS]') as any);

      const result = await postProcessor.extractReviewFindings(
        'Code looks good, no issues found. This message needs to be long enough to process',
        '/test/project'
      );

      expect(result).toBeNull();
    });
  });

  describe('generateCommitMessage', () => {
    it('should generate commit message from implementation output', async () => {
      const output = `[COMMIT_MESSAGE]
feat(auth): add JWT token authentication

- Add token generation endpoint
- Implement token validation middleware
- Add refresh token support
[/COMMIT_MESSAGE]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(output) as any);

      const result = await postProcessor.generateCommitMessage(
        'Implemented JWT authentication with token generation and validation that is long enough',
        '/test/project'
      );

      expect(result).not.toBeNull();
      expect(result?.data).toContain('feat(auth)');
      expect(result?.data).toContain('JWT token authentication');
    });

    it('should return null for [NO_COMMIT] response', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('[NO_COMMIT]') as any);

      const result = await postProcessor.generateCommitMessage(
        'Just exploration, no changes made. This needs to be long enough to process',
        '/test/project'
      );

      expect(result).toBeNull();
    });
  });

  describe('generateSummary', () => {
    it('should generate summary from long output', async () => {
      const output = `[SUMMARY]
Implemented user authentication with JWT tokens and added comprehensive test coverage.
[/SUMMARY]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(output) as any);

      const result = await postProcessor.generateSummary(
        'This is a very long output about implementing authentication with many details that needs processing',
        '/test/project'
      );

      expect(result).not.toBeNull();
      expect(result?.data).toContain('authentication');
      expect(result?.data).toContain('JWT');
    });

    it('should fall back to raw output if no markers', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('Implemented authentication feature successfully') as any);

      const result = await postProcessor.generateSummary(
        'Long implementation output here that is long enough to process by the system',
        '/test/project'
      );

      expect(result).not.toBeNull();
      expect(result?.data).toContain('authentication');
    });
  });

  describe('smartExtract', () => {
    it('should extract questions for Stage 1 without decisions', async () => {
      const questionOutput = `[DECISION_NEEDED priority="1" category="scope"]
What database should we use?
- Option A: PostgreSQL (recommended)
- Option B: MongoDB
[/DECISION_NEEDED]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(questionOutput) as any);

      const result = await postProcessor.smartExtract(
        'We need to decide on database. Should we use PostgreSQL or MongoDB? This is long enough.',
        '/test/project',
        {
          stage: 1,
          hasDecisions: false,
          hasPlanSteps: true, // Already has plan steps, so won't extract them
          hasImplementationStatus: false,
          hasPRCreated: false,
        }
      );

      expect(result.questions).toBeDefined();
      expect(result.questions).toHaveLength(1);
      expect(result.postProcessResults).toHaveLength(1);
      expect(result.postProcessResults[0].type).toBe('question_extraction');
    });

    it('should extract plan steps for Stage 1 without plan steps', async () => {
      const stepsOutput = `[PLAN_STEP id="step-1" parent="null" status="pending"]
Setup project
Initialize project structure
[/PLAN_STEP]`;

      // First call for questions returns none
      mockSpawn.mockReturnValueOnce(createMockProcess('[NO_QUESTIONS]') as any);
      // Second call for plan steps returns steps
      mockSpawn.mockReturnValueOnce(createMockProcess(stepsOutput) as any);

      const result = await postProcessor.smartExtract(
        'First we need to setup the project, then implement features. This should be long enough to process.',
        '/test/project',
        {
          stage: 1,
          hasDecisions: false,
          hasPlanSteps: false,
          hasImplementationStatus: false,
          hasPRCreated: false,
        }
      );

      expect(result.planSteps).toBeDefined();
      expect(result.planSteps).toHaveLength(1);
    });

    it('should extract implementation status for Stage 3', async () => {
      const statusOutput = `[IMPLEMENTATION_STATUS]
step_id: step-2
status: complete
files_modified: 3
tests_status: passing
work_type: implementing
progress: 100
message: Step completed successfully
[/IMPLEMENTATION_STATUS]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(statusOutput) as any);

      const result = await postProcessor.smartExtract(
        'Finished implementing step 2, all tests passing. This is long enough to process.',
        '/test/project',
        {
          stage: 3,
          hasDecisions: false,
          hasPlanSteps: false,
          hasImplementationStatus: false,
          hasPRCreated: false,
        }
      );

      expect(result.implementationStatus).toBeDefined();
      expect(result.implementationStatus?.stepId).toBe('step-2');
    });

    it('should extract PR info for Stage 4', async () => {
      const prOutput = `[PR_CREATED]
Title: Feature: Add authentication
Branch: feature/auth → main
[/PR_CREATED]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(prOutput) as any);

      const result = await postProcessor.smartExtract(
        'Created PR for authentication feature. This message needs to be long enough.',
        '/test/project',
        {
          stage: 4,
          hasDecisions: false,
          hasPlanSteps: false,
          hasImplementationStatus: false,
          hasPRCreated: false,
        }
      );

      expect(result.prInfo).toBeDefined();
      expect(result.prInfo?.title).toBe('Feature: Add authentication');
    });

    it('should extract review findings for Stage 5', async () => {
      const findingsOutput = `[DECISION_NEEDED priority="2" category="code_quality"]
Missing error handling. Could crash on invalid input.

How should we address this?
- Option A: Add try-catch blocks (recommended)
- Option B: Add validation
[/DECISION_NEEDED]`;

      mockSpawn.mockReturnValueOnce(createMockProcess(findingsOutput) as any);

      const result = await postProcessor.smartExtract(
        'Found missing error handling in the controller. This needs to be addressed.',
        '/test/project',
        {
          stage: 5,
          hasDecisions: false,
          hasPlanSteps: false,
          hasImplementationStatus: false,
          hasPRCreated: false,
        }
      );

      expect(result.reviewFindings).toBeDefined();
      expect(result.reviewFindings).toHaveLength(1);
      expect(result.reviewFindings?.[0].category).toBe('code_quality');
    });

    it('should not extract when content already exists', async () => {
      const result = await postProcessor.smartExtract(
        'Some output that is long enough to process normally',
        '/test/project',
        {
          stage: 1,
          hasDecisions: true, // Already has decisions
          hasPlanSteps: true,
          hasImplementationStatus: false,
          hasPRCreated: false,
        }
      );

      // Should not call Haiku since content exists
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(result.postProcessResults).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should handle process exit with non-zero code', async () => {
      mockSpawn.mockReturnValueOnce(createMockProcess('error', 1) as any);

      const result = await postProcessor.extractQuestions(
        'Some test output that is long enough to process',
        '/test/project'
      );

      expect(result).toBeNull();
    });

    it('should handle process spawn error', async () => {
      const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();

      // Need to wait for HaikuPostProcessor to attach its error handler first
      // by delaying the error emission with a longer timeout
      mockSpawn.mockImplementationOnce(() => {
        setTimeout(() => {
          proc.emit('error', new Error('spawn failed'));
        }, 10);
        return proc as any;
      });

      const result = await postProcessor.extractQuestions(
        'Some test output that is long enough to process',
        '/test/project'
      );

      expect(result).toBeNull();
    });

    it('should handle invalid JSON response', async () => {
      const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();

      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('not valid json'));
        proc.emit('close', 0);
      });

      mockSpawn.mockReturnValueOnce(proc as any);

      const result = await postProcessor.extractQuestions(
        'Some test output that is long enough to process',
        '/test/project'
      );

      expect(result).toBeNull();
    });
  });
});

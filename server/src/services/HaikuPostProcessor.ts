import { spawn } from 'child_process';
import { OutputParser, ParsedMarker, ParsedPlanStep, ParsedDecision, ParsedImplementationStatus, ParsedPRCreated } from './OutputParser';

const HAIKU_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const MIN_OUTPUT_LENGTH = 50; // Minimum output length to process

export type PostProcessingType =
  | 'decision_validation'
  | 'test_assessment'
  | 'incomplete_steps'
  | 'question_extraction'
  | 'plan_step_extraction'
  | 'pr_info_extraction'
  | 'implementation_status_extraction'
  | 'test_results_extraction'
  | 'review_findings_extraction'
  | 'commit_message_generation'
  | 'summary_generation';

export interface PostProcessResult<T> {
  data: T;
  prompt: string;
  output: string;
  durationMs: number;
}

// ============================================================================
// PROMPTS
// ============================================================================

const QUESTION_EXTRACTION_PROMPT = `You are a formatting assistant. Extract any questions or decisions from the following text and format them using the [DECISION_NEEDED] marker format.

Rules:
1. Only extract actual questions that require user input/decision
2. Each question must have at least 2 options
3. Mark one option as (recommended) if the text suggests a preference
4. Use priority 1 for fundamental/scope questions, 2 for technical details, 3 for minor preferences
5. Use appropriate category: scope, approach, technical, design, code_quality, architecture, security, performance

Output format for EACH question found:
[DECISION_NEEDED priority="1" category="scope"]
The question text here?
- Option A: Description (recommended)
- Option B: Description
[/DECISION_NEEDED]

If no questions are found that need user decisions, output exactly: [NO_QUESTIONS]

Text to analyze:
`;

const PLAN_STEP_EXTRACTION_PROMPT = `You are a formatting assistant. Extract implementation plan steps from the following text and format them using the [PLAN_STEP] marker format.

Rules:
1. Extract concrete, actionable implementation steps
2. Assign sequential IDs (step-1, step-2, etc.)
3. Set parentId to the previous step's ID for sequential dependencies, or null for independent steps
4. Include descriptive titles and detailed descriptions
5. All steps start with status="pending"

Output format for EACH step found:
[PLAN_STEP id="step-1" parent="null" status="pending"]
Step title here
Detailed description of what needs to be done, including specific files, functions, or components to modify.
[/PLAN_STEP]

If no plan steps are found, output exactly: [NO_STEPS]

Text to analyze:
`;

const PR_INFO_EXTRACTION_PROMPT = `You are a formatting assistant. Extract pull request information from the following text and format it using the [PR_CREATED] marker format.

Rules:
1. Extract PR title, source branch, and target branch
2. If any field is unclear, make a reasonable inference from context
3. Source branch is typically a feature branch
4. Target branch is typically main, master, or develop

Output format:
[PR_CREATED]
Title: The PR title
Source: source-branch-name
Target: target-branch-name
[/PR_CREATED]

If no PR information is found, output exactly: [NO_PR]

Text to analyze:
`;

const IMPLEMENTATION_STATUS_PROMPT = `You are a formatting assistant. Extract implementation progress status from the following text and format it using the [IMPLEMENTATION_STATUS] marker format.

Rules:
1. Extract current step ID if mentioned
2. Determine status: working, debugging, testing, blocked, complete
3. Count files modified if mentioned
4. Determine test status: passing, failing, pending, not_run
5. Determine work type: implementing, refactoring, testing, fixing
6. Estimate progress 0-100 based on context
7. Extract any progress message

Output format:
[IMPLEMENTATION_STATUS]
step_id: step-X
status: working|debugging|testing|blocked|complete
files_modified: N
tests_status: passing|failing|pending|not_run
work_type: implementing|refactoring|testing|fixing
progress: 0-100
message: Brief status message
[/IMPLEMENTATION_STATUS]

If no implementation status is found, output exactly: [NO_STATUS]

Text to analyze:
`;

const TEST_RESULTS_PROMPT = `You are a formatting assistant. Analyze the following text and determine the test results status.

Rules:
1. Look for any indication of test results
2. Determine if tests are passing, failing, or not run
3. Extract test file names if mentioned
4. Determine overall test health

Output format (JSON):
{
  "testsPassing": true|false,
  "testsRun": true|false,
  "testFiles": ["file1.test.ts", "file2.test.ts"],
  "failingTests": ["test name 1", "test name 2"],
  "summary": "Brief summary of test status"
}

If no test information is found, output exactly: [NO_TESTS]

Text to analyze:
`;

const REVIEW_FINDINGS_PROMPT = `You are a formatting assistant. Extract code review findings from the following text and format them as decision questions.

Rules:
1. Extract issues, concerns, or suggestions found during code review
2. Convert each finding into a [DECISION_NEEDED] question
3. Priority 1 for security/critical issues, 2 for code quality, 3 for style/minor
4. Category should be: security, performance, code_quality, architecture, or technical
5. Provide actionable options for each issue

Output format for EACH finding:
[DECISION_NEEDED priority="1|2|3" category="security|performance|code_quality|architecture|technical"]
**Issue:** Description of the problem found
**Impact:** What could go wrong if not addressed

How should we address this?
- Option A: Recommended fix (recommended)
- Option B: Alternative approach
- Option C: Accept risk and proceed
[/DECISION_NEEDED]

If no review findings need decisions, output exactly: [NO_FINDINGS]

Text to analyze:
`;

const COMMIT_MESSAGE_PROMPT = `You are a formatting assistant. Generate a conventional commit message from the following implementation output.

Rules:
1. Use conventional commit format: type(scope): description
2. Types: feat, fix, refactor, test, docs, style, chore
3. Scope should be the main area of change
4. Description should be concise (50 chars max for first line)
5. Include body with bullet points of key changes
6. Do not include Claude attribution

Output format:
[COMMIT_MESSAGE]
type(scope): brief description

- Key change 1
- Key change 2
- Key change 3
[/COMMIT_MESSAGE]

If cannot determine commit message, output exactly: [NO_COMMIT]

Text to analyze:
`;

const SUMMARY_PROMPT = `You are a formatting assistant. Generate a brief 1-2 sentence summary of the following Claude output for logging purposes.

Rules:
1. Capture the main action or outcome
2. Be concise (max 200 characters)
3. Use present tense
4. Focus on what was done, not how

Output format:
[SUMMARY]
Your 1-2 sentence summary here.
[/SUMMARY]

Text to summarize:
`;

// ============================================================================
// HAIKU POST-PROCESSOR SERVICE
// ============================================================================

export class HaikuPostProcessor {
  constructor(private readonly outputParser: OutputParser) {}

  /**
   * Run Haiku with a prompt and return raw output
   */
  private async runHaiku(prompt: string, cwd: string): Promise<{ output: string; durationMs: number } | null> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const childProcess = spawn('claude', [
        '--print',
        '--output-format', 'json',
        '--model', 'haiku',
        '-p', prompt,
      ], {
        cwd,
        env: { ...globalThis.process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      const timeoutId = setTimeout(() => {
        childProcess.kill();
        console.log('Haiku post-processing timed out');
        resolve(null);
      }, HAIKU_TIMEOUT_MS);

      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        if (code !== 0) {
          console.log('Haiku post-processing failed with code:', code);
          resolve(null);
          return;
        }

        try {
          const jsonOutput = JSON.parse(stdout);
          resolve({ output: jsonOutput.result || '', durationMs });
        } catch (error) {
          console.log('Failed to parse Haiku JSON output:', error);
          resolve(null);
        }
      });

      childProcess.on('error', () => {
        clearTimeout(timeoutId);
        resolve(null);
      });
    });
  }

  /**
   * Extract questions/decisions from unformatted output
   */
  async extractQuestions(output: string, cwd: string): Promise<PostProcessResult<ParsedDecision[]> | null> {
    if (output.length < MIN_OUTPUT_LENGTH) return null;

    const prompt = QUESTION_EXTRACTION_PROMPT + output;
    const result = await this.runHaiku(prompt, cwd);

    if (!result || result.output.includes('[NO_QUESTIONS]')) {
      return null;
    }

    const parsed = this.outputParser.parse(result.output);
    if (parsed.decisions.length === 0) {
      return null;
    }

    console.log(`Haiku extracted ${parsed.decisions.length} questions`);
    return {
      data: parsed.decisions,
      prompt,
      output: result.output,
      durationMs: result.durationMs,
    };
  }

  /**
   * Extract plan steps from prose descriptions
   */
  async extractPlanSteps(output: string, cwd: string): Promise<PostProcessResult<ParsedPlanStep[]> | null> {
    if (output.length < MIN_OUTPUT_LENGTH) return null;

    const prompt = PLAN_STEP_EXTRACTION_PROMPT + output;
    const result = await this.runHaiku(prompt, cwd);

    if (!result || result.output.includes('[NO_STEPS]')) {
      return null;
    }

    const parsed = this.outputParser.parse(result.output);
    if (parsed.planSteps.length === 0) {
      return null;
    }

    console.log(`Haiku extracted ${parsed.planSteps.length} plan steps`);
    return {
      data: parsed.planSteps,
      prompt,
      output: result.output,
      durationMs: result.durationMs,
    };
  }

  /**
   * Extract PR information from descriptions
   */
  async extractPRInfo(output: string, cwd: string): Promise<PostProcessResult<ParsedPRCreated> | null> {
    if (output.length < MIN_OUTPUT_LENGTH) return null;

    const prompt = PR_INFO_EXTRACTION_PROMPT + output;
    const result = await this.runHaiku(prompt, cwd);

    if (!result || result.output.includes('[NO_PR]')) {
      return null;
    }

    const parsed = this.outputParser.parse(result.output);
    if (!parsed.prCreated) {
      return null;
    }

    console.log(`Haiku extracted PR info: ${parsed.prCreated.title}`);
    return {
      data: parsed.prCreated,
      prompt,
      output: result.output,
      durationMs: result.durationMs,
    };
  }

  /**
   * Extract implementation status from prose
   */
  async extractImplementationStatus(output: string, cwd: string): Promise<PostProcessResult<ParsedImplementationStatus> | null> {
    if (output.length < MIN_OUTPUT_LENGTH) return null;

    const prompt = IMPLEMENTATION_STATUS_PROMPT + output;
    const result = await this.runHaiku(prompt, cwd);

    if (!result || result.output.includes('[NO_STATUS]')) {
      return null;
    }

    const parsed = this.outputParser.parse(result.output);
    if (!parsed.implementationStatus) {
      return null;
    }

    console.log(`Haiku extracted implementation status: ${parsed.implementationStatus.status}`);
    return {
      data: parsed.implementationStatus,
      prompt,
      output: result.output,
      durationMs: result.durationMs,
    };
  }

  /**
   * Extract and normalize test results
   */
  async extractTestResults(output: string, cwd: string): Promise<PostProcessResult<{
    testsPassing: boolean;
    testsRun: boolean;
    testFiles: string[];
    failingTests: string[];
    summary: string;
  }> | null> {
    if (output.length < MIN_OUTPUT_LENGTH) return null;

    const prompt = TEST_RESULTS_PROMPT + output;
    const result = await this.runHaiku(prompt, cwd);

    if (!result || result.output.includes('[NO_TESTS]')) {
      return null;
    }

    try {
      // Try to parse JSON from the output
      const jsonMatch = result.output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const testResults = JSON.parse(jsonMatch[0]);
      console.log(`Haiku extracted test results: ${testResults.testsPassing ? 'passing' : 'failing'}`);

      return {
        data: testResults,
        prompt,
        output: result.output,
        durationMs: result.durationMs,
      };
    } catch (error) {
      console.log('Failed to parse test results JSON:', error);
      return null;
    }
  }

  /**
   * Extract code review findings as decisions
   */
  async extractReviewFindings(output: string, cwd: string): Promise<PostProcessResult<ParsedDecision[]> | null> {
    if (output.length < MIN_OUTPUT_LENGTH) return null;

    const prompt = REVIEW_FINDINGS_PROMPT + output;
    const result = await this.runHaiku(prompt, cwd);

    if (!result || result.output.includes('[NO_FINDINGS]')) {
      return null;
    }

    const parsed = this.outputParser.parse(result.output);
    if (parsed.decisions.length === 0) {
      return null;
    }

    console.log(`Haiku extracted ${parsed.decisions.length} review findings`);
    return {
      data: parsed.decisions,
      prompt,
      output: result.output,
      durationMs: result.durationMs,
    };
  }

  /**
   * Generate a commit message from implementation output
   */
  async generateCommitMessage(output: string, cwd: string): Promise<PostProcessResult<string> | null> {
    if (output.length < MIN_OUTPUT_LENGTH) return null;

    const prompt = COMMIT_MESSAGE_PROMPT + output;
    const result = await this.runHaiku(prompt, cwd);

    if (!result || result.output.includes('[NO_COMMIT]')) {
      return null;
    }

    // Extract commit message from markers
    const match = result.output.match(/\[COMMIT_MESSAGE\]([\s\S]*?)\[\/COMMIT_MESSAGE\]/);
    if (!match) {
      return null;
    }

    const commitMessage = match[1].trim();
    console.log(`Haiku generated commit message: ${commitMessage.split('\n')[0]}`);

    return {
      data: commitMessage,
      prompt,
      output: result.output,
      durationMs: result.durationMs,
    };
  }

  /**
   * Generate a brief summary of Claude output
   */
  async generateSummary(output: string, cwd: string): Promise<PostProcessResult<string> | null> {
    if (output.length < MIN_OUTPUT_LENGTH) return null;

    const prompt = SUMMARY_PROMPT + output;
    const result = await this.runHaiku(prompt, cwd);

    if (!result) {
      return null;
    }

    // Extract summary from markers
    const match = result.output.match(/\[SUMMARY\]([\s\S]*?)\[\/SUMMARY\]/);
    if (!match) {
      // Try to use the raw output if no markers
      const summary = result.output.trim().substring(0, 200);
      if (summary.length > 10) {
        return {
          data: summary,
          prompt,
          output: result.output,
          durationMs: result.durationMs,
        };
      }
      return null;
    }

    const summary = match[1].trim();
    console.log(`Haiku generated summary: ${summary.substring(0, 50)}...`);

    return {
      data: summary,
      prompt,
      output: result.output,
      durationMs: result.durationMs,
    };
  }

  /**
   * Smart extraction: tries multiple extractors based on context
   * Returns all successfully extracted data
   */
  async smartExtract(
    output: string,
    cwd: string,
    context: {
      stage: number;
      hasDecisions: boolean;
      hasPlanSteps: boolean;
      hasImplementationStatus: boolean;
      hasPRCreated: boolean;
    }
  ): Promise<{
    questions?: ParsedDecision[];
    planSteps?: ParsedPlanStep[];
    prInfo?: ParsedPRCreated;
    implementationStatus?: ParsedImplementationStatus;
    reviewFindings?: ParsedDecision[];
    postProcessResults: Array<{ type: PostProcessingType; prompt: string; output: string; durationMs: number }>;
  }> {
    const results: {
      questions?: ParsedDecision[];
      planSteps?: ParsedPlanStep[];
      prInfo?: ParsedPRCreated;
      implementationStatus?: ParsedImplementationStatus;
      reviewFindings?: ParsedDecision[];
      postProcessResults: Array<{ type: PostProcessingType; prompt: string; output: string; durationMs: number }>;
    } = {
      postProcessResults: [],
    };

    // Stage 1 & 2: Look for questions and plan steps
    if ((context.stage === 1 || context.stage === 2) && !context.hasDecisions) {
      const questionsResult = await this.extractQuestions(output, cwd);
      if (questionsResult) {
        results.questions = questionsResult.data;
        results.postProcessResults.push({
          type: 'question_extraction',
          prompt: questionsResult.prompt,
          output: questionsResult.output,
          durationMs: questionsResult.durationMs,
        });
      }
    }

    // Stage 1: Look for plan steps
    if (context.stage === 1 && !context.hasPlanSteps) {
      const stepsResult = await this.extractPlanSteps(output, cwd);
      if (stepsResult) {
        results.planSteps = stepsResult.data;
        results.postProcessResults.push({
          type: 'plan_step_extraction',
          prompt: stepsResult.prompt,
          output: stepsResult.output,
          durationMs: stepsResult.durationMs,
        });
      }
    }

    // Stage 3: Look for implementation status
    if (context.stage === 3 && !context.hasImplementationStatus) {
      const statusResult = await this.extractImplementationStatus(output, cwd);
      if (statusResult) {
        results.implementationStatus = statusResult.data;
        results.postProcessResults.push({
          type: 'implementation_status_extraction',
          prompt: statusResult.prompt,
          output: statusResult.output,
          durationMs: statusResult.durationMs,
        });
      }
    }

    // Stage 4: Look for PR info
    if (context.stage === 4 && !context.hasPRCreated) {
      const prResult = await this.extractPRInfo(output, cwd);
      if (prResult) {
        results.prInfo = prResult.data;
        results.postProcessResults.push({
          type: 'pr_info_extraction',
          prompt: prResult.prompt,
          output: prResult.output,
          durationMs: prResult.durationMs,
        });
      }
    }

    // Stage 5: Look for review findings
    if (context.stage === 5 && !context.hasDecisions) {
      const findingsResult = await this.extractReviewFindings(output, cwd);
      if (findingsResult) {
        results.reviewFindings = findingsResult.data;
        results.postProcessResults.push({
          type: 'review_findings_extraction',
          prompt: findingsResult.prompt,
          output: findingsResult.output,
          durationMs: findingsResult.durationMs,
        });
      }
    }

    return results;
  }
}

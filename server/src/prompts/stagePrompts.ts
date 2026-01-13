import { Session, Plan, PlanStep, Question } from '@claude-code-web/shared';
import { escapeMarkers } from '../utils/sanitizeInput';

/**
 * Sanitize user-provided session fields to prevent prompt injection.
 * Returns a copy of the session with escaped markers in user input fields.
 */
function sanitizeSessionFields(session: Session): {
  title: string;
  featureDescription: string;
  technicalNotes: string;
  acceptanceCriteria: Array<{ text: string }>;
  affectedFiles: string[];
} {
  return {
    title: escapeMarkers(session.title),
    featureDescription: escapeMarkers(session.featureDescription),
    technicalNotes: escapeMarkers(session.technicalNotes || ''),
    acceptanceCriteria: session.acceptanceCriteria.map(c => ({
      text: escapeMarkers(c.text),
    })),
    affectedFiles: session.affectedFiles.map(f => escapeMarkers(f)),
  };
}

/**
 * Build Stage 1: Feature Discovery prompt
 * Uses Claude Code's native plan mode for structured exploration and planning.
 * Per README lines 1546-1611
 */
export function buildStage1Prompt(session: Session): string {
  // Sanitize user-provided fields to prevent marker injection
  const sanitized = sanitizeSessionFields(session);

  const acceptanceCriteriaText = sanitized.acceptanceCriteria.length > 0
    ? sanitized.acceptanceCriteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n')
    : 'No specific criteria provided.';

  const affectedFilesSection = sanitized.affectedFiles.length > 0
    ? `
## Affected Files (User Hints)
These files are likely to need changes:
${sanitized.affectedFiles.join('\n')}`
    : '';

  const technicalNotesSection = sanitized.technicalNotes
    ? `
## Technical Notes
${sanitized.technicalNotes}`
    : '';

  return `You are helping implement a new feature. You MUST thoroughly explore the codebase BEFORE asking any questions.

## Feature
Title: ${sanitized.title}
Description: ${sanitized.featureDescription}
Project Path: ${session.projectPath}

## Acceptance Criteria
${acceptanceCriteriaText}
${affectedFilesSection}
${technicalNotesSection}

## Instructions

### Phase 1: Codebase Exploration (MANDATORY - Do this FIRST)
You MUST explore the codebase before asking any questions. Use the Task tool to spawn parallel exploration agents:

1. **Architecture Agent**: Find project structure, entry points, main modules
   - Look for: package.json, tsconfig.json, main entry files
   - Understand: Build system, dependencies, module organization

2. **Existing Patterns Agent**: Find similar features already implemented
   - Search for: Related functionality, coding patterns, conventions
   - Note: How similar problems were solved, reusable utilities

3. **Integration Points Agent**: Find where the new feature connects
   - Identify: API routes, database schemas, UI components to modify
   - Map: Dependencies and data flow

Wait for ALL exploration agents to complete before proceeding.

### Phase 2: Ask Informed Questions
Only AFTER exploration, ask questions that couldn't be answered by reading the code:

[DECISION_NEEDED priority="1|2|3" category="scope|approach|technical|design"]
Question here? (Reference what you found: "I see X pattern in the codebase, should we follow it or...")
- Option A: Description (recommended)
- Option B: Description
- Option C: Description
[/DECISION_NEEDED]

Priority 1 = fundamental (scope, approach), Priority 2 = technical details, Priority 3 = refinements

IMPORTANT: Do NOT ask questions that can be answered by exploring the codebase:
- ❌ "What database are you using?" → Read the code to find out
- ❌ "How is auth currently handled?" → Explore and find out
- ✅ "I see you use JWT auth - should the new feature use the same pattern or try OAuth?"
- ✅ "The codebase has no rate limiting - which approach should we use?"

### Phase 3: Generate Plan
After questions are answered, generate implementation plan.

**IMPORTANT: The first step MUST be creating and checking out the feature branch:**
[PLAN_STEP id="step-1" parent="null" status="pending"]
Create feature branch
Create and checkout feature branch: git checkout -b ${session.featureBranch} from ${session.baseBranch}
[/PLAN_STEP]

Then add implementation steps:
[PLAN_STEP id="step-2" parent="step-1" status="pending"]
Step title here
Description referencing specific files/modules found during exploration.
[/PLAN_STEP]

### Phase 4: Complete
1. Use the Edit tool to write the complete plan to: ${session.claudePlanFilePath}
   - This file already exists and you have permission to edit it
   - Include all plan steps, technical details, and implementation notes
2. Output: [PLAN_FILE path="${session.claudePlanFilePath}"]
3. Exit plan mode and output: [PLAN_MODE_EXITED]`;
}

/**
 * Build Stage 2: Plan Review prompt
 * Reviews implementation plan and finds issues to present as decisions.
 * Per README lines 1613-1657
 */
export function buildStage2Prompt(session: Session, plan: Plan, currentIteration: number): string {
  const planStepsText = plan.steps.length > 0
    ? plan.steps.map((step, i) => {
        const parentInfo = step.parentId ? ` (depends on: ${step.parentId})` : '';
        return `${i + 1}. [${step.id}] ${step.title}${parentInfo}\n   ${step.description || 'No description'}`;
      }).join('\n\n')
    : 'No plan steps defined.';

  const targetIterations = 10; // README recommendation

  // Reference plan file for full context (handles context compaction)
  const planFileReference = session.claudePlanFilePath
    ? `\n\n## Full Plan Reference\nFor complete plan details, read: ${session.claudePlanFilePath}`
    : '';

  return `You are reviewing an implementation plan. Find issues and present them as decisions for the user.

## Current Plan (v${plan.planVersion})
${planStepsText}${planFileReference}

## Review Iteration
This is review ${currentIteration} of ${targetIterations} recommended.

## Instructions
1. Use the Task tool to spawn domain-specific subagents for parallel review:
   - Frontend Agent: Review UI-related steps
   - Backend Agent: Review API-related steps
   - Database Agent: Review data-related steps
   - Test Agent: Review test coverage

2. Check for issues in these categories:
   - Code Quality: Missing error handling, hardcoded values, missing tests
   - Architecture: Tight coupling, unclear separation of concerns
   - Security: Injection risks, exposed secrets, missing auth checks
   - Performance: N+1 queries, missing indexes, large bundle size

3. Present issues as progressive decisions for the user:
   - Priority 1: Fundamental issues (architecture, security) - ask first
   - Priority 2: Important issues (code quality, performance) - ask after P1 resolved
   - Priority 3: Refinements (style, optimization) - ask last

4. Format each issue as a decision with fix options:
[DECISION_NEEDED priority="1|2|3" category="code_quality|architecture|security|performance"]
Issue: Description of the problem found.
Impact: What could go wrong if not addressed.

How should we address this?
- Option A: Recommended fix approach (recommended)
- Option B: Alternative fix approach
- Option C: Accept risk and proceed without fix
[/DECISION_NEEDED]

5. After user answers priority 1 questions, present priority 2 questions, and so on.

6. If no issues found or all decisions resolved:
[PLAN_APPROVED]`;
}

/**
 * Build Stage 2: Plan Revision prompt
 * Revises plan based on user feedback.
 */
export function buildPlanRevisionPrompt(session: Session, plan: Plan, feedback: string): string {
  // Sanitize user-provided fields to prevent marker injection
  const sanitized = sanitizeSessionFields(session);
  const sanitizedFeedback = escapeMarkers(feedback);

  const planStepsText = plan.steps.length > 0
    ? plan.steps.map((step, i) => {
        const parentInfo = step.parentId ? ` (depends on: ${step.parentId})` : '';
        return `${i + 1}. [${step.id}] ${step.title}${parentInfo}\n   ${step.description || 'No description'}`;
      }).join('\n\n')
    : 'No plan steps defined.';

  // Reference plan file for full context (handles context compaction)
  const planFileReference = session.claudePlanFilePath
    ? `\n\n## Full Plan Reference\nFor complete plan details, read: ${session.claudePlanFilePath}`
    : '';

  return `You are revising an implementation plan based on user feedback.

## Feature
Title: ${sanitized.title}
Description: ${sanitized.featureDescription}

## Current Plan (v${plan.planVersion})
${planStepsText}${planFileReference}

## User Feedback
${sanitizedFeedback}

## Instructions
1. Carefully consider the user's feedback
2. Revise the plan to address their concerns
3. Output the revised plan steps using the format:

[PLAN_STEP id="step-id" parent="null|parent-id" status="pending"]
Step title
Step description
[/PLAN_STEP]

4. If you have clarifying questions about the feedback, present them as decisions:
[DECISION_NEEDED priority="1" category="scope"]
Question about the feedback...

- Option A: Interpretation 1 (recommended)
- Option B: Interpretation 2
[/DECISION_NEEDED]

5. After outputting revised [PLAN_STEP] markers, use the Edit tool to update the plan file: ${session.claudePlanFilePath}
6. After revising the plan, continue with Stage 2 review process to find any remaining issues.`;
}

/**
 * Build prompt to continue after user answers a batch of questions.
 * Each review iteration has progressive complexity questions.
 * The server sends this prompt when all questions from the same batch are answered.
 */
export function buildBatchAnswersContinuationPrompt(
  answeredQuestions: Question[],
  currentStage: number,
  claudePlanFilePath?: string | null
): string {
  // Sanitize user answers to prevent marker injection
  const answers = answeredQuestions.map(q => {
    const answerText = typeof q.answer?.value === 'string'
      ? escapeMarkers(q.answer.value)
      : escapeMarkers(JSON.stringify(q.answer?.value));
    return `**Q:** ${q.questionText}\n**A:** ${answerText}`;
  }).join('\n\n');

  if (currentStage === 1) {
    return `The user answered your discovery questions:

${answers}

Continue with the discovery process based on these answers.

IMPORTANT: If you need more clarification, you MUST ask questions using this exact format:
[DECISION_NEEDED priority="1|2|3" category="scope|approach|technical|design"]
Question here?
- Option A: Description (recommended)
- Option B: Description
[/DECISION_NEEDED]

When you have enough information:
1. Generate the implementation plan with [PLAN_STEP] markers
2. Use the Edit tool to write the plan to: ${claudePlanFilePath || '/path/to/plan.md'}
3. Output: [PLAN_FILE path="${claudePlanFilePath || '/path/to/plan.md'}"]
4. Exit plan mode and output: [PLAN_MODE_EXITED]`;
  }

  // Stage 2 continuation
  return `The user answered your review questions:

${answers}

Continue with the review process based on these answers.

IMPORTANT: If there are more issues to address, you MUST use this exact format:
[DECISION_NEEDED priority="1|2|3" category="code_quality|architecture|security|performance"]
Issue: Description of the problem found.
Impact: What could go wrong if not addressed.

How should we address this?
- Option A: Recommended fix approach (recommended)
- Option B: Alternative fix approach
- Option C: Accept risk and proceed without fix
[/DECISION_NEEDED]

If all issues are resolved and the plan is ready for implementation, output:
[PLAN_APPROVED]`;
}

/**
 * Build Stage 3: Implementation prompt
 * Executes approved plan steps sequentially with progress tracking.
 * Per README lines 1659-1700
 */
export function buildStage3Prompt(session: Session, plan: Plan): string {
  const planStepsText = plan.steps.map((step, i) => {
    const parentInfo = step.parentId ? ` (depends on: ${step.parentId})` : '';
    return `### Step ${i + 1}: [${step.id}] ${step.title}${parentInfo}
${step.description || 'No description provided.'}`;
  }).join('\n\n');

  // Reference plan file for full context (handles context compaction)
  const planFileReference = session.claudePlanFilePath
    ? `\n\n## Full Plan Reference\nIMPORTANT: Read ${session.claudePlanFilePath} for complete plan details and context.`
    : '';

  // Determine test requirements based on assessment
  const testsRequired = plan.testRequirement?.required ?? true; // Default to required if not assessed
  const testTypesText = plan.testRequirement?.testTypes?.join(', ') || 'unit';
  const frameworkText = plan.testRequirement?.existingFramework
    ? `Use the existing ${plan.testRequirement.existingFramework} test framework.`
    : 'Set up a test framework if needed.';
  const coverageText = plan.testRequirement?.suggestedCoverage || '';

  // Build test section based on requirement
  const testSection = testsRequired
    ? `
### Test Requirements (MANDATORY)
- **Tests ARE required for this implementation**
- Test types needed: ${testTypesText}
- ${frameworkText}${coverageText ? `\n- Coverage focus: ${coverageText}` : ''}
- Write tests BEFORE marking a step complete
- Tests should cover: happy path, edge cases, error handling
- Match existing test patterns in the codebase`
    : `
### Test Requirements
- **Tests are NOT required for this implementation**
- Reason: ${plan.testRequirement?.reason || 'Documentation/configuration changes only'}
- You may skip writing tests for these changes
- Still run existing tests to ensure no regressions`;

  const executionSteps = testsRequired
    ? `1. **Start the step** - Announce which step you're working on
2. **Implement the changes** - Write/modify the necessary code
3. **Write tests** - Add ${testTypesText} tests for new functionality
4. **Run tests** - Verify all tests pass (max 3 fix attempts if tests fail)
5. **Commit changes** - Create a git commit for the step
6. **Report completion** - Use the markers below`
    : `1. **Start the step** - Announce which step you're working on
2. **Implement the changes** - Write/modify the necessary code
3. **Run existing tests** - Ensure no regressions
4. **Commit changes** - Create a git commit for the step
5. **Report completion** - Use the markers below`;

  // Sanitize user-provided fields to prevent marker injection
  const sanitized = sanitizeSessionFields(session);

  return `You are implementing an approved feature plan. Execute each step sequentially, commit changes, and track progress.

## Feature
Title: ${sanitized.title}
Description: ${sanitized.featureDescription}
Project Path: ${session.projectPath}

## Approved Plan (${plan.steps.length} steps)
${planStepsText}${planFileReference}

## Instructions

### Execution Process
For each step:
${executionSteps}
${testSection}

### Progress Markers (Required)

**During step execution**, output progress updates:
\`\`\`
[IMPLEMENTATION_STATUS]
step_id: step-X
status: in_progress|testing|fixing|committing
files_modified: 3
tests_status: ${testsRequired ? 'pending|passing|failing' : 'skipped|passing'}
work_type: implementing${testsRequired ? '|testing|fixing' : ''}
progress: 50
message: Brief status message
[/IMPLEMENTATION_STATUS]
\`\`\`

**After completing a step**:
\`\`\`
[STEP_COMPLETE id="step-X"]
Summary: Brief summary of what was implemented.
Files modified: file1.ts, file2.ts
${testsRequired ? 'Tests added: test1.spec.ts, test2.spec.ts\nTests passing: Yes' : 'Tests added: none (not required)\nTests passing: N/A'}
[/STEP_COMPLETE]
\`\`\`

**If blocked and need user input**:
\`\`\`
[DECISION_NEEDED priority="1" category="blocker" immediate="true"]
Describe what you're blocked on and why you need user input.

- Option A: First approach (recommended)
- Option B: Alternative approach
[/DECISION_NEEDED]
\`\`\`
Note: When a blocker is raised, execution pauses. The user will answer and you'll resume.

**When ALL steps are complete**:
\`\`\`
[IMPLEMENTATION_COMPLETE]
Summary: What was implemented
Steps completed: X of Y
Files modified: list of key files
${testsRequired ? 'Tests added: list of test files\nAll tests passing: Yes/No' : 'Tests added: none (not required for this change)\nAll tests passing: N/A'}
[/IMPLEMENTATION_COMPLETE]
\`\`\`
${testsRequired ? 'Note: Do NOT output IMPLEMENTATION_COMPLETE unless all tests are passing.' : 'Note: Tests were not required for this implementation. Proceed when all steps are complete.'}
${testsRequired ? `
### Test Failure Handling
- If tests fail, attempt to fix the issue (up to 3 attempts per step)
- After 3 failed attempts, raise a blocker decision for user guidance
- Track retry count in your IMPLEMENTATION_STATUS updates` : ''}

### Git Commits
- Create a commit after each step completion
- Use descriptive commit messages: "Step X: <step title>"
- Include the step ID in the commit message

### Important Rules
1. Execute steps in order (respect dependencies via parentId)
2. Do NOT skip steps or change the plan
3. If a step cannot be completed, raise a blocker
4. Output IMPLEMENTATION_STATUS regularly for real-time progress
${testsRequired ? '5. Always run tests before marking a step complete' : '5. Run existing tests to ensure no regressions'}`;
}

/**
 * Completed step summary for single-step prompts
 */
interface CompletedStepSummary {
  id: string;
  title: string;
  summary: string;
}

/**
 * Build a single-step implementation prompt for Stage 3.
 * Used for one-step-at-a-time execution (instead of all steps at once).
 */
export function buildSingleStepPrompt(
  session: Session,
  plan: Plan,
  step: PlanStep,
  completedSteps: CompletedStepSummary[]
): string {
  // Sanitize user-provided fields to prevent prompt injection
  const sanitized = sanitizeSessionFields(session);

  // Build completed steps summary
  const completedSummary = completedSteps.length > 0
    ? completedSteps.map((s, i) =>
        `${i + 1}. [${s.id}] ${s.title}: ${s.summary}`
      ).join('\n')
    : 'None yet - this is the first step.';

  // Reference plan file for full context (handles context compaction)
  const planFileReference = session.claudePlanFilePath
    ? `\n\n## Full Plan Reference\nIMPORTANT: Read ${session.claudePlanFilePath} for complete plan details and context.`
    : '';

  // Determine test requirements based on assessment
  const testsRequired = plan.testRequirement?.required ?? true;
  const testTypesText = plan.testRequirement?.testTypes?.join(', ') || 'unit';
  const frameworkText = plan.testRequirement?.existingFramework
    ? `Use the existing ${plan.testRequirement.existingFramework} test framework.`
    : 'Set up a test framework if needed.';
  const coverageText = plan.testRequirement?.suggestedCoverage || '';

  // Build test section based on requirement
  const testSection = testsRequired
    ? `### Test Requirements (MANDATORY)
- **Tests ARE required for this step**
- Test types needed: ${testTypesText}
- ${frameworkText}${coverageText ? `\n- Coverage focus: ${coverageText}` : ''}
- Write tests BEFORE marking the step complete
- Match existing test patterns in the codebase`
    : `### Test Requirements
- **Tests are NOT required for this step**
- Reason: ${plan.testRequirement?.reason || 'Documentation/configuration changes only'}
- Run existing tests to ensure no regressions`;

  const executionSteps = testsRequired
    ? `1. **Implement the changes** - Write/modify the necessary code
2. **Write tests** - Add ${testTypesText} tests for new functionality
3. **Run tests** - Verify all tests pass (max 3 fix attempts if tests fail)
4. **Commit changes** - Create a git commit for this step
5. **Report completion** - Use the [STEP_COMPLETE] marker below`
    : `1. **Implement the changes** - Write/modify the necessary code
2. **Run existing tests** - Ensure no regressions
3. **Commit changes** - Create a git commit for this step
4. **Report completion** - Use the [STEP_COMPLETE] marker below`;

  // Step dependency info
  const dependencyInfo = step.parentId
    ? `\n**Dependency:** This step depends on [${step.parentId}] which is already completed.`
    : '';

  return `You are implementing one step of an approved feature plan.

## Feature
Title: ${sanitized.title}
Description: ${sanitized.featureDescription}
Project Path: ${session.projectPath}
${planFileReference}

## Progress
**Completed Steps:**
${completedSummary}

## Current Step: [${step.id}] ${step.title}${dependencyInfo}
${step.description || 'No description provided.'}

## Instructions

### Execution Process
${executionSteps}

${testSection}

### Progress Markers (Required)

**During implementation**, output progress updates:
\`\`\`
[IMPLEMENTATION_STATUS]
step_id: ${step.id}
status: in_progress|testing|fixing|committing
files_modified: 3
tests_status: ${testsRequired ? 'pending|passing|failing' : 'skipped|passing'}
work_type: implementing${testsRequired ? '|testing|fixing' : ''}
progress: 50
message: Brief status message
[/IMPLEMENTATION_STATUS]
\`\`\`

**When this step is complete**:
\`\`\`
[STEP_COMPLETE id="${step.id}"]
Summary: Brief summary of what was implemented.
Files modified: file1.ts, file2.ts
${testsRequired ? 'Tests added: test1.spec.ts, test2.spec.ts\nTests passing: Yes' : 'Tests added: none (not required)\nTests passing: N/A'}
[/STEP_COMPLETE]
\`\`\`

**If blocked and need user input**:
\`\`\`
[DECISION_NEEDED priority="1" category="blocker" immediate="true"]
Describe what you're blocked on and why you need user input.

- Option A: First approach (recommended)
- Option B: Alternative approach
[/DECISION_NEEDED]
\`\`\`
Note: When a blocker is raised, execution pauses. The user will answer and you'll resume.
${testsRequired ? `
### Test Failure Handling
- If tests fail, attempt to fix the issue (up to 3 attempts)
- After 3 failed attempts, raise a blocker decision for user guidance` : ''}

### Git Commits
- Create a commit after step completion
- Use descriptive commit message: "Step ${step.id}: ${step.title}"

### Important Rules
1. Focus ONLY on this step - do NOT work on other steps
2. Do NOT output [IMPLEMENTATION_COMPLETE] - only [STEP_COMPLETE]
3. If this step cannot be completed, raise a blocker
4. Output IMPLEMENTATION_STATUS regularly for real-time progress`;
}

/**
 * Build Stage 4: PR Creation prompt
 * Creates a pull request for the completed implementation.
 * Per README lines 1757-1795
 */
export function buildStage4Prompt(session: Session, plan: Plan): string {
  // Sanitize user-provided fields to prevent marker injection
  const sanitized = sanitizeSessionFields(session);

  const completedSteps = plan.steps.filter(s => s.status === 'completed');
  const planStepsText = completedSteps.map((step, i) => {
    return `${i + 1}. [${step.id}] ${step.title}\n   ${step.description || 'No description'}`;
  }).join('\n\n');

  // Reference plan file for full context
  const planFileReference = session.claudePlanFilePath
    ? `\n\n## Full Plan Reference\nFor complete plan details, read: ${session.claudePlanFilePath}`
    : '';

  // Build test summary if available
  const testSummary = plan.testRequirement
    ? plan.testRequirement.required
      ? `\n- Tests were required: ${plan.testRequirement.testTypes?.join(', ') || 'unit'}`
      : `\n- Tests were not required: ${plan.testRequirement.reason}`
    : '';

  return `You are creating a pull request for a completed implementation.

## Feature
Title: ${sanitized.title}
Description: ${sanitized.featureDescription}
Project Path: ${session.projectPath}

## Completed Implementation (${completedSteps.length} steps)
${planStepsText}${planFileReference}

## Implementation Summary${testSummary}

## Instructions

### Phase 1: Review Changes (MANDATORY)
Use the Task tool to spawn parallel review agents that examine the changes:

1. **Diff Analysis Agent**: Review the git diff for the implementation
   - Run: git diff main...HEAD (or appropriate base branch)
   - Summarize what was added, modified, deleted
   - Note any significant patterns

2. **Commit History Agent**: Review the commit history
   - Run: git log main...HEAD --oneline
   - Summarize the progression of changes
   - Note the commit structure

3. **Test Results Agent**: Review test status
   - Check if tests were run and passed
   - Note test coverage for new code
   - Flag any untested areas

Wait for ALL review agents to complete before proceeding.

### Phase 2: Prepare PR Content
Based on the review, prepare:

1. **PR Title**: Clear, descriptive title (under 72 characters)
   - Format: "feat: <what this adds>" or "fix: <what this fixes>"

2. **PR Summary**: What was implemented and why
   - Reference the feature description
   - Highlight key changes
   - Note any important decisions made

3. **Test Plan**: How reviewers should test the changes
   - Manual testing steps if applicable
   - Automated test coverage summary
   - Edge cases to verify

### Phase 3: Verify Git State
**NOTE:** Git operations (checkout, commit, push) have already been performed automatically.

1. **Verify branch is pushed**: Run \`git log origin/${session.featureBranch} -1 --oneline\`
   - This confirms the branch exists on the remote
   - If this fails, there may be an issue - report it

2. **Skip manual git push** - already done by the system

### Phase 4: Create or Update the PR
1. Check if PR already exists: \`gh pr list --head ${session.featureBranch}\`
2. If PR exists, update it: \`gh pr edit <number> --title "..." --body "..."\`
3. If no PR exists, create it: \`gh pr create --base ${session.baseBranch} --head ${session.featureBranch} --title "..." --body "..."\`

### Progress Markers (Required)

**During review**, output status:
\`\`\`
[PR_STATUS]
phase: reviewing|preparing|creating
message: Brief status message
[/PR_STATUS]
\`\`\`

**When PR is created**, output:
\`\`\`
[PR_CREATED]
Title: {{prTitle}}
Branch: {{featureBranch}} → {{baseBranch}}
URL: {{prUrl}}

## Summary
{{summary}}

## Test Plan
{{testPlan}}
[/PR_CREATED]
\`\`\`

### Important Rules
1. Git push has already been performed - do NOT run git push again
2. Review changes BEFORE creating the PR
3. Include a clear, actionable test plan
4. Reference the original feature description
5. Update existing PR if one exists, otherwise create new
6. Return the PR URL in the output`;
}

/**
 * Build Stage 5: PR Review prompt
 * Reviews the PR with fresh eyes, checks CI status, and approves or returns to Stage 2.
 * Per README lines 1797-1907
 */
export function buildStage5Prompt(session: Session, plan: Plan, prInfo: { title: string; branch: string; url: string }): string {
  // Sanitize user-provided fields to prevent marker injection
  const sanitized = sanitizeSessionFields(session);

  const planStepsText = plan.steps.map((step, i) => {
    return `${i + 1}. [${step.id}] ${step.title}\n   ${step.description || 'No description'}`;
  }).join('\n\n');

  // Reference plan file for full context
  const planFileReference = session.claudePlanFilePath
    ? `\n\n## Full Plan Reference\nFor complete plan details, read: ${session.claudePlanFilePath}`
    : '';

  return `You are reviewing a pull request. Be objective and thorough.

IMPORTANT: You are reviewing this code with fresh eyes. Evaluate it as if you did not write it.

## Feature
Title: ${sanitized.title}
Description: ${sanitized.featureDescription}
Project Path: ${session.projectPath}

## Implementation Plan
${planStepsText}${planFileReference}

## Pull Request
Title: ${prInfo.title}
Branch: ${prInfo.branch}
URL: ${prInfo.url}

## Instructions

### Phase 1: Parallel Review (MANDATORY)
Use the Task tool to spawn review agents in parallel:

1. **Code Review Agent**: Review the git diff for issues
   - Run: git diff main...HEAD
   - Check: correctness, edge cases, error handling

2. **Security Agent**: Check for security vulnerabilities
   - Look for: injection risks, exposed secrets, auth issues
   - Verify: input validation, output encoding

3. **Test Coverage Agent**: Verify test adequacy
   - Check: test files exist for new code
   - Verify: edge cases and error paths tested

4. **Integration Agent**: Check API contracts
   - Verify: frontend-backend data shapes match
   - Check: external API integrations

5. **CI Agent**: Poll CI status
   - Run: gh pr checks (get PR number from URL)
   - Wait for checks to complete
   - Report pass/fail status

Wait for ALL agents to complete before proceeding.

### Phase 2: Compile Findings
Batch all findings into a review checkpoint:

\`\`\`
[REVIEW_CHECKPOINT]
## Review Findings

[DECISION_NEEDED priority="1" category="critical" file="path/to/file.ts" line="42"]
Issue: Critical problem that must be fixed before merge.
Impact: What could go wrong in production.

How should we fix this?
- Option A: Recommended fix approach (recommended)
- Option B: Alternative fix approach
[/DECISION_NEEDED]

[DECISION_NEEDED priority="2" category="major" file="path/to/file.ts" line="88"]
Issue: Important issue that should be addressed.
Impact: Affects code quality or maintainability.

How should we handle this?
- Option A: Fix now before merge (recommended)
- Option B: Create follow-up ticket
- Option C: Accept as-is with justification
[/DECISION_NEEDED]
[/REVIEW_CHECKPOINT]
\`\`\`

### Phase 3: Report CI Status
Always report CI status:

\`\`\`
[CI_STATUS status="passing|failing|pending"]
Check Name: Status
Check Name: Status
[/CI_STATUS]
\`\`\`

### Phase 4: Decision
Based on findings and CI status:

**If CI is failing:**
\`\`\`
[CI_FAILED]
The following CI checks are failing:
- Check name: Error message

This requires returning to Stage 2 to fix the issues.
[/CI_FAILED]
\`\`\`

**If issues found that require fixes:**
Present as \`[DECISION_NEEDED]\` blocks and wait for user response.
If user chooses to fix, output:
\`\`\`
[RETURN_TO_STAGE_2]
Reason: Brief description of what needs to be fixed
[/RETURN_TO_STAGE_2]
\`\`\`

**If CI passes and no blocking issues:**
\`\`\`
[PR_APPROVED]
The PR is ready to merge. All CI checks passing.

Summary:
- X files changed
- All tests passing
- No security issues found
- Code follows project patterns
[/PR_APPROVED]
\`\`\`

### Important Rules
1. Be objective - review as if you didn't write the code
2. Check CI status before approving
3. Present issues as prioritized decisions
4. CI failures MUST return to Stage 2
5. Only output PR_APPROVED when CI passes AND no blocking issues`;
}

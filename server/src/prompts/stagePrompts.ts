import { Session, Plan, Question } from '@claude-code-web/shared';

/**
 * Build Stage 1: Feature Discovery prompt
 * Uses Claude Code's native plan mode for structured exploration and planning.
 * Per README lines 1546-1611
 */
export function buildStage1Prompt(session: Session): string {
  const acceptanceCriteriaText = session.acceptanceCriteria.length > 0
    ? session.acceptanceCriteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n')
    : 'No specific criteria provided.';

  const affectedFilesSection = session.affectedFiles.length > 0
    ? `
## Affected Files (User Hints)
These files are likely to need changes:
${session.affectedFiles.join('\n')}`
    : '';

  const technicalNotesSection = session.technicalNotes
    ? `
## Technical Notes
${session.technicalNotes}`
    : '';

  return `You are helping implement a new feature. You MUST thoroughly explore the codebase BEFORE asking any questions.

## Feature
Title: ${session.title}
Description: ${session.featureDescription}
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
After questions are answered, generate implementation plan:

[PLAN_STEP id="1" parent="null" status="pending"]
Step title here
Description referencing specific files/modules found during exploration.
[/PLAN_STEP]

### Phase 4: Complete
1. Write plan to file and output: [PLAN_FILE path="/path/to/plan.md"]
2. Exit plan mode and output: [PLAN_MODE_EXITED]`;
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
Title: ${session.title}
Description: ${session.featureDescription}

## Current Plan (v${plan.planVersion})
${planStepsText}${planFileReference}

## User Feedback
${feedback}

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

5. After revising the plan, continue with Stage 2 review process to find any remaining issues.`;
}

/**
 * Build prompt to continue after user answers a batch of questions.
 * Each review iteration has progressive complexity questions.
 * The server sends this prompt when all questions from the same batch are answered.
 */
export function buildBatchAnswersContinuationPrompt(
  answeredQuestions: Question[],
  currentStage: number
): string {
  const answers = answeredQuestions.map(q => {
    const answerText = typeof q.answer?.value === 'string'
      ? q.answer.value
      : JSON.stringify(q.answer?.value);
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
2. Write the plan to a file and output: [PLAN_FILE path="/path/to/plan.md"]
3. Exit plan mode and output: [PLAN_MODE_EXITED]`;
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

  return `You are implementing an approved feature plan. Execute each step sequentially, commit changes, and track progress.

## Feature
Title: ${session.title}
Description: ${session.featureDescription}
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
 * Build Stage 4: PR Creation prompt
 * Creates a pull request for the completed implementation.
 * Per README lines 1757-1795
 */
export function buildStage4Prompt(session: Session, plan: Plan): string {
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
Title: ${session.title}
Description: ${session.featureDescription}
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

### Phase 3: Create the PR
1. First, ensure all changes are committed
2. Push the branch to remote if not already pushed
3. Use \`gh pr create\` to create the pull request

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
1. Review changes BEFORE creating the PR
2. Include a clear, actionable test plan
3. Reference the original feature description
4. Use \`gh pr create\` with --title and --body flags
5. Return the PR URL in the output`;
}

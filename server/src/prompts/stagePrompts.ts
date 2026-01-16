import { Session, Plan, PlanStep, Question, ValidationContext } from '@claude-code-web/shared';
import { escapeMarkers } from '../utils/sanitizeInput';
import { hasValidationContext } from '../utils/validationContextExtractor';

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

  const acceptanceCriteriaSection = sanitized.acceptanceCriteria.length > 0
    ? `
## Acceptance Criteria
${sanitized.acceptanceCriteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}`
    : '';

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
${acceptanceCriteriaSection}${affectedFilesSection}${technicalNotesSection}

## Instructions

### Phase 0: Git Setup (MANDATORY - Do this IMMEDIATELY)
Before exploring the codebase, you MUST set up the git branch to ensure you're working with the latest code:

1. **Checkout base branch**: \`git checkout ${session.baseBranch}\`
2. **Pull latest changes**: \`git pull origin ${session.baseBranch}\`
3. **Create feature branch**: \`git checkout -b ${session.featureBranch}\`

Run these commands NOW before proceeding to Phase 1. This ensures your codebase exploration reads the most up-to-date code.

### Phase 1: Codebase Exploration (MANDATORY - Do this AFTER Phase 0)
You MUST explore the codebase before asking any questions. Use the Task tool to spawn parallel exploration agents.

**IMPORTANT - Subagent Restrictions:**
When spawning Task subagents in this stage, instruct them to use READ-ONLY tools only:
- Allowed: Read, Glob, Grep, WebFetch, WebSearch
- NOT allowed: Edit, Write, Bash (except read-only commands like \`git status\`, \`git log\`)
Include this restriction in each subagent prompt to prevent unintended modifications.

1. **Architecture Agent**: Quick overview of project structure.
   - Find: package.json, config files (tsconfig/vite/webpack), main entry points
   - Output: Tech stack, monorepo structure (if any), build commands

2. **Frontend Agent**: Explore UI layer patterns.
   - Find: Components related to this feature, state management, styling approach
   - Check: Existing patterns for similar UI, reusable components, routing
   - Output: Relevant UI files, patterns to follow, potential reuse

3. **Backend Agent**: Explore API/server layer patterns.
   - Find: Related API routes, controllers, middleware, business logic
   - Check: Auth patterns, error handling, validation approach
   - Output: Relevant API files, patterns to follow, potential reuse

4. **Database Agent**: Explore data layer patterns.
   - Find: Related models/schemas, migrations, query patterns
   - Check: ORM usage, relationships, indexing patterns
   - Output: Relevant data files, schema patterns to follow

5. **Integration Agent**: Explore frontend-backend boundaries.
   - Find: API client code, type definitions shared between layers
   - Check: How data flows between UI and API, contract patterns
   - Output: Integration patterns, shared types, potential contract issues

6. **Test Agent**: Explore testing patterns.
   - Find: Test files for similar features, test utilities, mocks
   - Check: Testing framework, coverage patterns, test organization
   - Output: Test patterns to follow, testing requirements

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
After questions are answered, generate a **complete, composable implementation plan** with all required sections.

## Composable Plan Structure
Your plan MUST include these sections with structured markers. Plans missing any section will be automatically rejected and you'll be asked to complete them.

### 1. Plan Meta (Required)
\`\`\`
[PLAN_META]
version: 1.0.0
isApproved: false
[/PLAN_META]
\`\`\`

### 2. Plan Steps (Required)
**NOTE:** The feature branch (${session.featureBranch}) was already created in Phase 0. Start your plan with the first implementation step:
\`\`\`
[PLAN_STEP id="step-1" parent="null" status="pending" complexity="low|medium|high"]
First implementation step title
Description of what this step accomplishes. Must be at least 50 characters with concrete implementation details.
[/PLAN_STEP]
\`\`\`

Add implementation steps with complexity ratings:
\`\`\`
[PLAN_STEP id="step-2" parent="step-1" status="pending" complexity="medium"]
Step title here
Description referencing specific files/modules found during exploration. Must be at least 50 characters with concrete implementation details.
[/PLAN_STEP]
\`\`\`

**Complexity ratings:**
- \`low\`: Simple changes, single file, < 1 hour
- \`medium\`: Multiple files, moderate logic, 1-4 hours
- \`high\`: Complex logic, many files, > 4 hours

### 3. Dependencies (Required)
\`\`\`
[PLAN_DEPENDENCIES]
Step Dependencies:
- step-2 -> step-1: Step 2 requires step 1 to be completed first
- step-3 -> step-2: Step 3 depends on step 2

External Dependencies:
- npm:package-name@version: Brief reason why needed
[/PLAN_DEPENDENCIES]
\`\`\`

### 4. Test Coverage (Required)
\`\`\`
[PLAN_TEST_COVERAGE]
Framework: vitest|jest|other
Required Types: unit, integration

Step Coverage:
- step-1: unit (required)
- step-2: unit, integration (required)
- step-3: unit (required)
[/PLAN_TEST_COVERAGE]
\`\`\`

### 5. Acceptance Criteria Mapping (Required)
Map each acceptance criterion to the steps that implement it:
\`\`\`
[PLAN_ACCEPTANCE_MAPPING]
${session.acceptanceCriteria.map((c, i) => `- AC-${i + 1}: "${c.text}" -> step-X, step-Y`).join('\n')}
[/PLAN_ACCEPTANCE_MAPPING]
\`\`\`

## Validation Requirements
Your plan will be automatically validated. To pass validation:
1. **All steps must have complexity ratings** (low/medium/high)
2. **Step descriptions must be >= 50 characters** with concrete details
3. **All 5 sections must be present** (meta, steps, dependencies, test coverage, acceptance mapping)
4. **All acceptance criteria must be mapped** to at least one step
5. **No placeholder text** like "TBD", "TODO", or "..." in descriptions

### Phase 4: Complete
1. Use the Edit tool to write the complete plan to: ${session.claudePlanFilePath}
   - This file already exists and you have permission to edit it
   - Include ALL plan sections: meta, steps, dependencies, test coverage, acceptance mapping
2. Output: [PLAN_FILE path="${session.claudePlanFilePath}"]
3. Exit plan mode and output: [PLAN_MODE_EXITED]`;
}

/**
 * Build Stage 2: Plan Review prompt
 * Reviews implementation plan and finds issues to present as decisions.
 * If planValidationContext exists, prepends validation issues to be addressed.
 * Per README lines 1613-1657
 */
export function buildStage2Prompt(session: Session, plan: Plan, currentIteration: number): string {
  const planStepsText = plan.steps.length > 0
    ? plan.steps.map((step, i) => {
        const parentInfo = step.parentId ? ` (depends on: ${step.parentId})` : '';
        const complexityInfo = (step as { complexity?: string }).complexity
          ? ` [${(step as { complexity?: string }).complexity} complexity]`
          : '';
        return `${i + 1}. [${step.id}] ${step.title}${parentInfo}${complexityInfo}\n   ${step.description || 'No description'}`;
      }).join('\n\n')
    : 'No plan steps defined.';

  const targetIterations = 10; // README recommendation

  // Reference plan file for full context (handles context compaction)
  const planFileReference = session.claudePlanFilePath
    ? `\n\n## Full Plan Reference\nFor complete plan details, read: ${session.claudePlanFilePath}`
    : '';

  // Build validation context section if plan was previously incomplete
  const validationContextSection = session.planValidationContext
    ? `
## ⚠️ Plan Validation Issues (MUST ADDRESS FIRST)
The previous plan submission was incomplete. Please address the following issues before proceeding:

${session.planValidationContext}

**Instructions for fixing validation issues:**
1. Review each validation issue listed above
2. Update your plan to address all issues
3. Ensure all required sections are complete
4. Re-output the updated plan markers

---

`
    : '';

  // Build composable plan structure documentation
  const composablePlanDocs = `
## Composable Plan Structure
Your plan should include these sections with structured markers:

### Required Plan Sections:
1. **Plan Steps** - Each step with complexity rating
   \`\`\`
   [PLAN_STEP id="step-X" parent="null|step-Y" status="pending" complexity="low|medium|high"]
   Step Title
   Detailed description (minimum 50 characters)
   [/PLAN_STEP]
   \`\`\`

2. **Plan Meta** - Plan metadata
   \`\`\`
   [PLAN_META]
   version: 1.0.0
   isApproved: false
   [/PLAN_META]
   \`\`\`

3. **Dependencies** - Step and external dependencies
   \`\`\`
   [PLAN_DEPENDENCIES]
   Step Dependencies:
   - step-2 -> step-1: Must complete auth before routes

   External Dependencies:
   - npm:jsonwebtoken@9.0.0: JWT library
   [/PLAN_DEPENDENCIES]
   \`\`\`

4. **Test Coverage** - Testing requirements
   \`\`\`
   [PLAN_TEST_COVERAGE]
   Framework: vitest
   Required Types: unit, integration

   Step Coverage:
   - step-1: unit (required)
   - step-2: unit, integration (required)
   [/PLAN_TEST_COVERAGE]
   \`\`\`

5. **Acceptance Mapping** - Link criteria to steps
   \`\`\`
   [PLAN_ACCEPTANCE_MAPPING]
   - AC-1: "Users can login" -> step-2, step-3
   - AC-2: "JWT tokens issued" -> step-1
   [/PLAN_ACCEPTANCE_MAPPING]
   \`\`\`

`;

  return `You are reviewing an implementation plan. Find issues and present them as decisions for the user.
${validationContextSection}
## Current Plan (v${plan.planVersion})
${planStepsText}${planFileReference}

## Review Iteration
This is review ${currentIteration} of ${targetIterations} recommended.
${composablePlanDocs}
## Instructions
1. Use the Task tool to spawn domain-specific subagents for parallel review.

**IMPORTANT - Subagent Restrictions:**
When spawning Task subagents in this stage, instruct them to use READ-ONLY tools only:
- Allowed: Read, Glob, Grep, WebFetch, WebSearch
- NOT allowed: Edit, Write, Bash (except read-only commands)
Include this restriction in each subagent prompt to prevent unintended modifications.

   - **Frontend Agent**: Review UI/client-side steps.
     - Correctness: Component structure, state management, error states
     - Security: XSS risks, sensitive data exposure, input sanitization
     - Performance: Bundle size, render optimization, lazy loading
     - Output: List of UI concerns with severity (critical/major/minor)

   - **Backend Agent**: Review API/server-side steps.
     - Correctness: Endpoint design, request/response contracts, error handling
     - Security: Auth checks, injection risks, input validation
     - Performance: Query efficiency, caching strategy, rate limiting
     - Output: List of backend concerns with severity

   - **Database Agent**: Review data layer steps.
     - Correctness: Schema design, migration strategy, relationships
     - Security: Access controls, sensitive data handling, SQL injection
     - Performance: Index usage, query patterns, connection pooling
     - Output: List of data concerns with severity

   - **Integration Agent**: Review frontend-backend boundaries.
     - Correctness: API contracts match, type consistency across layers
     - Security: Auth token handling, CORS configuration, error exposure
     - Performance: Payload sizes, request batching, caching headers
     - Output: List of integration concerns with severity

   - **Test Agent**: Review testing strategy.
     - Coverage: Unit, integration, e2e tests planned appropriately
     - Critical paths: Happy paths, error cases, edge cases identified
     - Output: List of testing gaps with severity

2. Check for issues in these categories:
   - Code Quality: Missing error handling, hardcoded values, missing tests
   - Architecture: Tight coupling, unclear separation of concerns
   - Security: Injection risks, exposed secrets, missing auth checks
   - Performance: N+1 queries, missing indexes, large bundle size
   - **Plan Structure**: Missing complexity ratings, insufficient descriptions, unmapped acceptance criteria

3. Present issues as progressive decisions for the user:
   - Priority 1: Fundamental issues (architecture, security, plan structure) - ask first
   - Priority 2: Important issues (code quality, performance) - ask after P1 resolved
   - Priority 3: Refinements (style, optimization) - ask last

4. Format each issue as a decision with fix options:
[DECISION_NEEDED priority="1|2|3" category="code_quality|architecture|security|performance|plan_structure"]
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
 * Supports step modifications: add, edit, and remove steps.
 */
export function buildPlanRevisionPrompt(session: Session, plan: Plan, feedback: string): string {
  // Sanitize user-provided fields to prevent marker injection
  const sanitized = sanitizeSessionFields(session);
  const sanitizedFeedback = escapeMarkers(feedback);

  const planStepsText = plan.steps.length > 0
    ? plan.steps.map((step, i) => {
        const parentInfo = step.parentId ? ` (depends on: ${step.parentId})` : '';
        const complexityInfo = (step as { complexity?: string }).complexity
          ? ` [${(step as { complexity?: string }).complexity} complexity]`
          : '';
        return `${i + 1}. [${step.id}] ${step.title}${parentInfo}${complexityInfo}\n   ${step.description || 'No description'}`;
      }).join('\n\n')
    : 'No plan steps defined.';

  // Reference plan file for full context (handles context compaction)
  const planFileReference = session.claudePlanFilePath
    ? `\n\n## Full Plan Reference\nFor complete plan details, read: ${session.claudePlanFilePath}`
    : '';

  // Build composable plan structure documentation (matches buildStage2Prompt)
  const composablePlanDocs = `
## Composable Plan Structure
Your revised plan should include these sections with structured markers:

### Required Plan Sections:
1. **Plan Steps** - Each step with complexity rating
   \`\`\`
   [PLAN_STEP id="step-X" parent="null|step-Y" status="pending" complexity="low|medium|high"]
   Step Title
   Detailed description (minimum 50 characters)
   [/PLAN_STEP]
   \`\`\`

   **Complexity ratings:**
   - \`low\`: Simple changes, single file, < 1 hour
   - \`medium\`: Multiple files, moderate logic, 1-4 hours
   - \`high\`: Complex logic, many files, > 4 hours

2. **Plan Meta** - Plan metadata
   \`\`\`
   [PLAN_META]
   version: 1.0.0
   isApproved: false
   [/PLAN_META]
   \`\`\`

3. **Dependencies** - Step and external dependencies
   \`\`\`
   [PLAN_DEPENDENCIES]
   Step Dependencies:
   - step-2 -> step-1: Must complete auth before routes

   External Dependencies:
   - npm:jsonwebtoken@9.0.0: JWT library
   [/PLAN_DEPENDENCIES]
   \`\`\`

4. **Test Coverage** - Testing requirements
   \`\`\`
   [PLAN_TEST_COVERAGE]
   Framework: vitest
   Required Types: unit, integration

   Step Coverage:
   - step-1: unit (required)
   - step-2: unit, integration (required)
   [/PLAN_TEST_COVERAGE]
   \`\`\`

5. **Acceptance Mapping** - Link criteria to steps
   \`\`\`
   [PLAN_ACCEPTANCE_MAPPING]
   - AC-1: "Users can login" -> step-2, step-3
   - AC-2: "JWT tokens issued" -> step-1
   [/PLAN_ACCEPTANCE_MAPPING]
   \`\`\`
`;

  return `You are revising an implementation plan based on user feedback.

## Feature
Title: ${sanitized.title}
Description: ${sanitized.featureDescription}

## Current Plan (v${plan.planVersion})
${planStepsText}${planFileReference}

## User Feedback
${sanitizedFeedback}
${composablePlanDocs}
## Step Modification Instructions

You can **add**, **edit**, or **remove** steps based on the feedback.

### To Add or Edit Steps
Output the step using the PLAN_STEP marker with the required complexity attribute:
\`\`\`
[PLAN_STEP id="step-new-1" parent="step-1" status="pending" complexity="medium"]
New step title
New step description with at least 50 characters of detailed implementation guidance.
[/PLAN_STEP]
\`\`\`

- Use a new unique ID for new steps (e.g., "step-new-1", "step-7")
- Use an existing ID to edit that step
- Always include the \`complexity\` attribute (low|medium|high)
- Step descriptions must be at least 50 characters

### To Remove Steps
Output the REMOVE_STEPS marker with a JSON array of step IDs to remove:
\`\`\`
[REMOVE_STEPS]
["step-3", "step-4"]
[/REMOVE_STEPS]
\`\`\`

**Important notes about step removal:**
- Child steps (those with \`parentId\` pointing to a removed step) will be automatically cascade-deleted
- Steps that depend on removed steps will be reset to "pending" status for re-implementation
- Only remove steps that are truly no longer needed

### Clarifying Questions
If you need clarification before making modifications, ask first:
\`\`\`
[DECISION_NEEDED priority="1" category="scope"]
Question about the feedback to clarify before modifying the plan...

- Option A: Interpretation 1 (recommended)
- Option B: Interpretation 2
[/DECISION_NEEDED]
\`\`\`

### Output Step Modifications
After outputting modifications via [PLAN_STEP] and [REMOVE_STEPS] markers:
\`\`\`
[STEP_MODIFICATIONS]
modified: ["step-1", "step-2"]
added: ["step-new-1"]
removed: ["step-3"]
[/STEP_MODIFICATIONS]
\`\`\`

## Workflow
1. Review the user feedback carefully
2. If clarification is needed, ask questions using DECISION_NEEDED markers
3. Output any step modifications (adds, edits, removals)
4. Output the [STEP_MODIFICATIONS] summary
5. Use the Edit tool to update the plan file: ${session.claudePlanFilePath}
6. Continue with Stage 2 review process to find any remaining issues`;
}

/**
 * Format validation context as a markdown section for inclusion in prompts.
 * Shows summary counts, filtered questions with reasons, and repurposed question mappings.
 */
export function formatValidationContextSection(validationContext?: ValidationContext | null): string {
  if (!validationContext || !hasValidationContext(validationContext)) {
    return '';
  }

  const { summary, filteredQuestions, repurposedQuestions } = validationContext;

  let section = `\n\n## Validation Context
During this session, some questions were filtered or repurposed by the validation system.

### Summary
- Total questions processed: ${summary.totalProcessed}
- Passed: ${summary.passedCount}
- Filtered: ${summary.filteredCount}
- Repurposed: ${summary.repurposedCount}`;

  // Add filtered questions section if any exist
  if (filteredQuestions.length > 0) {
    section += `

### Filtered Questions
The following questions were filtered out (not shown to user):
${filteredQuestions.map((q, i) => `${i + 1}. **"${escapeMarkers(q.questionText)}"**
   - Reason: ${escapeMarkers(q.reason)}`).join('\n')}`;
  }

  // Add repurposed questions section if any exist
  if (repurposedQuestions.length > 0) {
    section += `

### Repurposed Questions
The following questions were transformed into different questions:
${repurposedQuestions.map((q, i) => {
  const newQuestionsText = q.newQuestionTexts.length > 0
    ? q.newQuestionTexts.map(t => `     - "${escapeMarkers(t)}"`).join('\n')
    : '     - (no replacement questions)';
  return `${i + 1}. **Original:** "${escapeMarkers(q.originalQuestionText)}"
   - Reason: ${escapeMarkers(q.reason)}
   - Replaced with:
${newQuestionsText}`;
}).join('\n')}`;
  }

  section += `

**Note:** Consider this context when processing the user's answers. The filtered/repurposed questions indicate areas that were deemed less relevant or needed reformulation.`;

  return section;
}

/**
 * Build prompt to continue after user answers a batch of questions.
 * Each review iteration has progressive complexity questions.
 * The server sends this prompt when all questions from the same batch are answered.
 */
export function buildBatchAnswersContinuationPrompt(
  answeredQuestions: Question[],
  currentStage: number,
  claudePlanFilePath?: string | null,
  remarks?: string,
  validationContext?: ValidationContext | null
): string {
  // Sanitize user answers to prevent marker injection
  const answers = answeredQuestions.map(q => {
    const answerText = typeof q.answer?.value === 'string'
      ? escapeMarkers(q.answer.value)
      : escapeMarkers(JSON.stringify(q.answer?.value));
    return `**Q:** ${q.questionText}\n**A:** ${answerText}`;
  }).join('\n\n');

  // Sanitize and include remarks if provided
  const remarksSection = remarks?.trim()
    ? `\n\n**Additional concerns/requested changes from user:**\n${escapeMarkers(remarks.trim())}`
    : '';

  // Format validation context section if provided
  const validationSection = formatValidationContextSection(validationContext);

  if (currentStage === 1) {
    return `The user answered your discovery questions:

${answers}${remarksSection}${validationSection}

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

${answers}${remarksSection}${validationSection}

Continue with the review process based on these answers.${remarks?.trim() ? ' Pay special attention to the additional concerns raised by the user.' : ''}

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
 * Context about step modifications during Stage 2 revision.
 * Provides Claude with information about why a step is being re-implemented.
 */
export interface StepModificationContext {
  /** Whether this step was modified during Stage 2 revision */
  wasModified: boolean;
  /** Whether this step was newly added during Stage 2 revision */
  wasAdded: boolean;
  /** IDs of steps that were removed and may have affected this step */
  removedStepIds?: string[];
}

/**
 * Build a single-step implementation prompt for Stage 3.
 * Used for one-step-at-a-time execution (instead of all steps at once).
 * @param modificationContext - Optional context about step modifications from Stage 2 revision
 */
export function buildSingleStepPrompt(
  session: Session,
  plan: Plan,
  step: PlanStep,
  completedSteps: CompletedStepSummary[],
  modificationContext?: StepModificationContext
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

  // Build modification context section if this is a re-run after Stage 2 revision
  let modificationSection = '';
  if (modificationContext) {
    if (modificationContext.wasModified) {
      modificationSection = `\n\n**⚠️ MODIFIED STEP:** This step was modified during plan revision. The previous implementation is no longer valid. You must re-implement this step according to the updated description above.`;
    } else if (modificationContext.wasAdded) {
      modificationSection = `\n\n**🆕 NEW STEP:** This step was added during plan revision. This is a new step that has not been implemented before.`;
    }
    if (modificationContext.removedStepIds && modificationContext.removedStepIds.length > 0) {
      modificationSection += `\n**Note:** The following steps were removed from the plan: ${modificationContext.removedStepIds.join(', ')}. Any code or tests related to these steps may need cleanup.`;
    }
  }

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
${step.description || 'No description provided.'}${modificationSection}

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
Review the changes before creating the PR:

1. **Review git diff**:
   - Run: git diff main...HEAD (or appropriate base branch)
   - Summarize what was added, modified, deleted
   - Note any significant patterns

2. **Review commit history**:
   - Run: git log main...HEAD --oneline
   - Summarize the progression of changes
   - Note the commit structure

3. **Review test status**:
   - Check if tests were run and passed
   - Note test coverage for new code
   - Flag any untested areas

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
Use the Task tool to spawn review agents in parallel.

**IMPORTANT - Subagent Restrictions:**
When spawning Task subagents in this stage, instruct them to use READ-ONLY tools only:
- Allowed: Read, Glob, Grep, Bash (read-only: git diff, git log, gh pr checks)
- NOT allowed: Edit, Write, Bash with modifications (no commits, no file changes)
Include this restriction in each subagent prompt to prevent unintended modifications.

1. **Frontend Agent**: Review UI/client-side changes.
   - Run: git diff main...HEAD -- '*.tsx' '*.ts' '*.css' (client paths)
   - Correctness: Component logic, state handling, error states
   - Security: XSS risks, sensitive data in client, input sanitization
   - Performance: Bundle impact, render efficiency, unnecessary re-renders
   - Output: List of UI issues with file:line refs and severity

2. **Backend Agent**: Review API/server-side changes.
   - Run: git diff main...HEAD -- (server paths)
   - Correctness: Endpoint logic, error handling, edge cases
   - Security: Auth checks, injection risks, input validation, secrets
   - Performance: Query efficiency, N+1 issues, caching
   - Output: List of backend issues with file:line refs and severity

3. **Database Agent**: Review data layer changes.
   - Run: git diff main...HEAD -- (schema/migration paths)
   - Correctness: Schema design, migration safety, relationships
   - Security: Access controls, sensitive data handling
   - Performance: Index usage, query patterns
   - Output: List of data issues with file:line refs and severity

4. **Integration Agent**: Review frontend-backend boundaries.
   - Check: API contracts match, types consistent across layers
   - Security: Auth token handling, CORS, error message exposure
   - Performance: Payload sizes, request patterns
   - Output: List of integration issues with severity

5. **Test Agent**: Verify test coverage for changes.
   - Run: Find test files matching changed source files
   - Check: New code has tests, edge cases covered
   - Output: List of untested code paths with file:line refs

6. **CI Agent**: Wait for CI to complete.
   - Run: gh pr checks ${prInfo.url.split('/').pop()} --watch
   - Output: Final status (all passing / X failing)

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

// ============================================================================
// LEAN PROMPTS - For subsequent calls that leverage --resume context
// ============================================================================

/**
 * Lean Stage 2 prompt for iterations 2+.
 * Claude already knows the plan structure and marker formats from Stage 1.
 */
export function buildStage2PromptLean(
  plan: Plan,
  currentIteration: number,
  validationContext?: string | null,
  claudePlanFilePath?: string | null
): string {
  const validation = validationContext
    ? `⚠️ **Fix these validation issues first:**\n${validationContext}\n\n`
    : '';

  const planFile = claudePlanFilePath
    ? `Plan file: ${claudePlanFilePath}\n`
    : '';

  return `${validation}${planFile}Continue plan review (iteration ${currentIteration}/10).

Review the plan for issues. Present findings as [DECISION_NEEDED] markers.
When satisfied with the plan, output [PLAN_APPROVED].`;
}

/**
 * Lean single-step prompt for Stage 3 steps 2+.
 * Claude already knows the marker formats and process from the first step.
 */
export function buildSingleStepPromptLean(
  step: PlanStep,
  completedSteps: Array<{ id: string; title: string; summary: string }>,
  testsRequired: boolean
): string {
  const completedSummary = completedSteps.length > 0
    ? completedSteps.map(s => `- [${s.id}] ${s.title}`).join('\n')
    : 'None yet.';

  const testNote = testsRequired
    ? 'Write tests before marking complete.'
    : 'Tests not required for this change.';

  return `## Completed Steps
${completedSummary}

## Current Step: [${step.id}] ${step.title}
${step.description || 'No description provided.'}

${testNote}
Commit when done. Output [STEP_COMPLETE id="${step.id}"] with summary.
If blocked (e.g., a planning assumption discovered to be incorrect during implementation), use [DECISION_NEEDED category="blocker"].`;
}

/**
 * Lean Stage 4 prompt.
 * Claude knows the PR format from context.
 */
export function buildStage4PromptLean(
  session: Session,
  completedStepsCount: number
): string {
  return `Create PR for the completed implementation (${completedStepsCount} steps).

1. Review: git diff ${session.baseBranch}...HEAD
2. Create PR: gh pr create --base ${session.baseBranch} --head ${session.featureBranch}
3. Output [PR_CREATED] with title, URL, summary, and test plan.

Note: Git push already done. Check if PR exists first with gh pr list.`;
}

/**
 * Lean Stage 5 prompt.
 * Claude knows the review format from context.
 */
export function buildStage5PromptLean(
  prInfo: { title: string; url: string }
): string {
  return `Review PR: ${prInfo.url}
Title: ${prInfo.title}

1. Run parallel review agents (code, security, tests, integration)
2. Check CI: gh pr checks
3. Report findings as [DECISION_NEEDED] with priority/category
4. CI failing → [CI_FAILED]
5. Issues to fix → [RETURN_TO_STAGE_2]
6. All good → [PR_APPROVED]`;
}

/**
 * Lean batch answers continuation prompt.
 * Claude knows the marker formats already.
 */
export function buildBatchAnswersContinuationPromptLean(
  answeredQuestions: Question[],
  currentStage: number,
  validationContext?: ValidationContext | null
): string {
  const answers = answeredQuestions.map(q => {
    const answerText = typeof q.answer?.value === 'string'
      ? escapeMarkers(q.answer.value)
      : escapeMarkers(JSON.stringify(q.answer?.value));
    return `**Q:** ${q.questionText}\n**A:** ${answerText}`;
  }).join('\n\n');

  // Format validation context section if provided (abbreviated for lean version)
  const validationSection = formatValidationContextSection(validationContext);

  if (currentStage === 1) {
    return `User answers:\n\n${answers}${validationSection}\n\nContinue discovery. More questions → [DECISION_NEEDED]. Ready → generate plan with [PLAN_STEP] markers.`;
  }

  return `User answers:\n\n${answers}${validationSection}\n\nContinue review. More issues → [DECISION_NEEDED]. All resolved → [PLAN_APPROVED].`;
}

import { Session, Plan, PlanStep, Question, ValidationContext } from '@claude-code-web/shared';
import { escapeMarkers } from '../utils/sanitizeInput';
import { hasValidationContext } from '../utils/validationContextExtractor';

/**
 * Options for prompt generation that control whether agents are defined
 * externally via the --agents CLI flag or embedded in the prompt.
 */
export interface PromptOptions {
  /**
   * When true, agents are configured via the --agents CLI flag.
   * Prompts will reference agent names only, without full instructions.
   * This reduces prompt length by ~30-50%.
   */
  useExternalAgents?: boolean;
}

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
2. The plan is complete when the file is written with all required sections`;
}

/**
 * Agent definitions for streamlined prompts.
 * Maps agent type to its exploration instructions.
 *
 * NOTE: When useExternalAgents is true, these instructions are provided via
 * the --agents CLI flag (see STAGE_AGENTS in ClaudeOrchestrator.ts).
 * The prompt will reference agent names only without embedding full instructions.
 */
const AGENT_DEFINITIONS: Record<string, { name: string; instructions: string }> = {
  frontend: {
    name: 'Frontend Agent',
    instructions: `Explore UI layer patterns.
   - Find: Components related to this feature, state management, styling approach
   - Check: Existing patterns for similar UI, reusable components, routing
   - Output: Relevant UI files, patterns to follow, potential reuse`,
  },
  backend: {
    name: 'Backend Agent',
    instructions: `Explore API/server layer patterns.
   - Find: Related API routes, controllers, middleware, business logic
   - Check: Auth patterns, error handling, validation approach
   - Output: Relevant API files, patterns to follow, potential reuse`,
  },
  database: {
    name: 'Database Agent',
    instructions: `Explore data layer patterns.
   - Find: Related models/schemas, migrations, query patterns
   - Check: ORM usage, relationships, indexing patterns
   - Output: Relevant data files, schema patterns to follow`,
  },
  testing: {
    name: 'Test Agent',
    instructions: `Explore testing patterns.
   - Find: Test files for similar features, test utilities, mocks
   - Check: Testing framework, coverage patterns, test organization
   - Output: Test patterns to follow, testing requirements`,
  },
  infrastructure: {
    name: 'Infrastructure Agent',
    instructions: `Explore infrastructure and CI/CD patterns.
   - Find: CI/CD configs, deployment scripts, environment configs
   - Check: Build process, deployment pipeline, environment management
   - Output: Relevant config files, CI/CD patterns to follow`,
  },
  documentation: {
    name: 'Documentation Agent',
    instructions: `Explore documentation patterns.
   - Find: README files, API docs, inline documentation
   - Check: Documentation standards, existing doc structure
   - Output: Relevant docs, documentation patterns to follow`,
  },
};

/**
 * Build Stage 1: Streamlined Feature Discovery prompt
 * A focused version for simple/trivial changes that only spawns relevant agents.
 * Uses session.suggestedAgents to determine which agents to spawn.
 *
 * @param session - The session containing feature information
 * @param options - Optional prompt options (useExternalAgents to reduce prompt length)
 */
export function buildStage1PromptStreamlined(session: Session, options?: PromptOptions): string {
  // Sanitize user-provided fields to prevent marker injection
  const sanitized = sanitizeSessionFields(session);
  const useExternalAgents = options?.useExternalAgents ?? false;

  const acceptanceCriteriaSection =
    sanitized.acceptanceCriteria.length > 0
      ? `
## Acceptance Criteria
${sanitized.acceptanceCriteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}`
      : '';

  const affectedFilesSection =
    sanitized.affectedFiles.length > 0
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

  // Build agent section based on suggestedAgents
  // Filter to only valid agent types, fallback to all agents if none are valid
  const ALL_AGENT_KEYS = Object.keys(AGENT_DEFINITIONS);
  const rawSuggestedAgents = session.suggestedAgents || ['frontend', 'backend'];
  const validAgents = rawSuggestedAgents.filter((a) => AGENT_DEFINITIONS[a]);
  const suggestedAgents = validAgents.length > 0 ? validAgents : ALL_AGENT_KEYS;

  // When using external agents, just reference agent names without full instructions
  const agentSections = useExternalAgents
    ? suggestedAgents
        .map((agentType, index) => {
          const agent = AGENT_DEFINITIONS[agentType];
          return `${index + 1}. **${agent.name}** (${agentType})`;
        })
        .join('\n')
    : suggestedAgents
        .map((agentType, index) => {
          const agent = AGENT_DEFINITIONS[agentType];
          return `${index + 1}. **${agent.name}**: ${agent.instructions}`;
        })
        .join('\n\n');

  // For simple changes, always include a quick architecture check
  const architectureNote =
    suggestedAgents.length <= 2
      ? `
**Quick Architecture Check** (if not covered by agents above):
   - Verify project structure and entry points
   - Identify any dependencies that might be affected`
      : '';

  return `You are helping implement a focused change. Since this is a ${session.assessedComplexity || 'simple'} change, exploration is streamlined.

## Feature
Title: ${sanitized.title}
Description: ${sanitized.featureDescription}
Project Path: ${session.projectPath}
Complexity: ${session.assessedComplexity || 'simple'} (streamlined exploration)
${acceptanceCriteriaSection}${affectedFilesSection}${technicalNotesSection}

## Instructions

### Phase 0: Git Setup (MANDATORY - Do this IMMEDIATELY)
Before exploring the codebase, you MUST set up the git branch:

1. **Checkout base branch**: \`git checkout ${session.baseBranch}\`
2. **Pull latest changes**: \`git pull origin ${session.baseBranch}\`
3. **Create feature branch**: \`git checkout -b ${session.featureBranch}\`

Run these commands NOW before proceeding.

### Phase 1: Focused Exploration (MANDATORY)
Since this is a ${session.assessedComplexity || 'simple'} change, spawn only the relevant exploration agents.

**IMPORTANT - Subagent Restrictions:**
When spawning Task subagents, instruct them to use READ-ONLY tools only:
- Allowed: Read, Glob, Grep, WebFetch, WebSearch
- NOT allowed: Edit, Write, Bash (except read-only commands like \`git status\`)

**Spawn these agents:**

${agentSections}
${architectureNote}

Wait for exploration agents to complete before proceeding.

### Phase 2: Ask Informed Questions (ONLY IF NEEDED)
For ${session.assessedComplexity || 'simple'} changes, you likely have enough context from exploration.
Only ask questions if there are genuine ambiguities that can't be resolved from the codebase:

[DECISION_NEEDED priority="1|2|3" category="scope|approach|technical|design"]
Question here?
- Option A: Description
- Option B: Description
[/DECISION_NEEDED]

Skip this phase entirely if the change is clear and straightforward.

### Phase 3: Generate Plan
Create a concise implementation plan. For ${session.assessedComplexity || 'simple'} changes, plans should be:
- 1-3 steps for trivial changes
- 2-5 steps for simple changes

## Composable Plan Structure
Your plan MUST include these sections:

### 1. Plan Meta (Required)
\`\`\`
[PLAN_META]
version: 1.0.0
isApproved: false
[/PLAN_META]
\`\`\`

### 2. Plan Steps (Required)
**NOTE:** The feature branch (${session.featureBranch}) was already created in Phase 0.
\`\`\`
[PLAN_STEP id="step-1" parent="null" status="pending" complexity="low"]
Implementation step title
Description with at least 50 characters of concrete details.
[/PLAN_STEP]
\`\`\`

### 3. Dependencies (Required)
\`\`\`
[PLAN_DEPENDENCIES]
Step Dependencies:
- (list any step dependencies, or "None" for simple changes)

External Dependencies:
- (list any new packages needed, or "None")
[/PLAN_DEPENDENCIES]
\`\`\`

### 4. Test Coverage (Required)
\`\`\`
[PLAN_TEST_COVERAGE]
Framework: vitest|jest|other
Required Types: unit

Step Coverage:
- step-1: unit (required)
[/PLAN_TEST_COVERAGE]
\`\`\`

### 5. Acceptance Criteria Mapping (Required)
\`\`\`
[PLAN_ACCEPTANCE_MAPPING]
${session.acceptanceCriteria.map((c, i) => `- AC-${i + 1}: "${c.text}" -> step-X`).join('\n')}
[/PLAN_ACCEPTANCE_MAPPING]
\`\`\`

### Phase 4: Complete
1. Use the Edit tool to write the complete plan to: ${session.claudePlanFilePath}
   - This file already exists and you have permission to edit it
   - Include ALL plan sections: meta, steps, dependencies, test coverage, acceptance mapping
2. Exit plan mode and output: [PLAN_MODE_EXITED]`;
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
 * Review agent definitions for streamlined Stage 2.
 * Maps agent type to focused review instructions for simple changes.
 *
 * NOTE: When useExternalAgents is true, these instructions are provided via
 * the --agents CLI flag (see STAGE_AGENTS in ClaudeOrchestrator.ts).
 * The prompt will reference agent names only without embedding full instructions.
 */
const STAGE2_REVIEW_AGENTS: Record<string, { name: string; focus: string }> = {
  frontend: {
    name: 'Frontend Reviewer',
    focus: `Review UI aspects:
     - Component correctness and state handling
     - User input validation
     - Accessibility basics`,
  },
  backend: {
    name: 'Backend Reviewer',
    focus: `Review API aspects:
     - Endpoint correctness
     - Input validation and error handling
     - Auth checks if applicable`,
  },
  database: {
    name: 'Database Reviewer',
    focus: `Review data layer:
     - Schema correctness
     - Query efficiency
     - Data validation`,
  },
  testing: {
    name: 'Test Reviewer',
    focus: `Review test coverage:
     - Key functionality tested
     - Edge cases covered
     - Test quality`,
  },
  infrastructure: {
    name: 'Infrastructure Reviewer',
    focus: `Review infra aspects:
     - Config correctness
     - CI/CD impact
     - Environment handling`,
  },
  documentation: {
    name: 'Documentation Reviewer',
    focus: `Review documentation:
     - API docs if applicable
     - README updates
     - Code comments`,
  },
};

/**
 * Build Stage 2: Streamlined Plan Review prompt for simple changes.
 * Uses reduced iterations (3 instead of 10) and spawns only relevant review agents.
 *
 * @param session - The session containing feature information
 * @param plan - The plan to review
 * @param currentIteration - Current review iteration number
 * @param options - Optional prompt options (useExternalAgents to reduce prompt length)
 */
export function buildStage2PromptStreamlined(
  session: Session,
  plan: Plan,
  currentIteration: number,
  options?: PromptOptions
): string {
  const useExternalAgents = options?.useExternalAgents ?? false;

  const planStepsText =
    plan.steps.length > 0
      ? plan.steps
          .map((step, i) => {
            const parentInfo = step.parentId ? ` (depends on: ${step.parentId})` : '';
            const complexityInfo = (step as { complexity?: string }).complexity
              ? ` [${(step as { complexity?: string }).complexity} complexity]`
              : '';
            return `${i + 1}. [${step.id}] ${step.title}${parentInfo}${complexityInfo}\n   ${step.description || 'No description'}`;
          })
          .join('\n\n')
      : 'No plan steps defined.';

  // Streamlined target: 3 iterations for simple changes
  const targetIterations = 3;

  const planFileReference = session.claudePlanFilePath
    ? `\n\n## Full Plan Reference\nFor complete plan details, read: ${session.claudePlanFilePath}`
    : '';

  // Build validation context section if plan was previously incomplete
  const validationContextSection = session.planValidationContext
    ? `
## ⚠️ Plan Validation Issues (MUST ADDRESS FIRST)
${session.planValidationContext}

---

`
    : '';

  // Build review agents section based on suggestedAgents
  const suggestedAgents = session.suggestedAgents || ['frontend', 'backend'];
  // When using external agents, just reference agent names without full instructions
  const reviewAgentSections = useExternalAgents
    ? suggestedAgents
        .map((agentType, index) => {
          const agent = STAGE2_REVIEW_AGENTS[agentType];
          if (!agent) return null;
          return `   ${index + 1}. **${agent.name}** (${agentType})`;
        })
        .filter(Boolean)
        .join('\n')
    : suggestedAgents
        .map((agentType, index) => {
          const agent = STAGE2_REVIEW_AGENTS[agentType];
          if (!agent) return null;
          return `   ${index + 1}. **${agent.name}**: ${agent.focus}`;
        })
        .filter(Boolean)
        .join('\n\n');

  return `You are reviewing a ${session.assessedComplexity || 'simple'} change. This is a focused review.
${validationContextSection}
## Current Plan (v${plan.planVersion})
${planStepsText}${planFileReference}

## Review Iteration
This is review ${currentIteration} of ${targetIterations} (streamlined for simple changes).

## Instructions

### 1. Spawn Focused Review Agents
Since this is a ${session.assessedComplexity || 'simple'} change, spawn only the relevant review agents:

**Subagent Restrictions:**
- Allowed: Read, Glob, Grep
- NOT allowed: Edit, Write, Bash

${reviewAgentSections}

### 2. Focus on Critical Issues Only
For ${session.assessedComplexity || 'simple'} changes, only flag issues that are:
- **Correctness**: Logic errors, missing edge cases
- **Security**: Obvious vulnerabilities (auth, injection)
- **Plan Completeness**: Missing acceptance criteria mapping

Skip minor style/optimization suggestions for simple changes.

### 3. Present Issues as Decisions
Format critical issues only:
[DECISION_NEEDED priority="1" category="correctness|security|plan_structure"]
Issue: Brief description
- Option A: Fix approach (recommended)
- Option B: Alternative
[/DECISION_NEEDED]

### 4. Quick Approval Path
For simple changes, if no critical issues are found, approve immediately:
[PLAN_APPROVED]`;
}

/**
 * Lean Stage 2 prompt for streamlined review (iterations 2+).
 * Even more concise for simple changes.
 */
export function buildStage2PromptStreamlinedLean(
  plan: Plan,
  currentIteration: number,
  validationContext?: string | null,
  claudePlanFilePath?: string | null,
  assessedComplexity?: string
): string {
  const validation = validationContext
    ? `⚠️ **Fix validation issues:**\n${validationContext}\n\n`
    : '';

  const planFile = claudePlanFilePath ? `Plan: ${claudePlanFilePath}\n` : '';

  return `${validation}${planFile}Continue ${assessedComplexity || 'simple'} review (${currentIteration}/3).

Focus on critical issues only. Minor suggestions can be skipped.
[DECISION_NEEDED] for blockers, [PLAN_APPROVED] when ready.`;
}

/**
 * Build Stage 2: Plan Revision prompt
 * Revises plan based on user feedback.
 * Supports step modifications: add, edit, and remove steps.
 * Uses direct Edit tool modifications instead of marker-based output.
 */
/**
 * Options for building plan revision prompt
 */
export interface PlanRevisionOptions {
  /** Whether this revision is triggered by CI failure */
  isCIFailure?: boolean;
  /** PR URL for CI checks access */
  prUrl?: string | null;
}

export function buildPlanRevisionPrompt(
  session: Session,
  plan: Plan,
  feedback: string,
  options?: PlanRevisionOptions
): string {
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

  // Get the plan.json path from the plan.md path
  const planJsonPath = session.claudePlanFilePath
    ? session.claudePlanFilePath.replace(/plan\.md$/, 'plan.json')
    : null;

  // Build composable plan structure documentation (matches buildStage2Prompt)
  const composablePlanDocs = `
## Plan File Structure Reference
The plan.md file uses these structured markers:

### Plan Steps Format
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

### Other Plan Sections
- \`[PLAN_META]\` - Plan metadata (version, isApproved)
- \`[PLAN_DEPENDENCIES]\` - Step and external dependencies
- \`[PLAN_TEST_COVERAGE]\` - Testing requirements
- \`[PLAN_ACCEPTANCE_MAPPING]\` - Link acceptance criteria to steps
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

You can **add**, **edit**, or **remove** steps based on the feedback using the Edit tool directly.

### Workflow (IMPORTANT - Use Edit Tool Directly)
1. **Read** the current plan file: ${session.claudePlanFilePath}
2. **Analyze** the user feedback and determine what changes are needed
3. **Use the Edit tool** to modify plan.md directly:
   - To add a step: Insert a new \`[PLAN_STEP]\` block in the appropriate location
   - To edit a step: Modify the existing \`[PLAN_STEP]\` block content
   - To remove a step: Delete the entire \`[PLAN_STEP]\` block
4. **Update plan.json** (${planJsonPath || 'same directory as plan.md'}) to reflect your changes:
   - Add/modify/remove entries in the "steps" array
   - Each step should have: id, parentId, orderIndex, title, description, status, metadata, complexity
5. If clarification is needed, ask questions using DECISION_NEEDED markers first
6. Continue with Stage 2 review process

### Step Structure for plan.md
When adding or editing steps in plan.md, use this format:
\`\`\`
[PLAN_STEP id="step-X" parent="null|step-Y" status="pending" complexity="low|medium|high"]
Step Title
Detailed description with at least 50 characters of implementation guidance.
[/PLAN_STEP]
\`\`\`

### Step Structure for plan.json
When updating plan.json, each step should have this structure:
\`\`\`json
{
  "id": "step-X",
  "parentId": null,
  "orderIndex": 0,
  "title": "Step Title",
  "description": "Detailed description...",
  "status": "pending",
  "metadata": {},
  "complexity": "medium"
}
\`\`\`

### Important Notes
- **Use unique IDs** for new steps (e.g., "step-new-1", "step-7")
- **Update orderIndex** values to maintain proper sequence
- **Update parentId references** if removing a parent step
- **Child steps** that reference a removed parent should either be removed or have their parentId updated
- **Always keep both files in sync** - plan.md and plan.json must match

### Clarifying Questions
If you need clarification before making modifications, ask first:
\`\`\`
[DECISION_NEEDED priority="1" category="scope"]
Question about the feedback to clarify before modifying the plan...

- Option A: Interpretation 1 (recommended)
- Option B: Interpretation 2
[/DECISION_NEEDED]
\`\`\`
${options?.isCIFailure ? buildCITroubleshootingSection(options.prUrl) : ''}
The system will automatically detect changes to the plan files and process them accordingly.`;
}

/**
 * Build CI troubleshooting section for plan revision prompt
 */
function buildCITroubleshootingSection(prUrl?: string | null): string {
  const prNumber = prUrl?.split('/').pop() || '';
  const ghChecksCommand = prUrl
    ? `gh pr checks ${prNumber}`
    : 'gh pr checks <pr-number>';
  const ghViewCommand = prUrl
    ? `gh pr view ${prNumber}`
    : 'gh pr view <pr-number>';

  return `
## CI Failure Troubleshooting

**IMPORTANT:** CI checks have failed. Before modifying the plan, investigate the actual failures.

### Step 1: Read CI Check Results
Run the following command to see CI check status and failure details:
\`\`\`bash
${ghChecksCommand}
\`\`\`

### Step 2: Get Failure Details
For failed checks, view the logs to understand what went wrong:
\`\`\`bash
gh run view <run-id> --log-failed
\`\`\`

### Step 3: Determine the Fix
Based on the CI failure, decide:
1. **Plan needs changes** - If the implementation approach is wrong, modify the plan steps
2. **Implementation needs fixes** - If the plan is correct but implementation has bugs:
   - Set the affected step(s) status to "pending" in plan.json
   - Clear the step's contentHash field (set to null) to force re-implementation
   - Do NOT change the step's title/description unless the approach itself was wrong

### Step 4: Mark Steps for Re-implementation
If a step needs re-implementation (not plan changes), update plan.json:
\`\`\`json
{
  "id": "step-X",
  "status": "pending",
  "contentHash": null,
  ...
}
\`\`\`

### PR Reference
${prUrl ? `PR URL: ${prUrl}` : 'PR URL not available - use gh pr list to find it'}
`;
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
2. Use the Edit tool to write the plan to: ${claudePlanFilePath || '/path/to/plan.md'}`;
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
  // Filter out completed steps to reduce token usage
  const pendingSteps = plan.steps.filter(step => step.status !== 'completed');
  const completedCount = plan.steps.length - pendingSteps.length;

  const planStepsText = pendingSteps.map((step, i) => {
    const parentInfo = step.parentId ? ` (depends on: ${step.parentId})` : '';
    return `### Step ${i + 1}: [${step.id}] ${step.title}${parentInfo}
${step.description || 'No description provided.'}`;
  }).join('\n\n');

  const completedNote = completedCount > 0
    ? `\n(${completedCount} step${completedCount > 1 ? 's' : ''} already completed, not shown)`
    : '';

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

## Approved Plan (${pendingSteps.length} remaining of ${plan.steps.length} total)${completedNote}
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
${testsRequired ? '5. Always run tests before marking a step complete' : '5. Run existing tests to ensure no regressions'}
6. **NEVER run commands that block waiting for user input** (e.g., watch modes, interactive prompts, REPLs). Always use flags like \`--run\`, \`--no-watch\`, \`--non-interactive\`, \`-y\`, or \`--ci\` when available.`;
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
4. Output IMPLEMENTATION_STATUS regularly for real-time progress
5. **NEVER run commands that block waiting for user input** (e.g., watch modes, interactive prompts, REPLs). Always use flags like \`--run\`, \`--no-watch\`, \`--non-interactive\`, \`-y\`, or \`--ci\` when available.`;
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

  return `You are reviewing a pull request.

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

### Phase 1: Parallel Review
Spawn these review agents in parallel (READ-ONLY tools only):

1. **Code Agent**: \`git diff main...HEAD\` - check logic, error handling, edge cases
2. **Security Agent**: Check auth, injection, XSS, input validation, secrets
3. **Test Agent**: Verify new code has tests, edge cases covered
4. **Integration Agent**: Check API contracts, types, error handling

Also run: \`gh pr checks ${prInfo.url.split('/').pop()} --watch\`

### Phase 2: Document Findings
For issues, add plan steps to ${session.claudePlanFilePath || 'plan.md'}:

\`\`\`
[PLAN_STEP id="step-N" parent="null" status="pending"]
Fix: [Brief title]
[Priority X] [file.ts:line] Description and fix approach.
[/PLAN_STEP]
\`\`\`

### Phase 3: Decision
- **CI failing:** Add fix steps, then \`[CI_FAILED]\`
- **Issues found:** Add fix steps. System auto-returns to Stage 2.
- **All good:** \`[PR_APPROVED]\`

### Rules
- Review as if you didn't write the code
- Only approve when CI passes AND no issues`;
}

/**
 * Review agent definitions for streamlined Stage 5.
 * Maps agent type to focused review instructions for simple changes.
 *
 * NOTE: When useExternalAgents is true, these instructions are provided via
 * the --agents CLI flag (see STAGE_AGENTS in ClaudeOrchestrator.ts).
 * The prompt will reference agent names only without embedding full instructions.
 */
const STAGE5_REVIEW_AGENTS: Record<string, { name: string; focus: string }> = {
  frontend: {
    name: 'Frontend Reviewer',
    focus: `Review UI changes:
   - git diff main...HEAD -- '*.tsx' '*.ts' '*.css' (client paths)
   - Correctness: Component logic, state handling
   - Basic security: XSS risks, input sanitization
   - Output: List of UI issues with file:line refs`,
  },
  backend: {
    name: 'Backend Reviewer',
    focus: `Review API changes:
   - git diff main...HEAD -- (server paths)
   - Correctness: Endpoint logic, error handling
   - Basic security: Auth checks, input validation
   - Output: List of backend issues with file:line refs`,
  },
  database: {
    name: 'Database Reviewer',
    focus: `Review data layer:
   - git diff main...HEAD -- (schema/migration paths)
   - Schema correctness, migration safety
   - Output: List of data issues with file:line refs`,
  },
  testing: {
    name: 'Test Reviewer',
    focus: `Verify test coverage:
   - Find test files matching changed source files
   - Check: New code has tests
   - Output: List of untested code paths`,
  },
  infrastructure: {
    name: 'CI Reviewer',
    focus: `Check CI status:
   - Run: gh pr checks --watch
   - Output: Final status (passing/failing)`,
  },
  documentation: {
    name: 'Docs Reviewer',
    focus: `Review documentation changes:
   - Check: README updates, API docs
   - Verify: Docs match implementation
   - Output: Documentation gaps`,
  },
};

/**
 * Build Stage 5: Streamlined PR Review prompt for simple changes.
 * Uses fewer review agents and focused review criteria.
 *
 * @param session - The session containing feature information
 * @param plan - The implementation plan
 * @param prInfo - Pull request information (title, branch, url)
 * @param options - Optional prompt options (useExternalAgents to reduce prompt length)
 */
export function buildStage5PromptStreamlined(
  session: Session,
  plan: Plan,
  prInfo: { title: string; branch: string; url: string },
  options?: PromptOptions
): string {
  const useExternalAgents = options?.useExternalAgents ?? false;

  // Sanitize user-provided fields to prevent marker injection
  const sanitized = sanitizeSessionFields(session);

  const planStepsText = plan.steps
    .map((step, i) => {
      return `${i + 1}. [${step.id}] ${step.title}`;
    })
    .join('\n');

  // Build review agents section based on suggestedAgents + always include CI
  const suggestedAgents = session.suggestedAgents || ['frontend', 'backend'];
  // Ensure CI/infrastructure is always included
  const agentsToUse = [...new Set([...suggestedAgents, 'infrastructure'])];

  // When using external agents, just reference agent names without full instructions
  const reviewAgentSections = useExternalAgents
    ? agentsToUse
        .map((agentType, index) => {
          const agent = STAGE5_REVIEW_AGENTS[agentType];
          if (!agent) return null;
          return `${index + 1}. **${agent.name}** (${agentType})`;
        })
        .filter(Boolean)
        .join('\n')
    : agentsToUse
        .map((agentType, index) => {
          const agent = STAGE5_REVIEW_AGENTS[agentType];
          if (!agent) return null;
          return `${index + 1}. **${agent.name}**: ${agent.focus}`;
        })
        .filter(Boolean)
        .join('\n\n');

  // Get the plan.json path from the plan.md path
  const planJsonPath = session.claudePlanFilePath
    ? session.claudePlanFilePath.replace(/plan\.md$/, 'plan.json')
    : null;

  return `You are reviewing a ${session.assessedComplexity || 'simple'} change PR. This is a focused review.

## Feature
Title: ${sanitized.title}
Description: ${sanitized.featureDescription}

## Plan Summary
${planStepsText}

## Pull Request
URL: ${prInfo.url}
Branch: ${prInfo.branch}

## Instructions

### Phase 1: Focused Review
Since this is a ${session.assessedComplexity || 'simple'} change, spawn only these review agents:

**Subagent Restrictions:**
- Allowed: Read, Glob, Grep, Bash (read-only: git diff, git log, gh pr checks)
- NOT allowed: Edit, Write, Bash with modifications

${reviewAgentSections}

Wait for all agents to complete.

### Phase 2: Quick Findings Summary
\`\`\`
[REVIEW_CHECKPOINT]
### Critical Issues (if any)
- [file.ts:line] Issue description

### No Issues Found
All review agents found no significant issues.
[/REVIEW_CHECKPOINT]
\`\`\`

### Phase 3: CI Status
\`\`\`
[CI_STATUS status="passing|failing|pending"]
Check Status Summary
[/CI_STATUS]
\`\`\`

### Phase 4: Document Findings (if any)
If issues found, add as plan steps in:
- ${session.claudePlanFilePath || '~/.claude-web/<session>/plan.md'}
- ${planJsonPath || 'same directory as plan.json'}

Format:
\`\`\`
[PLAN_STEP id="step-N" parent="null" status="pending" complexity="low"]
Fix: [Issue title]
[file.ts:line] Description of what needs fixing.
[/PLAN_STEP]
\`\`\`

### Phase 5: Decision
**If CI failing:** [CI_FAILED] with failure details
**If issues found:** Add plan steps (system auto-returns to Stage 2)
**If all good:** [PR_APPROVED] - ready to merge`;
}

/**
 * Lean Stage 5 prompt for streamlined review.
 * Very concise for simple changes.
 */
export function buildStage5PromptStreamlinedLean(
  prInfo: { title: string; url: string },
  assessedComplexity?: string
): string {
  return `${assessedComplexity || 'Simple'} PR review: ${prInfo.url}
Title: ${prInfo.title}

1. Spawn focused review agents (skip extensive security/perf review)
2. Check CI: gh pr checks
3. Critical issues → add [PLAN_STEP]
4. CI failing → [CI_FAILED]
5. All good → [PR_APPROVED]`;
}

// ============================================================================
// LEAN PROMPTS - For subsequent calls that leverage --resume context
// ============================================================================

/**
 * Lean plan revision prompt for when returning from Stage 3+ with --resume.
 * Claude already knows all the context from previous stages.
 *
 * @param feedback - The reason for returning to Stage 2 (e.g., step failure, CI failure)
 * @param claudePlanFilePath - Optional path to the plan.md file
 * @param options - Additional context options
 */
export function buildPlanRevisionPromptLean(
  feedback: string,
  claudePlanFilePath?: string | null,
  options?: {
    isCIFailure?: boolean;
    prUrl?: string | null;
    failedStepId?: string;
  }
): string {
  const planFile = claudePlanFilePath
    ? `Plan file: ${claudePlanFilePath}\n\n`
    : '';

  const ciContext = options?.isCIFailure && options?.prUrl
    ? `Use \`gh pr checks ${options.prUrl}\` and \`gh run view\` to investigate.\n\n`
    : '';

  const stepContext = options?.failedStepId
    ? `Failed step: ${options.failedStepId}\n\n`
    : '';

  return `${planFile}${stepContext}${ciContext}**Returning to plan review:** ${feedback}

Review and revise the plan as needed:
1. Use the Edit tool to modify plan.md directly
2. Update plan.json to match
3. Ask [DECISION_NEEDED] questions if clarification is needed
4. Output [PLAN_APPROVED] when the plan is ready for implementation`;
}

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
 * Continuation prompt for iterative plan reviews.
 * Used when continuing review after [PLAN_APPROVED] with pending [DECISION_NEEDED] markers.
 *
 * @param currentIteration - Current iteration number (1-based, after increment)
 * @param maxIterations - Maximum allowed iterations (default 10)
 * @param claudePlanFilePath - Optional path to the plan.md file
 * @param pendingDecisionCount - Number of DECISION_NEEDED markers from last iteration
 */
export function buildPlanReviewContinuationPrompt(
  currentIteration: number,
  maxIterations: number = 10,
  claudePlanFilePath?: string | null,
  pendingDecisionCount?: number
): string {
  const remainingIterations = maxIterations - currentIteration;
  const planFile = claudePlanFilePath
    ? `Plan file: ${claudePlanFilePath}\n\n`
    : '';

  const decisionContext = pendingDecisionCount !== undefined && pendingDecisionCount > 0
    ? `You raised ${pendingDecisionCount} question(s) in the previous iteration that need user input.\n\n`
    : '';

  const urgencyNote = remainingIterations <= 2
    ? `⚠️ Only ${remainingIterations} iteration(s) remaining before forced approval.\n\n`
    : '';

  return `${planFile}${decisionContext}${urgencyNote}Continue plan review (iteration ${currentIteration}/${maxIterations}).

Review the plan for any remaining issues or clarifications needed.

**Important:** To complete the review:
- If you have questions requiring user decisions, output [DECISION_NEEDED] markers
- If the plan is complete and ready for implementation, output [PLAN_APPROVED] with NO [DECISION_NEEDED] markers

The review will continue until either:
1. You output [PLAN_APPROVED] with no [DECISION_NEEDED] markers, OR
2. Maximum iterations (${maxIterations}) is reached`;
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
 * Uses [PLAN_STEP] for findings to trigger auto-return to Stage 2.
 */
export function buildStage5PromptLean(
  prInfo: { title: string; url: string }
): string {
  const prNumber = prInfo.url.split('/').pop() || '';
  return `Review PR: ${prInfo.title}

1. Spawn parallel agents: Code, Security, Test, Integration
2. Check CI: gh pr checks ${prNumber} --watch
3. Findings → add [PLAN_STEP] markers
4. CI failing → [CI_FAILED]
5. All good → [PR_APPROVED]`;
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

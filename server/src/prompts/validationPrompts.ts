import type { Plan, Session, UserPreferences, AcceptanceCriterion } from '@claude-code-web/shared';
import type { ParsedDecision } from '../services/OutputParser';

/**
 * Get human-readable description for risk comfort level
 */
function getRiskDescription(level: UserPreferences['riskComfort']): string {
  switch (level) {
    case 'low': return 'prefers conservative, well-tested approaches';
    case 'medium': return 'balanced approach to risk';
    case 'high': return 'comfortable with experimental approaches';
  }
}

/**
 * Get human-readable description for scope flexibility
 */
function getScopeDescription(level: UserPreferences['scopeFlexibility']): string {
  switch (level) {
    case 'fixed': return 'wants only what was explicitly requested';
    case 'flexible': return 'open to minor improvements if clearly beneficial';
    case 'open': return 'welcomes suggestions for improvements and polish';
  }
}

/**
 * Get human-readable description for detail level
 */
function getDetailDescription(level: UserPreferences['detailLevel']): string {
  switch (level) {
    case 'minimal': return 'only surface critical issues';
    case 'standard': return 'surface important issues';
    case 'detailed': return 'surface most issues for thoroughness';
  }
}

/**
 * Get human-readable description for autonomy level
 */
function getAutonomyDescription(level: UserPreferences['autonomyLevel']): string {
  switch (level) {
    case 'guided': return 'prefers to be consulted on most decisions';
    case 'collaborative': return 'balanced between autonomy and consultation';
    case 'autonomous': return 'prefers Claude to make reasonable decisions independently';
  }
}

/**
 * Build validation prompt for Haiku to verify a decision against plan + codebase.
 * Per README lines 1461-1516 (Decision Validation LLM Post-Processing).
 *
 * The validation subagent:
 * 1. Reads the current plan to understand intended implementation
 * 2. Reads relevant code to verify actual implementation
 * 3. Compares plan intent vs code reality
 * 4. Returns action: "pass" | "filter" | "repurpose"
 */
export function buildDecisionValidationPrompt(
  decision: ParsedDecision,
  plan: Plan,
  preferences?: UserPreferences
): string {
  const planStepsText = plan.steps.length > 0
    ? plan.steps.map((step, i) => {
        const statusIcon = {
          pending: '[ ]',
          in_progress: '[~]',
          completed: '[x]',
          blocked: '[!]',
          skipped: '[-]',
          needs_review: '[?]',
        }[step.status] || '[ ]';
        return `${i + 1}. ${statusIcon} ${step.title}\n   ${step.description || 'No description'}`;
      }).join('\n\n')
    : 'No plan steps defined yet.';

  const fileContext = decision.file
    ? `\nReferenced File: ${decision.file}${decision.line ? `:${decision.line}` : ''}`
    : '';

  // Build preferences section if provided
  const preferencesSection = preferences ? `
## User Preferences
- Risk Comfort: ${preferences.riskComfort} (${getRiskDescription(preferences.riskComfort)})
- Speed vs Quality: ${preferences.speedVsQuality}
- Scope Flexibility: ${preferences.scopeFlexibility} (${getScopeDescription(preferences.scopeFlexibility)})
- Detail Level: ${preferences.detailLevel} (${getDetailDescription(preferences.detailLevel)})
- Autonomy Level: ${preferences.autonomyLevel} (${getAutonomyDescription(preferences.autonomyLevel)})
` : '';

  // Build preference-based filtering rules if preferences provided
  const preferenceRules = preferences ? `
## Preference-Based Filtering Rules
Apply these rules based on user preferences:

**Scope Flexibility (${preferences.scopeFlexibility}):**
${preferences.scopeFlexibility === 'fixed'
    ? '- FILTER scope expansion questions unless they are critical to the core request\n- FILTER "nice to have" or "polish" suggestions\n- Only PASS scope questions that affect the explicit requirements'
    : preferences.scopeFlexibility === 'flexible'
    ? '- PASS scope questions if they provide clear benefit\n- FILTER minor polish suggestions unless low-effort\n- Use judgment on scope expansion questions'
    : '- PASS scope expansion questions - user welcomes suggestions\n- PASS polish and improvement questions\n- Only FILTER if truly irrelevant to the work'}

**Detail Level (${preferences.detailLevel}):**
${preferences.detailLevel === 'minimal'
    ? '- FILTER priority 3 (low priority) questions\n- Only PASS priority 1-2 questions\n- Keep questions focused on critical issues'
    : preferences.detailLevel === 'standard'
    ? '- PASS priority 1-2 questions\n- Use judgment on priority 3 questions based on relevance\n- Balance thoroughness with efficiency'
    : '- PASS most questions across all priority levels\n- Only FILTER if clearly redundant or already addressed\n- User prefers thorough coverage'}

**Risk Comfort (${preferences.riskComfort}):**
${preferences.riskComfort === 'low'
    ? '- PASS questions about risky trade-offs or experimental approaches\n- PASS questions about potential edge cases or failure modes\n- User prefers to be consulted on anything uncertain'
    : preferences.riskComfort === 'medium'
    ? '- Use judgment on risk-related questions\n- PASS for significant risks, FILTER for minor uncertainties'
    : '- FILTER minor risk-related questions\n- Only PASS for major architectural risks\n- User is comfortable with experimental approaches'}

**Autonomy Level (${preferences.autonomyLevel}):**
${preferences.autonomyLevel === 'guided'
    ? '- PASS most implementation detail questions\n- User prefers to be involved in decisions\n- Only FILTER clearly trivial choices'
    : preferences.autonomyLevel === 'collaborative'
    ? '- PASS significant implementation questions\n- FILTER minor implementation details Claude can decide\n- Balance user involvement with efficiency'
    : '- FILTER minor implementation detail questions\n- Only PASS questions that significantly affect the outcome\n- User trusts Claude to make reasonable decisions'}

**Speed vs Quality (${preferences.speedVsQuality}):**
${preferences.speedVsQuality === 'speed'
    ? '- FILTER questions about optimization, refactoring, or code cleanup\n- FILTER suggestions for additional testing beyond core functionality\n- PASS only questions critical to getting the feature working\n- User prioritizes delivery speed over polish'
    : preferences.speedVsQuality === 'balanced'
    ? '- Use judgment on optimization and cleanup questions\n- PASS questions about important quality considerations\n- FILTER purely cosmetic or over-engineering suggestions'
    : '- PASS questions about code quality, testing, and best practices\n- PASS suggestions for refactoring or optimization\n- User values thoroughness and maintainability over speed'}
` : '';

  return `Investigate this concern and determine how to handle it.

## Current Implementation Plan
${planStepsText}
${preferencesSection}
## Concern Details
Category: ${decision.category}
Priority: ${decision.priority}${fileContext}

Concern:
${decision.questionText}

Options provided:
${decision.options.map(o => `- ${o.label}${o.recommended ? ' (recommended)' : ''}`).join('\n')}

## Instructions

1. **Check the Plan**: Is this concern already addressed in a current or future plan step?
2. **Check the Codebase** (if file is referenced): Read the file to see if solution exists
3. **Consider User Preferences**: Apply preference-based filtering rules if provided
4. **Decide the action**:
   - **pass**: Concern is valid and needs user input - pass through as-is
   - **filter**: Concern is fully addressed in plan/code OR filtered by user preferences
   - **repurpose**: Concern is semi-valid but question is wrong/incomplete - transform into better question(s)
${preferenceRules}
## Response Format (JSON only)

**If valid - pass through:**
{"action": "pass", "reason": "Why this needs user input"}

**If fully addressed - filter out:**
{"action": "filter", "reason": "Already in plan step X / Already implemented in Y"}

**If filtered by preference - filter out:**
{"action": "filter", "reason": "Filtered: [preference reason, e.g., 'low-priority question with minimal detail level']"}

**If semi-valid - repurpose into better question(s):**
{"action": "repurpose", "reason": "Why original question was incomplete", "questions": [
  {
    "questionText": "The better/refined question to ask",
    "category": "technical|design|scope|approach",
    "priority": 1-3,
    "options": [
      {"label": "Option A", "recommended": true},
      {"label": "Option B", "recommended": false}
    ]
  }
]}

## When to Repurpose
- The concern has merit but the question is poorly framed
- The question asks about something already decided, but a related aspect is unclear
- Multiple smaller questions would be more actionable than one vague question
- The options provided don't capture the real choices

## Rules
- Only use "filter" if you can CONFIRM the concern is fully addressed OR it matches preference-based filtering
- Use "repurpose" when the underlying concern is valid but question needs refinement
- When in doubt, use "pass" - it's better to ask than to miss an issue
- Keep repurposed questions focused and actionable
- Preserve the original priority unless you have reason to change it`;
}

/**
 * Build prompt for Haiku to assess whether a plan requires tests.
 * Called after plan approval, before Stage 3 execution.
 */
export function buildTestRequirementPrompt(session: Session, plan: Plan): string {
  const planStepsText = plan.steps.map((step, i) =>
    `${i + 1}. ${step.title}\n   ${step.description || 'No description'}`
  ).join('\n\n');

  return `Assess whether this implementation plan requires automated tests.

## Feature
Title: ${session.title}
Description: ${session.featureDescription}

## Implementation Plan
${planStepsText}

## Instructions

1. **Analyze the plan**: What type of changes are being made?
2. **Check the codebase**: Is there existing test infrastructure? (look for test files, jest.config, etc.)
3. **Determine if tests are needed** based on the criteria below

## Test Requirement Criteria

**Tests ARE required for:**
- New API endpoints or backend logic
- Database operations or migrations
- Business logic or calculations
- Authentication/authorization changes
- Data transformations or validations
- Any code that could have bugs with real consequences

**Tests are NOT required for:**
- Documentation updates (README, comments, docs)
- Configuration file changes
- Pure styling/CSS changes
- Simple text or copy changes
- Prototype/exploratory code explicitly marked as such
- Build/tooling configuration

## Response Format (JSON only)

{
  "required": true | false,
  "reason": "Brief explanation of why tests are/aren't needed",
  "testTypes": ["unit", "integration", "e2e"],  // empty array if not required
  "existingFramework": "jest" | "vitest" | "mocha" | null,
  "suggestedCoverage": "Brief description of what should be tested"
}

## Examples

**API endpoint addition:**
{"required": true, "reason": "New API endpoints need integration tests", "testTypes": ["unit", "integration"], "existingFramework": "jest", "suggestedCoverage": "Test request/response handling, error cases, auth"}

**README update:**
{"required": false, "reason": "Documentation changes don't require tests", "testTypes": [], "existingFramework": null, "suggestedCoverage": ""}

**CSS refactor:**
{"required": false, "reason": "Pure styling changes don't require automated tests", "testTypes": [], "existingFramework": null, "suggestedCoverage": ""}

## Rules
- Err on the side of requiring tests for anything involving logic
- Check for existing test patterns in the codebase
- Consider the complexity and risk of the changes`;
}

/**
 * Build prompt for Haiku to identify which plan steps are incomplete
 * based on CI failures or review issues from Stage 5.
 */
export function buildIncompleteStepsPrompt(plan: Plan, issueReason: string): string {
  const planStepsText = plan.steps.map((step, i) =>
    `${i + 1}. [${step.id}] ${step.title} (status: ${step.status})\n   ${step.description || 'No description'}`
  ).join('\n\n');

  return `Analyze CI/review issues and identify which plan steps are incomplete or need revision.

## Implementation Plan
${planStepsText}

## CI/Review Issues
${issueReason}

## Instructions

1. **Analyze the issues**: What specifically failed or needs fixing?
2. **Map to plan steps**: Which steps are affected by these issues?
3. **Determine status**: For each step, decide if it needs revision

## Response Format (JSON only)

{
  "affectedSteps": [
    {
      "stepId": "step-1",
      "status": "needs_review" | "pending",
      "reason": "Brief explanation of why this step is affected"
    }
  ],
  "unaffectedSteps": ["step-2", "step-3"],
  "summary": "Brief summary of what needs to be fixed"
}

## Status Meanings
- **needs_review**: Step was completed but has issues that need fixing
- **pending**: Step needs to be re-implemented from scratch
- Keep as **completed** if step is not affected by the issues

## Rules
- Only mark steps as affected if they are DIRECTLY related to the issues
- If unsure, mark as "needs_review" (safer than leaving as completed)
- Be specific about why each step is affected
- Consider dependencies - if step A affects step B, both may need review`;
}

/**
 * Build prompt for Haiku to assess the complexity of a feature request.
 * Called at session creation/edit time, before queueing.
 *
 * Complexity levels:
 * - trivial: Single-line changes, typo fixes, config tweaks
 * - simple: Localized changes (e.g., frontend label change, single file modification)
 * - normal: Standard features requiring multiple files/components
 * - complex: Large features, architectural changes, cross-cutting concerns
 */
export function buildComplexityAssessmentPrompt(
  title: string,
  description: string,
  acceptanceCriteria: AcceptanceCriterion[]
): string {
  const criteriaText = acceptanceCriteria.length > 0
    ? acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac.text}`).join('\n')
    : 'No acceptance criteria specified.';

  return `Classify the complexity of this feature request to optimize stage execution.

## Feature Request
Title: ${title}
Description: ${description}

## Acceptance Criteria
${criteriaText}

## Instructions

1. **Analyze the scope**: What changes are being requested?
2. **Identify affected areas**: Which parts of the codebase will be touched?
3. **Determine complexity**: Based on the criteria below, classify the complexity level

## Complexity Levels

**trivial**: Single-line changes, typo fixes, config value tweaks
- Examples: Fix a typo in a string, update a version number, change a constant value
- Expected file count: 1 file, 1-5 lines changed
- Suggested agents: Usually just the most relevant one (e.g., Frontend, Backend, or Docs)

**simple**: Localized changes that don't require architectural understanding
- Examples: Change a button label, update color/styling, add a simple validation message
- Expected file count: 1-3 files, < 50 lines changed
- Suggested agents: 1-2 relevant agents (e.g., Frontend + CI Agent for UI changes)

**normal**: Standard features requiring understanding of multiple components
- Examples: Add a new API endpoint, implement a form with validation, add a new page/route
- Expected file count: 3-10 files, < 500 lines changed
- Suggested agents: 3-4 agents based on feature scope

**complex**: Large features, architectural changes, or cross-cutting concerns
- Examples: Add authentication system, refactor database schema, implement real-time features
- Expected file count: 10+ files, 500+ lines changed
- Suggested agents: All 6 agents (full exploration needed)

## Agent Types
Available agents for suggestion:
- "frontend": UI components, client-side logic, styling
- "backend": API endpoints, server logic, services
- "database": Schema changes, migrations, queries
- "testing": Test files, test utilities
- "infrastructure": CI/CD, deployment, config files
- "documentation": README, docs, comments

## Response Format (JSON only)

{
  "complexity": "trivial" | "simple" | "normal" | "complex",
  "reason": "Brief explanation of why this complexity level was chosen",
  "suggestedAgents": ["frontend", "testing"],
  "useLeanPrompts": true | false
}

## Rules
- Err on the side of higher complexity if unsure (better to be thorough than miss something)
- For trivial/simple: suggest only 1-2 most relevant agents
- For normal: suggest 3-4 agents based on the specific feature
- For complex: suggest all 6 agents
- useLeanPrompts should be true for trivial/simple, false for normal/complex
- Consider the acceptance criteria - more criteria usually means higher complexity`;
}

import type { Plan, Session } from '@claude-code-web/shared';
import type { ParsedDecision } from '../services/OutputParser';

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
  plan: Plan
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

  return `Investigate this concern and determine how to handle it.

## Current Implementation Plan
${planStepsText}

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
3. **Decide the action**:
   - **pass**: Concern is valid and needs user input - pass through as-is
   - **filter**: Concern is fully addressed in plan or code - remove entirely
   - **repurpose**: Concern is semi-valid but question is wrong/incomplete - transform into better question(s)

## Response Format (JSON only)

**If valid - pass through:**
{"action": "pass", "reason": "Why this needs user input"}

**If fully addressed - filter out:**
{"action": "filter", "reason": "Already in plan step X / Already implemented in Y"}

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
- Only use "filter" if you can CONFIRM the concern is fully addressed
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

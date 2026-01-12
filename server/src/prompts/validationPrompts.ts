import type { Plan } from '@claude-code-web/shared';
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

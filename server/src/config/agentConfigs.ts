/**
 * Agent configuration factory functions for each stage.
 *
 * These functions generate stage-specific agent configurations that can be
 * passed to the Claude CLI via the --agents flag. They support filtering
 * based on session.suggestedAgents to include only relevant agents.
 */

import type { AgentsJson } from './agentSchema';
import { STAGE_AGENTS } from '../services/ClaudeOrchestrator';

/**
 * Valid agent types that can be suggested for a session.
 */
export const VALID_AGENT_TYPES = [
  'frontend',
  'backend',
  'database',
  'testing',
  'infrastructure',
  'documentation',
] as const;

export type AgentType = (typeof VALID_AGENT_TYPES)[number];

/**
 * Filter agents by the suggested agent types.
 * If no filter is provided, returns all agents for the stage.
 *
 * @param stageAgents - The full set of agents for a stage
 * @param suggestedAgents - Optional array of agent types to include
 * @returns Filtered agents object, or undefined if no matching agents
 */
function filterAgentsByType(
  stageAgents: Record<string, any>,
  suggestedAgents?: string[]
): AgentsJson | undefined {
  // If no filter provided, return all agents
  if (!suggestedAgents || suggestedAgents.length === 0) {
    return stageAgents;
  }

  // Filter to only requested agent types
  const filtered: AgentsJson = {};
  for (const agentType of suggestedAgents) {
    if (stageAgents[agentType]) {
      filtered[agentType] = stageAgents[agentType];
    }
  }

  // Return undefined if no matching agents found
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

/**
 * Get Stage 1 exploration agents.
 *
 * Stage 1 agents are used during the Discovery phase to explore the codebase.
 * They have read-only access (Read, Glob, Grep) and use Haiku model for cost efficiency.
 *
 * @param suggestedAgents - Optional array of agent types to include (e.g., ['frontend', 'backend'])
 * @returns AgentsJson object ready for CLI serialization, or undefined if no agents
 */
export function getStage1ExplorationAgents(suggestedAgents?: string[]): AgentsJson | undefined {
  const stageAgents = STAGE_AGENTS[1];
  if (!stageAgents) {
    return undefined;
  }
  return filterAgentsByType(stageAgents, suggestedAgents);
}

/**
 * Get Stage 2 plan review agents.
 *
 * Stage 2 agents are used during the Plan Review phase to validate the implementation plan.
 * They have read-only access (Read, Glob, Grep) and use Haiku model for cost efficiency.
 *
 * @param suggestedAgents - Optional array of agent types to include (e.g., ['frontend', 'backend'])
 * @returns AgentsJson object ready for CLI serialization, or undefined if no agents
 */
export function getStage2ReviewAgents(suggestedAgents?: string[]): AgentsJson | undefined {
  const stageAgents = STAGE_AGENTS[2];
  if (!stageAgents) {
    return undefined;
  }
  return filterAgentsByType(stageAgents, suggestedAgents);
}

/**
 * Get Stage 5 PR review agents.
 *
 * Stage 5 agents are used during the PR Review phase to validate the pull request.
 * They have read-only access plus limited git diff and gh pr access for review.
 * All use Haiku model for cost efficiency.
 *
 * @param suggestedAgents - Optional array of agent types to include (e.g., ['frontend', 'backend'])
 * @returns AgentsJson object ready for CLI serialization, or undefined if no agents
 */
export function getStage5PRReviewAgents(suggestedAgents?: string[]): AgentsJson | undefined {
  const stageAgents = STAGE_AGENTS[5];
  if (!stageAgents) {
    return undefined;
  }
  return filterAgentsByType(stageAgents, suggestedAgents);
}

/**
 * Get agents for any stage by stage number.
 *
 * This is a convenience function that delegates to the appropriate stage-specific function.
 * Returns undefined for stages that don't use agents (Stage 3, 4).
 *
 * @param stage - The stage number (1, 2, 3, 4, or 5)
 * @param suggestedAgents - Optional array of agent types to include
 * @returns AgentsJson object ready for CLI serialization, or undefined if no agents
 */
export function getStageAgents(stage: number, suggestedAgents?: string[]): AgentsJson | undefined {
  switch (stage) {
    case 1:
      return getStage1ExplorationAgents(suggestedAgents);
    case 2:
      return getStage2ReviewAgents(suggestedAgents);
    case 5:
      return getStage5PRReviewAgents(suggestedAgents);
    default:
      // Stages 3 and 4 don't use subagents
      return undefined;
  }
}

/**
 * Validate that suggested agent types are valid.
 *
 * @param suggestedAgents - Array of agent type strings to validate
 * @returns Object with valid and invalid agent types
 */
export function validateSuggestedAgents(suggestedAgents: string[]): {
  valid: AgentType[];
  invalid: string[];
} {
  const valid: AgentType[] = [];
  const invalid: string[] = [];

  for (const agent of suggestedAgents) {
    if (VALID_AGENT_TYPES.includes(agent as AgentType)) {
      valid.push(agent as AgentType);
    } else {
      invalid.push(agent);
    }
  }

  return { valid, invalid };
}

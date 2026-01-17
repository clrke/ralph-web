/**
 * Claude CLI --agents flag schema definitions and validation utilities.
 *
 * This module defines the TypeScript interfaces and Zod schemas for the
 * --agents CLI flag used to define custom subagents in Claude Code.
 *
 * See AGENTS_CLI_SCHEMA.md for full documentation.
 */

import { z } from 'zod';

/**
 * Valid model values for agent configuration.
 * - haiku: Fastest, most cost-effective (recommended for exploration/review)
 * - sonnet: Balanced performance and cost (default)
 * - opus: Most capable, highest cost
 * - inherit: Use the same model as the parent conversation
 */
export const AgentModel = z.enum(['haiku', 'sonnet', 'opus', 'inherit']);
export type AgentModel = z.infer<typeof AgentModel>;

/**
 * Valid permission modes for agent configuration.
 */
export const AgentPermissionMode = z.enum([
  'default',
  'acceptEdits',
  'dontAsk',
  'bypassPermissions',
  'plan',
]);
export type AgentPermissionMode = z.infer<typeof AgentPermissionMode>;

/**
 * Common tool names that can be used in agent configurations.
 * This is not exhaustive but covers the most common tools.
 */
export const COMMON_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Grep',
  'Glob',
  'Task',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
] as const;

/**
 * Zod schema for a single agent configuration.
 * Matches the Claude CLI --agents JSON schema.
 */
export const AgentConfigSchema = z.object({
  /** Required: Describes when Claude should delegate to this subagent */
  description: z.string().min(1, 'Description is required'),

  /** Required: The system prompt that guides the subagent's behavior */
  prompt: z.string().min(1, 'Prompt is required'),

  /** Optional: List of tools the subagent can use. Inherits all if omitted. */
  tools: z.array(z.string()).optional(),

  /** Optional: Model to use. Defaults to 'sonnet' if omitted. */
  model: AgentModel.optional(),

  /** Optional: Permission mode for the subagent. */
  permissionMode: AgentPermissionMode.optional(),

  /** Optional: Skills to load into the subagent's context at startup. */
  skills: z.array(z.string()).optional(),

  /** Optional: Lifecycle hooks scoped to this subagent. */
  hooks: z.object({}).catchall(z.any()).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Zod schema for the full --agents JSON object.
 * Keys are agent names, values are agent configurations.
 */
export const AgentsJsonSchema = z.record(z.string(), AgentConfigSchema);
export type AgentsJson = z.infer<typeof AgentsJsonSchema>;

/**
 * Maximum recommended size for the --agents JSON string (in bytes).
 * Shell argument limits vary by platform, but 10KB is a safe limit.
 */
export const MAX_AGENTS_JSON_SIZE = 10 * 1024; // 10KB

/**
 * Validate an agents configuration object.
 *
 * @param agents - The agents configuration to validate
 * @returns Validation result with success flag and errors if any
 */
export function validateAgentsConfig(agents: unknown): {
  success: boolean;
  data?: AgentsJson;
  errors?: string[];
} {
  const result = AgentsJsonSchema.safeParse(agents);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map((err) => {
    const path = err.path.join('.');
    return path ? `${path}: ${err.message}` : err.message;
  });

  return { success: false, errors };
}

/**
 * Serialize agents configuration to JSON string for CLI.
 *
 * @param agents - The agents configuration to serialize
 * @returns Serialized JSON string
 * @throws Error if serialized size exceeds MAX_AGENTS_JSON_SIZE
 */
export function serializeAgentsConfig(agents: AgentsJson): string {
  const json = JSON.stringify(agents);

  if (json.length > MAX_AGENTS_JSON_SIZE) {
    throw new Error(
      `Agents JSON size (${json.length} bytes) exceeds maximum allowed size (${MAX_AGENTS_JSON_SIZE} bytes)`
    );
  }

  return json;
}

/**
 * Create a single agent configuration with common defaults.
 *
 * @param name - Agent name (used as key in the agents object)
 * @param config - Partial agent configuration
 * @returns Complete agent configuration with name
 */
export function createAgentConfig(
  name: string,
  config: Omit<AgentConfig, 'model'> & { model?: AgentModel }
): { name: string; config: AgentConfig } {
  return {
    name,
    config: {
      description: config.description,
      prompt: config.prompt,
      tools: config.tools,
      model: config.model ?? 'haiku', // Default to haiku for cost efficiency
      permissionMode: config.permissionMode,
      skills: config.skills,
      hooks: config.hooks,
    },
  };
}

/**
 * Build an agents JSON object from an array of named agent configs.
 *
 * @param agents - Array of agent configurations with names
 * @returns Agents JSON object ready for serialization
 */
export function buildAgentsJson(
  agents: Array<{ name: string; config: AgentConfig }>
): AgentsJson {
  const result: AgentsJson = {};

  for (const { name, config } of agents) {
    result[name] = config;
  }

  return result;
}

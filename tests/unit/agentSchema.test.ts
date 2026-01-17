/**
 * Unit tests for Claude CLI --agents schema validation and utilities.
 */

import {
  AgentConfigSchema,
  AgentsJsonSchema,
  AgentModel,
  AgentPermissionMode,
  validateAgentsConfig,
  serializeAgentsConfig,
  createAgentConfig,
  buildAgentsJson,
  MAX_AGENTS_JSON_SIZE,
  type AgentConfig,
  type AgentsJson,
} from '../../server/src/config/agentSchema';

describe('AgentSchema', () => {
  describe('AgentConfigSchema', () => {
    it('should validate a minimal valid agent config', () => {
      const config = {
        description: 'Test agent',
        prompt: 'You are a test agent',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate a complete agent config with all fields', () => {
      const config: AgentConfig = {
        description: 'Expert code reviewer',
        prompt: 'You are a senior code reviewer. Focus on quality.',
        tools: ['Read', 'Grep', 'Glob'],
        model: 'haiku',
        permissionMode: 'default',
        skills: ['code-review'],
        hooks: { onStart: 'echo Starting' },
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(config);
      }
    });

    it('should reject empty description', () => {
      const config = {
        description: '',
        prompt: 'Valid prompt',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty prompt', () => {
      const config = {
        description: 'Valid description',
        prompt: '',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject missing description', () => {
      const config = {
        prompt: 'Valid prompt',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject missing prompt', () => {
      const config = {
        description: 'Valid description',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid model value', () => {
      const config = {
        description: 'Test agent',
        prompt: 'You are a test agent',
        model: 'invalid-model',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should accept all valid model values', () => {
      const validModels = ['haiku', 'sonnet', 'opus', 'inherit'];

      for (const model of validModels) {
        const config = {
          description: 'Test agent',
          prompt: 'You are a test agent',
          model,
        };

        const result = AgentConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should accept all valid permission modes', () => {
      const validModes = [
        'default',
        'acceptEdits',
        'dontAsk',
        'bypassPermissions',
        'plan',
      ];

      for (const mode of validModes) {
        const config = {
          description: 'Test agent',
          prompt: 'You are a test agent',
          permissionMode: mode,
        };

        const result = AgentConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid permission mode', () => {
      const config = {
        description: 'Test agent',
        prompt: 'You are a test agent',
        permissionMode: 'invalid-mode',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('AgentsJsonSchema', () => {
    it('should validate a single agent object', () => {
      const agents: AgentsJson = {
        'code-reviewer': {
          description: 'Reviews code',
          prompt: 'You are a code reviewer',
        },
      };

      const result = AgentsJsonSchema.safeParse(agents);
      expect(result.success).toBe(true);
    });

    it('should validate multiple agents', () => {
      const agents: AgentsJson = {
        reviewer: {
          description: 'Code reviewer',
          prompt: 'Review code quality',
          tools: ['Read', 'Grep'],
          model: 'haiku',
        },
        explorer: {
          description: 'Codebase explorer',
          prompt: 'Explore and understand code',
          tools: ['Read', 'Glob', 'Grep'],
          model: 'haiku',
        },
      };

      const result = AgentsJsonSchema.safeParse(agents);
      expect(result.success).toBe(true);
    });

    it('should reject if any agent is invalid', () => {
      const agents = {
        valid: {
          description: 'Valid agent',
          prompt: 'Valid prompt',
        },
        invalid: {
          description: '', // Empty description
          prompt: 'Valid prompt',
        },
      };

      const result = AgentsJsonSchema.safeParse(agents);
      expect(result.success).toBe(false);
    });

    it('should accept empty object (no agents)', () => {
      const result = AgentsJsonSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('validateAgentsConfig', () => {
    it('should return success for valid config', () => {
      const agents = {
        'test-agent': {
          description: 'Test agent',
          prompt: 'You are a test agent',
        },
      };

      const result = validateAgentsConfig(agents);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(agents);
      expect(result.errors).toBeUndefined();
    });

    it('should return errors for invalid config', () => {
      const agents = {
        'test-agent': {
          description: '', // Invalid
          prompt: 'You are a test agent',
        },
      };

      const result = validateAgentsConfig(agents);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should include path in error messages', () => {
      const agents = {
        'my-agent': {
          description: '', // Invalid
          prompt: 'Valid prompt',
        },
      };

      const result = validateAgentsConfig(agents);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      // Error should reference the path to the invalid field
      expect(result.errors!.some((e) => e.includes('my-agent'))).toBe(true);
    });
  });

  describe('serializeAgentsConfig', () => {
    it('should serialize agents to JSON string', () => {
      const agents: AgentsJson = {
        reviewer: {
          description: 'Code reviewer',
          prompt: 'Review code',
        },
      };

      const json = serializeAgentsConfig(agents);
      expect(typeof json).toBe('string');
      expect(JSON.parse(json)).toEqual(agents);
    });

    it('should throw error if JSON exceeds max size', () => {
      // Create a very large agent config
      const largePrompt = 'x'.repeat(MAX_AGENTS_JSON_SIZE + 1000);
      const agents: AgentsJson = {
        'large-agent': {
          description: 'Large agent',
          prompt: largePrompt,
        },
      };

      expect(() => serializeAgentsConfig(agents)).toThrow(
        /exceeds maximum allowed size/
      );
    });

    it('should not throw for config within size limit', () => {
      const agents: AgentsJson = {
        'normal-agent': {
          description: 'Normal agent',
          prompt: 'A normal sized prompt',
          tools: ['Read', 'Grep', 'Glob'],
          model: 'haiku',
        },
      };

      expect(() => serializeAgentsConfig(agents)).not.toThrow();
    });
  });

  describe('createAgentConfig', () => {
    it('should create agent config with default model', () => {
      const result = createAgentConfig('reviewer', {
        description: 'Code reviewer',
        prompt: 'Review code quality',
      });

      expect(result.name).toBe('reviewer');
      expect(result.config.description).toBe('Code reviewer');
      expect(result.config.prompt).toBe('Review code quality');
      expect(result.config.model).toBe('haiku'); // Default
    });

    it('should allow overriding the model', () => {
      const result = createAgentConfig('reviewer', {
        description: 'Code reviewer',
        prompt: 'Review code quality',
        model: 'sonnet',
      });

      expect(result.config.model).toBe('sonnet');
    });

    it('should include all provided fields', () => {
      const result = createAgentConfig('reviewer', {
        description: 'Code reviewer',
        prompt: 'Review code quality',
        tools: ['Read', 'Grep'],
        model: 'haiku',
        permissionMode: 'default',
        skills: ['code-review'],
        hooks: { onStart: 'echo start' },
      });

      expect(result.config.tools).toEqual(['Read', 'Grep']);
      expect(result.config.permissionMode).toBe('default');
      expect(result.config.skills).toEqual(['code-review']);
      expect(result.config.hooks).toEqual({ onStart: 'echo start' });
    });
  });

  describe('buildAgentsJson', () => {
    it('should build agents JSON from array of configs', () => {
      const agents = [
        createAgentConfig('reviewer', {
          description: 'Code reviewer',
          prompt: 'Review code',
        }),
        createAgentConfig('explorer', {
          description: 'Codebase explorer',
          prompt: 'Explore code',
        }),
      ];

      const result = buildAgentsJson(agents);

      expect(Object.keys(result)).toEqual(['reviewer', 'explorer']);
      expect(result.reviewer.description).toBe('Code reviewer');
      expect(result.explorer.description).toBe('Codebase explorer');
    });

    it('should return empty object for empty array', () => {
      const result = buildAgentsJson([]);
      expect(result).toEqual({});
    });

    it('should overwrite duplicate names with last value', () => {
      const agents = [
        createAgentConfig('agent', {
          description: 'First',
          prompt: 'First prompt',
        }),
        createAgentConfig('agent', {
          description: 'Second',
          prompt: 'Second prompt',
        }),
      ];

      const result = buildAgentsJson(agents);

      expect(Object.keys(result)).toEqual(['agent']);
      expect(result.agent.description).toBe('Second');
    });
  });

  describe('type exports', () => {
    it('should export AgentModel enum values', () => {
      const models = AgentModel.options;
      expect(models).toContain('haiku');
      expect(models).toContain('sonnet');
      expect(models).toContain('opus');
      expect(models).toContain('inherit');
    });

    it('should export AgentPermissionMode enum values', () => {
      const modes = AgentPermissionMode.options;
      expect(modes).toContain('default');
      expect(modes).toContain('acceptEdits');
      expect(modes).toContain('dontAsk');
      expect(modes).toContain('bypassPermissions');
      expect(modes).toContain('plan');
    });

    it('should export MAX_AGENTS_JSON_SIZE constant', () => {
      expect(MAX_AGENTS_JSON_SIZE).toBe(10 * 1024);
    });
  });
});

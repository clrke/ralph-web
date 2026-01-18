import {
  getStage1ExplorationAgents,
  getStage2ReviewAgents,
  getStage5PRReviewAgents,
  getStageAgents,
  validateSuggestedAgents,
  VALID_AGENT_TYPES,
} from '../../server/src/config/agentConfigs';

describe('agentConfigs', () => {
  describe('VALID_AGENT_TYPES', () => {
    it('should contain all expected agent types', () => {
      expect(VALID_AGENT_TYPES).toContain('frontend');
      expect(VALID_AGENT_TYPES).toContain('backend');
      expect(VALID_AGENT_TYPES).toContain('database');
      expect(VALID_AGENT_TYPES).toContain('testing');
      expect(VALID_AGENT_TYPES).toContain('infrastructure');
      expect(VALID_AGENT_TYPES).toContain('documentation');
    });

    it('should have exactly 6 agent types', () => {
      expect(VALID_AGENT_TYPES).toHaveLength(6);
    });
  });

  describe('getStage1ExplorationAgents', () => {
    it('should return all agents when no filter provided', () => {
      const agents = getStage1ExplorationAgents();

      expect(agents).toBeDefined();
      expect(Object.keys(agents!)).toHaveLength(6);
      expect(agents!.frontend).toBeDefined();
      expect(agents!.backend).toBeDefined();
      expect(agents!.database).toBeDefined();
      expect(agents!.testing).toBeDefined();
      expect(agents!.infrastructure).toBeDefined();
      expect(agents!.documentation).toBeDefined();
    });

    it('should return all agents when empty array provided', () => {
      const agents = getStage1ExplorationAgents([]);

      expect(agents).toBeDefined();
      expect(Object.keys(agents!)).toHaveLength(6);
    });

    it('should filter to only requested agent types', () => {
      const agents = getStage1ExplorationAgents(['frontend', 'backend']);

      expect(agents).toBeDefined();
      expect(Object.keys(agents!)).toHaveLength(2);
      expect(agents!.frontend).toBeDefined();
      expect(agents!.backend).toBeDefined();
      expect(agents!.database).toBeUndefined();
    });

    it('should return undefined for invalid agent types only', () => {
      const agents = getStage1ExplorationAgents(['invalid', 'nonexistent']);

      expect(agents).toBeUndefined();
    });

    it('should filter out invalid types and return valid ones', () => {
      const agents = getStage1ExplorationAgents(['frontend', 'invalid', 'backend']);

      expect(agents).toBeDefined();
      expect(Object.keys(agents!)).toHaveLength(2);
      expect(agents!.frontend).toBeDefined();
      expect(agents!.backend).toBeDefined();
    });

    it('should return agents with haiku model', () => {
      const agents = getStage1ExplorationAgents(['frontend']);

      expect(agents).toBeDefined();
      expect(agents!.frontend.model).toBe('haiku');
    });

    it('should return agents with read-only tools', () => {
      const agents = getStage1ExplorationAgents(['frontend']);

      expect(agents).toBeDefined();
      expect(agents!.frontend.tools).toContain('Read');
      expect(agents!.frontend.tools).toContain('Glob');
      expect(agents!.frontend.tools).toContain('Grep');
      expect(agents!.frontend.tools).not.toContain('Write');
      expect(agents!.frontend.tools).not.toContain('Edit');
    });
  });

  describe('getStage2ReviewAgents', () => {
    it('should return all agents when no filter provided', () => {
      const agents = getStage2ReviewAgents();

      expect(agents).toBeDefined();
      expect(Object.keys(agents!)).toHaveLength(6);
    });

    it('should filter to only requested agent types', () => {
      const agents = getStage2ReviewAgents(['testing', 'documentation']);

      expect(agents).toBeDefined();
      expect(Object.keys(agents!)).toHaveLength(2);
      expect(agents!.testing).toBeDefined();
      expect(agents!.documentation).toBeDefined();
    });

    it('should return agents with haiku model', () => {
      const agents = getStage2ReviewAgents(['backend']);

      expect(agents).toBeDefined();
      expect(agents!.backend.model).toBe('haiku');
    });

    it('should return agents with read-only tools', () => {
      const agents = getStage2ReviewAgents(['backend']);

      expect(agents).toBeDefined();
      expect(agents!.backend.tools).toContain('Read');
      expect(agents!.backend.tools).not.toContain('Write');
      expect(agents!.backend.tools).not.toContain('Bash');
    });
  });

  describe('getStage5PRReviewAgents', () => {
    it('should return all agents when no filter provided', () => {
      const agents = getStage5PRReviewAgents();

      expect(agents).toBeDefined();
      expect(Object.keys(agents!)).toHaveLength(6);
    });

    it('should filter to only requested agent types', () => {
      const agents = getStage5PRReviewAgents(['frontend', 'infrastructure']);

      expect(agents).toBeDefined();
      expect(Object.keys(agents!)).toHaveLength(2);
      expect(agents!.frontend).toBeDefined();
      expect(agents!.infrastructure).toBeDefined();
    });

    it('should return agents with haiku model', () => {
      const agents = getStage5PRReviewAgents(['frontend']);

      expect(agents).toBeDefined();
      expect(agents!.frontend.model).toBe('haiku');
    });

    it('should return frontend agent with git diff access', () => {
      const agents = getStage5PRReviewAgents(['frontend']);

      expect(agents).toBeDefined();
      expect(agents!.frontend.tools).toContain('Bash(git:diff*)');
    });

    it('should return infrastructure agent with gh pr access', () => {
      const agents = getStage5PRReviewAgents(['infrastructure']);

      expect(agents).toBeDefined();
      expect(agents!.infrastructure.tools).toContain('Bash(gh:pr*)');
    });

    it('should return testing agent without bash access', () => {
      const agents = getStage5PRReviewAgents(['testing']);

      expect(agents).toBeDefined();
      const tools = agents!.testing.tools || [];
      const hasBash = tools.some((t: string) => t.startsWith('Bash'));
      expect(hasBash).toBe(false);
    });
  });

  describe('getStageAgents', () => {
    it('should return Stage 1 agents for stage 1', () => {
      const agents = getStageAgents(1, ['frontend']);

      expect(agents).toBeDefined();
      expect(agents!.frontend).toBeDefined();
      expect(agents!.frontend.description).toContain('Explore UI layer');
    });

    it('should return Stage 2 agents for stage 2', () => {
      const agents = getStageAgents(2, ['frontend']);

      expect(agents).toBeDefined();
      expect(agents!.frontend).toBeDefined();
      expect(agents!.frontend.description).toContain('Review UI aspects');
    });

    it('should return undefined for stage 3', () => {
      const agents = getStageAgents(3);

      expect(agents).toBeUndefined();
    });

    it('should return undefined for stage 4', () => {
      const agents = getStageAgents(4);

      expect(agents).toBeUndefined();
    });

    it('should return Stage 5 agents for stage 5', () => {
      const agents = getStageAgents(5, ['frontend']);

      expect(agents).toBeDefined();
      expect(agents!.frontend).toBeDefined();
      expect(agents!.frontend.description).toContain('Review UI changes');
    });

    it('should return undefined for invalid stage numbers', () => {
      expect(getStageAgents(0)).toBeUndefined();
      expect(getStageAgents(6)).toBeUndefined();
      expect(getStageAgents(-1)).toBeUndefined();
    });

    it('should filter agents based on suggestedAgents', () => {
      const agents = getStageAgents(1, ['backend', 'database']);

      expect(agents).toBeDefined();
      expect(Object.keys(agents!)).toHaveLength(2);
      expect(agents!.backend).toBeDefined();
      expect(agents!.database).toBeDefined();
      expect(agents!.frontend).toBeUndefined();
    });
  });

  describe('validateSuggestedAgents', () => {
    it('should return all valid agents when all are valid', () => {
      const result = validateSuggestedAgents(['frontend', 'backend', 'testing']);

      expect(result.valid).toEqual(['frontend', 'backend', 'testing']);
      expect(result.invalid).toEqual([]);
    });

    it('should separate valid and invalid agents', () => {
      const result = validateSuggestedAgents(['frontend', 'invalid', 'backend', 'nonexistent']);

      expect(result.valid).toEqual(['frontend', 'backend']);
      expect(result.invalid).toEqual(['invalid', 'nonexistent']);
    });

    it('should return empty arrays when input is empty', () => {
      const result = validateSuggestedAgents([]);

      expect(result.valid).toEqual([]);
      expect(result.invalid).toEqual([]);
    });

    it('should return all invalid when no valid agents', () => {
      const result = validateSuggestedAgents(['foo', 'bar', 'baz']);

      expect(result.valid).toEqual([]);
      expect(result.invalid).toEqual(['foo', 'bar', 'baz']);
    });

    it('should handle all valid agent types', () => {
      const result = validateSuggestedAgents([
        'frontend',
        'backend',
        'database',
        'testing',
        'infrastructure',
        'documentation',
      ]);

      expect(result.valid).toHaveLength(6);
      expect(result.invalid).toEqual([]);
    });
  });
});

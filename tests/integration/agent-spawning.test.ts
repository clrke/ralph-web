/**
 * Integration tests for end-to-end agent spawning.
 *
 * Tests verify:
 * 1. Spawned Claude processes receive correct --agents configuration
 * 2. Agent configurations produce valid JSON that Claude CLI accepts
 * 3. Output parsing works correctly with agent-based spawning
 */

import { EventEmitter } from 'events';
import { spawn as actualSpawn } from 'child_process';
import { ClaudeOrchestrator } from '../../server/src/services/ClaudeOrchestrator';
import { OutputParser } from '../../server/src/services/OutputParser';
import {
  getStage1ExplorationAgents,
  getStage2ReviewAgents,
  getStage5PRReviewAgents,
} from '../../server/src/config/agentConfigs';
import { serializeAgentsConfig, validateAgentsConfig } from '../../server/src/config/agentSchema';

// Mock child_process spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const mockSpawn = actualSpawn as jest.MockedFunction<typeof actualSpawn>;

describe('Agent Spawning Integration', () => {
  let orchestrator: ClaudeOrchestrator;
  let outputParser: OutputParser;

  beforeEach(() => {
    outputParser = new OutputParser();
    orchestrator = new ClaudeOrchestrator(outputParser);
    jest.clearAllMocks();
  });

  describe('command building with agents', () => {
    it('should build command with Stage 1 exploration agents', () => {
      const agents = getStage1ExplorationAgents(['frontend', 'backend']);

      const cmd = orchestrator.buildCommand({
        prompt: 'Explore the codebase',
        projectPath: '/test/project',
        allowedTools: orchestrator.getStageTools(1),
        agents,
      });

      expect(cmd.args).toContain('--agents');
      const agentsIndex = cmd.args.indexOf('--agents');
      const agentsJson = cmd.args[agentsIndex + 1];

      // Verify it's valid JSON
      expect(() => JSON.parse(agentsJson)).not.toThrow();

      // Verify structure
      const parsed = JSON.parse(agentsJson);
      expect(parsed.frontend).toBeDefined();
      expect(parsed.backend).toBeDefined();
      expect(parsed.frontend.model).toBe('haiku');
      expect(parsed.backend.model).toBe('haiku');
    });

    it('should build command with Stage 2 review agents', () => {
      const agents = getStage2ReviewAgents(['frontend', 'testing']);

      const cmd = orchestrator.buildCommand({
        prompt: 'Review the plan',
        projectPath: '/test/project',
        allowedTools: orchestrator.getStageTools(2),
        agents,
      });

      expect(cmd.args).toContain('--agents');
      const agentsIndex = cmd.args.indexOf('--agents');
      const agentsJson = cmd.args[agentsIndex + 1];

      const parsed = JSON.parse(agentsJson);
      expect(parsed.frontend).toBeDefined();
      expect(parsed.testing).toBeDefined();
      expect(parsed.frontend.description).toContain('Review UI aspects');
    });

    it('should build command with Stage 5 PR review agents', () => {
      const agents = getStage5PRReviewAgents(['frontend', 'infrastructure']);

      const cmd = orchestrator.buildCommand({
        prompt: 'Review the PR',
        projectPath: '/test/project',
        allowedTools: orchestrator.getStageTools(5),
        agents,
      });

      expect(cmd.args).toContain('--agents');
      const agentsIndex = cmd.args.indexOf('--agents');
      const agentsJson = cmd.args[agentsIndex + 1];

      const parsed = JSON.parse(agentsJson);
      expect(parsed.frontend).toBeDefined();
      expect(parsed.infrastructure).toBeDefined();
      // Stage 5 frontend agent should have git diff access
      expect(parsed.frontend.tools).toContain('Bash(git:diff*)');
    });
  });

  describe('agent configuration validation', () => {
    it('should produce valid JSON for all Stage 1 agents', () => {
      const agents = getStage1ExplorationAgents();
      expect(agents).toBeDefined();

      const validation = validateAgentsConfig(agents!);
      expect(validation.success).toBe(true);

      const json = serializeAgentsConfig(agents!);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should produce valid JSON for all Stage 2 agents', () => {
      const agents = getStage2ReviewAgents();
      expect(agents).toBeDefined();

      const validation = validateAgentsConfig(agents!);
      expect(validation.success).toBe(true);

      const json = serializeAgentsConfig(agents!);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should produce valid JSON for all Stage 5 agents', () => {
      const agents = getStage5PRReviewAgents();
      expect(agents).toBeDefined();

      const validation = validateAgentsConfig(agents!);
      expect(validation.success).toBe(true);

      const json = serializeAgentsConfig(agents!);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should filter agents correctly based on suggestedAgents', () => {
      const allAgents = getStage1ExplorationAgents();
      const filteredAgents = getStage1ExplorationAgents(['frontend']);

      expect(Object.keys(allAgents!)).toHaveLength(6);
      expect(Object.keys(filteredAgents!)).toHaveLength(1);
      expect(filteredAgents!.frontend).toBeDefined();
      expect(filteredAgents!.backend).toBeUndefined();
    });
  });

  describe('spawn with agents and output parsing', () => {
    it('should spawn process with agents and parse output correctly', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const agents = getStage1ExplorationAgents(['frontend']);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Explore frontend patterns',
        projectPath: '/test/project',
        allowedTools: orchestrator.getStageTools(1),
        agents,
      });

      // Simulate successful output with decision markers
      const mockOutput = JSON.stringify({
        result: `Found frontend patterns.

[DECISION_NEEDED priority="1" category="approach"]
Which UI framework should we use?
- Option A: React (recommended)
- Option B: Vue
[/DECISION_NEEDED]`,
        session_id: 'session-123',
        cost_usd: 0.01,
        is_error: false,
      });

      mockProcess.stdout.emit('data', Buffer.from(mockOutput));
      mockProcess.emit('close', 0);

      const result = await spawnPromise;

      // Verify spawn was called with --agents
      expect(mockSpawn).toHaveBeenCalled();
      const spawnArgs = mockSpawn.mock.calls[0][1];
      expect(spawnArgs).toContain('--agents');

      // Verify output parsing still works
      expect(result.output).toContain('Found frontend patterns');
      expect(result.parsed.decisions).toHaveLength(1);
      expect(result.parsed.decisions[0].priority).toBe(1); // Priority is parsed as number
      expect(result.parsed.decisions[0].category).toBe('approach');
    });

    it('should spawn process with agents and parse plan steps', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const agents = getStage2ReviewAgents(['backend', 'testing']);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Review the plan',
        projectPath: '/test/project',
        allowedTools: orchestrator.getStageTools(2),
        agents,
      });

      // Simulate output with plan step markers
      const mockOutput = JSON.stringify({
        result: `Plan review complete.

[PLAN_STEP id="step-1" parent="null" status="pending" complexity="medium"]
Implement API endpoint
Create REST endpoint for user authentication with JWT tokens.
[/PLAN_STEP]

[PLAN_APPROVED]`,
        session_id: 'session-456',
        cost_usd: 0.02,
        is_error: false,
      });

      mockProcess.stdout.emit('data', Buffer.from(mockOutput));
      mockProcess.emit('close', 0);

      const result = await spawnPromise;

      // Verify spawn was called with --agents
      const spawnArgs = mockSpawn.mock.calls[0][1];
      expect(spawnArgs).toContain('--agents');

      // Verify output parsing
      expect(result.parsed.planSteps).toHaveLength(1);
      expect(result.parsed.planSteps[0].id).toBe('step-1');
      expect(result.parsed.planSteps[0].complexity).toBe('medium');
      expect(result.parsed.planApproved).toBe(true);
    });

    it('should spawn process with agents and handle PR review markers', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      mockSpawn.mockReturnValue(mockProcess);

      const agents = getStage5PRReviewAgents(['frontend', 'infrastructure']);

      const spawnPromise = orchestrator.spawn({
        prompt: 'Review the PR',
        projectPath: '/test/project',
        allowedTools: orchestrator.getStageTools(5),
        agents,
      });

      // Simulate output with PR approval
      const mockOutput = JSON.stringify({
        result: `PR review complete.

[CI_STATUS status="passing"]
All checks passed
[/CI_STATUS]

[PR_APPROVED]`,
        session_id: 'session-789',
        cost_usd: 0.03,
        is_error: false,
      });

      mockProcess.stdout.emit('data', Buffer.from(mockOutput));
      mockProcess.emit('close', 0);

      const result = await spawnPromise;

      // Verify spawn was called with --agents
      const spawnArgs = mockSpawn.mock.calls[0][1];
      expect(spawnArgs).toContain('--agents');

      // Verify output parsing
      expect(result.parsed.prApproved).toBe(true);
      expect(result.output).toContain('PR review complete');
    });
  });

  describe('agent JSON structure matches Claude CLI expectations', () => {
    it('should produce JSON matching the documented --agents schema', () => {
      const agents = getStage1ExplorationAgents(['frontend']);
      const json = serializeAgentsConfig(agents!);
      const parsed = JSON.parse(json);

      // Verify structure matches Claude CLI documentation
      // { "agent-name": { description, prompt, tools?, model? } }
      expect(parsed.frontend).toBeDefined();
      expect(typeof parsed.frontend.description).toBe('string');
      expect(typeof parsed.frontend.prompt).toBe('string');
      expect(Array.isArray(parsed.frontend.tools)).toBe(true);
      expect(['haiku', 'sonnet', 'opus', 'inherit']).toContain(parsed.frontend.model);
    });

    it('should include all required fields for each agent', () => {
      const allStageAgents = [
        getStage1ExplorationAgents(),
        getStage2ReviewAgents(),
        getStage5PRReviewAgents(),
      ];

      for (const agents of allStageAgents) {
        expect(agents).toBeDefined();
        for (const [name, config] of Object.entries(agents!)) {
          expect(config.description).toBeDefined();
          expect(config.description.length).toBeGreaterThan(0);
          expect(config.prompt).toBeDefined();
          expect(config.prompt.length).toBeGreaterThan(0);
        }
      }
    });

    it('should not exceed 10KB size limit for any stage', () => {
      const stages = [
        { stage: 1, agents: getStage1ExplorationAgents() },
        { stage: 2, agents: getStage2ReviewAgents() },
        { stage: 5, agents: getStage5PRReviewAgents() },
      ];

      for (const { stage, agents } of stages) {
        const json = serializeAgentsConfig(agents!);
        expect(json.length).toBeLessThan(10240); // 10KB
      }
    });
  });
});

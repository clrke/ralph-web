import { Session } from '@claude-code-web/shared';
import {
  buildStage1Prompt,
  buildStage1PromptStreamlined,
} from '../../server/src/prompts/stagePrompts';

describe('Stage 1 Prompt Selection', () => {
  const baseSession: Session = {
    version: '1.0',
    id: 'test-session-id',
    projectId: 'test-project',
    featureId: 'test-feature',
    title: 'Test Feature',
    featureDescription: 'A test feature description',
    projectPath: '/test/project',
    acceptanceCriteria: [{ text: 'Feature works correctly', checked: false, type: 'manual' }],
    affectedFiles: [],
    technicalNotes: '',
    baseBranch: 'main',
    featureBranch: 'feature/test',
    baseCommitSha: 'abc123',
    status: 'discovery',
    currentStage: 1,
    replanningCount: 0,
    claudeSessionId: null,
    claudePlanFilePath: '/tmp/plan.md',
    currentPlanVersion: 0,
    claudeStage3SessionId: null,
    prUrl: null,
    sessionExpiresAt: '2026-01-12T00:00:00Z',
    createdAt: '2026-01-11T00:00:00Z',
    updatedAt: '2026-01-11T00:00:00Z',
  };

  describe('buildStage1Prompt (full)', () => {
    it('should include all 6 exploration agents', () => {
      const prompt = buildStage1Prompt(baseSession);

      expect(prompt).toContain('Architecture Agent');
      expect(prompt).toContain('Frontend Agent');
      expect(prompt).toContain('Backend Agent');
      expect(prompt).toContain('Database Agent');
      expect(prompt).toContain('Integration Agent');
      expect(prompt).toContain('Test Agent');
    });

    it('should be longer than streamlined prompt', () => {
      const sessionSimple: Session = {
        ...baseSession,
        assessedComplexity: 'simple',
        suggestedAgents: ['frontend'],
      };

      const fullPrompt = buildStage1Prompt(baseSession);
      const streamlinedPrompt = buildStage1PromptStreamlined(sessionSimple);

      expect(fullPrompt.length).toBeGreaterThan(streamlinedPrompt.length);
    });
  });

  describe('buildStage1PromptStreamlined', () => {
    it('should not include all 6 agents when only frontend is suggested', () => {
      const sessionFrontendOnly: Session = {
        ...baseSession,
        assessedComplexity: 'simple',
        suggestedAgents: ['frontend'],
      };

      const prompt = buildStage1PromptStreamlined(sessionFrontendOnly);

      expect(prompt).toContain('Frontend Agent');
      expect(prompt).not.toContain('Backend Agent');
      expect(prompt).not.toContain('Database Agent');
      expect(prompt).not.toContain('Architecture Agent');
    });

    it('should include only the suggested agents', () => {
      const sessionBackendDatabase: Session = {
        ...baseSession,
        assessedComplexity: 'simple',
        suggestedAgents: ['backend', 'database'],
      };

      const prompt = buildStage1PromptStreamlined(sessionBackendDatabase);

      expect(prompt).toContain('Backend Agent');
      expect(prompt).toContain('Database Agent');
      expect(prompt).not.toContain('Frontend Agent');
      expect(prompt).not.toContain('Test Agent');
    });

    it('should indicate focused exploration', () => {
      const sessionSimple: Session = {
        ...baseSession,
        assessedComplexity: 'simple',
        suggestedAgents: ['frontend'],
      };

      const prompt = buildStage1PromptStreamlined(sessionSimple);

      expect(prompt).toContain('Focused Exploration');
      expect(prompt).toContain('streamlined');
    });

    it('should suggest skipping questions for simple changes', () => {
      const sessionSimple: Session = {
        ...baseSession,
        assessedComplexity: 'simple',
        suggestedAgents: ['frontend'],
      };

      const prompt = buildStage1PromptStreamlined(sessionSimple);

      expect(prompt).toContain('Skip this phase entirely');
      expect(prompt).toContain('ONLY IF NEEDED');
    });
  });

  describe('prompt selection logic', () => {
    /**
     * Test that sessions with different complexity levels get different prompts.
     * In production, selectStage1PromptBuilder chooses based on assessedComplexity.
     */

    it('trivial complexity should use streamlined prompt pattern', () => {
      const sessionTrivial: Session = {
        ...baseSession,
        assessedComplexity: 'trivial',
        suggestedAgents: ['frontend'],
      };

      const prompt = buildStage1PromptStreamlined(sessionTrivial);

      // Streamlined should have "focused" and fewer agents
      expect(prompt).toContain('Focused Exploration');
      expect(prompt).toContain('trivial');
    });

    it('simple complexity should use streamlined prompt pattern', () => {
      const sessionSimple: Session = {
        ...baseSession,
        assessedComplexity: 'simple',
        suggestedAgents: ['frontend', 'testing'],
      };

      const prompt = buildStage1PromptStreamlined(sessionSimple);

      // Streamlined should have "focused" and specified agents
      expect(prompt).toContain('Focused Exploration');
      expect(prompt).toContain('simple');
      expect(prompt).toContain('Frontend Agent');
      expect(prompt).toContain('Test Agent');
    });

    it('normal complexity should use full prompt pattern', () => {
      const sessionNormal: Session = {
        ...baseSession,
        assessedComplexity: 'normal',
        suggestedAgents: ['frontend', 'backend', 'database'],
      };

      const prompt = buildStage1Prompt(sessionNormal);

      // Full prompt should have all 6 agents and "Codebase Exploration" (not "Focused")
      expect(prompt).toContain('Codebase Exploration');
      expect(prompt).toContain('Architecture Agent');
      expect(prompt).toContain('Frontend Agent');
      expect(prompt).toContain('Backend Agent');
      expect(prompt).toContain('Database Agent');
      expect(prompt).toContain('Integration Agent');
      expect(prompt).toContain('Test Agent');
    });

    it('complex complexity should use full prompt pattern', () => {
      const sessionComplex: Session = {
        ...baseSession,
        assessedComplexity: 'complex',
        suggestedAgents: [
          'frontend',
          'backend',
          'database',
          'testing',
          'infrastructure',
          'documentation',
        ],
      };

      const prompt = buildStage1Prompt(sessionComplex);

      // Full prompt should have comprehensive exploration
      expect(prompt).toContain('Codebase Exploration');
      expect(prompt).toContain('Architecture Agent');
    });

    it('undefined complexity should default to full prompt pattern', () => {
      const sessionNoComplexity: Session = {
        ...baseSession,
        assessedComplexity: undefined,
        suggestedAgents: undefined,
      };

      const prompt = buildStage1Prompt(sessionNoComplexity);

      // Should use full prompt with all agents
      expect(prompt).toContain('Codebase Exploration');
      expect(prompt).toContain('Architecture Agent');
      expect(prompt).toContain('Frontend Agent');
      expect(prompt).toContain('Backend Agent');
    });
  });
});

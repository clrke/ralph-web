/**
 * Comprehensive tests for streamlined prompt builders and complexity-based selection.
 *
 * Tests verify:
 * 1. buildStage1PromptStreamlined produces correct agent instructions based on suggestedAgents
 * 2. buildStage2PromptStreamlined has reduced iteration count (3 vs 10)
 * 3. buildStage5PromptStreamlined spawns fewer review agents (but always includes CI)
 * 4. All streamlined prompts maintain required marker formats
 * 5. Complexity-based prompt selection works correctly in stage execution paths
 */

import { Session, Plan, ChangeComplexity } from '@claude-code-web/shared';
import {
  buildStage1Prompt,
  buildStage1PromptStreamlined,
  buildStage2Prompt,
  buildStage2PromptStreamlined,
  buildStage2PromptStreamlinedLean,
  buildStage2PromptLean,
  buildStage5Prompt,
  buildStage5PromptStreamlined,
  buildStage5PromptStreamlinedLean,
  buildStage5PromptLean,
} from '../../server/src/prompts/stagePrompts';

describe('Streamlined Prompts', () => {
  const baseSession: Session = {
    version: '1.0',
    id: 'test-session-id',
    projectId: 'test-project',
    featureId: 'test-feature',
    title: 'Test Feature',
    featureDescription: 'A test feature description with enough detail',
    projectPath: '/test/project',
    acceptanceCriteria: [
      { text: 'Feature works correctly', checked: false, type: 'manual' },
      { text: 'Tests pass', checked: false, type: 'automated' },
    ],
    affectedFiles: ['src/component.tsx'],
    technicalNotes: 'Use existing patterns',
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

  const mockPlan: Plan = {
    id: 'plan-123',
    sessionId: 'session-123',
    status: 'pending',
    version: 1,
    planVersion: 1,
    steps: [
      {
        id: 'step-1',
        title: 'Implement core functionality',
        description: 'Create the main component with required logic',
        status: 'pending',
        order: 0,
        dependencies: [],
        complexity: 'low',
      },
      {
        id: 'step-2',
        title: 'Add tests',
        description: 'Write unit tests for the component',
        status: 'pending',
        order: 1,
        dependencies: ['step-1'],
        complexity: 'low',
      },
    ],
    createdAt: '2026-01-11T00:00:00Z',
    updatedAt: '2026-01-11T00:00:00Z',
  };

  const prInfo = {
    title: 'feat: Add test feature',
    branch: 'feature/test',
    url: 'https://github.com/test/repo/pull/123',
  };

  describe('buildStage1PromptStreamlined', () => {
    describe('agent selection based on suggestedAgents', () => {
      it('should only spawn frontend agent when only frontend is suggested', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('Frontend Agent');
        expect(prompt).toContain('UI layer patterns');
        expect(prompt).not.toContain('Backend Agent');
        expect(prompt).not.toContain('Database Agent');
        expect(prompt).not.toContain('Infrastructure Agent');
      });

      it('should spawn multiple agents when multiple are suggested', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend', 'backend', 'testing'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('Frontend Agent');
        expect(prompt).toContain('Backend Agent');
        expect(prompt).toContain('Test Agent');
        expect(prompt).not.toContain('Database Agent');
      });

      it('should spawn all relevant agents for a data-focused change', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['backend', 'database'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('Backend Agent');
        expect(prompt).toContain('Database Agent');
        expect(prompt).not.toContain('Frontend Agent');
      });

      it('should default to frontend and backend when no agents suggested', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: undefined,
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('Frontend Agent');
        expect(prompt).toContain('Backend Agent');
      });
    });

    describe('complexity indication', () => {
      it('should indicate trivial complexity in prompt', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'trivial',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('trivial');
        expect(prompt).toContain('streamlined');
      });

      it('should indicate simple complexity in prompt', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend', 'testing'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('simple');
      });
    });

    describe('required markers', () => {
      it('should include DECISION_NEEDED marker format', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('[DECISION_NEEDED');
        expect(prompt).toContain('[/DECISION_NEEDED]');
      });

      it('should include PLAN_STEP marker format', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('[PLAN_STEP');
        expect(prompt).toContain('[/PLAN_STEP]');
      });

      it('should include PLAN_META marker format', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('[PLAN_META]');
        expect(prompt).toContain('[/PLAN_META]');
      });

      it('should include PLAN_DEPENDENCIES marker', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('[PLAN_DEPENDENCIES]');
        expect(prompt).toContain('[/PLAN_DEPENDENCIES]');
      });

      it('should include PLAN_TEST_COVERAGE marker', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('[PLAN_TEST_COVERAGE]');
        expect(prompt).toContain('[/PLAN_TEST_COVERAGE]');
      });

      it('should include PLAN_ACCEPTANCE_MAPPING marker', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        expect(prompt).toContain('[PLAN_ACCEPTANCE_MAPPING]');
        expect(prompt).toContain('[/PLAN_ACCEPTANCE_MAPPING]');
      });
    });

    describe('prompt length comparison', () => {
      it('should be shorter than full Stage 1 prompt', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const fullPrompt = buildStage1Prompt(baseSession);
        const streamlinedPrompt = buildStage1PromptStreamlined(session);

        expect(streamlinedPrompt.length).toBeLessThan(fullPrompt.length);
      });

      it('should be significantly shorter when only 1 agent is suggested', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'trivial',
          suggestedAgents: ['frontend'],
        };

        const fullPrompt = buildStage1Prompt(baseSession);
        const streamlinedPrompt = buildStage1PromptStreamlined(session);

        // At least 20% shorter
        expect(streamlinedPrompt.length).toBeLessThan(fullPrompt.length * 0.8);
      });
    });

    describe('invalid agent fallback (step-17 fix)', () => {
      it('should fallback to all agents when suggestedAgents contains only invalid values', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['invalid_agent_1', 'unknown_agent_2'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        // Should include ALL valid agents as fallback
        expect(prompt).toContain('Frontend Agent');
        expect(prompt).toContain('Backend Agent');
        expect(prompt).toContain('Database Agent');
        expect(prompt).toContain('Test Agent');
        expect(prompt).toContain('Infrastructure Agent');
        expect(prompt).toContain('Documentation Agent');
      });

      it('should filter out invalid agents but keep valid ones', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend', 'invalid_agent', 'testing'],
        };

        const prompt = buildStage1PromptStreamlined(session);

        // Should include only the valid agents
        expect(prompt).toContain('Frontend Agent');
        expect(prompt).toContain('Test Agent');
        // Should NOT include invalid agents or other valid agents not in the list
        expect(prompt).not.toContain('Backend Agent');
        expect(prompt).not.toContain('Database Agent');
      });

      it('should use default agents when suggestedAgents is undefined', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: undefined,
        };

        const prompt = buildStage1PromptStreamlined(session);

        // Default is ['frontend', 'backend']
        expect(prompt).toContain('Frontend Agent');
        expect(prompt).toContain('Backend Agent');
        expect(prompt).not.toContain('Database Agent');
      });

      it('should use default agents when suggestedAgents is empty array', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: [],
        };

        const prompt = buildStage1PromptStreamlined(session);

        // Empty array should fallback to all agents
        expect(prompt).toContain('Frontend Agent');
        expect(prompt).toContain('Backend Agent');
        expect(prompt).toContain('Database Agent');
        expect(prompt).toContain('Test Agent');
        expect(prompt).toContain('Infrastructure Agent');
        expect(prompt).toContain('Documentation Agent');
      });
    });
  });

  describe('buildStage2PromptStreamlined', () => {
    describe('reduced iteration count', () => {
      it('should use 3 iterations instead of 10', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend', 'testing'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 1);

        expect(prompt).toContain('1 of 3');
        expect(prompt).not.toContain('1 of 10');
      });

      it('should indicate this is streamlined for simple changes', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 1);

        expect(prompt).toContain('streamlined');
        expect(prompt).toContain('simple');
      });

      it('should show correct iteration count for iteration 2', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 2);

        expect(prompt).toContain('2 of 3');
      });

      it('should show correct iteration count for iteration 3', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 3);

        expect(prompt).toContain('3 of 3');
      });
    });

    describe('agent selection', () => {
      it('should only include suggested review agents', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 1);

        expect(prompt).toContain('Frontend Reviewer');
        expect(prompt).not.toContain('Backend Reviewer');
        expect(prompt).not.toContain('Database Reviewer');
      });

      it('should include multiple reviewers when multiple agents suggested', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['backend', 'database', 'testing'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 1);

        expect(prompt).toContain('Backend Reviewer');
        expect(prompt).toContain('Database Reviewer');
        expect(prompt).toContain('Test Reviewer');
      });
    });

    describe('focus on critical issues', () => {
      it('should emphasize critical issues only', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 1);

        expect(prompt).toContain('Critical Issues Only');
      });

      it('should mention skipping minor issues', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 1);

        expect(prompt).toContain('Skip minor');
      });
    });

    describe('required markers', () => {
      it('should include DECISION_NEEDED marker', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 1);

        expect(prompt).toContain('[DECISION_NEEDED');
      });

      it('should include PLAN_APPROVED marker', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage2PromptStreamlined(session, mockPlan, 1);

        expect(prompt).toContain('[PLAN_APPROVED]');
      });
    });

    describe('prompt length comparison', () => {
      it('should be shorter than full Stage 2 prompt', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const fullPrompt = buildStage2Prompt(baseSession, mockPlan, 1);
        const streamlinedPrompt = buildStage2PromptStreamlined(session, mockPlan, 1);

        expect(streamlinedPrompt.length).toBeLessThan(fullPrompt.length);
      });
    });
  });

  describe('buildStage2PromptStreamlinedLean', () => {
    it('should be very concise', () => {
      const prompt = buildStage2PromptStreamlinedLean(mockPlan, 2, null, '/tmp/plan.md', 'simple');

      expect(prompt.length).toBeLessThan(300);
    });

    it('should include 3-iteration format', () => {
      const prompt = buildStage2PromptStreamlinedLean(mockPlan, 2, null, null, 'simple');

      expect(prompt).toContain('2/3');
    });

    it('should be even shorter than streamlined full prompt', () => {
      const session: Session = {
        ...baseSession,
        assessedComplexity: 'simple',
        suggestedAgents: ['frontend'],
      };

      const streamlinedFull = buildStage2PromptStreamlined(session, mockPlan, 2);
      const streamlinedLean = buildStage2PromptStreamlinedLean(mockPlan, 2, null, null, 'simple');

      expect(streamlinedLean.length).toBeLessThan(streamlinedFull.length);
    });
  });

  describe('buildStage5PromptStreamlined', () => {
    describe('always includes CI reviewer', () => {
      it('should always include CI Reviewer even when not in suggestedAgents', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('CI Reviewer');
      });

      it('should include CI Reviewer alongside other suggested agents', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['backend', 'database'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('Backend Reviewer');
        expect(prompt).toContain('Database Reviewer');
        expect(prompt).toContain('CI Reviewer');
      });

      it('should not duplicate CI Reviewer if infrastructure is already suggested', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend', 'infrastructure'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        // Should only appear once
        const ciReviewerMatches = prompt.match(/CI Reviewer/g);
        expect(ciReviewerMatches?.length).toBe(1);
      });

      it('should use infrastructure key for CI Reviewer (step-19 verification)', () => {
        // This test documents that 'infrastructure' is the correct key for CI Reviewer
        // in STAGE5_REVIEW_AGENTS, not 'ci'
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['infrastructure'], // Use the correct key
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        // The infrastructure agent should produce CI Reviewer
        expect(prompt).toContain('CI Reviewer');
        expect(prompt).toContain('gh pr checks');
      });
    });

    describe('spawns fewer agents than full prompt', () => {
      it('should only include suggested agents (plus CI)', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('Frontend Reviewer');
        expect(prompt).toContain('CI Reviewer');
        expect(prompt).not.toContain('Backend Reviewer');
        expect(prompt).not.toContain('Database Reviewer');
        expect(prompt).not.toContain('Docs Reviewer');
      });

      it('should spawn fewer review agents than full prompt', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const fullPrompt = buildStage5Prompt(baseSession, mockPlan, prInfo);
        const streamlinedPrompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        // Full prompt has 4 fixed agents (Code, Security, Test, Integration)
        expect(fullPrompt).toContain('Code Agent');
        expect(fullPrompt).toContain('Security Agent');
        expect(fullPrompt).toContain('Test Agent');
        expect(fullPrompt).toContain('Integration Agent');

        // Streamlined prompt only includes suggested agents + CI
        expect(streamlinedPrompt).toContain('Frontend Reviewer');
        expect(streamlinedPrompt).toContain('CI Reviewer');
        expect(streamlinedPrompt).not.toContain('Backend Reviewer');
      });
    });

    describe('required markers', () => {
      it('should include REVIEW_CHECKPOINT marker', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('[REVIEW_CHECKPOINT]');
        expect(prompt).toContain('[/REVIEW_CHECKPOINT]');
      });

      it('should include CI_STATUS marker', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('[CI_STATUS');
        expect(prompt).toContain('[/CI_STATUS]');
      });

      it('should include PLAN_STEP marker for findings', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('[PLAN_STEP');
      });

      it('should include CI_FAILED marker', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('[CI_FAILED]');
      });

      it('should include PR_APPROVED marker', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('[PR_APPROVED]');
      });
    });

    describe('PR information', () => {
      it('should include PR URL', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('https://github.com/test/repo/pull/123');
      });

      it('should include branch name', () => {
        const session: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo);

        expect(prompt).toContain('feature/test');
      });
    });
  });

  describe('buildStage5PromptStreamlinedLean', () => {
    const leanPrInfo = {
      title: 'fix: Update button label',
      url: 'https://github.com/test/repo/pull/456',
    };

    it('should be very concise', () => {
      const prompt = buildStage5PromptStreamlinedLean(leanPrInfo, 'simple');

      expect(prompt.length).toBeLessThan(300);
    });

    it('should include PR information', () => {
      const prompt = buildStage5PromptStreamlinedLean(leanPrInfo, 'simple');

      expect(prompt).toContain('https://github.com/test/repo/pull/456');
      expect(prompt).toContain('fix: Update button label');
    });

    it('should suggest skipping extensive review', () => {
      const prompt = buildStage5PromptStreamlinedLean(leanPrInfo, 'simple');

      expect(prompt).toContain('skip extensive');
    });

    it('should include required markers', () => {
      const prompt = buildStage5PromptStreamlinedLean(leanPrInfo, 'simple');

      expect(prompt).toContain('[PLAN_STEP]');
      expect(prompt).toContain('[CI_FAILED]');
      expect(prompt).toContain('[PR_APPROVED]');
    });
  });

  describe('complexity-based prompt selection', () => {
    /**
     * These tests verify the logic for selecting streamlined vs full prompts
     * based on assessedComplexity. In production, selectStageXPromptBuilder
     * functions in app.ts make this decision.
     */

    describe('Stage 1 prompt selection', () => {
      it('trivial complexity should get streamlined prompt with 1-2 agents', () => {
        const sessionTrivial: Session = {
          ...baseSession,
          assessedComplexity: 'trivial',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage1PromptStreamlined(sessionTrivial);

        // Should be focused/streamlined
        expect(prompt).toContain('Focused Exploration');
        expect(prompt).toContain('streamlined');
        // Should have fewer agents
        expect(prompt).toContain('Frontend Agent');
        expect(prompt).not.toContain('Architecture Agent');
      });

      it('simple complexity should get streamlined prompt', () => {
        const sessionSimple: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend', 'testing'],
        };

        const prompt = buildStage1PromptStreamlined(sessionSimple);

        expect(prompt).toContain('Focused Exploration');
      });

      it('normal complexity should use full prompt', () => {
        // Note: selectStage1PromptBuilder chooses full prompt for normal
        const sessionNormal: Session = {
          ...baseSession,
          assessedComplexity: 'normal',
        };

        const prompt = buildStage1Prompt(sessionNormal);

        expect(prompt).toContain('Codebase Exploration');
        expect(prompt).toContain('Architecture Agent');
        expect(prompt).toContain('Integration Agent'); // Only in full
      });

      it('complex complexity should use full prompt', () => {
        const sessionComplex: Session = {
          ...baseSession,
          assessedComplexity: 'complex',
        };

        const prompt = buildStage1Prompt(sessionComplex);

        expect(prompt).toContain('Codebase Exploration');
        expect(prompt).toContain('Architecture Agent');
      });
    });

    describe('Stage 2 prompt selection', () => {
      it('trivial complexity should get 3-iteration review', () => {
        const sessionTrivial: Session = {
          ...baseSession,
          assessedComplexity: 'trivial',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage2PromptStreamlined(sessionTrivial, mockPlan, 1);

        expect(prompt).toContain('1 of 3');
      });

      it('simple complexity should get 3-iteration review', () => {
        const sessionSimple: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend', 'testing'],
        };

        const prompt = buildStage2PromptStreamlined(sessionSimple, mockPlan, 1);

        expect(prompt).toContain('1 of 3');
      });

      it('normal complexity should use full 10-iteration review', () => {
        // Note: selectStage2PromptBuilder chooses full prompt for normal
        const sessionNormal: Session = {
          ...baseSession,
          assessedComplexity: 'normal',
        };

        const prompt = buildStage2Prompt(sessionNormal, mockPlan, 1);

        expect(prompt).toContain('1 of 10');
      });

      it('complex complexity should use full 10-iteration review', () => {
        const sessionComplex: Session = {
          ...baseSession,
          assessedComplexity: 'complex',
        };

        const prompt = buildStage2Prompt(sessionComplex, mockPlan, 1);

        expect(prompt).toContain('1 of 10');
      });
    });

    describe('Stage 5 prompt selection', () => {
      it('trivial complexity should get focused review with CI', () => {
        const sessionTrivial: Session = {
          ...baseSession,
          assessedComplexity: 'trivial',
          suggestedAgents: ['documentation'],
        };

        const prompt = buildStage5PromptStreamlined(sessionTrivial, mockPlan, prInfo);

        expect(prompt).toContain('Docs Reviewer');
        expect(prompt).toContain('CI Reviewer');
        expect(prompt).not.toContain('Security Agent'); // From full prompt
      });

      it('simple complexity should get focused review with CI', () => {
        const sessionSimple: Session = {
          ...baseSession,
          assessedComplexity: 'simple',
          suggestedAgents: ['frontend'],
        };

        const prompt = buildStage5PromptStreamlined(sessionSimple, mockPlan, prInfo);

        expect(prompt).toContain('focused review');
        expect(prompt).toContain('CI Reviewer');
      });

      it('normal complexity should use full review', () => {
        const sessionNormal: Session = {
          ...baseSession,
          assessedComplexity: 'normal',
        };

        const prompt = buildStage5Prompt(sessionNormal, mockPlan, prInfo);

        // Full prompt has more comprehensive review with all 4 agents
        expect(prompt).toContain('Security Agent');
        expect(prompt).toContain('Code Agent');
        expect(prompt).toContain('Test Agent');
        expect(prompt).toContain('Integration Agent');
      });

      it('complex complexity should use full review', () => {
        const sessionComplex: Session = {
          ...baseSession,
          assessedComplexity: 'complex',
        };

        const prompt = buildStage5Prompt(sessionComplex, mockPlan, prInfo);

        // Full prompt should have all review agents
        expect(prompt).toContain('Security Agent');
        expect(prompt).toContain('Code Agent');
        expect(prompt).toContain('Test Agent');
        expect(prompt).toContain('Integration Agent');
      });
    });
  });

  describe('lean prompt comparison', () => {
    describe('Stage 2 lean prompts', () => {
      it('streamlined lean should be shorter than standard lean', () => {
        const standardLean = buildStage2PromptLean(mockPlan, 2, null, '/tmp/plan.md');
        const streamlinedLean = buildStage2PromptStreamlinedLean(mockPlan, 2, null, '/tmp/plan.md', 'simple');

        // Both should be concise, but streamlined can be slightly different
        expect(standardLean.length).toBeLessThan(500);
        expect(streamlinedLean.length).toBeLessThan(500);
      });

      it('streamlined lean should reference 3 iterations', () => {
        const streamlinedLean = buildStage2PromptStreamlinedLean(mockPlan, 2, null, null, 'simple');

        expect(streamlinedLean).toContain('2/3');
      });

      it('standard lean should reference 10 iterations', () => {
        const standardLean = buildStage2PromptLean(mockPlan, 2, null, null);

        expect(standardLean).toContain('2/10');
      });
    });

    describe('Stage 5 lean prompts', () => {
      const leanPrInfo = { title: 'Test PR', url: 'https://github.com/test/pr/1' };

      it('streamlined lean should mention skipping extensive review', () => {
        const streamlinedLean = buildStage5PromptStreamlinedLean(leanPrInfo, 'simple');

        expect(streamlinedLean).toContain('skip extensive');
      });

      it('both lean prompts should be very concise', () => {
        const standardLean = buildStage5PromptLean(leanPrInfo);
        const streamlinedLean = buildStage5PromptStreamlinedLean(leanPrInfo, 'simple');

        expect(standardLean.length).toBeLessThan(400);
        expect(streamlinedLean.length).toBeLessThan(400);
      });
    });
  });

  describe('useExternalAgents option', () => {
    const baseSession: Session = {
      version: '1.0',
      id: 'test-session-id',
      projectId: 'test-project',
      featureId: 'test-feature',
      title: 'Test Feature',
      featureDescription: 'A test feature description with enough detail',
      projectPath: '/test/project',
      acceptanceCriteria: [{ text: 'Feature works', checked: false, type: 'manual' }],
      affectedFiles: ['src/component.tsx'],
      technicalNotes: 'Use existing patterns',
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
      assessedComplexity: 'simple',
      suggestedAgents: ['frontend', 'backend'],
    };

    const mockPlan: Plan = {
      id: 'plan-123',
      sessionId: 'session-123',
      status: 'pending',
      version: 1,
      planVersion: 1,
      steps: [
        {
          id: 'step-1',
          title: 'Implement feature',
          description: 'Create the main component',
          status: 'pending',
          order: 0,
          dependencies: [],
          complexity: 'low',
        },
      ],
      createdAt: '2026-01-11T00:00:00Z',
      updatedAt: '2026-01-11T00:00:00Z',
    };

    const prInfo = {
      title: 'feat: Test',
      branch: 'feature/test',
      url: 'https://github.com/test/repo/pull/123',
    };

    describe('buildStage1PromptStreamlined with useExternalAgents', () => {
      it('should include full agent instructions when useExternalAgents is false', () => {
        const prompt = buildStage1PromptStreamlined(baseSession, { useExternalAgents: false });

        // Full instructions include detailed content
        expect(prompt).toContain('Explore UI layer patterns');
        expect(prompt).toContain('Explore API/server layer patterns');
      });

      it('should include only agent names when useExternalAgents is true', () => {
        const prompt = buildStage1PromptStreamlined(baseSession, { useExternalAgents: true });

        // Should have agent names with type in parentheses
        expect(prompt).toContain('**Frontend Agent** (frontend)');
        expect(prompt).toContain('**Backend Agent** (backend)');
        // Should NOT have the full instructions
        expect(prompt).not.toContain('Explore UI layer patterns');
        expect(prompt).not.toContain('Explore API/server layer patterns');
      });

      it('should produce shorter prompt when useExternalAgents is true', () => {
        const fullPrompt = buildStage1PromptStreamlined(baseSession, { useExternalAgents: false });
        const leanPrompt = buildStage1PromptStreamlined(baseSession, { useExternalAgents: true });

        expect(leanPrompt.length).toBeLessThan(fullPrompt.length);
      });

      it('should default to false when options is undefined', () => {
        const promptNoOptions = buildStage1PromptStreamlined(baseSession);
        const promptFalse = buildStage1PromptStreamlined(baseSession, { useExternalAgents: false });

        // Both should include full instructions
        expect(promptNoOptions).toContain('Explore UI layer patterns');
        expect(promptFalse).toContain('Explore UI layer patterns');
      });
    });

    describe('buildStage2PromptStreamlined with useExternalAgents', () => {
      it('should include full agent focus when useExternalAgents is false', () => {
        const prompt = buildStage2PromptStreamlined(baseSession, mockPlan, 1, { useExternalAgents: false });

        // Full focus includes detailed content
        expect(prompt).toContain('Component correctness');
        expect(prompt).toContain('Endpoint correctness');
      });

      it('should include only agent names when useExternalAgents is true', () => {
        const prompt = buildStage2PromptStreamlined(baseSession, mockPlan, 1, { useExternalAgents: true });

        // Should have agent names with type in parentheses
        expect(prompt).toContain('**Frontend Reviewer** (frontend)');
        expect(prompt).toContain('**Backend Reviewer** (backend)');
        // Should NOT have the full focus
        expect(prompt).not.toContain('Component correctness');
        expect(prompt).not.toContain('Endpoint correctness');
      });

      it('should produce shorter prompt when useExternalAgents is true', () => {
        const fullPrompt = buildStage2PromptStreamlined(baseSession, mockPlan, 1, { useExternalAgents: false });
        const leanPrompt = buildStage2PromptStreamlined(baseSession, mockPlan, 1, { useExternalAgents: true });

        expect(leanPrompt.length).toBeLessThan(fullPrompt.length);
      });
    });

    describe('buildStage5PromptStreamlined with useExternalAgents', () => {
      it('should include full agent focus when useExternalAgents is false', () => {
        const prompt = buildStage5PromptStreamlined(baseSession, mockPlan, prInfo, { useExternalAgents: false });

        // Full focus includes detailed content
        expect(prompt).toContain('git diff main...HEAD');
        expect(prompt).toContain('Correctness:');
      });

      it('should include only agent names when useExternalAgents is true', () => {
        const prompt = buildStage5PromptStreamlined(baseSession, mockPlan, prInfo, { useExternalAgents: true });

        // Should have agent names with type in parentheses
        expect(prompt).toContain('**Frontend Reviewer** (frontend)');
        expect(prompt).toContain('**Backend Reviewer** (backend)');
        expect(prompt).toContain('**CI Reviewer** (infrastructure)');
        // Should NOT have the full focus
        expect(prompt).not.toContain('git diff main...HEAD');
      });

      it('should produce shorter prompt when useExternalAgents is true', () => {
        const fullPrompt = buildStage5PromptStreamlined(baseSession, mockPlan, prInfo, { useExternalAgents: false });
        const leanPrompt = buildStage5PromptStreamlined(baseSession, mockPlan, prInfo, { useExternalAgents: true });

        expect(leanPrompt.length).toBeLessThan(fullPrompt.length);
      });

      it('should always include infrastructure agent even when useExternalAgents is true', () => {
        const session = { ...baseSession, suggestedAgents: ['frontend'] };
        const prompt = buildStage5PromptStreamlined(session, mockPlan, prInfo, { useExternalAgents: true });

        // Infrastructure (CI) should always be included
        expect(prompt).toContain('(infrastructure)');
      });
    });
  });
});

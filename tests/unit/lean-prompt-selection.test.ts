/**
 * Tests for lean prompt selection logic.
 *
 * These tests verify that the correct prompt (lean vs full) is selected
 * based on session state. The selection logic mirrors what's in app.ts.
 */

import { Session, Plan, PlanStep } from '@claude-code-web/shared';
import {
  buildStage2Prompt,
  buildStage2PromptLean,
  buildSingleStepPrompt,
  buildSingleStepPromptLean,
  buildStage4Prompt,
  buildStage4PromptLean,
  buildStage5Prompt,
  buildStage5PromptLean,
} from '../../server/src/prompts/stagePrompts';

describe('Lean Prompt Selection Logic', () => {
  // Base mock session without Claude session IDs
  const baseSession: Session = {
    version: '1.0',
    dataVersion: 1,
    id: 'test-session-id',
    projectId: 'test-project',
    featureId: 'add-auth',
    title: 'Add User Authentication',
    featureDescription: 'Implement JWT-based authentication',
    projectPath: '/Users/test/project',
    acceptanceCriteria: [{ text: 'Users can login', checked: false }],
    affectedFiles: [],
    technicalNotes: '',
    baseBranch: 'main',
    featureBranch: 'feature/add-auth',
    baseCommitSha: 'abc123',
    status: 'discovery',
    currentStage: 1,
    replanningCount: 0,
    claudeSessionId: null,
    claudePlanFilePath: '/path/to/plan.md',
    currentPlanVersion: 1,
    claudeStage3SessionId: null,
    prUrl: null,
    sessionExpiresAt: '2026-01-12T00:00:00Z',
    createdAt: '2026-01-11T00:00:00Z',
    updatedAt: '2026-01-11T00:00:00Z',
  };

  const mockPlan: Plan = {
    version: '1.0',
    planVersion: 1,
    sessionId: 'test-session-id',
    isApproved: true,
    reviewCount: 1,
    createdAt: '2026-01-11T00:00:00Z',
    steps: [
      {
        id: 'step-1',
        parentId: null,
        orderIndex: 0,
        title: 'Create feature branch',
        description: 'Create and checkout feature branch from main',
        status: 'completed',
        metadata: {},
      },
      {
        id: 'step-2',
        parentId: 'step-1',
        orderIndex: 1,
        title: 'Implement auth middleware',
        description: 'Set up JWT validation in middleware',
        status: 'pending',
        metadata: {},
      },
    ],
    testRequirement: {
      required: true,
      testTypes: ['unit'],
      existingFramework: 'vitest',
    },
  };

  /**
   * Simulates the Stage 2 prompt selection logic from app.ts
   * Uses lean prompt when currentIteration > 1
   */
  function selectStage2Prompt(
    session: Session,
    plan: Plan,
    currentIteration: number
  ): { type: 'lean' | 'full'; prompt: string } {
    if (currentIteration > 1) {
      return {
        type: 'lean',
        prompt: buildStage2PromptLean(
          plan,
          currentIteration,
          session.planValidationContext,
          session.claudePlanFilePath
        ),
      };
    }
    return {
      type: 'full',
      prompt: buildStage2Prompt(session, plan, currentIteration),
    };
  }

  /**
   * Simulates the Stage 3 single step prompt selection logic from app.ts
   * Uses lean prompt when claudeStage3SessionId exists AND completedSteps.length > 0
   */
  function selectStage3Prompt(
    session: Session,
    plan: Plan,
    step: PlanStep,
    completedSteps: Array<{ id: string; title: string; summary: string }>
  ): { type: 'lean' | 'full'; prompt: string } {
    const testsRequired = plan.testRequirement?.required ?? true;
    const useLeanPrompt = session.claudeStage3SessionId !== null && completedSteps.length > 0;

    if (useLeanPrompt) {
      return {
        type: 'lean',
        prompt: buildSingleStepPromptLean(step, completedSteps, testsRequired),
      };
    }
    return {
      type: 'full',
      prompt: buildSingleStepPrompt(session, plan, step, completedSteps),
    };
  }

  /**
   * Simulates the Stage 4 prompt selection logic from app.ts
   * Uses lean prompt when claudeSessionId exists
   */
  function selectStage4Prompt(
    session: Session,
    plan: Plan
  ): { type: 'lean' | 'full'; prompt: string } {
    const completedStepsCount = plan.steps.filter(s => s.status === 'completed').length;

    if (session.claudeSessionId) {
      return {
        type: 'lean',
        prompt: buildStage4PromptLean(session, completedStepsCount),
      };
    }
    return {
      type: 'full',
      prompt: buildStage4Prompt(session, plan),
    };
  }

  /**
   * Simulates the Stage 5 prompt selection logic from app.ts
   * Uses lean prompt when claudeSessionId exists AND prReviewCount > 0
   * (mirrors Stage 2's reviewCount pattern)
   */
  function selectStage5Prompt(
    session: Session,
    plan: Plan,
    prInfo: { title: string; url: string; branch: string }
  ): { type: 'lean' | 'full'; prompt: string } {
    const useLeanStage5 = session.claudeSessionId && (session.prReviewCount || 0) > 0;
    if (useLeanStage5) {
      return {
        type: 'lean',
        prompt: buildStage5PromptLean(prInfo),
      };
    }
    return {
      type: 'full',
      prompt: buildStage5Prompt(session, plan, prInfo),
    };
  }

  describe('Stage 2 Selection', () => {
    it('should use full prompt on first iteration (currentIteration === 1)', () => {
      const result = selectStage2Prompt(baseSession, mockPlan, 1);

      expect(result.type).toBe('full');
      expect(result.prompt).toContain('You are reviewing an implementation plan');
      expect(result.prompt).toContain('Composable Plan Structure');
    });

    it('should use lean prompt on subsequent iterations (currentIteration > 1)', () => {
      const result = selectStage2Prompt(baseSession, mockPlan, 2);

      expect(result.type).toBe('lean');
      expect(result.prompt).toContain('Continue plan review');
      expect(result.prompt).toContain('iteration 2/10');
      expect(result.prompt).not.toContain('Composable Plan Structure');
    });

    it('should use lean prompt on iteration 5', () => {
      const result = selectStage2Prompt(baseSession, mockPlan, 5);

      expect(result.type).toBe('lean');
      expect(result.prompt).toContain('iteration 5/10');
    });

    it('should include validation context in lean prompt when present', () => {
      const sessionWithValidation = {
        ...baseSession,
        planValidationContext: 'Missing complexity ratings',
      };

      const result = selectStage2Prompt(sessionWithValidation, mockPlan, 2);

      expect(result.type).toBe('lean');
      expect(result.prompt).toContain('Missing complexity ratings');
    });
  });

  describe('Stage 3 Selection', () => {
    const step: PlanStep = {
      id: 'step-2',
      parentId: 'step-1',
      orderIndex: 1,
      title: 'Implement auth middleware',
      description: 'Set up JWT validation',
      status: 'in_progress',
      metadata: {},
    };

    const completedSteps = [
      { id: 'step-1', title: 'Create feature branch', summary: 'Branch created' },
    ];

    it('should use full prompt when claudeStage3SessionId is null (first step)', () => {
      const result = selectStage3Prompt(baseSession, mockPlan, step, completedSteps);

      expect(result.type).toBe('full');
      expect(result.prompt).toContain('You are implementing one step');
      expect(result.prompt).toContain('Execution Process');
    });

    it('should use full prompt when no completed steps even with session ID', () => {
      const sessionWithId = {
        ...baseSession,
        claudeStage3SessionId: 'stage3-session-123',
      };

      const result = selectStage3Prompt(sessionWithId, mockPlan, step, []);

      expect(result.type).toBe('full');
      expect(result.prompt).toContain('You are implementing one step');
    });

    it('should use lean prompt when claudeStage3SessionId exists AND has completed steps', () => {
      const sessionWithId = {
        ...baseSession,
        claudeStage3SessionId: 'stage3-session-123',
      };

      const result = selectStage3Prompt(sessionWithId, mockPlan, step, completedSteps);

      expect(result.type).toBe('lean');
      expect(result.prompt).toContain('Current Step: [step-2]');
      expect(result.prompt).not.toContain('You are implementing one step');
    });

    it('should include completed steps in lean prompt', () => {
      const sessionWithId = {
        ...baseSession,
        claudeStage3SessionId: 'stage3-session-123',
      };

      const result = selectStage3Prompt(sessionWithId, mockPlan, step, completedSteps);

      expect(result.type).toBe('lean');
      expect(result.prompt).toContain('[step-1] Create feature branch');
    });

    it('should include test requirement note in lean prompt', () => {
      const sessionWithId = {
        ...baseSession,
        claudeStage3SessionId: 'stage3-session-123',
      };

      const result = selectStage3Prompt(sessionWithId, mockPlan, step, completedSteps);

      expect(result.prompt).toContain('Write tests before marking complete');
    });
  });

  describe('Stage 4 Selection', () => {
    it('should use full prompt when claudeSessionId is null', () => {
      const result = selectStage4Prompt(baseSession, mockPlan);

      expect(result.type).toBe('full');
      expect(result.prompt).toContain('You are creating a pull request');
      expect(result.prompt).toContain('Phase 1: Review Changes');
    });

    it('should use lean prompt when claudeSessionId exists', () => {
      const sessionWithId = {
        ...baseSession,
        claudeSessionId: 'claude-session-123',
      };

      const result = selectStage4Prompt(sessionWithId, mockPlan);

      expect(result.type).toBe('lean');
      expect(result.prompt).toContain('Create PR');
      expect(result.prompt).not.toContain('You are creating a pull request');
    });

    it('should include correct step count in lean prompt', () => {
      const sessionWithId = {
        ...baseSession,
        claudeSessionId: 'claude-session-123',
      };

      const result = selectStage4Prompt(sessionWithId, mockPlan);

      expect(result.prompt).toContain('1 steps'); // Only step-1 is completed
    });

    it('should include branch info in lean prompt', () => {
      const sessionWithId = {
        ...baseSession,
        claudeSessionId: 'claude-session-123',
      };

      const result = selectStage4Prompt(sessionWithId, mockPlan);

      expect(result.prompt).toContain('--base main');
      expect(result.prompt).toContain('--head feature/add-auth');
    });
  });

  describe('Stage 5 Selection', () => {
    const prInfo = {
      title: 'feat: Add JWT authentication',
      url: 'https://github.com/test/repo/pull/123',
      branch: 'feature/add-auth',
    };

    it('should use full prompt when claudeSessionId is null', () => {
      const result = selectStage5Prompt(baseSession, mockPlan, prInfo);

      expect(result.type).toBe('full');
      expect(result.prompt).toContain('You are reviewing a pull request');
      expect(result.prompt).toContain('Phase 1: Parallel Review');
    });

    it('should use full prompt when claudeSessionId exists but prReviewCount is 0 (first review)', () => {
      const sessionWithId = {
        ...baseSession,
        claudeSessionId: 'claude-session-123',
        prReviewCount: 0,
      };

      const result = selectStage5Prompt(sessionWithId, mockPlan, prInfo);

      expect(result.type).toBe('full');
      expect(result.prompt).toContain('You are reviewing a pull request');
      expect(result.prompt).toContain('Phase 1: Parallel Review');
    });

    it('should use full prompt when claudeSessionId exists but prReviewCount is undefined (first review)', () => {
      const sessionWithId = {
        ...baseSession,
        claudeSessionId: 'claude-session-123',
        // prReviewCount not set (undefined)
      };

      const result = selectStage5Prompt(sessionWithId, mockPlan, prInfo);

      expect(result.type).toBe('full');
      expect(result.prompt).toContain('You are reviewing a pull request');
    });

    it('should use lean prompt when claudeSessionId exists AND prReviewCount > 0 (subsequent reviews)', () => {
      const sessionWithId = {
        ...baseSession,
        claudeSessionId: 'claude-session-123',
        prReviewCount: 1,
      };

      const result = selectStage5Prompt(sessionWithId, mockPlan, prInfo);

      expect(result.type).toBe('lean');
      expect(result.prompt).toContain('Review PR:');
      expect(result.prompt).not.toContain('You are reviewing a pull request');
    });

    it('should include PR URL in lean prompt', () => {
      const sessionWithId = {
        ...baseSession,
        claudeSessionId: 'claude-session-123',
        prReviewCount: 1,
      };

      const result = selectStage5Prompt(sessionWithId, mockPlan, prInfo);

      expect(result.prompt).toContain('https://github.com/test/repo/pull/123');
    });

    it('should include PR title in lean prompt', () => {
      const sessionWithId = {
        ...baseSession,
        claudeSessionId: 'claude-session-123',
        prReviewCount: 1,
      };

      const result = selectStage5Prompt(sessionWithId, mockPlan, prInfo);

      expect(result.prompt).toContain('feat: Add JWT authentication');
    });

    it('should use lean prompt on multiple subsequent reviews (prReviewCount > 1)', () => {
      const sessionWithMultipleReviews = {
        ...baseSession,
        claudeSessionId: 'claude-session-123',
        prReviewCount: 3,
      };

      const result = selectStage5Prompt(sessionWithMultipleReviews, mockPlan, prInfo);

      expect(result.type).toBe('lean');
      expect(result.prompt).toContain('Review PR:');
    });
  });

  describe('Prompt Size Verification', () => {
    const step: PlanStep = mockPlan.steps[1];
    const completedSteps = [
      { id: 'step-1', title: 'Create feature branch', summary: 'Done' },
    ];
    const prInfo = {
      title: 'Test PR',
      url: 'https://github.com/test/pr/1',
      branch: 'feature/test',
    };

    it('Stage 2: lean prompt should be significantly smaller than full', () => {
      const full = selectStage2Prompt(baseSession, mockPlan, 1);
      const lean = selectStage2Prompt(baseSession, mockPlan, 2);

      expect(lean.prompt.length).toBeLessThan(full.prompt.length * 0.3);
    });

    it('Stage 3: lean prompt should be significantly smaller than full', () => {
      const full = selectStage3Prompt(baseSession, mockPlan, step, completedSteps);
      const sessionWithId = { ...baseSession, claudeStage3SessionId: 'test' };
      const lean = selectStage3Prompt(sessionWithId, mockPlan, step, completedSteps);

      expect(lean.prompt.length).toBeLessThan(full.prompt.length * 0.4);
    });

    it('Stage 4: lean prompt should be significantly smaller than full', () => {
      const full = selectStage4Prompt(baseSession, mockPlan);
      const sessionWithId = { ...baseSession, claudeSessionId: 'test' };
      const lean = selectStage4Prompt(sessionWithId, mockPlan);

      expect(lean.prompt.length).toBeLessThan(full.prompt.length * 0.2);
    });

    it('Stage 5: lean prompt should be significantly smaller than full', () => {
      const full = selectStage5Prompt(baseSession, mockPlan, prInfo);
      const sessionWithId = { ...baseSession, claudeSessionId: 'test', prReviewCount: 1 };
      const lean = selectStage5Prompt(sessionWithId, mockPlan, prInfo);

      expect(lean.prompt.length).toBeLessThan(full.prompt.length * 0.2);
    });
  });
});

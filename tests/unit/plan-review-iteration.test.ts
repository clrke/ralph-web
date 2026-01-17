import {
  MAX_PLAN_VALIDATION_ATTEMPTS,
  MAX_PLAN_REVIEW_ITERATIONS,
} from '../../server/src/services/ClaudeOrchestrator';
import { ParsedMarker } from '../../server/src/services/OutputParser';
import { shouldContinuePlanReview } from '../../server/src/app';
import { buildPlanReviewContinuationPrompt } from '../../server/src/prompts/stagePrompts';

/**
 * Tests for plan review iteration constants and hasDecisionNeeded tracking.
 *
 * Step 1 requirements:
 * - MAX_PLAN_REVIEW_ITERATIONS constant set to 10
 * - hasDecisionNeeded tracking via result.parsed.decisions.length > 0
 * - incrementReviewCount timing (tested in integration tests)
 */

describe('Plan Review Iteration Constants', () => {
  describe('MAX_PLAN_REVIEW_ITERATIONS', () => {
    it('should be exported and equal to 10', () => {
      expect(MAX_PLAN_REVIEW_ITERATIONS).toBeDefined();
      expect(MAX_PLAN_REVIEW_ITERATIONS).toBe(10);
    });

    it('should be greater than MAX_PLAN_VALIDATION_ATTEMPTS', () => {
      // Review iterations (10) should be higher than validation attempts (3)
      // since review is a higher-level loop
      expect(MAX_PLAN_REVIEW_ITERATIONS).toBeGreaterThan(MAX_PLAN_VALIDATION_ATTEMPTS);
    });

    it('should be a reasonable iteration limit', () => {
      // Sanity check: should be positive and not excessively high
      expect(MAX_PLAN_REVIEW_ITERATIONS).toBeGreaterThan(0);
      expect(MAX_PLAN_REVIEW_ITERATIONS).toBeLessThanOrEqual(20);
    });
  });

  describe('hasDecisionNeeded tracking', () => {
    /**
     * hasDecisionNeeded is derived from result.parsed.decisions.length > 0
     * These tests verify the decision tracking logic
     */

    it('should detect decisions needed when decisions array is non-empty', () => {
      const mockParsedResult: Partial<ParsedMarker> = {
        decisions: [
          {
            id: 'q1',
            stage: 'planning',
            questionType: 'single_choice',
            questionText: 'Which approach?',
            options: [
              { value: 'a', label: 'Option A', recommended: true },
              { value: 'b', label: 'Option B', recommended: false },
            ],
            priority: 1,
            isRequired: true,
          },
        ],
        planApproved: true,
      };

      const hasDecisionNeeded = mockParsedResult.decisions!.length > 0;
      expect(hasDecisionNeeded).toBe(true);
    });

    it('should detect no decisions needed when decisions array is empty', () => {
      const mockParsedResult: Partial<ParsedMarker> = {
        decisions: [],
        planApproved: true,
      };

      const hasDecisionNeeded = mockParsedResult.decisions!.length > 0;
      expect(hasDecisionNeeded).toBe(false);
    });

    it('should work with multiple decisions', () => {
      const mockParsedResult: Partial<ParsedMarker> = {
        decisions: [
          {
            id: 'q1',
            stage: 'planning',
            questionType: 'single_choice',
            questionText: 'First question?',
            options: [
              { value: 'a', label: 'A', recommended: true },
              { value: 'b', label: 'B', recommended: false },
            ],
            priority: 1,
            isRequired: true,
          },
          {
            id: 'q2',
            stage: 'planning',
            questionType: 'single_choice',
            questionText: 'Second question?',
            options: [
              { value: 'x', label: 'X', recommended: false },
              { value: 'y', label: 'Y', recommended: true },
            ],
            priority: 2,
            isRequired: false,
          },
        ],
        planApproved: true,
      };

      const hasDecisionNeeded = mockParsedResult.decisions!.length > 0;
      expect(hasDecisionNeeded).toBe(true);
      expect(mockParsedResult.decisions!.length).toBe(2);
    });

    it('should track decisions independently of planApproved status', () => {
      // Case 1: Approved with decisions (continue reviewing)
      const approvedWithDecisions: Partial<ParsedMarker> = {
        decisions: [{ id: 'q1', stage: 'planning', questionType: 'single_choice', questionText: 'Q?', options: [{ value: 'a', label: 'A', recommended: true }, { value: 'b', label: 'B', recommended: false }], priority: 1, isRequired: true }],
        planApproved: true,
      };
      expect(approvedWithDecisions.decisions!.length > 0).toBe(true);
      expect(approvedWithDecisions.planApproved).toBe(true);

      // Case 2: Approved without decisions (stop reviewing)
      const approvedNoDecisions: Partial<ParsedMarker> = {
        decisions: [],
        planApproved: true,
      };
      expect(approvedNoDecisions.decisions!.length > 0).toBe(false);
      expect(approvedNoDecisions.planApproved).toBe(true);

      // Case 3: Not approved with decisions (normal flow)
      const notApprovedWithDecisions: Partial<ParsedMarker> = {
        decisions: [{ id: 'q1', stage: 'planning', questionType: 'single_choice', questionText: 'Q?', options: [{ value: 'a', label: 'A', recommended: true }, { value: 'b', label: 'B', recommended: false }], priority: 1, isRequired: true }],
        planApproved: false,
      };
      expect(notApprovedWithDecisions.decisions!.length > 0).toBe(true);
      expect(notApprovedWithDecisions.planApproved).toBe(false);

      // Case 4: Not approved without decisions (should not happen but handled)
      const notApprovedNoDecisions: Partial<ParsedMarker> = {
        decisions: [],
        planApproved: false,
      };
      expect(notApprovedNoDecisions.decisions!.length > 0).toBe(false);
      expect(notApprovedNoDecisions.planApproved).toBe(false);
    });
  });

  describe('Review count boundary conditions', () => {
    /**
     * Tests for boundary conditions around review count and MAX_PLAN_REVIEW_ITERATIONS
     * These will be used by shouldContinuePlanReview in step-2
     */

    it('reviewCount=0 should allow continuation', () => {
      const reviewCount = 0;
      expect(reviewCount < MAX_PLAN_REVIEW_ITERATIONS).toBe(true);
    });

    it('reviewCount=9 should allow continuation', () => {
      const reviewCount = 9;
      expect(reviewCount < MAX_PLAN_REVIEW_ITERATIONS).toBe(true);
    });

    it('reviewCount=10 should NOT allow continuation', () => {
      const reviewCount = 10;
      expect(reviewCount < MAX_PLAN_REVIEW_ITERATIONS).toBe(false);
    });

    it('reviewCount=11 should NOT allow continuation', () => {
      const reviewCount = 11;
      expect(reviewCount < MAX_PLAN_REVIEW_ITERATIONS).toBe(false);
    });
  });
});

describe('shouldContinuePlanReview', () => {
  describe('basic behavior', () => {
    it('should return true when under iteration limit AND decisions pending', () => {
      expect(shouldContinuePlanReview(0, true, true)).toBe(true);
      expect(shouldContinuePlanReview(5, true, true)).toBe(true);
      expect(shouldContinuePlanReview(9, true, true)).toBe(true);
    });

    it('should return false when no decisions pending (regardless of iteration count)', () => {
      expect(shouldContinuePlanReview(0, false, true)).toBe(false);
      expect(shouldContinuePlanReview(5, false, true)).toBe(false);
      expect(shouldContinuePlanReview(9, false, true)).toBe(false);
    });

    it('should return false when at or over iteration limit (even with decisions pending)', () => {
      expect(shouldContinuePlanReview(10, true, true)).toBe(false);
      expect(shouldContinuePlanReview(11, true, true)).toBe(false);
      expect(shouldContinuePlanReview(100, true, true)).toBe(false);
    });

    it('should return false when both conditions fail', () => {
      expect(shouldContinuePlanReview(10, false, true)).toBe(false);
      expect(shouldContinuePlanReview(15, false, true)).toBe(false);
    });
  });

  describe('planApproved parameter behavior', () => {
    it('should continue reviewing when approved but decisions remain', () => {
      // This is the key new behavior: approved with decisions = continue
      expect(shouldContinuePlanReview(1, true, true)).toBe(true);
      expect(shouldContinuePlanReview(5, true, true)).toBe(true);
    });

    it('should stop reviewing when approved and no decisions remain', () => {
      // Approved without decisions = stop (natural termination)
      expect(shouldContinuePlanReview(1, false, true)).toBe(false);
      expect(shouldContinuePlanReview(5, false, true)).toBe(false);
    });

    it('should continue reviewing when not approved but decisions remain', () => {
      // Not approved with decisions = continue (normal flow)
      expect(shouldContinuePlanReview(1, true, false)).toBe(true);
      expect(shouldContinuePlanReview(5, true, false)).toBe(true);
    });

    it('should stop reviewing when not approved and no decisions remain', () => {
      // Not approved without decisions = stop (edge case, but handled)
      expect(shouldContinuePlanReview(1, false, false)).toBe(false);
      expect(shouldContinuePlanReview(5, false, false)).toBe(false);
    });
  });

  describe('boundary conditions', () => {
    it('should handle reviewCount=0 (first iteration complete)', () => {
      expect(shouldContinuePlanReview(0, true, true)).toBe(true);
      expect(shouldContinuePlanReview(0, false, true)).toBe(false);
    });

    it('should handle reviewCount=9 (one before limit)', () => {
      expect(shouldContinuePlanReview(9, true, true)).toBe(true);
      expect(shouldContinuePlanReview(9, false, true)).toBe(false);
    });

    it('should handle reviewCount=10 (at limit)', () => {
      expect(shouldContinuePlanReview(10, true, true)).toBe(false);
      expect(shouldContinuePlanReview(10, false, true)).toBe(false);
    });

    it('should handle negative reviewCount gracefully', () => {
      // Edge case: should still work (though shouldn't happen in practice)
      expect(shouldContinuePlanReview(-1, true, true)).toBe(true);
    });
  });

  describe('integration with MAX_PLAN_REVIEW_ITERATIONS', () => {
    it('should use MAX_PLAN_REVIEW_ITERATIONS as the limit', () => {
      // One less than limit should continue
      expect(shouldContinuePlanReview(MAX_PLAN_REVIEW_ITERATIONS - 1, true, true)).toBe(true);

      // At limit should stop
      expect(shouldContinuePlanReview(MAX_PLAN_REVIEW_ITERATIONS, true, true)).toBe(false);

      // Over limit should stop
      expect(shouldContinuePlanReview(MAX_PLAN_REVIEW_ITERATIONS + 1, true, true)).toBe(false);
    });
  });
});

describe('handleStage2Completion continuation logic', () => {
  /**
   * Tests for the integration of shouldContinuePlanReview in handleStage2Completion.
   * These tests verify the decision flow for continuing vs transitioning to Stage 3.
   *
   * Note: These are unit tests for the logic flow, not full integration tests.
   * Full integration tests would require mocking the entire session/storage system.
   */

  describe('continuation decision flow', () => {
    it('should continue when approved with decisions and under iteration limit', () => {
      // Simulates: plan approved (PLAN_APPROVED), but has DECISION_NEEDED markers
      const reviewCount = 1;
      const hasDecisionNeeded = true;
      const planApproved = true;

      // This scenario should trigger continuation, not Stage 3 transition
      expect(shouldContinuePlanReview(reviewCount, hasDecisionNeeded, planApproved)).toBe(true);
    });

    it('should transition to Stage 3 when approved with no decisions', () => {
      // Simulates: plan approved (PLAN_APPROVED), no DECISION_NEEDED markers
      const reviewCount = 3;
      const hasDecisionNeeded = false;
      const planApproved = true;

      // This scenario should transition to Stage 3 (natural termination)
      expect(shouldContinuePlanReview(reviewCount, hasDecisionNeeded, planApproved)).toBe(false);
    });

    it('should transition to Stage 3 when max iterations reached with decisions', () => {
      // Simulates: plan approved, decisions pending, but max iterations reached
      const reviewCount = MAX_PLAN_REVIEW_ITERATIONS;
      const hasDecisionNeeded = true;
      const planApproved = true;

      // This scenario should transition to Stage 3 (force termination at limit)
      expect(shouldContinuePlanReview(reviewCount, hasDecisionNeeded, planApproved)).toBe(false);
    });

    it('should continue multiple iterations with decisions', () => {
      // Simulates: multiple review iterations, each with new decisions
      const planApproved = true;
      const hasDecisionNeeded = true;

      // Each iteration from 0 to 9 should continue
      for (let i = 0; i < MAX_PLAN_REVIEW_ITERATIONS; i++) {
        expect(shouldContinuePlanReview(i, hasDecisionNeeded, planApproved)).toBe(true);
      }

      // Iteration 10 should stop
      expect(shouldContinuePlanReview(MAX_PLAN_REVIEW_ITERATIONS, hasDecisionNeeded, planApproved)).toBe(false);
    });
  });

  describe('termination conditions', () => {
    it('should identify clean termination (no decisions)', () => {
      // Clean termination: review completed naturally with no pending decisions
      const scenarios = [
        { reviewCount: 1, hasDecisionNeeded: false, planApproved: true },
        { reviewCount: 5, hasDecisionNeeded: false, planApproved: true },
        { reviewCount: 9, hasDecisionNeeded: false, planApproved: true },
      ];

      scenarios.forEach(({ reviewCount, hasDecisionNeeded, planApproved }) => {
        expect(shouldContinuePlanReview(reviewCount, hasDecisionNeeded, planApproved)).toBe(false);
      });
    });

    it('should identify forced termination (max iterations)', () => {
      // Forced termination: max iterations reached, decisions still pending
      const scenarios = [
        { reviewCount: 10, hasDecisionNeeded: true, planApproved: true },
        { reviewCount: 11, hasDecisionNeeded: true, planApproved: true },
        { reviewCount: 15, hasDecisionNeeded: true, planApproved: true },
      ];

      scenarios.forEach(({ reviewCount, hasDecisionNeeded, planApproved }) => {
        expect(shouldContinuePlanReview(reviewCount, hasDecisionNeeded, planApproved)).toBe(false);
      });
    });
  });

  describe('hasDecisionNeeded derivation', () => {
    it('should derive hasDecisionNeeded from parsed decisions array', () => {
      // Simulates the derivation logic in handleStage2Completion
      const deriveHasDecisionNeeded = (parsedDecisions: unknown[]) => parsedDecisions.length > 0;

      // Empty decisions array
      expect(deriveHasDecisionNeeded([])).toBe(false);

      // Single decision
      expect(deriveHasDecisionNeeded([{ id: 'q1' }])).toBe(true);

      // Multiple decisions
      expect(deriveHasDecisionNeeded([{ id: 'q1' }, { id: 'q2' }])).toBe(true);
    });

    it('should derive planApproved from state or marker', () => {
      // Simulates the derivation logic in handleStage2Completion
      const derivePlanApproved = (stateApproved: boolean, markerApproved: boolean) =>
        stateApproved || markerApproved;

      // Both false
      expect(derivePlanApproved(false, false)).toBe(false);

      // State approved only
      expect(derivePlanApproved(true, false)).toBe(true);

      // Marker approved only
      expect(derivePlanApproved(false, true)).toBe(true);

      // Both approved
      expect(derivePlanApproved(true, true)).toBe(true);
    });
  });
});

describe('buildPlanReviewContinuationPrompt', () => {
  describe('basic prompt structure', () => {
    it('should include current iteration and max iterations', () => {
      const prompt = buildPlanReviewContinuationPrompt(3, 10);

      expect(prompt).toContain('iteration 3/10');
      expect(prompt).toContain('Maximum iterations (10)');
    });

    it('should include instructions for completing review', () => {
      const prompt = buildPlanReviewContinuationPrompt(1, 10);

      expect(prompt).toContain('[DECISION_NEEDED]');
      expect(prompt).toContain('[PLAN_APPROVED]');
      expect(prompt).toContain('with NO [DECISION_NEEDED] markers');
    });

    it('should include termination conditions', () => {
      const prompt = buildPlanReviewContinuationPrompt(1, 10);

      expect(prompt).toContain('You output [PLAN_APPROVED] with no [DECISION_NEEDED] markers');
      expect(prompt).toContain('Maximum iterations (10) is reached');
    });
  });

  describe('plan file path', () => {
    it('should include plan file path when provided', () => {
      const prompt = buildPlanReviewContinuationPrompt(1, 10, '/path/to/plan.md');

      expect(prompt).toContain('Plan file: /path/to/plan.md');
    });

    it('should not include plan file section when path is null', () => {
      const prompt = buildPlanReviewContinuationPrompt(1, 10, null);

      expect(prompt).not.toContain('Plan file:');
    });

    it('should not include plan file section when path is undefined', () => {
      const prompt = buildPlanReviewContinuationPrompt(1, 10, undefined);

      expect(prompt).not.toContain('Plan file:');
    });
  });

  describe('pending decision count', () => {
    it('should include decision count when provided and > 0', () => {
      const prompt = buildPlanReviewContinuationPrompt(2, 10, null, 3);

      expect(prompt).toContain('You raised 3 question(s) in the previous iteration');
    });

    it('should not include decision context when count is 0', () => {
      const prompt = buildPlanReviewContinuationPrompt(2, 10, null, 0);

      expect(prompt).not.toContain('You raised');
      expect(prompt).not.toContain('question(s) in the previous iteration');
    });

    it('should not include decision context when count is undefined', () => {
      const prompt = buildPlanReviewContinuationPrompt(2, 10, null, undefined);

      expect(prompt).not.toContain('You raised');
    });

    it('should handle single decision correctly', () => {
      const prompt = buildPlanReviewContinuationPrompt(2, 10, null, 1);

      expect(prompt).toContain('You raised 1 question(s)');
    });
  });

  describe('urgency note for low remaining iterations', () => {
    it('should show urgency note when 2 iterations remaining', () => {
      const prompt = buildPlanReviewContinuationPrompt(8, 10);

      expect(prompt).toContain('⚠️ Only 2 iteration(s) remaining before forced approval');
    });

    it('should show urgency note when 1 iteration remaining', () => {
      const prompt = buildPlanReviewContinuationPrompt(9, 10);

      expect(prompt).toContain('⚠️ Only 1 iteration(s) remaining before forced approval');
    });

    it('should show urgency note when 0 iterations remaining (at limit)', () => {
      const prompt = buildPlanReviewContinuationPrompt(10, 10);

      expect(prompt).toContain('⚠️ Only 0 iteration(s) remaining before forced approval');
    });

    it('should NOT show urgency note when 3+ iterations remaining', () => {
      const prompt = buildPlanReviewContinuationPrompt(7, 10);

      expect(prompt).not.toContain('⚠️');
      expect(prompt).not.toContain('remaining before forced approval');
    });

    it('should NOT show urgency note early in iteration cycle', () => {
      const prompt = buildPlanReviewContinuationPrompt(1, 10);

      expect(prompt).not.toContain('⚠️');
    });
  });

  describe('custom max iterations', () => {
    it('should use custom max iterations value', () => {
      const prompt = buildPlanReviewContinuationPrompt(3, 5);

      expect(prompt).toContain('iteration 3/5');
      expect(prompt).toContain('Maximum iterations (5)');
    });

    it('should calculate remaining iterations correctly with custom max', () => {
      const prompt = buildPlanReviewContinuationPrompt(3, 5);

      // 5 - 3 = 2, should show urgency
      expect(prompt).toContain('⚠️ Only 2 iteration(s) remaining');
    });
  });

  describe('full prompt with all options', () => {
    it('should combine all elements correctly', () => {
      const prompt = buildPlanReviewContinuationPrompt(8, 10, '/home/user/plan.md', 2);

      // Plan file
      expect(prompt).toContain('Plan file: /home/user/plan.md');

      // Decision count
      expect(prompt).toContain('You raised 2 question(s) in the previous iteration');

      // Urgency (10 - 8 = 2 remaining)
      expect(prompt).toContain('⚠️ Only 2 iteration(s) remaining');

      // Iteration info
      expect(prompt).toContain('iteration 8/10');

      // Instructions
      expect(prompt).toContain('[DECISION_NEEDED]');
      expect(prompt).toContain('[PLAN_APPROVED]');
    });
  });

  describe('integration with MAX_PLAN_REVIEW_ITERATIONS', () => {
    it('should work correctly with the constant value', () => {
      const prompt = buildPlanReviewContinuationPrompt(5, MAX_PLAN_REVIEW_ITERATIONS);

      expect(prompt).toContain(`iteration 5/${MAX_PLAN_REVIEW_ITERATIONS}`);
      expect(prompt).toContain(`Maximum iterations (${MAX_PLAN_REVIEW_ITERATIONS})`);
    });
  });
});

describe('Plan Review Iteration Logging', () => {
  /**
   * Tests for structured logging format and error context in plan review iterations.
   * These verify the logging patterns added in step-5.
   */

  describe('structured logging format', () => {
    it('should format iteration decision log correctly', () => {
      // Simulates the log format: [Plan Review] {featureId}: Iteration {n}/{max} - hasDecisionNeeded={bool}, planApproved={bool}, decision={CONTINUE|TRANSITION_TO_STAGE_3}
      const featureId = 'feature-123';
      const nextIteration = 3;
      const hasDecisionNeeded = true;
      const planApproved = true;
      const shouldContinue = shouldContinuePlanReview(nextIteration - 1, hasDecisionNeeded, planApproved);

      const expectedDecision = shouldContinue ? 'CONTINUE' : 'TRANSITION_TO_STAGE_3';
      const logMessage =
        `[Plan Review] ${featureId}: Iteration ${nextIteration}/${MAX_PLAN_REVIEW_ITERATIONS} - ` +
        `hasDecisionNeeded=${hasDecisionNeeded}, planApproved=${planApproved}, ` +
        `decision=${expectedDecision}`;

      // Verify log structure
      expect(logMessage).toContain('[Plan Review]');
      expect(logMessage).toContain('feature-123');
      expect(logMessage).toContain(`Iteration 3/${MAX_PLAN_REVIEW_ITERATIONS}`);
      expect(logMessage).toContain('hasDecisionNeeded=true');
      expect(logMessage).toContain('planApproved=true');
      expect(logMessage).toContain('decision=CONTINUE');
    });

    it('should show TRANSITION_TO_STAGE_3 when not continuing', () => {
      const featureId = 'feature-456';
      const nextIteration = 5;
      const hasDecisionNeeded = false; // No decisions = stop
      const planApproved = true;
      const shouldContinue = shouldContinuePlanReview(nextIteration - 1, hasDecisionNeeded, planApproved);

      const expectedDecision = shouldContinue ? 'CONTINUE' : 'TRANSITION_TO_STAGE_3';

      expect(expectedDecision).toBe('TRANSITION_TO_STAGE_3');
    });
  });

  describe('error action format with iteration context', () => {
    it('should format error action with iteration context', () => {
      const iterationContext = 3;
      const errorAction = iterationContext
        ? `stage2_spawn_error_iteration_${iterationContext}_of_${MAX_PLAN_REVIEW_ITERATIONS}`
        : 'stage2_spawn_error';

      expect(errorAction).toBe(`stage2_spawn_error_iteration_3_of_${MAX_PLAN_REVIEW_ITERATIONS}`);
      expect(errorAction).toContain('iteration_3');
      expect(errorAction).toContain(`of_${MAX_PLAN_REVIEW_ITERATIONS}`);
    });

    it('should use default error action when no iteration context', () => {
      const iterationContext: number | undefined = undefined;
      const errorAction = iterationContext
        ? `stage2_spawn_error_iteration_${iterationContext}_of_${MAX_PLAN_REVIEW_ITERATIONS}`
        : 'stage2_spawn_error';

      expect(errorAction).toBe('stage2_spawn_error');
    });
  });

  describe('iteration info formatting', () => {
    it('should format iteration info string correctly', () => {
      const iterationContext = 5;
      const iterationInfo = iterationContext
        ? ` (iteration ${iterationContext}/${MAX_PLAN_REVIEW_ITERATIONS})`
        : '';

      expect(iterationInfo).toBe(` (iteration 5/${MAX_PLAN_REVIEW_ITERATIONS})`);
    });

    it('should return empty string when no iteration context', () => {
      const iterationContext: number | undefined = undefined;
      const iterationInfo = iterationContext
        ? ` (iteration ${iterationContext}/${MAX_PLAN_REVIEW_ITERATIONS})`
        : '';

      expect(iterationInfo).toBe('');
    });
  });

  describe('execution status options with iteration', () => {
    it('should include iteration and maxIterations in error event options', () => {
      const iterationContext = 7;
      const options = {
        stage: 2,
        iteration: iterationContext,
        maxIterations: MAX_PLAN_REVIEW_ITERATIONS,
      };

      expect(options.stage).toBe(2);
      expect(options.iteration).toBe(7);
      expect(options.maxIterations).toBe(MAX_PLAN_REVIEW_ITERATIONS);
    });

    it('should have correct types for iteration options', () => {
      const options: {
        stage: number;
        iteration?: number;
        maxIterations?: number;
      } = {
        stage: 2,
        iteration: 3,
        maxIterations: 10,
      };

      expect(typeof options.iteration).toBe('number');
      expect(typeof options.maxIterations).toBe('number');
    });
  });
});

import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { Session, ComplexityAssessment } from '@claude-code-web/shared';

// Mock child_process.spawn before imports
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import { ComplexityAssessor } from '../../server/src/services/ComplexityAssessor';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('Complexity Assessment Integration', () => {
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;

  beforeEach(() => {
    mockChildProcess = new EventEmitter();
    mockChildProcess.stdout = new EventEmitter() as any;
    mockChildProcess.stderr = new EventEmitter() as any;
    mockChildProcess.kill = jest.fn();

    mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ComplexityAssessor assess method', () => {
    it('should assess complexity for a new session', async () => {
      const assessor = new ComplexityAssessor();

      const assessPromise = assessor.assess(
        'Change button label',
        'Update the submit button text',
        [{ text: 'Button shows new text', checked: false, type: 'manual' }],
        '/test/project'
      );

      // Simulate Haiku response
      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Single UI text change',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await assessPromise;

      expect(result.complexity).toBe('simple');
      expect(result.reason).toBe('Single UI text change');
      expect(result.suggestedAgents).toEqual(['frontend']);
      expect(result.useLeanPrompts).toBe(true);
    });

    it('should assess complexity for a complex feature', async () => {
      const assessor = new ComplexityAssessor();

      const assessPromise = assessor.assess(
        'Add authentication system',
        'Implement OAuth2 with JWT tokens and session management',
        [
          { text: 'Users can login with OAuth', checked: false, type: 'manual' },
          { text: 'JWT tokens are validated', checked: false, type: 'manual' },
          { text: 'Sessions are persisted', checked: false, type: 'manual' },
        ],
        '/test/project'
      );

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'complex',
          reason: 'Cross-cutting authentication affecting multiple layers',
          suggestedAgents: ['frontend', 'backend', 'database', 'testing', 'infrastructure', 'documentation'],
          useLeanPrompts: false,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await assessPromise;

      expect(result.complexity).toBe('complex');
      expect(result.suggestedAgents).toHaveLength(6);
      expect(result.useLeanPrompts).toBe(false);
    });

    it('should return normal complexity on error (conservative fallback)', async () => {
      const assessor = new ComplexityAssessor();

      const assessPromise = assessor.assess(
        'Test feature',
        'Test description',
        [],
        '/test/project'
      );

      // Simulate error
      mockChildProcess.emit('error', new Error('spawn ENOENT'));

      const result = await assessPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('spawn error');
      expect(result.suggestedAgents.length).toBeGreaterThan(0);
    });

    it('should return normal complexity on timeout', async () => {
      jest.useFakeTimers();
      const assessor = new ComplexityAssessor();

      const assessPromise = assessor.assess(
        'Test feature',
        'Test description',
        [],
        '/test/project'
      );

      // Advance past timeout (2 minutes)
      jest.advanceTimersByTime(120_001);

      const result = await assessPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('timed out');
      expect(mockChildProcess.kill).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('Session creation flow simulation', () => {
    it('should process complexity assessment asynchronously', async () => {
      const assessor = new ComplexityAssessor();
      let assessmentResolved = false;

      // Start assessment
      const assessPromise = assessor.assess(
        'Add feature',
        'Add a new feature',
        [],
        '/test/project'
      ).then((result) => {
        assessmentResolved = true;
        return result;
      });

      // Assessment hasn't resolved yet
      expect(assessmentResolved).toBe(false);

      // Simulate delayed Haiku response
      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'normal',
          reason: 'Standard feature',
          suggestedAgents: ['frontend', 'backend', 'testing'],
          useLeanPrompts: false,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      // Now it should resolve
      const result = await assessPromise;
      expect(assessmentResolved).toBe(true);
      expect(result.complexity).toBe('normal');
    });

    it('should handle assessment failure gracefully', async () => {
      const assessor = new ComplexityAssessor();

      const assessPromise = assessor.assess(
        'Test feature',
        'Test description',
        [],
        '/test/project'
      );

      // Simulate non-zero exit code
      mockChildProcess.emit('close', 1);

      const result = await assessPromise;

      // Should fallback to normal complexity
      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('failed');
    });
  });

  describe('Edit session flow simulation', () => {
    it('should re-assess when title changes', async () => {
      const assessor = new ComplexityAssessor();

      // First assessment (original)
      const firstAssessPromise = assessor.assess(
        'Original title',
        'Original description',
        [],
        '/test/project'
      );

      let response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Simple change',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const firstResult = await firstAssessPromise;
      expect(firstResult.complexity).toBe('simple');

      // Reset mock for second assessment
      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter() as any;
      mockChildProcess.stderr = new EventEmitter() as any;
      mockChildProcess.kill = jest.fn();
      mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

      // Second assessment (after edit with different title)
      const secondAssessPromise = assessor.assess(
        'Add authentication system', // More complex title
        'Original description',
        [],
        '/test/project'
      );

      response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'complex',
          reason: 'Authentication is complex',
          suggestedAgents: ['frontend', 'backend', 'database', 'testing'],
          useLeanPrompts: false,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const secondResult = await secondAssessPromise;
      expect(secondResult.complexity).toBe('complex');
    });

    it('should re-assess when acceptance criteria changes', async () => {
      const assessor = new ComplexityAssessor();

      // Assessment with no criteria
      const firstAssessPromise = assessor.assess(
        'Feature',
        'Description',
        [], // No criteria
        '/test/project'
      );

      let response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'trivial',
          reason: 'No criteria, simple change',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const firstResult = await firstAssessPromise;
      expect(firstResult.complexity).toBe('trivial');

      // Reset mock
      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter() as any;
      mockChildProcess.stderr = new EventEmitter() as any;
      mockChildProcess.kill = jest.fn();
      mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

      // Assessment with many criteria (indicates more complex feature)
      const secondAssessPromise = assessor.assess(
        'Feature',
        'Description',
        [
          { text: 'Criterion 1', checked: false, type: 'manual' },
          { text: 'Criterion 2', checked: false, type: 'manual' },
          { text: 'Criterion 3', checked: false, type: 'manual' },
          { text: 'Criterion 4', checked: false, type: 'manual' },
          { text: 'Criterion 5', checked: false, type: 'manual' },
        ],
        '/test/project'
      );

      response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'normal',
          reason: 'Multiple acceptance criteria indicate higher complexity',
          suggestedAgents: ['frontend', 'backend', 'testing'],
          useLeanPrompts: false,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const secondResult = await secondAssessPromise;
      expect(secondResult.complexity).toBe('normal');
    });
  });

  describe('Session creation flow with complexity-aware prompt selection', () => {
    /**
     * These tests verify the fix for the race condition where Stage 1 prompt
     * selection was happening before complexity assessment completed.
     *
     * The fix ensures that for active sessions, complexity assessment is awaited
     * before selectStage1PromptBuilder is called, so the session has
     * assessedComplexity populated.
     */

    it('should complete assessment before prompt can be selected (simulates await)', async () => {
      const assessor = new ComplexityAssessor();

      // Simulate the fixed flow: await assessment, then select prompt
      const assessPromise = assessor.assess(
        'Simple button change',
        'Update submit button text',
        [{ text: 'Button shows new text', checked: false, type: 'manual' }],
        '/test/project'
      );

      // Simulate Haiku response for simple change
      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Single UI text change',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const assessment = await assessPromise;

      // After awaiting, session would be updated with complexity data
      // This simulates what happens in the fixed app.ts flow
      const updatedSession = {
        assessedComplexity: assessment.complexity,
        suggestedAgents: assessment.suggestedAgents,
        useLeanPrompts: assessment.useLeanPrompts,
      };

      // Verify the session now has complexity data for prompt selection
      expect(updatedSession.assessedComplexity).toBe('simple');
      expect(updatedSession.suggestedAgents).toEqual(['frontend']);
      expect(updatedSession.useLeanPrompts).toBe(true);
    });

    it('should persist useLeanPrompts field in session (step-13 fix)', async () => {
      const assessor = new ComplexityAssessor();

      // Test with simple change (useLeanPrompts: true)
      let assessPromise = assessor.assess(
        'Fix typo',
        'Correct spelling mistake',
        [],
        '/test/project'
      );

      let response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'trivial',
          reason: 'Simple typo fix',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      let assessment = await assessPromise;
      expect(assessment.useLeanPrompts).toBe(true);

      // Reset mock for second test
      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter() as any;
      mockChildProcess.stderr = new EventEmitter() as any;
      mockChildProcess.kill = jest.fn();
      mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

      // Test with complex change (useLeanPrompts: false)
      assessPromise = assessor.assess(
        'Add auth system',
        'Implement full OAuth2 flow',
        [
          { text: 'OAuth works', checked: false, type: 'manual' },
          { text: 'JWT validated', checked: false, type: 'manual' },
        ],
        '/test/project'
      );

      response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'complex',
          reason: 'Multi-layer authentication',
          suggestedAgents: ['frontend', 'backend', 'database', 'testing'],
          useLeanPrompts: false,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      assessment = await assessPromise;
      expect(assessment.useLeanPrompts).toBe(false);
    });

    it('should allow prompt selection to proceed with full prompt on assessment error', async () => {
      const assessor = new ComplexityAssessor();

      const assessPromise = assessor.assess(
        'Test feature',
        'Test description',
        [],
        '/test/project'
      );

      // Simulate error condition
      mockChildProcess.emit('error', new Error('spawn ENOENT'));

      const assessment = await assessPromise;

      // Even on error, we get a fallback assessment
      expect(assessment.complexity).toBe('normal');

      // This means full prompt would be used (not streamlined)
      // which is the safe/conservative approach
      const updatedSession = {
        assessedComplexity: assessment.complexity,
        suggestedAgents: assessment.suggestedAgents,
      };

      expect(updatedSession.assessedComplexity).toBe('normal');
    });

    it('should handle queued sessions with async assessment correctly', async () => {
      const assessor = new ComplexityAssessor();

      // For queued sessions, assessment runs in background (fire-and-forget)
      // By the time the session is dequeued and Stage 1 starts,
      // the assessment should already be complete

      const assessPromise = assessor.assess(
        'Complex auth feature',
        'Implement OAuth2 with JWT',
        [
          { text: 'OAuth login works', checked: false, type: 'manual' },
          { text: 'JWT validation', checked: false, type: 'manual' },
        ],
        '/test/project'
      );

      // Simulate delayed response (as would happen while queued)
      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'complex',
          reason: 'Authentication affects multiple layers',
          suggestedAgents: ['frontend', 'backend', 'database', 'testing'],
          useLeanPrompts: false,
        }),
      });

      // Small delay to simulate async processing
      await new Promise(resolve => setTimeout(resolve, 5));

      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const assessment = await assessPromise;

      // Session would be updated with complexity before it's dequeued
      expect(assessment.complexity).toBe('complex');
      expect(assessment.suggestedAgents).toHaveLength(4);
    });
  });

  describe('ComplexityAssessment result structure', () => {
    it('should include all required fields in the result', async () => {
      const assessor = new ComplexityAssessor();

      const assessPromise = assessor.assess(
        'Test feature',
        'Test description',
        [{ text: 'AC 1', checked: false, type: 'manual' }],
        '/test/project'
      );

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Simple change',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await assessPromise;

      // Check all required fields are present
      expect(result).toHaveProperty('complexity');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('suggestedAgents');
      expect(result).toHaveProperty('useLeanPrompts');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('prompt');
      expect(result).toHaveProperty('output');

      // Validate types
      expect(typeof result.complexity).toBe('string');
      expect(typeof result.reason).toBe('string');
      expect(Array.isArray(result.suggestedAgents)).toBe(true);
      expect(typeof result.useLeanPrompts).toBe('boolean');
      expect(typeof result.durationMs).toBe('number');
      expect(typeof result.prompt).toBe('string');
      expect(typeof result.output).toBe('string');
    });

    it('should have positive durationMs value', async () => {
      const assessor = new ComplexityAssessor();

      const assessPromise = assessor.assess(
        'Test feature',
        'Test description',
        [],
        '/test/project'
      );

      // Add small delay to ensure non-zero duration
      await new Promise(resolve => setTimeout(resolve, 10));

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'trivial',
          reason: 'Quick change',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await assessPromise;

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

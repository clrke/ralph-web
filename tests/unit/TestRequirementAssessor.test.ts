import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { Plan, Session } from '@claude-code-web/shared';

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import { TestRequirementAssessor } from '../../server/src/services/TestRequirementAssessor';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('TestRequirementAssessor', () => {
  let assessor: TestRequirementAssessor;
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;

  const mockSession: Session = {
    projectId: 'project-123',
    featureId: 'feature-123',
    title: 'Add user authentication',
    featureDescription: 'Implement login and logout functionality',
    status: 'stage3_implementing',
    stage: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockPlan: Plan = {
    id: 'plan-123',
    sessionId: 'session-123',
    status: 'approved',
    version: 1,
    steps: [
      {
        id: 'step-1',
        title: 'Create login form',
        description: 'Build the login UI component',
        status: 'completed',
        order: 0,
        dependencies: [],
      },
      {
        id: 'step-2',
        title: 'Add authentication API',
        description: 'Implement backend auth endpoints',
        status: 'in_progress',
        order: 1,
        dependencies: ['step-1'],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    assessor = new TestRequirementAssessor();
    mockChildProcess = new EventEmitter();
    mockChildProcess.stdout = new EventEmitter() as any;
    mockChildProcess.stderr = new EventEmitter() as any;
    mockChildProcess.kill = jest.fn();

    mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('assess', () => {
    it('should return tests required when Haiku determines they are needed', async () => {
      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          required: true,
          reason: 'Authentication code requires thorough testing',
          testTypes: ['unit', 'integration'],
          existingFramework: 'jest',
          suggestedCoverage: '80% for auth modules',
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.required).toBe(true);
      expect(result.reason).toBe('Authentication code requires thorough testing');
      expect(result.testTypes).toEqual(['unit', 'integration']);
      expect(result.existingFramework).toBe('jest');
      expect(result.suggestedCoverage).toBe('80% for auth modules');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return tests not required when Haiku determines they are not needed', async () => {
      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          required: false,
          reason: 'This is a documentation-only change',
          testTypes: [],
          existingFramework: null,
          suggestedCoverage: 'N/A',
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.required).toBe(false);
      expect(result.reason).toBe('This is a documentation-only change');
      expect(result.testTypes).toEqual([]);
    });

    it('should require tests conservatively on timeout', async () => {
      jest.useFakeTimers();

      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      // Advance past the 2-minute timeout
      jest.advanceTimersByTime(120_001);

      const result = await resultPromise;

      expect(result.required).toBe(true);
      expect(result.reason).toContain('timed out');
      expect(result.testTypes).toEqual(['unit']);
      expect(mockChildProcess.kill).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should require tests conservatively on process error', async () => {
      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      mockChildProcess.emit('close', 1);

      const result = await resultPromise;

      expect(result.required).toBe(true);
      expect(result.reason).toContain('failed (code 1)');
      expect(result.testTypes).toEqual(['unit']);
    });

    it('should require tests conservatively on spawn error', async () => {
      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      mockChildProcess.emit('error', new Error('spawn ENOENT'));

      const result = await resultPromise;

      expect(result.required).toBe(true);
      expect(result.reason).toContain('spawn error');
      expect(result.testTypes).toEqual(['unit']);
    });

    it('should require tests conservatively on invalid JSON response', async () => {
      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      mockChildProcess.stdout!.emit('data', Buffer.from('not valid json'));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.required).toBe(true);
      expect(result.reason).toContain('parse');
    });

    it('should require tests conservatively when JSON lacks required fields', async () => {
      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      const response = JSON.stringify({
        result: '{"something": "else"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.required).toBe(true);
      expect(result.reason).toContain('parse');
    });

    it('should spawn claude with correct arguments', async () => {
      assessor.assess(mockSession, mockPlan, '/project');

      expect(mockSpawn).toHaveBeenCalledWith('claude', expect.arrayContaining([
        '--print',
        '--output-format', 'json',
        '--model', 'haiku',
        '--allowedTools', 'Read,Glob,Grep,WebFetch,WebSearch',
        '-p', expect.any(String),
      ]), expect.objectContaining({
        cwd: '/project',
      }));
    });

    it('should include prompt and output in result', async () => {
      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          required: true,
          reason: 'Tests needed',
          testTypes: ['unit'],
          existingFramework: 'jest',
          suggestedCoverage: '80%',
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.prompt).toBeDefined();
      expect(result.prompt.length).toBeGreaterThan(0);
      expect(result.output).toBe(response);
    });

    it('should handle response with extra text around JSON', async () => {
      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      const response = JSON.stringify({
        result: 'Here is my assessment:\n\n{"required": true, "reason": "Tests are needed for security"}\n\nLet me know if you need more info.',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.required).toBe(true);
      expect(result.reason).toBe('Tests are needed for security');
    });

    it('should handle empty testTypes array', async () => {
      const resultPromise = assessor.assess(mockSession, mockPlan, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          required: false,
          reason: 'No tests needed',
          // testTypes missing
          existingFramework: null,
          suggestedCoverage: '',
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.required).toBe(false);
      expect(result.testTypes).toEqual([]);
    });
  });
});

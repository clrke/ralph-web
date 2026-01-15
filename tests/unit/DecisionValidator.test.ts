import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { Plan, UserPreferences } from '@claude-code-web/shared';
import { DEFAULT_USER_PREFERENCES } from '@claude-code-web/shared';
import type { ParsedDecision } from '../../server/src/services/OutputParser';

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import { DecisionValidator } from '../../server/src/services/DecisionValidator';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('DecisionValidator', () => {
  let validator: DecisionValidator;
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;

  const mockDecision: ParsedDecision = {
    questionText: 'Should we use TypeScript or JavaScript?',
    category: 'technical',
    priority: 1,
    options: [
      { label: 'TypeScript', recommended: true },
      { label: 'JavaScript', recommended: false },
    ],
  };

  const mockPlan: Plan = {
    id: 'plan-123',
    sessionId: 'session-123',
    status: 'approved',
    version: 1,
    steps: [
      {
        id: 'step-1',
        title: 'Setup project',
        description: 'Initialize the project structure',
        status: 'completed',
        order: 0,
        dependencies: [],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    validator = new DecisionValidator();
    mockChildProcess = new EventEmitter();
    mockChildProcess.stdout = new EventEmitter() as any;
    mockChildProcess.stderr = new EventEmitter() as any;
    mockChildProcess.kill = jest.fn();

    mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    // Use mockReset instead of mockClear to also reset the implementation
    // This ensures the next test's beforeEach properly sets up mockReturnValue
    mockSpawn.mockReset();
  });

  describe('validateDecision', () => {
    it('should pass valid decisions', async () => {
      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      // Emit valid response
      const response = JSON.stringify({
        result: '{"action": "pass", "reason": "This is a valid architectural decision"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.action).toBe('pass');
      expect(result.reason).toBe('This is a valid architectural decision');
      expect(result.decision).toBe(mockDecision);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should filter invalid decisions', async () => {
      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      const response = JSON.stringify({
        result: '{"action": "filter", "reason": "This question is already answered in the codebase"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.action).toBe('filter');
      expect(result.reason).toBe('This question is already answered in the codebase');
    });

    it('should repurpose and return new questions', async () => {
      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      // Simple repurpose without nested options (which causes regex matching issues)
      const response = JSON.stringify({
        result: '{"action": "repurpose", "reason": "Question is too broad", "questions": [{"questionText": "What level of type safety is needed?"}]}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.action).toBe('repurpose');
      expect(result.repurposedQuestions).toHaveLength(1);
      expect(result.repurposedQuestions![0].questionText).toBe('What level of type safety is needed?');
    });

    it('should repurpose with nested options array', async () => {
      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      // Complex repurpose with nested options array (tests proper JSON parsing)
      const repurposeJson = {
        action: 'repurpose',
        reason: 'The concern is valid but framing is wrong',
        questions: [{
          questionText: 'Should we add comprehensive test coverage now?',
          category: 'approach',
          priority: 2,
          options: [
            { label: 'Add tests now (Recommended)', recommended: true, description: 'Write tests immediately' },
            { label: 'Integrate first, test after', recommended: false, description: 'Complete integration first' }
          ]
        }]
      };

      const response = JSON.stringify({
        result: JSON.stringify(repurposeJson),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.action).toBe('repurpose');
      expect(result.repurposedQuestions).toHaveLength(1);
      expect(result.repurposedQuestions![0].questionText).toBe('Should we add comprehensive test coverage now?');
      expect(result.repurposedQuestions![0].options).toHaveLength(2);
      expect(result.repurposedQuestions![0].options[0].label).toBe('Add tests now (Recommended)');
      expect(result.repurposedQuestions![0].options[0].recommended).toBe(true);
      expect(result.repurposedQuestions![0].options[0].description).toBe('Write tests immediately');
    });

    it('should pass conservatively on timeout', async () => {
      jest.useFakeTimers();

      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      // Advance past the 3-minute timeout
      jest.advanceTimersByTime(180_001);

      const result = await resultPromise;

      expect(result.action).toBe('pass');
      expect(result.reason).toContain('timed out');
      expect(mockChildProcess.kill).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should pass conservatively on process error', async () => {
      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      mockChildProcess.emit('close', 1);

      const result = await resultPromise;

      expect(result.action).toBe('pass');
      expect(result.reason).toContain('failed (code 1)');
    });

    it('should pass conservatively on spawn error', async () => {
      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      mockChildProcess.emit('error', new Error('spawn ENOENT'));

      const result = await resultPromise;

      expect(result.action).toBe('pass');
      expect(result.reason).toContain('spawn error');
    });

    it('should pass conservatively on invalid JSON response', async () => {
      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      mockChildProcess.stdout!.emit('data', Buffer.from('not valid json'));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.action).toBe('pass');
      expect(result.reason).toContain('parse');
    });

    it('should handle legacy valid/reason format', async () => {
      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      const response = JSON.stringify({
        result: '{"valid": true, "reason": "This is valid"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.action).toBe('pass');
      expect(result.reason).toBe('This is valid');
    });

    it('should handle legacy invalid response', async () => {
      const resultPromise = validator.validateDecision(mockDecision, mockPlan, '/project');

      const response = JSON.stringify({
        result: '{"valid": false, "reason": "Not a real question"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.action).toBe('filter');
      expect(result.reason).toBe('Not a real question');
    });

    it('should spawn claude with correct arguments', async () => {
      validator.validateDecision(mockDecision, mockPlan, '/project');

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
  });

  describe('validateDecisions', () => {
    it('should return empty results for empty input', async () => {
      const { validDecisions, log } = await validator.validateDecisions([], mockPlan, '/project');

      expect(validDecisions).toHaveLength(0);
      expect(log.totalDecisions).toBe(0);
      expect(log.passedCount).toBe(0);
      expect(log.filteredCount).toBe(0);
      expect(log.repurposedCount).toBe(0);
    });

    it('should process multiple decisions in parallel', async () => {
      const decisions: ParsedDecision[] = [
        { ...mockDecision, questionText: 'Question 1' },
        { ...mockDecision, questionText: 'Question 2' },
      ];

      const mockProcesses: (EventEmitter & Partial<ChildProcess>)[] = [];

      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
        proc.stdout = new EventEmitter() as any;
        proc.stderr = new EventEmitter() as any;
        proc.kill = jest.fn();
        mockProcesses.push(proc);
        return proc as ChildProcess;
      });

      const resultPromise = validator.validateDecisions(decisions, mockPlan, '/project');

      // Wait for both processes to be spawned
      await new Promise(resolve => setTimeout(resolve, 10));

      // Respond to both processes
      for (let i = 0; i < mockProcesses.length; i++) {
        const response = JSON.stringify({
          result: `{"action": "pass", "reason": "Valid question ${i + 1}"}`,
        });
        mockProcesses[i].stdout!.emit('data', Buffer.from(response));
        mockProcesses[i].emit('close', 0);
      }

      const { validDecisions, log } = await resultPromise;

      expect(validDecisions).toHaveLength(2);
      expect(log.totalDecisions).toBe(2);
      expect(log.passedCount).toBe(2);
    });

    it('should aggregate filtered decisions', async () => {
      const decisions: ParsedDecision[] = [
        { ...mockDecision, questionText: 'Question 1' },
        { ...mockDecision, questionText: 'Question 2' },
      ];

      const mockProcesses: (EventEmitter & Partial<ChildProcess>)[] = [];

      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
        proc.stdout = new EventEmitter() as any;
        proc.stderr = new EventEmitter() as any;
        proc.kill = jest.fn();
        mockProcesses.push(proc);
        return proc as ChildProcess;
      });

      const resultPromise = validator.validateDecisions(decisions, mockPlan, '/project');

      await new Promise(resolve => setTimeout(resolve, 10));

      // First passes, second filtered
      mockProcesses[0].stdout!.emit('data', Buffer.from(JSON.stringify({
        result: '{"action": "pass", "reason": "Valid"}',
      })));
      mockProcesses[0].emit('close', 0);

      mockProcesses[1].stdout!.emit('data', Buffer.from(JSON.stringify({
        result: '{"action": "filter", "reason": "Invalid"}',
      })));
      mockProcesses[1].emit('close', 0);

      const { validDecisions, log } = await resultPromise;

      expect(validDecisions).toHaveLength(1);
      expect(log.passedCount).toBe(1);
      expect(log.filteredCount).toBe(1);
    });

    it('should pass preferences to validateDecision for each decision', async () => {
      const decisions: ParsedDecision[] = [
        { ...mockDecision, questionText: 'Question 1' },
      ];

      const customPrefs: UserPreferences = {
        riskComfort: 'high',
        speedVsQuality: 'quality',
        scopeFlexibility: 'open',
        detailLevel: 'detailed',
        autonomyLevel: 'autonomous',
      };

      const mockProcesses: (EventEmitter & Partial<ChildProcess>)[] = [];

      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
        proc.stdout = new EventEmitter() as any;
        proc.stderr = new EventEmitter() as any;
        proc.kill = jest.fn();
        mockProcesses.push(proc);
        return proc as ChildProcess;
      });

      const resultPromise = validator.validateDecisions(decisions, mockPlan, '/project', customPrefs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Respond to process
      mockProcesses[0].stdout!.emit('data', Buffer.from(JSON.stringify({
        result: '{"action": "pass", "reason": "Valid question"}',
      })));
      mockProcesses[0].emit('close', 0);

      const { validDecisions } = await resultPromise;

      expect(validDecisions).toHaveLength(1);

      // Verify the prompt includes preferences
      const spawnCall = mockSpawn.mock.calls[0];
      const promptArg = spawnCall[1].find((arg: string, i: number, arr: string[]) => arr[i - 1] === '-p');
      expect(promptArg).toContain('## User Preferences');
      expect(promptArg).toContain('Risk Comfort: high');
      expect(promptArg).toContain('Scope Flexibility: open');
    });
  });

  describe('validateDecision with preferences', () => {
    it('should include preferences in prompt when provided', async () => {
      const resultPromise = validator.validateDecision(
        mockDecision,
        mockPlan,
        '/project',
        DEFAULT_USER_PREFERENCES
      );

      // Emit valid response
      const response = JSON.stringify({
        result: '{"action": "pass", "reason": "Valid decision"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      await resultPromise;

      // Verify spawn was called with prompt containing preferences
      const spawnCall = mockSpawn.mock.calls[0];
      const promptArg = spawnCall[1].find((arg: string, i: number, arr: string[]) => arr[i - 1] === '-p');
      expect(promptArg).toContain('## User Preferences');
      expect(promptArg).toContain('Risk Comfort: medium');
      expect(promptArg).toContain('Scope Flexibility: flexible');
      expect(promptArg).toContain('Detail Level: standard');
      expect(promptArg).toContain('Autonomy Level: collaborative');
    });

    it('should include preference-based filtering rules in prompt', async () => {
      const customPrefs: UserPreferences = {
        riskComfort: 'low',
        speedVsQuality: 'speed',
        scopeFlexibility: 'fixed',
        detailLevel: 'minimal',
        autonomyLevel: 'guided',
      };

      const resultPromise = validator.validateDecision(
        mockDecision,
        mockPlan,
        '/project',
        customPrefs
      );

      const response = JSON.stringify({
        result: '{"action": "filter", "reason": "Filtered by preference"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      await resultPromise;

      const spawnCall = mockSpawn.mock.calls[0];
      const promptArg = spawnCall[1].find((arg: string, i: number, arr: string[]) => arr[i - 1] === '-p');
      expect(promptArg).toContain('## Preference-Based Filtering Rules');
      expect(promptArg).toContain('Scope Flexibility (fixed)');
      expect(promptArg).toContain('Detail Level (minimal)');
      expect(promptArg).toContain('FILTER priority 3');
    });

    it('should not include preferences section when not provided', async () => {
      const resultPromise = validator.validateDecision(
        mockDecision,
        mockPlan,
        '/project'
        // No preferences parameter
      );

      const response = JSON.stringify({
        result: '{"action": "pass", "reason": "Valid decision"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      await resultPromise;

      const spawnCall = mockSpawn.mock.calls[0];
      const promptArg = spawnCall[1].find((arg: string, i: number, arr: string[]) => arr[i - 1] === '-p');
      expect(promptArg).not.toContain('## User Preferences');
      expect(promptArg).not.toContain('## Preference-Based Filtering Rules');
    });

    it('should store prompt with preferences in result', async () => {
      const resultPromise = validator.validateDecision(
        mockDecision,
        mockPlan,
        '/project',
        DEFAULT_USER_PREFERENCES
      );

      const response = JSON.stringify({
        result: '{"action": "pass", "reason": "Valid decision"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      // The prompt stored in result should include preferences
      expect(result.prompt).toContain('## User Preferences');
      expect(result.prompt).toContain('Risk Comfort: medium');
    });
  });
});

import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { AcceptanceCriterion } from '@claude-code-web/shared';

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
import { ComplexityAssessor } from '../../server/src/services/ComplexityAssessor';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('ComplexityAssessor', () => {
  let assessor: ComplexityAssessor;
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;

  const mockTitle = 'Change button label';
  const mockDescription = 'Update the submit button text from "Submit" to "Save"';
  const mockCriteria: AcceptanceCriterion[] = [
    { text: 'Button shows "Save" text', checked: false, type: 'manual' },
  ];

  beforeEach(() => {
    assessor = new ComplexityAssessor();
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
    it('should return trivial complexity for simple changes', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'trivial',
          reason: 'Single button label change - one file, one line',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('trivial');
      expect(result.reason).toBe('Single button label change - one file, one line');
      expect(result.suggestedAgents).toEqual(['frontend']);
      expect(result.useLeanPrompts).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return simple complexity with appropriate agents', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Localized UI change with styling update',
          suggestedAgents: ['frontend', 'testing'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('simple');
      expect(result.suggestedAgents).toEqual(['frontend', 'testing']);
      expect(result.useLeanPrompts).toBe(true);
    });

    it('should return normal complexity for standard features', async () => {
      const resultPromise = assessor.assess(
        'Add new API endpoint',
        'Create a REST endpoint for user preferences',
        [{ text: 'Endpoint returns user prefs', checked: false, type: 'manual' }],
        '/project'
      );

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'normal',
          reason: 'New API endpoint with backend logic and tests',
          suggestedAgents: ['backend', 'database', 'testing'],
          useLeanPrompts: false,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.suggestedAgents).toEqual(['backend', 'database', 'testing']);
      expect(result.useLeanPrompts).toBe(false);
    });

    it('should return complex complexity for large features', async () => {
      const resultPromise = assessor.assess(
        'Add authentication system',
        'Implement OAuth2 with JWT tokens',
        [],
        '/project'
      );

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'complex',
          reason: 'Cross-cutting authentication system affecting many files',
          suggestedAgents: ['frontend', 'backend', 'database', 'testing', 'infrastructure', 'documentation'],
          useLeanPrompts: false,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('complex');
      expect(result.suggestedAgents).toHaveLength(6);
      expect(result.useLeanPrompts).toBe(false);
    });

    it('should use normal complexity conservatively on timeout', async () => {
      jest.useFakeTimers();

      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Advance past the 2-minute timeout
      jest.advanceTimersByTime(120_001);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('timed out');
      expect(result.suggestedAgents).toHaveLength(4);
      expect(result.useLeanPrompts).toBe(false);
      expect(mockChildProcess.kill).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should use normal complexity conservatively on process error', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      mockChildProcess.emit('close', 1);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('failed (code 1)');
      expect(result.suggestedAgents).toHaveLength(4);
    });

    it('should use normal complexity conservatively on spawn error', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      mockChildProcess.emit('error', new Error('spawn ENOENT'));

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('spawn error');
      expect(result.suggestedAgents).toHaveLength(4);
    });

    it('should use normal complexity conservatively on invalid JSON response', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      mockChildProcess.stdout!.emit('data', Buffer.from('not valid json'));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('parse');
    });

    it('should use normal complexity when JSON lacks required fields', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: '{"something": "else"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('parse');
    });

    it('should handle malformed inner JSON in result field (step-15 edge case)', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Outer JSON parses, but inner result contains truncated/malformed JSON
      const response = JSON.stringify({
        result: '{"complexity": "simple", "reason": "test',  // Missing closing brace and quote
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('parse');
    });

    it('should handle result field with complexity but malformed suggestedAgents (step-15 edge case)', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Inner JSON has complexity/reason but suggestedAgents is malformed
      const response = JSON.stringify({
        result: '{"complexity": "simple", "reason": "test reason", "suggestedAgents": "not-an-array"}',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      // Should still parse complexity but use default agents
      expect(result.complexity).toBe('simple');
      expect(result.reason).toBe('test reason');
      expect(result.suggestedAgents).toEqual(['frontend', 'testing']); // Default for simple
    });

    it('should spawn claude with correct arguments', async () => {
      assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      expect(mockSpawn).toHaveBeenCalledWith('claude', expect.arrayContaining([
        '--print',
        '--output-format', 'json',
        '--model', 'haiku',
        '--allowedTools', 'Read,Glob,Grep',
        '-p', expect.any(String),
      ]), expect.objectContaining({
        cwd: '/project',
      }));
    });

    it('should include prompt and output in result', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

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

      const result = await resultPromise;

      expect(result.prompt).toBeDefined();
      expect(result.prompt.length).toBeGreaterThan(0);
      expect(result.output).toBe(response);
    });

    it('should handle response with extra text around JSON', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: 'Here is my assessment:\n\n{"complexity": "trivial", "reason": "Single line change"}\n\nLet me know if you need more info.',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('trivial');
      expect(result.reason).toBe('Single line change');
    });

    it('should filter invalid agent types from response', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Simple change',
          suggestedAgents: ['frontend', 'invalid_agent', 'backend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.suggestedAgents).toEqual(['frontend', 'backend']);
      expect(result.suggestedAgents).not.toContain('invalid_agent');
    });

    it('should provide default agents when suggestedAgents is empty', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Simple change',
          suggestedAgents: [],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.suggestedAgents.length).toBeGreaterThan(0);
    });

    it('should provide default agents when suggestedAgents is not an array', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'normal',
          reason: 'Normal change',
          suggestedAgents: 'frontend', // Wrong type - should be array
          useLeanPrompts: false,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(Array.isArray(result.suggestedAgents)).toBe(true);
      expect(result.suggestedAgents.length).toBeGreaterThan(0);
    });

    it('should infer useLeanPrompts from complexity when not provided', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'trivial',
          reason: 'Trivial change',
          suggestedAgents: ['frontend'],
          // useLeanPrompts not provided - should be inferred as true for trivial
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.useLeanPrompts).toBe(true);
    });

    it('should infer useLeanPrompts as false for normal/complex', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'complex',
          reason: 'Complex change',
          suggestedAgents: ['frontend', 'backend'],
          // useLeanPrompts not provided - should be inferred as false for complex
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.useLeanPrompts).toBe(false);
    });

    it('should handle invalid complexity value by falling back to normal', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'invalid_complexity',
          reason: 'Some reason',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
    });

    it('should handle empty acceptance criteria', async () => {
      const resultPromise = assessor.assess(
        'Simple title',
        'Simple description',
        [], // Empty criteria
        '/project'
      );

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'trivial',
          reason: 'No criteria, simple change',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('trivial');
      // Verify the prompt was built correctly (it should contain "No acceptance criteria specified")
      expect(result.prompt).toContain('No acceptance criteria specified');
    });

    it('should include acceptance criteria in prompt', async () => {
      const criteria: AcceptanceCriterion[] = [
        { text: 'First criterion', checked: false, type: 'manual' },
        { text: 'Second criterion', checked: false, type: 'manual' },
      ];

      const resultPromise = assessor.assess('Title', 'Description', criteria, '/project');

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

      const result = await resultPromise;

      expect(result.prompt).toContain('First criterion');
      expect(result.prompt).toContain('Second criterion');
    });
  });

  describe('default agents for complexity', () => {
    it('should provide appropriate agents for each complexity level on fallback', async () => {
      // Test each complexity level's default agents
      const complexityTests = [
        { complexity: 'trivial', expectedCount: 1 },
        { complexity: 'simple', expectedCount: 2 },
        { complexity: 'normal', expectedCount: 4 },
        { complexity: 'complex', expectedCount: 6 },
      ];

      for (const test of complexityTests) {
        const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

        const response = JSON.stringify({
          result: JSON.stringify({
            complexity: test.complexity,
            reason: `${test.complexity} change`,
            suggestedAgents: [], // Empty to trigger default
            useLeanPrompts: test.complexity === 'trivial' || test.complexity === 'simple',
          }),
        });
        mockChildProcess.stdout!.emit('data', Buffer.from(response));
        mockChildProcess.emit('close', 0);

        const result = await resultPromise;

        expect(result.suggestedAgents.length).toBe(test.expectedCount);

        // Reset for next test
        mockChildProcess = new EventEmitter();
        mockChildProcess.stdout = new EventEmitter() as any;
        mockChildProcess.stderr = new EventEmitter() as any;
        mockChildProcess.kill = jest.fn();
        mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);
      }
    });

    it('should return ["frontend"] as default for trivial complexity', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, [], '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'trivial',
          reason: 'Trivial change',
          suggestedAgents: [], // Empty to trigger default
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.suggestedAgents).toEqual(['frontend']);
    });

    it('should return ["frontend", "testing"] as default for simple complexity', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, [], '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Simple change',
          suggestedAgents: [], // Empty to trigger default
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.suggestedAgents).toEqual(['frontend', 'testing']);
    });

    it('should return 4 agents as default for normal complexity', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, [], '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'normal',
          reason: 'Normal change',
          suggestedAgents: [], // Empty to trigger default
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.suggestedAgents).toEqual(['frontend', 'backend', 'testing', 'infrastructure']);
    });

    it('should return all 6 agents as default for complex complexity', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, [], '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'complex',
          reason: 'Complex change',
          suggestedAgents: [], // Empty to trigger default
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.suggestedAgents).toEqual([
        'frontend',
        'backend',
        'database',
        'testing',
        'infrastructure',
        'documentation',
      ]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty reason field by providing default message', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: '', // Empty reason
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      // Empty string is falsy, so it falls through to 'No reason provided'
      expect(result.reason).toBe('No reason provided');
    });

    it('should fall back to normal when reason field is missing from JSON', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          // reason missing - regex requires both complexity AND reason
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      // Missing reason causes regex to not match, falling back to parse error
      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('parse');
    });

    it('should handle process killed (exit code -2)', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      mockChildProcess.emit('close', -2);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('failed (code -2)');
      expect(result.suggestedAgents).toHaveLength(4);
    });

    it('should handle null exit code', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      mockChildProcess.emit('close', null);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.suggestedAgents).toHaveLength(4);
    });

    it('should accumulate stdout data from multiple chunks', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Send response in multiple chunks
      const fullResponse = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Chunked response',
          suggestedAgents: ['frontend'],
          useLeanPrompts: true,
        }),
      });

      const chunk1 = fullResponse.slice(0, 20);
      const chunk2 = fullResponse.slice(20, 50);
      const chunk3 = fullResponse.slice(50);

      mockChildProcess.stdout!.emit('data', Buffer.from(chunk1));
      mockChildProcess.stdout!.emit('data', Buffer.from(chunk2));
      mockChildProcess.stdout!.emit('data', Buffer.from(chunk3));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('simple');
      expect(result.reason).toBe('Chunked response');
    });

    it('should handle empty result field', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: '',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.reason).toContain('parse');
    });

    it('should handle response with only whitespace in result', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: '   \n\t  ',
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
    });

    it('should include partial output in result on spawn error', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Emit some partial output before error
      mockChildProcess.stdout!.emit('data', Buffer.from('partial output before error'));
      mockChildProcess.emit('error', new Error('Connection reset'));

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.output).toBe('partial output before error');
    });

    it('should use provided projectPath for cwd', async () => {
      const customPath = '/custom/project/path';
      assessor.assess(mockTitle, mockDescription, mockCriteria, customPath);

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.objectContaining({
          cwd: customPath,
        })
      );
    });

    it('should respect useLeanPrompts when explicitly provided as false', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'trivial', // Would normally infer useLeanPrompts=true
          reason: 'Trivial but needs full prompts',
          suggestedAgents: ['frontend'],
          useLeanPrompts: false, // Explicitly set to false
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.useLeanPrompts).toBe(false);
    });

    it('should respect useLeanPrompts when explicitly provided as true for complex', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'complex', // Would normally infer useLeanPrompts=false
          reason: 'Complex but use lean prompts',
          suggestedAgents: ['frontend', 'backend'],
          useLeanPrompts: true, // Explicitly set to true
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      expect(result.useLeanPrompts).toBe(true);
    });

    it('should filter all invalid agents and use defaults', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Simple change',
          suggestedAgents: ['invalid1', 'invalid2', 'another_invalid'],
          useLeanPrompts: true,
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      // Since all agents were invalid, should fall back to simple defaults
      expect(result.suggestedAgents).toEqual(['frontend', 'testing']);
    });
  });

  describe('stderr capture (step-14 fix)', () => {
    it('should log stderr when process exits with non-zero code', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Emit stderr before process closes
      mockChildProcess.stderr!.emit('data', Buffer.from('Error: Model validation failed'));
      mockChildProcess.emit('close', 1);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(consoleSpy).toHaveBeenCalledWith('Complexity assessment stderr:', 'Error: Model validation failed');
    });

    it('should log stderr on spawn error', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Emit stderr before error
      mockChildProcess.stderr!.emit('data', Buffer.from('Permission denied'));
      mockChildProcess.emit('error', new Error('spawn failed'));

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(consoleSpy).toHaveBeenCalledWith('Complexity assessment stderr:', 'Permission denied');
    });

    it('should log stderr on timeout', async () => {
      jest.useFakeTimers();
      const consoleSpy = jest.spyOn(console, 'log');
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Emit stderr before timeout
      mockChildProcess.stderr!.emit('data', Buffer.from('Slow response warning'));

      // Advance past timeout
      jest.advanceTimersByTime(120_001);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(consoleSpy).toHaveBeenCalledWith('Complexity assessment stderr at timeout:', 'Slow response warning');

      jest.useRealTimers();
    });

    it('should not log stderr when empty', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // No stderr emitted
      mockChildProcess.emit('close', 1);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      // Should NOT have logged stderr (since it was empty)
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringMatching(/Complexity assessment stderr/), expect.any(String));
    });

    it('should accumulate multiple stderr chunks', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Emit multiple stderr chunks
      mockChildProcess.stderr!.emit('data', Buffer.from('Error part 1\n'));
      mockChildProcess.stderr!.emit('data', Buffer.from('Error part 2'));
      mockChildProcess.emit('close', 1);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(consoleSpy).toHaveBeenCalledWith('Complexity assessment stderr:', 'Error part 1\nError part 2');
    });
  });

  describe('timeout behavior', () => {
    it('should include partial output when timeout occurs', async () => {
      jest.useFakeTimers();

      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      // Send some partial data before timeout
      mockChildProcess.stdout!.emit('data', Buffer.from('{"result": "partial'));

      // Advance past timeout
      jest.advanceTimersByTime(120_001);

      const result = await resultPromise;

      expect(result.complexity).toBe('normal');
      expect(result.output).toBe('{"result": "partial');
      expect(mockChildProcess.kill).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should clear timeout when process completes normally', async () => {
      jest.useFakeTimers();

      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');

      const response = JSON.stringify({
        result: JSON.stringify({
          complexity: 'simple',
          reason: 'Quick assessment',
          suggestedAgents: ['frontend'],
        }),
      });
      mockChildProcess.stdout!.emit('data', Buffer.from(response));
      mockChildProcess.emit('close', 0);

      const result = await resultPromise;

      // Now advance time past timeout - should not affect result
      jest.advanceTimersByTime(120_001);

      expect(result.complexity).toBe('simple');
      expect(mockChildProcess.kill).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('error fallback behavior summary (step-20)', () => {
    /**
     * This test documents all error scenarios that result in fallback to
     * 'normal' complexity with conservative defaults. This ensures the system
     * never fails silently and always provides a safe fallback.
     */

    it('should fallback to normal complexity with 4 agents and useLeanPrompts=false on all error paths', async () => {
      // Define expected fallback behavior
      const expectedFallback = {
        complexity: 'normal',
        agentCount: 4,
        useLeanPrompts: false,
      };

      // Test 1: Timeout
      jest.useFakeTimers();
      let resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');
      jest.advanceTimersByTime(120_001);
      let result = await resultPromise;

      expect(result.complexity).toBe(expectedFallback.complexity);
      expect(result.suggestedAgents).toHaveLength(expectedFallback.agentCount);
      expect(result.useLeanPrompts).toBe(expectedFallback.useLeanPrompts);
      expect(result.reason).toContain('timed out');

      jest.useRealTimers();

      // Reset mock
      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter() as any;
      mockChildProcess.stderr = new EventEmitter() as any;
      mockChildProcess.kill = jest.fn();
      mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

      // Test 2: Non-zero exit code
      resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');
      mockChildProcess.emit('close', 1);
      result = await resultPromise;

      expect(result.complexity).toBe(expectedFallback.complexity);
      expect(result.suggestedAgents).toHaveLength(expectedFallback.agentCount);
      expect(result.useLeanPrompts).toBe(expectedFallback.useLeanPrompts);
      expect(result.reason).toContain('failed');

      // Reset mock
      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter() as any;
      mockChildProcess.stderr = new EventEmitter() as any;
      mockChildProcess.kill = jest.fn();
      mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

      // Test 3: Spawn error (ENOENT)
      resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');
      mockChildProcess.emit('error', new Error('spawn ENOENT'));
      result = await resultPromise;

      expect(result.complexity).toBe(expectedFallback.complexity);
      expect(result.suggestedAgents).toHaveLength(expectedFallback.agentCount);
      expect(result.useLeanPrompts).toBe(expectedFallback.useLeanPrompts);
      expect(result.reason).toContain('spawn error');

      // Reset mock
      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter() as any;
      mockChildProcess.stderr = new EventEmitter() as any;
      mockChildProcess.kill = jest.fn();
      mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

      // Test 4: Invalid JSON response
      resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');
      mockChildProcess.stdout!.emit('data', Buffer.from('not valid json at all'));
      mockChildProcess.emit('close', 0);
      result = await resultPromise;

      expect(result.complexity).toBe(expectedFallback.complexity);
      expect(result.suggestedAgents).toHaveLength(expectedFallback.agentCount);
      expect(result.useLeanPrompts).toBe(expectedFallback.useLeanPrompts);
      expect(result.reason).toContain('parse');

      // Reset mock
      mockChildProcess = new EventEmitter();
      mockChildProcess.stdout = new EventEmitter() as any;
      mockChildProcess.stderr = new EventEmitter() as any;
      mockChildProcess.kill = jest.fn();
      mockSpawn.mockReturnValue(mockChildProcess as ChildProcess);

      // Test 5: Valid outer JSON but missing complexity/reason in result
      resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');
      mockChildProcess.stdout!.emit('data', Buffer.from(JSON.stringify({ result: '{}' })));
      mockChildProcess.emit('close', 0);
      result = await resultPromise;

      expect(result.complexity).toBe(expectedFallback.complexity);
      expect(result.suggestedAgents).toHaveLength(expectedFallback.agentCount);
      expect(result.useLeanPrompts).toBe(expectedFallback.useLeanPrompts);
    });

    it('should always provide 4 default agents for normal complexity fallback', async () => {
      const resultPromise = assessor.assess(mockTitle, mockDescription, mockCriteria, '/project');
      mockChildProcess.emit('error', new Error('any error'));
      const result = await resultPromise;

      // Should include first 4 from ALL_AGENTS: frontend, backend, database, testing
      expect(result.suggestedAgents).toContain('frontend');
      expect(result.suggestedAgents).toContain('backend');
      expect(result.suggestedAgents).toContain('database');
      expect(result.suggestedAgents).toContain('testing');
      expect(result.suggestedAgents).toHaveLength(4);
    });
  });
});

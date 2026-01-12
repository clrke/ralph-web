import {
  CircuitBreaker,
  createCircuitBreaker,
  CB_NO_PROGRESS_THRESHOLD,
  CB_SAME_ERROR_THRESHOLD,
  CB_HALF_OPEN_THRESHOLD,
  CircuitBreakerStateData,
} from '../../server/src/services/CircuitBreaker';
import { FileStorageService } from '../../server/src/data/FileStorageService';

// Mock FileStorageService
jest.mock('../../server/src/data/FileStorageService');

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let mockStorage: jest.Mocked<FileStorageService>;
  let storedState: CircuitBreakerStateData | null;
  let storedHistory: { transitions: unknown[] } | null;

  beforeEach(() => {
    jest.clearAllMocks();
    storedState = null;
    storedHistory = null;

    mockStorage = {
      readJson: jest.fn().mockImplementation((path: string) => {
        if (path.includes('.circuit_breaker_state')) {
          return Promise.resolve(storedState);
        }
        if (path.includes('.circuit_breaker_history')) {
          return Promise.resolve(storedHistory);
        }
        return Promise.resolve(null);
      }),
      writeJson: jest.fn().mockImplementation((path: string, data: unknown) => {
        if (path.includes('.circuit_breaker_state')) {
          storedState = data as CircuitBreakerStateData;
        }
        if (path.includes('.circuit_breaker_history')) {
          storedHistory = data as { transitions: unknown[] };
        }
        return Promise.resolve();
      }),
    } as unknown as jest.Mocked<FileStorageService>;

    circuitBreaker = createCircuitBreaker(mockStorage, '/test/session');
  });

  describe('init', () => {
    it('should create initial CLOSED state when no state exists', async () => {
      const state = await circuitBreaker.init();

      expect(state.state).toBe('CLOSED');
      expect(state.consecutiveNoProgress).toBe(0);
      expect(state.consecutiveSameError).toBe(0);
      expect(state.totalOpens).toBe(0);
      expect(mockStorage.writeJson).toHaveBeenCalled();
    });

    it('should return existing state if valid', async () => {
      storedState = {
        state: 'HALF_OPEN',
        lastChange: new Date().toISOString(),
        consecutiveNoProgress: 2,
        consecutiveSameError: 0,
        lastProgressLoop: 5,
        totalOpens: 1,
        reason: 'Test state',
        currentLoop: 7,
      };

      const state = await circuitBreaker.init();

      expect(state.state).toBe('HALF_OPEN');
      expect(state.consecutiveNoProgress).toBe(2);
    });

    it('should reinitialize if stored state is invalid', async () => {
      storedState = { invalid: 'data' } as unknown as CircuitBreakerStateData;

      const state = await circuitBreaker.init();

      expect(state.state).toBe('CLOSED');
    });
  });

  describe('recordLoopResult', () => {
    beforeEach(async () => {
      await circuitBreaker.init();
    });

    it('should increment loop count on each call', async () => {
      let state = await circuitBreaker.recordLoopResult(0, false);
      expect(state.currentLoop).toBe(1);

      state = await circuitBreaker.recordLoopResult(0, false);
      expect(state.currentLoop).toBe(2);
    });

    it('should reset consecutiveNoProgress when files are changed', async () => {
      // Cause some no-progress loops
      await circuitBreaker.recordLoopResult(0, false);
      await circuitBreaker.recordLoopResult(0, false);
      let state = await circuitBreaker.getState();
      expect(state.consecutiveNoProgress).toBe(2);

      // Make progress
      state = await circuitBreaker.recordLoopResult(5, false);
      expect(state.consecutiveNoProgress).toBe(0);
    });

    it('should transition CLOSED -> HALF_OPEN after threshold no-progress loops', async () => {
      // CB_HALF_OPEN_THRESHOLD is 2
      await circuitBreaker.recordLoopResult(0, false);
      const state = await circuitBreaker.recordLoopResult(0, false);

      expect(state.state).toBe('HALF_OPEN');
      expect(state.consecutiveNoProgress).toBe(CB_HALF_OPEN_THRESHOLD);
    });

    it('should transition CLOSED -> OPEN after full threshold no-progress loops', async () => {
      // CB_NO_PROGRESS_THRESHOLD is 3
      for (let i = 0; i < CB_NO_PROGRESS_THRESHOLD; i++) {
        await circuitBreaker.recordLoopResult(0, false);
      }

      const state = await circuitBreaker.getState();
      expect(state.state).toBe('OPEN');
      expect(state.totalOpens).toBe(1);
    });

    it('should transition CLOSED -> OPEN after same error threshold', async () => {
      // CB_SAME_ERROR_THRESHOLD is 5
      for (let i = 0; i < CB_SAME_ERROR_THRESHOLD; i++) {
        await circuitBreaker.recordLoopResult(1, true); // Progress but errors
      }

      const state = await circuitBreaker.getState();
      expect(state.state).toBe('OPEN');
      expect(state.reason).toContain('Same error occurred');
    });

    it('should transition HALF_OPEN -> CLOSED when progress is detected', async () => {
      // Enter HALF_OPEN state
      await circuitBreaker.recordLoopResult(0, false);
      await circuitBreaker.recordLoopResult(0, false);

      let state = await circuitBreaker.getState();
      expect(state.state).toBe('HALF_OPEN');

      // Make progress to recover
      state = await circuitBreaker.recordLoopResult(3, false);
      expect(state.state).toBe('CLOSED');
      expect(state.reason).toContain('recovering');
    });

    it('should transition HALF_OPEN -> OPEN when recovery fails', async () => {
      // Enter HALF_OPEN state
      await circuitBreaker.recordLoopResult(0, false);
      await circuitBreaker.recordLoopResult(0, false);

      // Continue without progress to reach full threshold
      await circuitBreaker.recordLoopResult(0, false);

      const state = await circuitBreaker.getState();
      expect(state.state).toBe('OPEN');
      expect(state.reason).toContain('Recovery failed');
    });

    it('should stay in OPEN state once opened', async () => {
      // Enter OPEN state
      for (let i = 0; i < CB_NO_PROGRESS_THRESHOLD; i++) {
        await circuitBreaker.recordLoopResult(0, false);
      }

      let state = await circuitBreaker.getState();
      expect(state.state).toBe('OPEN');

      // Try to make progress - should stay OPEN
      state = await circuitBreaker.recordLoopResult(5, false);
      expect(state.state).toBe('OPEN');
    });

    it('should reset error count when no errors', async () => {
      await circuitBreaker.recordLoopResult(1, true);
      await circuitBreaker.recordLoopResult(1, true);
      let state = await circuitBreaker.getState();
      expect(state.consecutiveSameError).toBe(2);

      state = await circuitBreaker.recordLoopResult(1, false);
      expect(state.consecutiveSameError).toBe(0);
    });
  });

  describe('canExecute', () => {
    beforeEach(async () => {
      await circuitBreaker.init();
    });

    it('should return true when CLOSED', async () => {
      const canExecute = await circuitBreaker.canExecute();
      expect(canExecute).toBe(true);
    });

    it('should return true when HALF_OPEN', async () => {
      await circuitBreaker.recordLoopResult(0, false);
      await circuitBreaker.recordLoopResult(0, false);

      const state = await circuitBreaker.getState();
      expect(state.state).toBe('HALF_OPEN');

      const canExecute = await circuitBreaker.canExecute();
      expect(canExecute).toBe(true);
    });

    it('should return false when OPEN', async () => {
      for (let i = 0; i < CB_NO_PROGRESS_THRESHOLD; i++) {
        await circuitBreaker.recordLoopResult(0, false);
      }

      const canExecute = await circuitBreaker.canExecute();
      expect(canExecute).toBe(false);
    });
  });

  describe('shouldHaltExecution', () => {
    beforeEach(async () => {
      await circuitBreaker.init();
    });

    it('should return shouldHalt=false when CLOSED', async () => {
      const result = await circuitBreaker.shouldHaltExecution();
      expect(result.shouldHalt).toBe(false);
      expect(result.state).toBe('CLOSED');
    });

    it('should return shouldHalt=false but monitoring when HALF_OPEN', async () => {
      await circuitBreaker.recordLoopResult(0, false);
      await circuitBreaker.recordLoopResult(0, false);

      const result = await circuitBreaker.shouldHaltExecution();
      expect(result.shouldHalt).toBe(false);
      expect(result.state).toBe('HALF_OPEN');
      expect(result.recommendation).toContain('monitoring mode');
    });

    it('should return shouldHalt=true when OPEN', async () => {
      for (let i = 0; i < CB_NO_PROGRESS_THRESHOLD; i++) {
        await circuitBreaker.recordLoopResult(0, false);
      }

      const result = await circuitBreaker.shouldHaltExecution();
      expect(result.shouldHalt).toBe(true);
      expect(result.state).toBe('OPEN');
      expect(result.recommendation).toContain('Manual intervention');
    });
  });

  describe('reset', () => {
    beforeEach(async () => {
      await circuitBreaker.init();
    });

    it('should reset OPEN circuit to CLOSED', async () => {
      // Enter OPEN state
      for (let i = 0; i < CB_NO_PROGRESS_THRESHOLD; i++) {
        await circuitBreaker.recordLoopResult(0, false);
      }

      let state = await circuitBreaker.getState();
      expect(state.state).toBe('OPEN');

      // Reset
      state = await circuitBreaker.reset('User requested reset');
      expect(state.state).toBe('CLOSED');
      expect(state.consecutiveNoProgress).toBe(0);
      expect(state.consecutiveSameError).toBe(0);
      expect(state.reason).toBe('User requested reset');
    });

    it('should preserve totalOpens count after reset', async () => {
      // Enter OPEN state twice
      for (let i = 0; i < CB_NO_PROGRESS_THRESHOLD; i++) {
        await circuitBreaker.recordLoopResult(0, false);
      }
      await circuitBreaker.reset();

      for (let i = 0; i < CB_NO_PROGRESS_THRESHOLD; i++) {
        await circuitBreaker.recordLoopResult(0, false);
      }

      const state = await circuitBreaker.getState();
      expect(state.totalOpens).toBe(2);
    });
  });

  describe('getHistory', () => {
    beforeEach(async () => {
      await circuitBreaker.init();
    });

    it('should return empty history initially', async () => {
      const history = await circuitBreaker.getHistory();
      expect(history.transitions).toEqual([]);
    });

    it('should track state transitions in history', async () => {
      // Trigger CLOSED -> HALF_OPEN
      await circuitBreaker.recordLoopResult(0, false);
      await circuitBreaker.recordLoopResult(0, false);

      // Trigger HALF_OPEN -> OPEN
      await circuitBreaker.recordLoopResult(0, false);

      const history = await circuitBreaker.getHistory();
      expect(history.transitions.length).toBe(2);
      expect(history.transitions[0].fromState).toBe('CLOSED');
      expect(history.transitions[0].toState).toBe('HALF_OPEN');
      expect(history.transitions[1].fromState).toBe('HALF_OPEN');
      expect(history.transitions[1].toState).toBe('OPEN');
    });
  });

  describe('getStatus', () => {
    beforeEach(async () => {
      await circuitBreaker.init();
    });

    it('should return status summary', async () => {
      const status = await circuitBreaker.getStatus();

      expect(status.state).toBe('CLOSED');
      expect(status.stateLabel).toBe('Normal Operation');
      expect(status.consecutiveNoProgress).toBe(0);
      expect(status.currentLoop).toBe(0);
    });

    it('should show correct label for OPEN state', async () => {
      for (let i = 0; i < CB_NO_PROGRESS_THRESHOLD; i++) {
        await circuitBreaker.recordLoopResult(0, false);
      }

      const status = await circuitBreaker.getStatus();
      expect(status.state).toBe('OPEN');
      expect(status.stateLabel).toBe('Halted - Intervention Required');
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      await circuitBreaker.init();
    });

    it('should handle rapid transitions correctly', async () => {
      // Rapidly alternate between progress and no progress
      for (let i = 0; i < 10; i++) {
        await circuitBreaker.recordLoopResult(i % 2 === 0 ? 0 : 1, false);
      }

      const state = await circuitBreaker.getState();
      // Should not reach OPEN because progress is made every other loop
      expect(state.state).not.toBe('OPEN');
    });

    it('should handle concurrent reads correctly', async () => {
      // Simulate concurrent access
      const results = await Promise.all([
        circuitBreaker.getState(),
        circuitBreaker.getState(),
        circuitBreaker.getState(),
      ]);

      expect(results[0].state).toBe('CLOSED');
      expect(results[1].state).toBe('CLOSED');
      expect(results[2].state).toBe('CLOSED');
    });
  });
});

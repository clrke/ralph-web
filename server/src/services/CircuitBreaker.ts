import { FileStorageService } from '../data/FileStorageService';

/**
 * Circuit Breaker State Machine
 * Based on ralph-claude-code pattern:
 * - CLOSED: Normal operation, progress is being detected
 * - HALF_OPEN: Monitoring mode, checking for recovery after initial failure
 * - OPEN: Failure detected, execution halted
 */
export type CircuitBreakerState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

// Configuration thresholds
export const CB_NO_PROGRESS_THRESHOLD = 3;
export const CB_SAME_ERROR_THRESHOLD = 5;
export const CB_HALF_OPEN_THRESHOLD = 2;

// File names
const CB_STATE_FILE = '.circuit_breaker_state';
const CB_HISTORY_FILE = '.circuit_breaker_history';

export interface CircuitBreakerStateData {
  state: CircuitBreakerState;
  lastChange: string;
  consecutiveNoProgress: number;
  consecutiveSameError: number;
  lastProgressLoop: number;
  totalOpens: number;
  reason: string;
  currentLoop: number;
}

export interface CircuitBreakerTransition {
  timestamp: string;
  loop: number;
  fromState: CircuitBreakerState;
  toState: CircuitBreakerState;
  reason: string;
}

export interface CircuitBreakerHistory {
  transitions: CircuitBreakerTransition[];
}

export class CircuitBreaker {
  private storage: FileStorageService;
  private sessionDir: string;

  constructor(storage: FileStorageService, sessionDir: string) {
    this.storage = storage;
    this.sessionDir = sessionDir;
  }

  /**
   * Initialize circuit breaker state if not exists
   */
  async init(): Promise<CircuitBreakerStateData> {
    const statePath = `${this.sessionDir}/${CB_STATE_FILE}`;
    const existing = await this.storage.readJson<CircuitBreakerStateData>(statePath);

    if (existing && this.isValidState(existing)) {
      return existing;
    }

    // Create initial state
    const initialState: CircuitBreakerStateData = {
      state: 'CLOSED',
      lastChange: new Date().toISOString(),
      consecutiveNoProgress: 0,
      consecutiveSameError: 0,
      lastProgressLoop: 0,
      totalOpens: 0,
      reason: 'Initial state',
      currentLoop: 0,
    };

    await this.storage.writeJson(statePath, initialState);
    return initialState;
  }

  /**
   * Validate state data structure
   */
  private isValidState(data: unknown): data is CircuitBreakerStateData {
    if (typeof data !== 'object' || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d.state === 'string' &&
      ['CLOSED', 'HALF_OPEN', 'OPEN'].includes(d.state) &&
      typeof d.consecutiveNoProgress === 'number' &&
      typeof d.consecutiveSameError === 'number'
    );
  }

  /**
   * Get current state
   */
  async getState(): Promise<CircuitBreakerStateData> {
    const statePath = `${this.sessionDir}/${CB_STATE_FILE}`;
    const state = await this.storage.readJson<CircuitBreakerStateData>(statePath);
    if (!state || !this.isValidState(state)) {
      return this.init();
    }
    return state;
  }

  /**
   * Save state to file
   */
  private async saveState(state: CircuitBreakerStateData): Promise<void> {
    const statePath = `${this.sessionDir}/${CB_STATE_FILE}`;
    await this.storage.writeJson(statePath, state);
  }

  /**
   * Log a state transition to history file
   */
  private async logTransition(
    fromState: CircuitBreakerState,
    toState: CircuitBreakerState,
    reason: string,
    loop: number
  ): Promise<void> {
    const historyPath = `${this.sessionDir}/${CB_HISTORY_FILE}`;

    const history = await this.storage.readJson<CircuitBreakerHistory>(historyPath) || { transitions: [] };

    const transition: CircuitBreakerTransition = {
      timestamp: new Date().toISOString(),
      loop,
      fromState,
      toState,
      reason,
    };

    history.transitions.push(transition);
    await this.storage.writeJson(historyPath, history);

    // Log to console with colors for visibility
    const stateColors: Record<CircuitBreakerState, string> = {
      CLOSED: '\x1b[32m', // Green
      HALF_OPEN: '\x1b[33m', // Yellow
      OPEN: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';

    console.log(
      `[CircuitBreaker] ${stateColors[fromState]}${fromState}${reset} → ${stateColors[toState]}${toState}${reset}: ${reason}`
    );
  }

  /**
   * Record the result of a loop/spawn iteration
   * @param filesChanged Number of files modified in this iteration
   * @param hasErrors Whether errors occurred in this iteration
   */
  async recordLoopResult(filesChanged: number, hasErrors: boolean): Promise<CircuitBreakerStateData> {
    const state = await this.getState();
    const previousState = state.state;

    state.currentLoop++;

    // Track progress
    const hasProgress = filesChanged > 0;

    if (hasProgress) {
      state.consecutiveNoProgress = 0;
      state.lastProgressLoop = state.currentLoop;
    } else {
      state.consecutiveNoProgress++;
    }

    // Track errors
    if (hasErrors) {
      state.consecutiveSameError++;
    } else {
      state.consecutiveSameError = 0;
    }

    // Determine state transitions
    let newState = state.state;
    let reason = '';

    switch (state.state) {
      case 'CLOSED':
        // Check if we should open the circuit
        if (state.consecutiveNoProgress >= CB_NO_PROGRESS_THRESHOLD) {
          newState = 'OPEN';
          reason = `No progress detected in ${state.consecutiveNoProgress} consecutive loops`;
          state.totalOpens++;
        } else if (state.consecutiveSameError >= CB_SAME_ERROR_THRESHOLD) {
          newState = 'OPEN';
          reason = `Same error occurred ${state.consecutiveSameError} consecutive times`;
          state.totalOpens++;
        } else if (state.consecutiveNoProgress >= CB_HALF_OPEN_THRESHOLD) {
          // Enter monitoring mode
          newState = 'HALF_OPEN';
          reason = `Monitoring: ${state.consecutiveNoProgress} consecutive loops without progress`;
        }
        break;

      case 'HALF_OPEN':
        // Check if we should recover or fully open
        if (hasProgress) {
          newState = 'CLOSED';
          reason = 'Progress detected, recovering to normal operation';
        } else if (state.consecutiveNoProgress >= CB_NO_PROGRESS_THRESHOLD) {
          newState = 'OPEN';
          reason = `Recovery failed: no progress in ${state.consecutiveNoProgress} consecutive loops`;
          state.totalOpens++;
        }
        break;

      case 'OPEN':
        // Stay open - requires manual reset
        break;
    }

    // Log transition if state changed
    if (newState !== previousState) {
      state.state = newState;
      state.lastChange = new Date().toISOString();
      state.reason = reason;
      await this.logTransition(previousState, newState, reason, state.currentLoop);
    }

    await this.saveState(state);
    return state;
  }

  /**
   * Check if execution can proceed
   * @returns true if CLOSED or HALF_OPEN, false if OPEN
   */
  async canExecute(): Promise<boolean> {
    const state = await this.getState();
    return state.state !== 'OPEN';
  }

  /**
   * Check if execution should be halted
   * Returns halt info if OPEN, null otherwise
   */
  async shouldHaltExecution(): Promise<{
    shouldHalt: boolean;
    state: CircuitBreakerState;
    reason: string;
    recommendation: string;
  }> {
    const state = await this.getState();

    if (state.state === 'OPEN') {
      return {
        shouldHalt: true,
        state: state.state,
        reason: state.reason,
        recommendation: 'Manual intervention required. Review the session state and reset the circuit breaker to continue.',
      };
    }

    if (state.state === 'HALF_OPEN') {
      return {
        shouldHalt: false,
        state: state.state,
        reason: state.reason,
        recommendation: 'System is in monitoring mode. Will recover if progress is made, or halt if stagnation continues.',
      };
    }

    return {
      shouldHalt: false,
      state: state.state,
      reason: 'Normal operation',
      recommendation: '',
    };
  }

  /**
   * Manually reset the circuit breaker to CLOSED state
   * @param reason Reason for the reset
   */
  async reset(reason: string = 'Manual reset'): Promise<CircuitBreakerStateData> {
    const state = await this.getState();
    const previousState = state.state;

    // Log transition
    await this.logTransition(previousState, 'CLOSED', reason, state.currentLoop);

    // Reset state
    state.state = 'CLOSED';
    state.lastChange = new Date().toISOString();
    state.consecutiveNoProgress = 0;
    state.consecutiveSameError = 0;
    state.reason = reason;

    await this.saveState(state);
    return state;
  }

  /**
   * Get circuit breaker history
   */
  async getHistory(): Promise<CircuitBreakerHistory> {
    const historyPath = `${this.sessionDir}/${CB_HISTORY_FILE}`;
    return await this.storage.readJson<CircuitBreakerHistory>(historyPath) || { transitions: [] };
  }

  /**
   * Get a status summary for display
   */
  async getStatus(): Promise<{
    state: CircuitBreakerState;
    stateLabel: string;
    consecutiveNoProgress: number;
    consecutiveSameError: number;
    currentLoop: number;
    totalOpens: number;
    lastChange: string;
    reason: string;
  }> {
    const state = await this.getState();

    const stateLabels: Record<CircuitBreakerState, string> = {
      CLOSED: 'Normal Operation',
      HALF_OPEN: 'Monitoring Mode',
      OPEN: 'Halted - Intervention Required',
    };

    return {
      state: state.state,
      stateLabel: stateLabels[state.state],
      consecutiveNoProgress: state.consecutiveNoProgress,
      consecutiveSameError: state.consecutiveSameError,
      currentLoop: state.currentLoop,
      totalOpens: state.totalOpens,
      lastChange: state.lastChange,
      reason: state.reason,
    };
  }
}

/**
 * Factory function to create a CircuitBreaker instance
 */
export function createCircuitBreaker(storage: FileStorageService, sessionDir: string): CircuitBreaker {
  return new CircuitBreaker(storage, sessionDir);
}

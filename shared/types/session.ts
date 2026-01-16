export type SessionStatus =
  | 'queued'           // Waiting for another session to complete
  | 'discovery'        // Stage 1: Feature discovery
  | 'planning'         // Stage 2: Plan review
  | 'implementing'     // Stage 3: Implementation
  | 'pr_creation'      // Stage 4: PR creation
  | 'pr_review'        // Stage 5: PR review
  | 'final_approval'   // Stage 6: Final approval (user decides: merge, return to Stage 2, or re-review)
  | 'completed'        // Stage 7: Session completed, PR ready to merge
  | 'paused'
  | 'failed';

export type CircuitBreakerState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

/** User preferences for decision filtering in plan review */
export interface UserPreferences {
  /** How comfortable with experimental/risky approaches */
  riskComfort: 'low' | 'medium' | 'high';

  /** Trade-off between delivery speed and implementation quality */
  speedVsQuality: 'speed' | 'balanced' | 'quality';

  /** Openness to scope changes beyond original request */
  scopeFlexibility: 'fixed' | 'flexible' | 'open';

  /** How many questions/details to surface */
  detailLevel: 'minimal' | 'standard' | 'detailed';

  /** How much Claude should decide vs ask */
  autonomyLevel: 'guided' | 'collaborative' | 'autonomous';
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  riskComfort: 'medium',
  speedVsQuality: 'balanced',
  scopeFlexibility: 'flexible',
  detailLevel: 'standard',
  autonomyLevel: 'collaborative',
};

export interface AcceptanceCriterion {
  text: string;
  checked: boolean;
  type: 'automated' | 'manual';
}

export interface ExitSignals {
  testOnlySpawns: number[];
  completionSignals: number[];
  noProgressSpawns: number[];
}

export interface Session {
  version: string;
  id: string;
  projectId: string;
  featureId: string;
  title: string;
  featureDescription: string;
  projectPath: string;
  acceptanceCriteria: AcceptanceCriterion[];
  affectedFiles: string[];
  technicalNotes: string;
  baseBranch: string;
  featureBranch: string;
  baseCommitSha: string;
  status: SessionStatus;
  currentStage: number;
  replanningCount: number;
  claudeSessionId: string | null;
  claudePlanFilePath: string | null;
  currentPlanVersion: number;
  claudeStage3SessionId: string | null; // Fresh sessionId for Stage 3 execution
  prUrl: string | null; // URL to the created PR (set in Stage 4)
  sessionExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  /** Context for plan validation failures - set when plan structure is incomplete after Stage 2 */
  planValidationContext?: string | null;
  /** Number of plan validation attempts in current Stage 2 session */
  planValidationAttempts?: number;
  /** Queue position when status is 'queued' (1 = next in line) */
  queuePosition?: number | null;
  /** Timestamp when session was queued */
  queuedAt?: string | null;
  /** User preferences for decision filtering */
  preferences?: UserPreferences;
}

export interface SessionRuntimeStatus {
  version: string;
  sessionId: string;
  timestamp: string;
  currentStage: number;
  currentStepId: string | null;
  blockedStepId?: string | null; // Which step has a blocker
  status: 'idle' | 'executing' | 'waiting_input' | 'paused' | 'error';
  claudeSpawnCount: number;
  callsThisHour: number;
  maxCallsPerHour: number;
  nextHourReset: string;
  circuitBreakerState: CircuitBreakerState;
  lastOutputLength: number;
  exitSignals: ExitSignals;
  lastAction: string;
  lastActionAt: string;
}

export interface CreateSessionInput {
  title: string;
  featureDescription: string;
  projectPath: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  affectedFiles?: string[];
  technicalNotes?: string;
  baseBranch?: string;
  /** Optional preferences to use for this session (overrides project defaults) */
  preferences?: UserPreferences;
  /** Queue position for new sessions (only used when session is being queued)
   * 'front' = position 1 (highest priority)
   * 'end' = after all existing queued sessions (default)
   * number = specific position (1-based)
   */
  insertAtPosition?: 'front' | 'end' | number;
}

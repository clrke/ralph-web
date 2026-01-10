export type SessionStatus =
  | 'discovery'      // Stage 1: Feature discovery
  | 'planning'       // Stage 2: Plan review
  | 'implementing'   // Stage 3: Implementation
  | 'pr_creation'    // Stage 4: PR creation
  | 'pr_review'      // Stage 5: PR review
  | 'completed'
  | 'paused'
  | 'failed';

export type CircuitBreakerState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

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
  sessionExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStatus {
  version: string;
  sessionId: string;
  timestamp: string;
  currentStage: number;
  currentStepId: string | null;
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
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped' | 'needs_review';

export interface PlanStep {
  id: string;
  parentId: string | null;
  orderIndex: number;
  title: string;
  description: string;
  status: PlanStepStatus;
  metadata: Record<string, unknown>;
  /** Hash of step content (title + description) when completed. Used to skip re-implementation of unchanged steps. */
  contentHash?: string | null;
}

export interface TestRequirement {
  required: boolean;
  reason: string;
  testTypes: string[];
  existingFramework: string | null;
  suggestedCoverage: string;
  assessedAt: string;
}

export interface Plan {
  version: string;
  planVersion: number;
  sessionId: string;
  isApproved: boolean;
  reviewCount: number;
  createdAt: string;
  steps: PlanStep[];
  /** Test requirement assessment result - set after plan approval */
  testRequirement?: TestRequirement;
}

export interface PlanHistoryEntry {
  version: number;
  plan: Plan;
  changedAt: string;
  changedBy: 'user' | 'claude' | 'system';
  changeReason: string;
}

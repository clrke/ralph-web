export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';

export interface PlanStep {
  id: string;
  parentId: string | null;
  orderIndex: number;
  title: string;
  description: string;
  status: PlanStepStatus;
  metadata: Record<string, unknown>;
}

export interface Plan {
  version: string;
  planVersion: number;
  sessionId: string;
  isApproved: boolean;
  reviewCount: number;
  createdAt: string;
  steps: PlanStep[];
}

export interface PlanHistoryEntry {
  version: number;
  plan: Plan;
  changedAt: string;
  changedBy: 'user' | 'claude' | 'system';
  changeReason: string;
}

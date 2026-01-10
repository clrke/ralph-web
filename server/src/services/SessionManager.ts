import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { FileStorageService } from '../data/FileStorageService';
import {
  Session,
  SessionStatus,
  CreateSessionInput,
  ExitSignals,
} from '@claude-code-web/shared';

const STAGE_STATUS_MAP: Record<number, SessionStatus> = {
  1: 'discovery',
  2: 'planning',
  3: 'implementing',
  4: 'pr_creation',
  5: 'pr_review',
};

const VALID_TRANSITIONS: Record<number, number[]> = {
  1: [2],
  2: [1, 3], // Can go back to 1 for replanning
  3: [2, 4], // Can go back to 2 for replanning
  4: [5],
  5: [2], // Can go back to 2 for PR review issues
};

export class SessionManager {
  constructor(private readonly storage: FileStorageService) {}

  getProjectId(projectPath: string): string {
    return crypto.createHash('md5').update(projectPath).digest('hex');
  }

  getFeatureId(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  private getSessionPath(projectId: string, featureId: string): string {
    return `${projectId}/${featureId}`;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const projectId = this.getProjectId(input.projectPath);
    const featureId = this.getFeatureId(input.title);
    const sessionPath = this.getSessionPath(projectId, featureId);
    const now = new Date().toISOString();
    const sessionId = uuidv4();

    // Create session directory
    await this.storage.ensureDir(sessionPath);
    await this.storage.ensureDir(`${sessionPath}/plan-history`);

    // Create session.json
    const session: Session = {
      version: '1.0',
      id: sessionId,
      projectId,
      featureId,
      title: input.title,
      featureDescription: input.featureDescription,
      projectPath: input.projectPath,
      acceptanceCriteria: input.acceptanceCriteria || [],
      affectedFiles: input.affectedFiles || [],
      technicalNotes: input.technicalNotes || '',
      baseBranch: input.baseBranch || 'main',
      featureBranch: `feature/${featureId}`,
      baseCommitSha: '',
      status: 'discovery',
      currentStage: 1,
      replanningCount: 0,
      claudeSessionId: null,
      claudePlanFilePath: null,
      currentPlanVersion: 0,
      sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.writeJson(`${sessionPath}/session.json`, session);

    // Create initial plan.json
    await this.storage.writeJson(`${sessionPath}/plan.json`, {
      version: '1.0',
      planVersion: 0,
      sessionId,
      isApproved: false,
      reviewCount: 0,
      createdAt: now,
      steps: [],
    });

    // Create questions.json
    await this.storage.writeJson(`${sessionPath}/questions.json`, {
      version: '1.0',
      sessionId,
      questions: [],
    });

    // Create status.json
    const exitSignals: ExitSignals = {
      testOnlySpawns: [],
      completionSignals: [],
      noProgressSpawns: [],
    };

    await this.storage.writeJson(`${sessionPath}/status.json`, {
      version: '1.0',
      sessionId,
      timestamp: now,
      currentStage: 1,
      currentStepId: null,
      status: 'idle',
      claudeSpawnCount: 0,
      callsThisHour: 0,
      maxCallsPerHour: 100,
      nextHourReset: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      circuitBreakerState: 'CLOSED',
      lastOutputLength: 0,
      exitSignals,
      lastAction: 'session_created',
      lastActionAt: now,
    });

    // Update projects.json index
    const projectsIndex = (await this.storage.readJson<Record<string, string>>('projects.json')) || {};
    projectsIndex[projectId] = input.projectPath;
    await this.storage.writeJson('projects.json', projectsIndex);

    // Update project index
    const projectIndex = (await this.storage.readJson<string[]>(`${projectId}/index.json`)) || [];
    if (!projectIndex.includes(featureId)) {
      projectIndex.push(featureId);
      await this.storage.writeJson(`${projectId}/index.json`, projectIndex);
    }

    return session;
  }

  async getSession(projectId: string, featureId: string): Promise<Session | null> {
    const sessionPath = this.getSessionPath(projectId, featureId);
    return this.storage.readJson<Session>(`${sessionPath}/session.json`);
  }

  async updateSession(
    projectId: string,
    featureId: string,
    updates: Partial<Session>
  ): Promise<Session> {
    const session = await this.getSession(projectId, featureId);

    if (!session) {
      throw new Error(`Session not found: ${projectId}/${featureId}`);
    }

    const updatedSession: Session = {
      ...session,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const sessionPath = this.getSessionPath(projectId, featureId);
    await this.storage.writeJson(`${sessionPath}/session.json`, updatedSession);

    return updatedSession;
  }

  async listSessions(projectId: string): Promise<Session[]> {
    const projectIndex = await this.storage.readJson<string[]>(`${projectId}/index.json`);

    if (!projectIndex) {
      return [];
    }

    const sessions: Session[] = [];

    for (const featureId of projectIndex) {
      const session = await this.getSession(projectId, featureId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  async transitionStage(projectId: string, featureId: string, targetStage: number): Promise<Session> {
    const session = await this.getSession(projectId, featureId);

    if (!session) {
      throw new Error(`Session not found: ${projectId}/${featureId}`);
    }

    const validTargets = VALID_TRANSITIONS[session.currentStage] || [];

    if (!validTargets.includes(targetStage)) {
      throw new Error(
        `Invalid stage transition: ${session.currentStage} -> ${targetStage}. Valid targets: ${validTargets.join(', ')}`
      );
    }

    const newStatus = STAGE_STATUS_MAP[targetStage] || session.status;

    return this.updateSession(projectId, featureId, {
      currentStage: targetStage,
      status: newStatus,
      replanningCount:
        targetStage < session.currentStage
          ? session.replanningCount + 1
          : session.replanningCount,
    });
  }
}

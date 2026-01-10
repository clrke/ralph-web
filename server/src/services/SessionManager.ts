import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { FileStorageService } from '../data/FileStorageService';

const execFileAsync = promisify(execFile);
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

// Fields that cannot be modified via updateSession
const PROTECTED_FIELDS = ['id', 'projectId', 'featureId', 'version', 'createdAt'] as const;

export interface SessionManagerOptions {
  validateProjectPath?: boolean;
}

export interface GitInfo {
  currentBranch: string;
  headCommitSha: string;
}

export class SessionManager {
  private readonly options: SessionManagerOptions;

  constructor(
    private readonly storage: FileStorageService,
    options: SessionManagerOptions = {}
  ) {
    this.options = {
      validateProjectPath: false,
      ...options,
    };
  }

  getProjectId(projectPath: string): string {
    // Use SHA256 for better collision resistance (truncated to 32 chars)
    return crypto.createHash('sha256').update(projectPath).digest('hex').substring(0, 32);
  }

  getFeatureId(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
      .trim();

    // Handle empty or invalid titles
    if (!slug) {
      throw new Error('Title must contain at least one alphanumeric character');
    }

    // Truncate very long slugs (filesystem path limits)
    return slug.substring(0, 64);
  }

  /**
   * Validates a project path according to README requirements (lines 2133-2144)
   * Checks: exists, is directory, has read access, has write access, is git repo
   * Note: Access checks come before git check since we need read access to check for .git
   */
  async validateProjectPath(projectPath: string): Promise<void> {
    // Check path exists
    const exists = await fs.pathExists(projectPath);
    if (!exists) {
      throw new Error('Project path does not exist');
    }

    // Check is directory
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) {
      throw new Error('Project path is not a directory');
    }

    // Check read access (must come before git check since we need to read dir contents)
    try {
      await fs.access(projectPath, fs.constants.R_OK);
    } catch {
      throw new Error('Cannot read project directory');
    }

    // Check write access
    try {
      await fs.access(projectPath, fs.constants.W_OK);
    } catch {
      throw new Error('Cannot write to project directory');
    }

    // Check is git repository (comes after access checks)
    const gitPath = path.join(projectPath, '.git');
    const hasGit = await fs.pathExists(gitPath);
    if (!hasGit) {
      throw new Error('Project path is not a git repository');
    }
  }

  /**
   * Get git information from a project directory
   * Returns null if not a git repository or git commands fail
   */
  async getGitInfo(projectPath: string): Promise<GitInfo | null> {
    try {
      // Check if .git exists
      const gitPath = path.join(projectPath, '.git');
      const hasGit = await fs.pathExists(gitPath);
      if (!hasGit) {
        return null;
      }

      // Get current branch name
      const { stdout: branchOutput } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projectPath,
      });

      // Get HEAD commit SHA
      const { stdout: shaOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: projectPath,
      });

      return {
        currentBranch: branchOutput.trim(),
        headCommitSha: shaOutput.trim(),
      };
    } catch {
      return null;
    }
  }

  private getSessionPath(projectId: string, featureId: string): string {
    return `${projectId}/${featureId}`;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    // Validate required fields
    if (!input.title?.trim()) {
      throw new Error('Title is required');
    }
    if (!input.projectPath?.trim()) {
      throw new Error('Project path is required');
    }

    // Validate project path if enabled (README lines 2133-2144)
    if (this.options.validateProjectPath) {
      await this.validateProjectPath(input.projectPath);
    }

    const projectId = this.getProjectId(input.projectPath);
    const featureId = this.getFeatureId(input.title);
    const sessionPath = this.getSessionPath(projectId, featureId);
    const now = new Date().toISOString();
    const sessionId = uuidv4();

    // Get git info if path validation is enabled (we know it's a valid git repo)
    let baseCommitSha = '';
    if (this.options.validateProjectPath) {
      const gitInfo = await this.getGitInfo(input.projectPath);
      if (gitInfo) {
        baseCommitSha = gitInfo.headCommitSha;
      }
    }

    // Check for existing session to prevent collision
    const existingSession = await this.storage.exists(`${sessionPath}/session.json`);
    if (existingSession) {
      throw new Error(`Session already exists: ${projectId}/${featureId}. Use a different title.`);
    }

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
      baseCommitSha,
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

    // Remove protected fields from updates to prevent data corruption
    const safeUpdates = { ...updates };
    for (const field of PROTECTED_FIELDS) {
      delete safeUpdates[field];
    }

    const updatedSession: Session = {
      ...session,
      ...safeUpdates,
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

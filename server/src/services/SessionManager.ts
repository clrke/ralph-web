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
  UserPreferences,
  BackoutReason,
} from '@claude-code-web/shared';
import { isBackoutAllowedForStatus, BackoutAction } from '../validation/schemas';

const STAGE_STATUS_MAP: Record<number, SessionStatus> = {
  1: 'discovery',
  2: 'planning',
  3: 'implementing',
  4: 'pr_creation',
  5: 'pr_review',
  6: 'final_approval',
  7: 'completed',
};

const VALID_TRANSITIONS: Record<number, number[]> = {
  1: [2],
  2: [1, 3], // Can go back to 1 for replanning
  3: [2, 4], // Can go back to 2 for replanning
  4: [5],
  5: [2, 6], // Can go back to 2 for PR review issues, or forward to 6 for final approval
  6: [2, 5, 7], // Can return to Stage 2 for plan changes, Stage 5 for re-review, or Stage 7 to complete
  7: [], // Terminal state - no transitions allowed
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

export interface BackoutResult {
  /** The updated session after backout */
  session: Session;
  /** The next session that was promoted (if any) */
  promotedSession: Session | null;
}

export interface ResumeResult {
  /** The updated session after resuming */
  session: Session;
  /** Whether the session was queued (true) or immediately started (false) */
  wasQueued: boolean;
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

  async createSession(input: CreateSessionInput, projectPreferences?: UserPreferences): Promise<Session> {
    // Validate required fields
    if (!input.title?.trim()) {
      throw new Error('Title is required');
    }
    if (!input.projectPath?.trim()) {
      throw new Error('Project path is required');
    }

    // Determine preferences: input.preferences takes priority over projectPreferences
    const preferences = input.preferences || projectPreferences;

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

    // Check if there's already an active session for this project
    const activeSession = await this.getActiveSessionForProject(projectId);
    const queuedSessions = await this.getQueuedSessions(projectId);
    const isQueued = activeSession !== null;

    // Calculate queue position based on insertAtPosition option
    let queuePosition: number | null = null;
    if (isQueued) {
      const insertAt = input.insertAtPosition;
      if (insertAt === 'front' || insertAt === 1) {
        // Insert at front - will need to shift other sessions
        queuePosition = 1;
      } else if (typeof insertAt === 'number') {
        // Insert at specific position (clamped to valid range)
        queuePosition = Math.min(Math.max(1, insertAt), queuedSessions.length + 1);
      } else {
        // Default: 'end' or undefined - add to end of queue
        queuePosition = queuedSessions.length + 1;
      }
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
      status: isQueued ? 'queued' : 'discovery',
      currentStage: isQueued ? 0 : 1, // Stage 0 means not started yet
      queuePosition,
      queuedAt: isQueued ? now : null,
      replanningCount: 0,
      claudeSessionId: null,
      claudeStage3SessionId: null,
      claudePlanFilePath: this.storage.getAbsolutePath(`${sessionPath}/plan.md`),
      currentPlanVersion: 0,
      prUrl: null,
      sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
      preferences,
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

    // Create empty plan.md for Claude to edit (D1 approach - path-restricted Edit)
    await this.storage.writeText(`${sessionPath}/plan.md`, `# Implementation Plan: ${input.title}\n\n<!-- Claude will edit this file with the implementation plan -->\n`);

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
      currentStage: isQueued ? 0 : 1,
      currentStepId: null,
      status: isQueued ? 'queued' : 'idle',
      claudeSpawnCount: 0,
      callsThisHour: 0,
      maxCallsPerHour: 100,
      nextHourReset: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      circuitBreakerState: 'CLOSED',
      lastOutputLength: 0,
      exitSignals,
      lastAction: isQueued ? 'session_queued' : 'session_created',
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

    // If inserting at a position other than the end, shift existing queued sessions
    if (isQueued && queuePosition !== null && queuePosition <= queuedSessions.length) {
      // Shift sessions that are at or after the insertion position
      for (const queuedSession of queuedSessions) {
        const pos = queuedSession.queuePosition;
        if (pos != null && pos >= queuePosition) {
          await this.updateSession(projectId, queuedSession.featureId, {
            queuePosition: pos + 1,
          });
        }
      }
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

    // Validate stage transitions if currentStage is being updated
    if (safeUpdates.currentStage !== undefined && safeUpdates.currentStage !== session.currentStage) {
      // Allow transition from stage 0 (queued) to stage 1 (discovery) when session starts
      const isQueuedToStartTransition = session.currentStage === 0 && safeUpdates.currentStage === 1;
      // Allow transition to stage 0 (queued) from any stage (for queuing)
      const isTransitionToQueued = safeUpdates.currentStage === 0;

      if (!isQueuedToStartTransition && !isTransitionToQueued) {
        const validTargets = VALID_TRANSITIONS[session.currentStage] || [];
        if (!validTargets.includes(safeUpdates.currentStage)) {
          throw new Error(
            `Invalid stage transition from ${session.currentStage} to ${safeUpdates.currentStage}. ` +
            `Valid transitions: ${validTargets.join(', ') || 'none (terminal state)'}`
          );
        }
      }
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

  async listAllSessions(): Promise<Session[]> {
    const projectsIndex = await this.storage.readJson<Record<string, string>>('projects.json');

    if (!projectsIndex) {
      return [];
    }

    const allSessions: Session[] = [];

    for (const projectId of Object.keys(projectsIndex)) {
      const sessions = await this.listSessions(projectId);
      allSessions.push(...sessions);
    }

    // Sort by updatedAt descending (most recent first)
    return allSessions.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Get the currently active session for a project (not queued/completed/paused/failed)
   * Returns null if no active session exists
   */
  async getActiveSessionForProject(projectId: string): Promise<Session | null> {
    const sessions = await this.listSessions(projectId);
    const activeStatuses: SessionStatus[] = [
      'discovery', 'planning', 'implementing', 'pr_creation', 'pr_review', 'final_approval'
    ];

    return sessions.find(s => activeStatuses.includes(s.status)) || null;
  }

  /**
   * Get all queued sessions for a project, sorted by priority (lowest queuePosition first).
   * Sessions with lower queuePosition values have higher priority and will be processed first.
   */
  async getQueuedSessions(projectId: string): Promise<Session[]> {
    const sessions = await this.listSessions(projectId);
    return sessions
      .filter(s => s.status === 'queued')
      .sort((a, b) => {
        // Sort by queuePosition ascending (lower position = higher priority)
        // Null positions are treated as lowest priority (sorted to end)
        const posA = a.queuePosition ?? Number.MAX_SAFE_INTEGER;
        const posB = b.queuePosition ?? Number.MAX_SAFE_INTEGER;
        return posA - posB;
      });
  }

  /**
   * Get the next queued session for a project (highest priority = lowest queuePosition).
   * This is used by auto-selection to pick which session to start next when the
   * current active session completes.
   */
  async getNextQueuedSession(projectId: string): Promise<Session | null> {
    const queuedSessions = await this.getQueuedSessions(projectId);
    // Return the first session (lowest queuePosition = highest priority)
    return queuedSessions[0] || null;
  }

  /**
   * Start a queued session (transition from queued to discovery)
   */
  async startQueuedSession(projectId: string, featureId: string): Promise<Session> {
    const session = await this.getSession(projectId, featureId);

    if (!session) {
      throw new Error(`Session not found: ${projectId}/${featureId}`);
    }

    if (session.status !== 'queued') {
      throw new Error(`Session is not queued: ${session.status}`);
    }

    // Check no other active session exists
    const activeSession = await this.getActiveSessionForProject(projectId);
    if (activeSession) {
      throw new Error(`Cannot start queued session: another session is active (${activeSession.featureId})`);
    }

    return this.updateSession(projectId, featureId, {
      status: 'discovery',
      currentStage: 1,
      queuePosition: null,
      queuedAt: null,
    });
  }

  /**
   * Recalculate queue positions for all queued sessions in a project
   */
  async recalculateQueuePositions(projectId: string): Promise<void> {
    const queuedSessions = await this.getQueuedSessions(projectId);

    for (let i = 0; i < queuedSessions.length; i++) {
      await this.updateSession(projectId, queuedSessions[i].featureId, {
        queuePosition: i + 1,
      });
    }
  }

  /**
   * Reorder queued sessions for a project with specified feature ID order
   * @param projectId - The project ID
   * @param orderedFeatureIds - Array of feature IDs in desired order (highest priority first)
   * @returns Array of updated queued sessions in new order
   * @throws Error if any feature ID is not found or not in queued status
   */
  async reorderQueuedSessions(projectId: string, orderedFeatureIds: string[]): Promise<Session[]> {
    // Deduplicate feature IDs while preserving order
    const uniqueFeatureIds = [...new Set(orderedFeatureIds)];

    // Use lock to ensure atomic queue operations
    return this.storage.withLock(`${projectId}/queue.lock`, async () => {
      // Get current queued sessions
      const queuedSessions = await this.getQueuedSessions(projectId);
      const queuedFeatureIds = new Set(queuedSessions.map(s => s.featureId));

      // Validate all provided IDs are actually queued sessions
      const invalidIds: string[] = [];
      for (const featureId of uniqueFeatureIds) {
        if (!queuedFeatureIds.has(featureId)) {
          invalidIds.push(featureId);
        }
      }

      if (invalidIds.length > 0) {
        throw new Error(`Invalid feature IDs (not queued sessions): ${invalidIds.join(', ')}`);
      }

      // Build new order: provided IDs first (in order), then any remaining queued sessions
      const orderedSet = new Set(uniqueFeatureIds);
      const remainingQueued = queuedSessions
        .filter(s => !orderedSet.has(s.featureId))
        .map(s => s.featureId);

      const finalOrder = [...uniqueFeatureIds, ...remainingQueued];

      // Update queue positions
      const updatedSessions: Session[] = [];
      for (let i = 0; i < finalOrder.length; i++) {
        const featureId = finalOrder[i];
        const updated = await this.updateSession(projectId, featureId, {
          queuePosition: i + 1,
        });
        updatedSessions.push(updated);
      }

      return updatedSessions;
    });
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

    // Update status.json to keep currentStage in sync
    const sessionPath = this.getSessionPath(projectId, featureId);
    const statusPath = `${sessionPath}/status.json`;
    const statusFile = await this.storage.readJson<Record<string, unknown>>(statusPath);
    if (statusFile) {
      statusFile.currentStage = targetStage;
      statusFile.timestamp = new Date().toISOString();
      await this.storage.writeJson(statusPath, statusFile);
    }

    return this.updateSession(projectId, featureId, {
      currentStage: targetStage,
      status: newStatus,
      replanningCount:
        targetStage < session.currentStage
          ? session.replanningCount + 1
          : session.replanningCount,
    });
  }

  /**
   * Back out from a session by pausing or abandoning it.
   * - 'pause': Sets status to 'paused', keeps session for later resumption
   * - 'abandon': Sets status to 'failed', marks session as won't do
   *
   * Automatically promotes the next queued session for the project.
   *
   * @param projectId - The project ID
   * @param featureId - The feature ID
   * @param action - 'pause' or 'abandon'
   * @param reason - Optional reason for backing out
   * @returns BackoutResult with updated session and any promoted session
   * @throws Error if session not found or backout not allowed for current status
   */
  async backoutSession(
    projectId: string,
    featureId: string,
    action: BackoutAction,
    reason?: BackoutReason
  ): Promise<BackoutResult> {
    const session = await this.getSession(projectId, featureId);

    if (!session) {
      throw new Error(`Session not found: ${projectId}/${featureId}`);
    }

    // Validate that backout is allowed for current status
    if (!isBackoutAllowedForStatus(session.status)) {
      throw new Error(
        `Cannot back out from session with status '${session.status}'. ` +
        `Backout is only allowed for active sessions (stages 1-6 or queued).`
      );
    }

    const now = new Date().toISOString();
    const newStatus: SessionStatus = action === 'pause' ? 'paused' : 'failed';

    // Update the session with backout information
    const updatedSession = await this.updateSession(projectId, featureId, {
      status: newStatus,
      backoutReason: reason || 'user_requested',
      backoutTimestamp: now,
      // Clear queue-related fields if session was queued
      queuePosition: null,
      queuedAt: null,
    });

    // Update status.json to reflect the backout
    const sessionPath = this.getSessionPath(projectId, featureId);
    const statusPath = `${sessionPath}/status.json`;
    const statusFile = await this.storage.readJson<Record<string, unknown>>(statusPath);
    if (statusFile) {
      statusFile.status = action === 'pause' ? 'paused' : 'error';
      statusFile.timestamp = now;
      statusFile.lastAction = `session_${action === 'pause' ? 'paused' : 'abandoned'}`;
      statusFile.lastActionAt = now;
      await this.storage.writeJson(statusPath, statusFile);
    }

    // Recalculate queue positions if session was queued
    await this.recalculateQueuePositions(projectId);

    // Check if we should promote the next queued session
    let promotedSession: Session | null = null;

    // Only promote if there's no other active session
    const activeSession = await this.getActiveSessionForProject(projectId);
    if (!activeSession) {
      const nextSession = await this.getNextQueuedSession(projectId);
      if (nextSession) {
        promotedSession = await this.startQueuedSession(projectId, nextSession.featureId);
        // Recalculate again after promotion
        await this.recalculateQueuePositions(projectId);
      }
    }

    return {
      session: updatedSession,
      promotedSession,
    };
  }

  /**
   * Resume a paused session.
   * - Validates session is in 'paused' status
   * - Restores the appropriate status based on currentStage
   * - Clears backout metadata
   * - If another session is active, queues this session at the front
   * - Otherwise, starts the session immediately
   *
   * @param projectId - The project ID
   * @param featureId - The feature ID
   * @returns ResumeResult with updated session and queue status
   * @throws Error if session not found or not in paused status
   */
  async resumeSession(
    projectId: string,
    featureId: string
  ): Promise<ResumeResult> {
    const session = await this.getSession(projectId, featureId);

    if (!session) {
      throw new Error(`Session not found: ${projectId}/${featureId}`);
    }

    // Validate that session is paused
    if (session.status !== 'paused') {
      throw new Error(
        `Cannot resume session with status '${session.status}'. ` +
        `Only paused sessions can be resumed.`
      );
    }

    const now = new Date().toISOString();

    // Check if there's an active session for this project
    const activeSession = await this.getActiveSessionForProject(projectId);
    const wasQueued = activeSession !== null;

    // Determine the appropriate status based on currentStage
    // Stage 0 means the session was queued when it was paused
    const targetStatus: SessionStatus = wasQueued
      ? 'queued'
      : session.currentStage === 0
        ? 'discovery' // If it was queued before, start fresh at discovery
        : STAGE_STATUS_MAP[session.currentStage] || 'discovery';

    // Determine the target stage
    const targetStage = wasQueued
      ? 0 // Queued sessions have stage 0
      : session.currentStage === 0
        ? 1 // If it was queued before, start at stage 1
        : session.currentStage;

    // Calculate queue position if being queued (insert at front)
    let queuePosition: number | null = null;
    let queuedAt: string | null = null;
    if (wasQueued) {
      // Get current queued sessions and shift them
      const queuedSessions = await this.getQueuedSessions(projectId);
      queuePosition = 1; // Insert at front

      // Shift existing queued sessions
      for (const queuedSession of queuedSessions) {
        const pos = queuedSession.queuePosition;
        if (pos != null) {
          await this.updateSession(projectId, queuedSession.featureId, {
            queuePosition: pos + 1,
          });
        }
      }
      queuedAt = now;
    }

    // Update the session
    const updatedSession = await this.updateSession(projectId, featureId, {
      status: targetStatus,
      currentStage: targetStage,
      backoutReason: null,
      backoutTimestamp: null,
      queuePosition,
      queuedAt,
    });

    // Update status.json to reflect the resume
    const sessionPath = this.getSessionPath(projectId, featureId);
    const statusPath = `${sessionPath}/status.json`;
    const statusFile = await this.storage.readJson<Record<string, unknown>>(statusPath);
    if (statusFile) {
      statusFile.status = wasQueued ? 'queued' : 'idle';
      statusFile.currentStage = targetStage;
      statusFile.timestamp = now;
      statusFile.lastAction = wasQueued ? 'session_queued' : 'session_resumed';
      statusFile.lastActionAt = now;
      await this.storage.writeJson(statusPath, statusFile);
    }

    return {
      session: updatedSession,
      wasQueued,
    };
  }
}

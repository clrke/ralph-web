import { ClaudeResultHandler } from '../../server/src/services/ClaudeResultHandler';
import { FileStorageService } from '../../server/src/data/FileStorageService';
import { SessionManager } from '../../server/src/services/SessionManager';
import { ClaudeResult } from '../../server/src/services/ClaudeOrchestrator';
import { Session } from '@claude-code-web/shared';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

describe('ClaudeResultHandler', () => {
  let handler: ClaudeResultHandler;
  let storage: FileStorageService;
  let sessionManager: SessionManager;
  let testDir: string;

  const mockSession: Session = {
    version: '1.0',
    id: 'test-session-id',
    projectId: 'test-project',
    featureId: 'add-auth',
    title: 'Add Authentication',
    featureDescription: 'Add JWT auth',
    projectPath: '/test/project',
    acceptanceCriteria: [],
    affectedFiles: [],
    technicalNotes: '',
    baseBranch: 'main',
    featureBranch: 'feature/add-auth',
    baseCommitSha: 'abc123',
    status: 'discovery',
    currentStage: 1,
    replanningCount: 0,
    claudeSessionId: null,
    claudePlanFilePath: null,
    currentPlanVersion: 0,
    sessionExpiresAt: '2026-01-12T00:00:00Z',
    createdAt: '2026-01-11T00:00:00Z',
    updatedAt: '2026-01-11T00:00:00Z',
  };

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `claude-result-handler-test-${Date.now()}`);
    await fs.ensureDir(testDir);

    storage = new FileStorageService(testDir);
    sessionManager = new SessionManager(storage);
    handler = new ClaudeResultHandler(storage, sessionManager);

    // Create session directory structure
    const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;
    await storage.ensureDir(sessionDir);
    await storage.writeJson(`${sessionDir}/session.json`, mockSession);
    await storage.writeJson(`${sessionDir}/questions.json`, { version: '1.0', sessionId: mockSession.id, questions: [] });
    await storage.writeJson(`${sessionDir}/plan.json`, { version: '1.0', planVersion: 0, sessionId: mockSession.id, isApproved: false, reviewCount: 0, steps: [] });
    await storage.writeJson(`${sessionDir}/conversations.json`, { entries: [] });
    await storage.writeJson(`${sessionDir}/status.json`, { status: 'running' });
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('saveConversation', () => {
    it('should append conversation entry to conversations.json', async () => {
      const result: ClaudeResult = {
        output: 'Claude response text',
        sessionId: 'claude-session-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [],
          planSteps: [],
          stepCompleted: null,
          stepsCompleted: [],
          planModeEntered: false,
          planModeExited: false,
          planFilePath: null,
          implementationComplete: false,
          implementationSummary: null,
          implementationStatus: null,
          prCreated: null,
          planApproved: false,
        },
      };

      await handler.handleStage1Result(mockSession, result, 'Test prompt');

      const conversations = await storage.readJson<{ entries: unknown[] }>(
        `${mockSession.projectId}/${mockSession.featureId}/conversations.json`
      );

      expect(conversations!.entries).toHaveLength(1);
      expect(conversations!.entries[0]).toMatchObject({
        stage: 1,
        prompt: 'Test prompt',
        output: 'Claude response text',
        sessionId: 'claude-session-123',
        costUsd: 0.05,
        isError: false,
      });
    });
  });

  describe('saveQuestions', () => {
    it('should save parsed decisions to questions.json', async () => {
      const result: ClaudeResult = {
        output: 'Response with questions',
        sessionId: 'claude-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [
            {
              priority: 1,
              category: 'scope',
              questionText: 'Which auth method should we use?',
              options: [
                { label: 'JWT tokens', recommended: true },
                { label: 'Session cookies', recommended: false },
              ],
            },
            {
              priority: 2,
              category: 'technical',
              questionText: 'Which password hashing library?',
              options: [
                { label: 'bcrypt', recommended: true },
                { label: 'argon2', recommended: false },
              ],
            },
          ],
          planSteps: [],
          stepCompleted: null,
          stepsCompleted: [],
          planModeEntered: true,
          planModeExited: false,
          planFilePath: null,
          implementationComplete: false,
          implementationSummary: null,
          implementationStatus: null,
          prCreated: null,
          planApproved: false,
        },
      };

      await handler.handleStage1Result(mockSession, result, 'Test prompt');

      const questions = await storage.readJson<{ questions: unknown[] }>(
        `${mockSession.projectId}/${mockSession.featureId}/questions.json`
      );

      expect(questions!.questions).toHaveLength(2);
      expect(questions!.questions[0]).toMatchObject({
        priority: 1,
        category: 'scope',
        questionText: 'Which auth method should we use?',
        stage: 'discovery', // Stage 1 maps to 'discovery'
      });
      expect(questions!.questions[1]).toMatchObject({
        priority: 2,
        category: 'technical',
      });
    });

    it('should generate unique IDs for each question', async () => {
      const result: ClaudeResult = {
        output: 'Response',
        sessionId: 'claude-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [
            { priority: 1, category: 'scope', questionText: 'Q1', options: [] },
            { priority: 2, category: 'scope', questionText: 'Q2', options: [] },
          ],
          planSteps: [],
          stepCompleted: null,
          stepsCompleted: [],
          planModeEntered: false,
          planModeExited: false,
          planFilePath: null,
          implementationComplete: false,
          implementationSummary: null,
          implementationStatus: null,
          prCreated: null,
          planApproved: false,
        },
      };

      await handler.handleStage1Result(mockSession, result, 'Test prompt');

      const questions = await storage.readJson<{ questions: Array<{ id: string }> }>(
        `${mockSession.projectId}/${mockSession.featureId}/questions.json`
      );

      expect(questions!.questions[0].id).toBeDefined();
      expect(questions!.questions[1].id).toBeDefined();
      expect(questions!.questions[0].id).not.toBe(questions!.questions[1].id);
    });
  });

  describe('savePlanSteps', () => {
    it('should save parsed plan steps to plan.json', async () => {
      const result: ClaudeResult = {
        output: 'Response with plan',
        sessionId: 'claude-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [],
          planSteps: [
            {
              id: '1',
              parentId: null,
              status: 'pending',
              title: 'Create auth middleware',
              description: 'Set up JWT validation middleware',
            },
            {
              id: '2',
              parentId: '1',
              status: 'pending',
              title: 'Add login endpoint',
              description: 'POST /api/login',
            },
          ],
          stepCompleted: null,
          stepsCompleted: [],
          planModeEntered: true,
          planModeExited: true,
          planFilePath: null,
          implementationComplete: false,
          implementationSummary: null,
          implementationStatus: null,
          prCreated: null,
          planApproved: false,
        },
      };

      await handler.handleStage1Result(mockSession, result, 'Test prompt');

      const plan = await storage.readJson<{ steps: unknown[]; planVersion: number }>(
        `${mockSession.projectId}/${mockSession.featureId}/plan.json`
      );

      expect(plan!.steps).toHaveLength(2);
      expect(plan!.planVersion).toBe(1);
      expect(plan!.steps[0]).toMatchObject({
        id: '1',
        title: 'Create auth middleware',
      });
    });
  });

  describe('savePlanFilePath', () => {
    it('should update session with Claude plan file path', async () => {
      const result: ClaudeResult = {
        output: 'Response with plan file',
        sessionId: 'claude-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [],
          planSteps: [],
          stepCompleted: null,
          stepsCompleted: [],
          planModeEntered: true,
          planModeExited: true,
          planFilePath: '/Users/arke/.claude/plans/my-feature.md',
          implementationComplete: false,
          implementationSummary: null,
          implementationStatus: null,
          prCreated: null,
          planApproved: false,
        },
      };

      await handler.handleStage1Result(mockSession, result, 'Test prompt');

      const session = await storage.readJson<Session>(
        `${mockSession.projectId}/${mockSession.featureId}/session.json`
      );

      expect(session!.claudePlanFilePath).toBe('/Users/arke/.claude/plans/my-feature.md');
    });
  });

  describe('saveClaudeSessionId', () => {
    it('should update session with Claude session ID', async () => {
      const result: ClaudeResult = {
        output: 'Response',
        sessionId: 'claude-session-abc123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [],
          planSteps: [],
          stepCompleted: null,
          stepsCompleted: [],
          planModeEntered: false,
          planModeExited: false,
          planFilePath: null,
          implementationComplete: false,
          implementationSummary: null,
          implementationStatus: null,
          prCreated: null,
          planApproved: false,
        },
      };

      await handler.handleStage1Result(mockSession, result, 'Test prompt');

      const session = await storage.readJson<Session>(
        `${mockSession.projectId}/${mockSession.featureId}/session.json`
      );

      expect(session!.claudeSessionId).toBe('claude-session-abc123');
    });
  });

  describe('updateStatus', () => {
    it('should update status.json with result info', async () => {
      const result: ClaudeResult = {
        output: 'A'.repeat(5000),
        sessionId: 'claude-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [],
          planSteps: [],
          stepCompleted: null,
          stepsCompleted: [],
          planModeEntered: false,
          planModeExited: false,
          planFilePath: null,
          implementationComplete: false,
          implementationSummary: null,
          implementationStatus: null,
          prCreated: null,
          planApproved: false,
        },
      };

      await handler.handleStage1Result(mockSession, result, 'Test prompt');

      const status = await storage.readJson<{
        status: string;
        claudeSpawnCount: number;
        lastAction: string;
        lastOutputLength: number;
      }>(`${mockSession.projectId}/${mockSession.featureId}/status.json`);

      expect(status!.status).toBe('idle');
      expect(status!.claudeSpawnCount).toBe(1);
      expect(status!.lastAction).toBe('stage1_complete');
      expect(status!.lastOutputLength).toBe(5000);
    });

    it('should set error status when result has error', async () => {
      const result: ClaudeResult = {
        output: 'Error output',
        sessionId: null,
        costUsd: 0,
        isError: true,
        error: 'Something went wrong',
        parsed: {
          decisions: [],
          planSteps: [],
          stepCompleted: null,
          stepsCompleted: [],
          planModeEntered: false,
          planModeExited: false,
          planFilePath: null,
          implementationComplete: false,
          implementationSummary: null,
          implementationStatus: null,
          prCreated: null,
          planApproved: false,
        },
      };

      await handler.handleStage1Result(mockSession, result, 'Test prompt');

      const status = await storage.readJson<{ status: string; lastAction: string }>(
        `${mockSession.projectId}/${mockSession.featureId}/status.json`
      );

      expect(status!.status).toBe('error');
      expect(status!.lastAction).toBe('stage1_error');
    });
  });
});

import { ClaudeResultHandler } from '../../server/src/services/ClaudeResultHandler';
import { FileStorageService } from '../../server/src/data/FileStorageService';
import { SessionManager } from '../../server/src/services/SessionManager';
import { ClaudeResult } from '../../server/src/services/ClaudeOrchestrator';
import { DecisionValidator, ValidationLog, ValidationResult } from '../../server/src/services/DecisionValidator';
import { Session } from '@claude-code-web/shared';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Mock DecisionValidator for testing validation metadata flow
class MockDecisionValidator {
  private mockResults: ValidationResult[] = [];

  setMockResults(results: ValidationResult[]) {
    this.mockResults = results;
  }

  async validateDecisions(
    decisions: Array<{ questionText: string; category: string; priority: number; options: Array<{ label: string; recommended: boolean }> }>,
    _plan: unknown,
    _projectPath: string
  ): Promise<{ validDecisions: typeof decisions; log: ValidationLog }> {
    const log: ValidationLog = {
      timestamp: new Date().toISOString(),
      totalDecisions: decisions.length,
      passedCount: this.mockResults.filter(r => r.action === 'pass').length,
      filteredCount: this.mockResults.filter(r => r.action === 'filter').length,
      repurposedCount: this.mockResults.filter(r => r.action === 'repurpose').length,
      results: this.mockResults.length > 0 ? this.mockResults : decisions.map((d, i) => ({
        decision: d,
        action: 'pass' as const,
        reason: 'Valid decision',
        validatedAt: new Date().toISOString(),
        durationMs: 100,
        prompt: `Validate: ${d.questionText}`,
        output: '{"action": "pass", "reason": "Valid decision"}',
      })),
    };

    const validDecisions = decisions.filter((_, i) => {
      const result = log.results[i];
      return result?.action === 'pass' || result?.action === 'repurpose';
    });

    return { validDecisions, log };
  }
}

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

  describe('saveConversationStart', () => {
    it('should save a "started" conversation entry', async () => {
      await handler.saveConversationStart(
        `${mockSession.projectId}/${mockSession.featureId}`,
        1,
        'Test prompt'
      );

      const conversations = await storage.readJson<{ entries: Array<{ status: string; output: string; prompt: string }> }>(
        `${mockSession.projectId}/${mockSession.featureId}/conversations.json`
      );

      expect(conversations!.entries).toHaveLength(1);
      expect(conversations!.entries[0]).toMatchObject({
        stage: 1,
        prompt: 'Test prompt',
        output: '',
        status: 'started',
      });
    });

    it('should have empty output and zero cost for started entries', async () => {
      await handler.saveConversationStart(
        `${mockSession.projectId}/${mockSession.featureId}`,
        2,
        'Stage 2 prompt'
      );

      const conversations = await storage.readJson<{ entries: Array<{ output: string; costUsd: number; sessionId: string | null }> }>(
        `${mockSession.projectId}/${mockSession.featureId}/conversations.json`
      );

      expect(conversations!.entries[0].output).toBe('');
      expect(conversations!.entries[0].costUsd).toBe(0);
      expect(conversations!.entries[0].sessionId).toBeNull();
    });
  });

  describe('saveConversation updates started entry', () => {
    it('should update existing "started" entry instead of appending new one', async () => {
      // First, save a "started" entry
      await handler.saveConversationStart(
        `${mockSession.projectId}/${mockSession.featureId}`,
        1,
        'Test prompt'
      );

      // Now complete via handleStage1Result
      const result: ClaudeResult = {
        output: 'Claude completed response',
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

      const conversations = await storage.readJson<{ entries: Array<{ status: string; output: string }> }>(
        `${mockSession.projectId}/${mockSession.featureId}/conversations.json`
      );

      // Should have only 1 entry, not 2
      expect(conversations!.entries).toHaveLength(1);
      expect(conversations!.entries[0].status).toBe('completed');
      expect(conversations!.entries[0].output).toBe('Claude completed response');
    });

    it('should update the correct stage entry when multiple stages exist', async () => {
      // Save started entries for stages 1 and 2
      await handler.saveConversationStart(
        `${mockSession.projectId}/${mockSession.featureId}`,
        1,
        'Stage 1 prompt'
      );
      await handler.saveConversationStart(
        `${mockSession.projectId}/${mockSession.featureId}`,
        2,
        'Stage 2 prompt'
      );

      // Complete stage 2
      const stage2Session = { ...mockSession, currentStage: 2 };
      const result: ClaudeResult = {
        output: 'Stage 2 completed',
        sessionId: 'claude-session-456',
        costUsd: 0.08,
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

      await handler.handleStage2Result(stage2Session, result, 'Stage 2 prompt');

      const conversations = await storage.readJson<{ entries: Array<{ stage: number; status: string; output: string }> }>(
        `${mockSession.projectId}/${mockSession.featureId}/conversations.json`
      );

      // Should have 2 entries
      expect(conversations!.entries).toHaveLength(2);
      // Stage 1 should still be "started"
      expect(conversations!.entries[0].stage).toBe(1);
      expect(conversations!.entries[0].status).toBe('started');
      // Stage 2 should be "completed"
      expect(conversations!.entries[1].stage).toBe(2);
      expect(conversations!.entries[1].status).toBe('completed');
      expect(conversations!.entries[1].output).toBe('Stage 2 completed');
    });

    it('should append new entry if no started entry exists for that stage', async () => {
      // No saveConversationStart call - just complete directly
      const result: ClaudeResult = {
        output: 'Direct completion',
        sessionId: 'claude-123',
        costUsd: 0.03,
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

      const conversations = await storage.readJson<{ entries: Array<{ status: string }> }>(
        `${mockSession.projectId}/${mockSession.featureId}/conversations.json`
      );

      expect(conversations!.entries).toHaveLength(1);
      expect(conversations!.entries[0].status).toBe('completed');
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

  describe('markIncompleteConversationsAsInterrupted', () => {
    const sessionDir = 'test-project/add-auth';

    it('should mark started conversations as interrupted', async () => {
      // Set up conversations with a "started" entry
      await storage.writeJson(`${sessionDir}/conversations.json`, {
        entries: [
          { stage: 1, status: 'completed', timestamp: '2026-01-01T00:00:00Z', prompt: 'p1', output: 'o1' },
          { stage: 2, status: 'started', timestamp: '2026-01-01T01:00:00Z', prompt: 'p2', output: '' },
        ],
      });

      const count = await handler.markIncompleteConversationsAsInterrupted(sessionDir);

      expect(count).toBe(1);

      const conversations = await storage.readJson<{ entries: Array<{ status: string; error?: string }> }>(`${sessionDir}/conversations.json`);
      expect(conversations!.entries[0].status).toBe('completed');
      expect(conversations!.entries[1].status).toBe('interrupted');
      expect(conversations!.entries[1].error).toBe('Session interrupted by server restart');
    });

    it('should mark multiple started conversations as interrupted', async () => {
      // Set up conversations with multiple "started" entries (edge case)
      await storage.writeJson(`${sessionDir}/conversations.json`, {
        entries: [
          { stage: 1, status: 'started', timestamp: '2026-01-01T00:00:00Z', prompt: 'p1', output: '' },
          { stage: 2, status: 'started', timestamp: '2026-01-01T01:00:00Z', prompt: 'p2', output: '' },
          { stage: 3, status: 'started', timestamp: '2026-01-01T02:00:00Z', prompt: 'p3', output: '' },
        ],
      });

      const count = await handler.markIncompleteConversationsAsInterrupted(sessionDir);

      expect(count).toBe(3);

      const conversations = await storage.readJson<{ entries: Array<{ status: string }> }>(`${sessionDir}/conversations.json`);
      expect(conversations!.entries.every(e => e.status === 'interrupted')).toBe(true);
    });

    it('should return 0 if no started conversations exist', async () => {
      // Set up conversations with only completed entries
      await storage.writeJson(`${sessionDir}/conversations.json`, {
        entries: [
          { stage: 1, status: 'completed', timestamp: '2026-01-01T00:00:00Z', prompt: 'p1', output: 'o1' },
          { stage: 2, status: 'completed', timestamp: '2026-01-01T01:00:00Z', prompt: 'p2', output: 'o2' },
        ],
      });

      const count = await handler.markIncompleteConversationsAsInterrupted(sessionDir);

      expect(count).toBe(0);
    });

    it('should return 0 if conversations file does not exist', async () => {
      // Remove conversations file
      const conversationsPath = path.join(testDir, sessionDir, 'conversations.json');
      await fs.remove(conversationsPath);

      const count = await handler.markIncompleteConversationsAsInterrupted(sessionDir);

      expect(count).toBe(0);
    });

    it('should not modify already interrupted conversations', async () => {
      // Set up conversations with an already interrupted entry
      await storage.writeJson(`${sessionDir}/conversations.json`, {
        entries: [
          { stage: 1, status: 'interrupted', timestamp: '2026-01-01T00:00:00Z', prompt: 'p1', output: '', error: 'Previous error' },
          { stage: 2, status: 'started', timestamp: '2026-01-01T01:00:00Z', prompt: 'p2', output: '' },
        ],
      });

      const count = await handler.markIncompleteConversationsAsInterrupted(sessionDir);

      expect(count).toBe(1); // Only the "started" one

      const conversations = await storage.readJson<{ entries: Array<{ status: string; error?: string }> }>(`${sessionDir}/conversations.json`);
      expect(conversations!.entries[0].error).toBe('Previous error'); // Original error preserved
      expect(conversations!.entries[1].status).toBe('interrupted');
    });
  });

  describe('handleStage3Result', () => {
    const stage3Session: Session = {
      ...mockSession,
      currentStage: 3,
      status: 'implementation',
    };

    const baseResult = (): ClaudeResult => ({
      output: 'Implementation output',
      sessionId: 'claude-session-stage3',
      costUsd: 0.15,
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
        allTestsPassing: false,
        testsAdded: [],
        ciStatus: null,
        ciFailed: false,
        prApproved: false,
        returnToStage2: null,
      },
    });

    beforeEach(async () => {
      const sessionDir = `${stage3Session.projectId}/${stage3Session.featureId}`;
      // Set up plan with steps for Stage 3 testing
      await storage.writeJson(`${sessionDir}/plan.json`, {
        version: '1.0',
        planVersion: 1,
        sessionId: stage3Session.id,
        isApproved: true,
        reviewCount: 2,
        steps: [
          { id: 'step-1', parentId: null, orderIndex: 0, title: 'Create feature branch', description: 'git checkout -b feature/add-auth', status: 'pending', metadata: {} },
          { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Create auth middleware', description: 'Set up JWT validation', status: 'pending', metadata: {} },
          { id: 'step-3', parentId: 'step-2', orderIndex: 2, title: 'Add login endpoint', description: 'POST /api/login', status: 'pending', metadata: {} },
        ],
        createdAt: '2026-01-11T00:00:00Z',
      });

      // Set up status.json with Stage 3 fields
      await storage.writeJson(`${sessionDir}/status.json`, {
        version: '1.0',
        sessionId: stage3Session.id,
        timestamp: '2026-01-11T00:00:00Z',
        currentStage: 3,
        currentStepId: null,
        blockedStepId: null,
        status: 'running',
        claudeSpawnCount: 0,
        callsThisHour: 0,
        maxCallsPerHour: 50,
        nextHourReset: '2026-01-11T01:00:00Z',
        circuitBreakerState: 'CLOSED',
        lastOutputLength: 0,
        lastAction: 'stage3_started',
        lastActionAt: '2026-01-11T00:00:00Z',
        stepRetries: {},
      });
    });

    describe('conversation saving', () => {
      it('should save conversation entry with stepId', async () => {
        const result = baseResult();
        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-1');

        const conversations = await storage.readJson<{ entries: Array<{ stage: number; stepId: string; output: string }> }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/conversations.json`
        );

        expect(conversations!.entries).toHaveLength(1);
        expect(conversations!.entries[0]).toMatchObject({
          stage: 3,
          stepId: 'step-1',
          output: 'Implementation output',
        });
      });

      it('should save conversation without stepId when not provided', async () => {
        const result = baseResult();
        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        const conversations = await storage.readJson<{ entries: Array<{ stage: number; stepId?: string }> }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/conversations.json`
        );

        expect(conversations!.entries).toHaveLength(1);
        expect(conversations!.entries[0].stage).toBe(3);
        expect(conversations!.entries[0].stepId).toBeUndefined();
      });
    });

    describe('step status updates', () => {
      it('should mark step as completed when stepsCompleted is populated', async () => {
        const result = baseResult();
        result.parsed.stepsCompleted = [
          { id: 'step-1', summary: 'Created feature branch', testsAdded: [], testsPassing: true },
        ];

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-1');

        const plan = await storage.readJson<{ steps: Array<{ id: string; status: string; metadata: { completionSummary?: string; completedAt?: string } }> }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/plan.json`
        );

        expect(plan!.steps[0].status).toBe('completed');
        expect(plan!.steps[0].metadata.completionSummary).toBe('Created feature branch');
        expect(plan!.steps[0].metadata.completedAt).toBeDefined();
      });

      it('should mark multiple steps as completed', async () => {
        const result = baseResult();
        result.parsed.stepsCompleted = [
          { id: 'step-1', summary: 'Created branch', testsAdded: [], testsPassing: true },
          { id: 'step-2', summary: 'Added middleware', testsAdded: ['auth.test.ts'], testsPassing: true },
        ];

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        const plan = await storage.readJson<{ steps: Array<{ id: string; status: string }> }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/plan.json`
        );

        expect(plan!.steps[0].status).toBe('completed');
        expect(plan!.steps[1].status).toBe('completed');
        expect(plan!.steps[2].status).toBe('pending'); // Unchanged
      });

      it('should not update steps that are not in stepsCompleted', async () => {
        const result = baseResult();
        result.parsed.stepsCompleted = [
          { id: 'step-2', summary: 'Added middleware', testsAdded: [], testsPassing: true },
        ];

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        const plan = await storage.readJson<{ steps: Array<{ id: string; status: string }> }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/plan.json`
        );

        expect(plan!.steps[0].status).toBe('pending'); // step-1 unchanged
        expect(plan!.steps[1].status).toBe('completed'); // step-2 completed
      });
    });

    describe('blocker handling', () => {
      it('should detect blocker decisions and save to questions.json', async () => {
        const result = baseResult();
        result.parsed.decisions = [
          {
            priority: 1,
            category: 'blocker',
            questionText: 'Cannot proceed: missing database credentials',
            options: [
              { label: 'Add credentials to .env', recommended: true },
              { label: 'Skip database setup', recommended: false },
            ],
          },
        ];

        const { hasBlocker } = await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-2');

        expect(hasBlocker).toBe(true);

        const questions = await storage.readJson<{ questions: Array<{ category: string; questionText: string; stepId?: string }> }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/questions.json`
        );

        expect(questions!.questions).toHaveLength(1);
        expect(questions!.questions[0]).toMatchObject({
          category: 'blocker',
          questionText: 'Cannot proceed: missing database credentials',
          stepId: 'step-2',
        });
      });

      it('should return hasBlocker false when no blocker decisions', async () => {
        const result = baseResult();
        result.parsed.decisions = [
          {
            priority: 2,
            category: 'technical',
            questionText: 'Regular question',
            options: [],
          },
        ];

        const { hasBlocker } = await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        expect(hasBlocker).toBe(false);
      });

      it('should set blockedStepId in status.json when blocker detected', async () => {
        const result = baseResult();
        result.parsed.decisions = [
          {
            priority: 1,
            category: 'blocker',
            questionText: 'Blocker question',
            options: [],
          },
        ];

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-2');

        const status = await storage.readJson<{ blockedStepId: string | null }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.blockedStepId).toBe('step-2');
      });

      it('should clear blockedStepId when step completes', async () => {
        // First set a blocked state
        const sessionDir = `${stage3Session.projectId}/${stage3Session.featureId}`;
        await storage.writeJson(`${sessionDir}/status.json`, {
          ...(await storage.readJson(`${sessionDir}/status.json`)),
          blockedStepId: 'step-2',
        });

        const result = baseResult();
        result.parsed.stepsCompleted = [
          { id: 'step-2', summary: 'Completed after blocker resolved', testsAdded: [], testsPassing: true },
        ];

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-2');

        const status = await storage.readJson<{ blockedStepId: string | null }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.blockedStepId).toBeNull();
      });
    });

    describe('retry count tracking', () => {
      it('should increment retry count when tests are failing', async () => {
        const result = baseResult();
        result.parsed.implementationStatus = {
          stepId: 'step-2',
          status: 'testing',
          filesModified: ['src/auth.ts'],
          testsStatus: 'failing',
          retryCount: 1,
          message: 'Tests failed, retrying',
        };

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-2');

        const status = await storage.readJson<{ stepRetries: Record<string, number> }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.stepRetries['step-2']).toBe(1);
      });

      it('should accumulate retry count across multiple calls', async () => {
        const result = baseResult();
        result.parsed.implementationStatus = {
          stepId: 'step-2',
          status: 'testing',
          filesModified: ['src/auth.ts'],
          testsStatus: 'failing',
          retryCount: 1,
          message: 'Tests failed',
        };

        // First failure
        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-2');
        // Second failure
        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-2');
        // Third failure
        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-2');

        const status = await storage.readJson<{ stepRetries: Record<string, number> }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.stepRetries['step-2']).toBe(3);
      });

      it('should clear retry count when step completes', async () => {
        const sessionDir = `${stage3Session.projectId}/${stage3Session.featureId}`;
        // Set up existing retry count
        const existingStatus = await storage.readJson(`${sessionDir}/status.json`) as Record<string, unknown>;
        await storage.writeJson(`${sessionDir}/status.json`, {
          ...existingStatus,
          stepRetries: { 'step-2': 2 },
        });

        const result = baseResult();
        result.parsed.stepsCompleted = [
          { id: 'step-2', summary: 'Completed', testsAdded: [], testsPassing: true },
        ];

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-2');

        const status = await storage.readJson<{ stepRetries: Record<string, number> }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.stepRetries['step-2']).toBeUndefined();
      });
    });

    describe('markStepBlocked', () => {
      it('should mark step as blocked in plan.json', async () => {
        const sessionDir = `${stage3Session.projectId}/${stage3Session.featureId}`;
        await handler.markStepBlocked(sessionDir, 'step-2');

        const plan = await storage.readJson<{ steps: Array<{ id: string; status: string; metadata: { blockedAt?: string; blockedReason?: string } }> }>(
          `${sessionDir}/plan.json`
        );

        const step2 = plan!.steps.find(s => s.id === 'step-2');
        expect(step2!.status).toBe('blocked');
        expect(step2!.metadata.blockedAt).toBeDefined();
        expect(step2!.metadata.blockedReason).toBe('Max retry attempts exceeded');
      });
    });

    describe('getStepRetryCount', () => {
      it('should return current retry count for a step', async () => {
        const sessionDir = `${stage3Session.projectId}/${stage3Session.featureId}`;
        const existingStatus = await storage.readJson(`${sessionDir}/status.json`) as Record<string, unknown>;
        await storage.writeJson(`${sessionDir}/status.json`, {
          ...existingStatus,
          stepRetries: { 'step-2': 2, 'step-3': 1 },
        });

        const count = await handler.getStepRetryCount(sessionDir, 'step-2');
        expect(count).toBe(2);
      });

      it('should return 0 for steps with no retries', async () => {
        const sessionDir = `${stage3Session.projectId}/${stage3Session.featureId}`;
        const count = await handler.getStepRetryCount(sessionDir, 'step-1');
        expect(count).toBe(0);
      });
    });

    describe('implementation completion detection', () => {
      it('should ignore implementationComplete marker and use state-only verification', async () => {
        // The implementation now uses state-only verification
        // The marker is logged but ignored for reliability
        const result = baseResult();
        result.parsed.implementationComplete = true;
        result.parsed.implementationSummary = 'All features implemented';

        // Even with marker set, completion should be false because state shows pending steps
        const { implementationComplete } = await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        expect(implementationComplete).toBe(false); // State-only verification: steps are still pending
      });

      it('should detect completion via state (all steps completed)', async () => {
        const sessionDir = `${stage3Session.projectId}/${stage3Session.featureId}`;
        // Mark all steps as completed in plan
        const plan = await storage.readJson(`${sessionDir}/plan.json`) as Record<string, unknown>;
        await storage.writeJson(`${sessionDir}/plan.json`, {
          ...plan,
          steps: [
            { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', status: 'completed', metadata: {} },
            { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Step 2', status: 'completed', metadata: {} },
            { id: 'step-3', parentId: 'step-2', orderIndex: 2, title: 'Step 3', status: 'completed', metadata: {} },
          ],
        });

        const result = baseResult();
        // Don't set implementationComplete marker - should detect via state

        const { implementationComplete } = await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        expect(implementationComplete).toBe(true);
      });

      it('should not detect completion when steps are pending', async () => {
        const result = baseResult();

        const { implementationComplete } = await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        expect(implementationComplete).toBe(false);
      });

      it('should detect completion when skipped steps exist', async () => {
        const sessionDir = `${stage3Session.projectId}/${stage3Session.featureId}`;
        // Mark steps as completed or skipped
        const plan = await storage.readJson(`${sessionDir}/plan.json`) as Record<string, unknown>;
        await storage.writeJson(`${sessionDir}/plan.json`, {
          ...plan,
          steps: [
            { id: 'step-1', parentId: null, orderIndex: 0, title: 'Step 1', status: 'completed', metadata: {} },
            { id: 'step-2', parentId: 'step-1', orderIndex: 1, title: 'Step 2', status: 'skipped', metadata: {} },
            { id: 'step-3', parentId: 'step-2', orderIndex: 2, title: 'Step 3', status: 'completed', metadata: {} },
          ],
        });

        const result = baseResult();
        const { implementationComplete } = await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        expect(implementationComplete).toBe(true);
      });
    });

    describe('status updates', () => {
      it('should update currentStepId from implementationStatus', async () => {
        const result = baseResult();
        result.parsed.implementationStatus = {
          stepId: 'step-2',
          status: 'in_progress',
          filesModified: [],
          testsStatus: null,
          retryCount: 0,
          message: 'Working on step 2',
        };

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        const status = await storage.readJson<{ currentStepId: string | null }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.currentStepId).toBe('step-2');
      });

      it('should set status to running during execution', async () => {
        const result = baseResult();
        result.parsed.implementationStatus = {
          stepId: 'step-1',
          status: 'in_progress',
          filesModified: ['src/app.ts'],
          testsStatus: null,
          retryCount: 0,
          message: 'Implementing',
        };

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        const status = await storage.readJson<{ status: string }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.status).toBe('running');
      });

      it('should keep status as running (completion handled by app.ts)', async () => {
        // The ClaudeResultHandler no longer sets status to 'completed' directly
        // That's handled by app.ts after state verification
        const sessionDir = `${stage3Session.projectId}/${stage3Session.featureId}`;
        // Mark all steps as completed
        const plan = await storage.readJson(`${sessionDir}/plan.json`) as Record<string, unknown>;
        await storage.writeJson(`${sessionDir}/plan.json`, {
          ...plan,
          steps: [
            { id: 'step-1', status: 'completed', metadata: {} },
            { id: 'step-2', status: 'completed', metadata: {} },
            { id: 'step-3', status: 'completed', metadata: {} },
          ],
        });

        const result = baseResult();
        result.parsed.implementationComplete = true;

        // The handler returns implementationComplete: true, but status remains 'running'
        // app.ts is responsible for setting 'completed' status after state verification
        const { implementationComplete } = await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        expect(implementationComplete).toBe(true); // State shows all steps completed

        const status = await storage.readJson<{ status: string; lastAction: string }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        // Handler keeps status as 'running', completion status set by app.ts
        expect(status!.status).toBe('running');
        expect(status!.lastAction).toBe('stage3_progress');
      });

      it('should set lastAction to stage3_blocked when blocker detected', async () => {
        const result = baseResult();
        result.parsed.decisions = [
          { priority: 1, category: 'blocker', questionText: 'Blocked', options: [] },
        ];

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt', 'step-2');

        const status = await storage.readJson<{ lastAction: string }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.lastAction).toBe('stage3_blocked');
      });

      it('should set lastAction to stage3_progress during normal execution', async () => {
        const result = baseResult();

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        const status = await storage.readJson<{ lastAction: string }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.lastAction).toBe('stage3_progress');
      });

      it('should increment claudeSpawnCount', async () => {
        const result = baseResult();

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');
        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        const status = await storage.readJson<{ claudeSpawnCount: number }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.claudeSpawnCount).toBe(2);
      });
    });

    describe('error handling', () => {
      it('should handle error results', async () => {
        const result = baseResult();
        result.isError = true;
        result.error = 'Claude spawn failed';

        await handler.handleStage3Result(stage3Session, result, 'Stage 3 prompt');

        const status = await storage.readJson<{ status: string }>(
          `${stage3Session.projectId}/${stage3Session.featureId}/status.json`
        );

        expect(status!.status).toBe('error');
      });
    });
  });

  describe('savePostProcessingConversation', () => {
    it('should save post-processing conversation without validation metadata', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;

      await handler.savePostProcessingConversation(
        sessionDir,
        1,
        'decision_validation',
        'Validate this decision',
        '{"result": "pass"}',
        100,
        false
      );

      const conversations = await storage.readJson<{ entries: Array<{
        stage: number;
        postProcessingType: string;
        questionId?: string;
        validationAction?: string;
        questionIndex?: number;
      }> }>(
        `${sessionDir}/conversations.json`
      );

      expect(conversations!.entries).toHaveLength(1);
      expect(conversations!.entries[0].stage).toBe(1);
      expect(conversations!.entries[0].postProcessingType).toBe('decision_validation');
      expect(conversations!.entries[0].questionId).toBeUndefined();
      expect(conversations!.entries[0].validationAction).toBeUndefined();
      expect(conversations!.entries[0].questionIndex).toBeUndefined();
    });

    it('should save post-processing conversation with validation metadata', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;

      await handler.savePostProcessingConversation(
        sessionDir,
        1,
        'decision_validation',
        'Validate question about auth',
        '{"result": "pass"}',
        150,
        false,
        undefined,
        {
          questionId: 'question-abc-123',
          validationAction: 'pass',
          questionIndex: 1,
        }
      );

      const conversations = await storage.readJson<{ entries: Array<{
        stage: number;
        postProcessingType: string;
        questionId?: string;
        validationAction?: string;
        questionIndex?: number;
        output: string;
      }> }>(
        `${sessionDir}/conversations.json`
      );

      expect(conversations!.entries).toHaveLength(1);
      expect(conversations!.entries[0].questionId).toBe('question-abc-123');
      expect(conversations!.entries[0].validationAction).toBe('pass');
      expect(conversations!.entries[0].questionIndex).toBe(1);
      expect(conversations!.entries[0].output).toBe('pass'); // extracted from result
    });

    it('should save filter validation action', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;

      await handler.savePostProcessingConversation(
        sessionDir,
        1,
        'decision_validation',
        'Validate duplicate question',
        '{"result": "filter"}',
        100,
        false,
        undefined,
        {
          questionId: 'question-duplicate',
          validationAction: 'filter',
          questionIndex: 2,
        }
      );

      const conversations = await storage.readJson<{ entries: Array<{
        validationAction?: string;
        questionIndex?: number;
      }> }>(
        `${sessionDir}/conversations.json`
      );

      expect(conversations!.entries[0].validationAction).toBe('filter');
      expect(conversations!.entries[0].questionIndex).toBe(2);
    });

    it('should save repurpose validation action', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;

      await handler.savePostProcessingConversation(
        sessionDir,
        2,
        'decision_validation',
        'Validate question for repurposing',
        '{"result": "repurpose"}',
        120,
        false,
        undefined,
        {
          questionId: 'question-xyz',
          validationAction: 'repurpose',
          questionIndex: 3,
        }
      );

      const conversations = await storage.readJson<{ entries: Array<{
        stage: number;
        validationAction?: string;
        questionIndex?: number;
      }> }>(
        `${sessionDir}/conversations.json`
      );

      expect(conversations!.entries[0].stage).toBe(2);
      expect(conversations!.entries[0].validationAction).toBe('repurpose');
      expect(conversations!.entries[0].questionIndex).toBe(3);
    });

    it('should append multiple validation entries preserving metadata', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;

      // Save first validation
      await handler.savePostProcessingConversation(
        sessionDir,
        1,
        'decision_validation',
        'First validation',
        '{"result": "pass"}',
        100,
        false,
        undefined,
        { questionId: 'q1', validationAction: 'pass', questionIndex: 1 }
      );

      // Save second validation
      await handler.savePostProcessingConversation(
        sessionDir,
        1,
        'decision_validation',
        'Second validation',
        '{"result": "filter"}',
        100,
        false,
        undefined,
        { questionId: 'q2', validationAction: 'filter', questionIndex: 2 }
      );

      const conversations = await storage.readJson<{ entries: Array<{
        questionId?: string;
        validationAction?: string;
        questionIndex?: number;
      }> }>(
        `${sessionDir}/conversations.json`
      );

      expect(conversations!.entries).toHaveLength(2);
      expect(conversations!.entries[0].questionId).toBe('q1');
      expect(conversations!.entries[0].validationAction).toBe('pass');
      expect(conversations!.entries[0].questionIndex).toBe(1);
      expect(conversations!.entries[1].questionId).toBe('q2');
      expect(conversations!.entries[1].validationAction).toBe('filter');
      expect(conversations!.entries[1].questionIndex).toBe(2);
    });

    it('should handle partial validation metadata', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;

      // Only questionId, no action or index
      await handler.savePostProcessingConversation(
        sessionDir,
        1,
        'decision_validation',
        'Partial validation',
        '{"result": "pass"}',
        100,
        false,
        undefined,
        { questionId: 'q-partial' }
      );

      const conversations = await storage.readJson<{ entries: Array<{
        questionId?: string;
        validationAction?: string;
        questionIndex?: number;
      }> }>(
        `${sessionDir}/conversations.json`
      );

      expect(conversations!.entries[0].questionId).toBe('q-partial');
      expect(conversations!.entries[0].validationAction).toBeUndefined();
      expect(conversations!.entries[0].questionIndex).toBeUndefined();
    });
  });

  describe('validation metadata flow in saveQuestions', () => {
    let handlerWithValidator: ClaudeResultHandler;
    let mockValidator: MockDecisionValidator;

    beforeEach(async () => {
      mockValidator = new MockDecisionValidator();
      handlerWithValidator = new ClaudeResultHandler(
        storage,
        sessionManager,
        mockValidator as unknown as DecisionValidator
      );

      // Set up a plan so validation is triggered
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;
      await storage.writeJson(`${sessionDir}/plan.json`, {
        version: '1.0',
        planVersion: 1,
        sessionId: mockSession.id,
        isApproved: true,
        reviewCount: 1,
        steps: [
          { id: 'step-1', title: 'Setup', description: 'Initial setup', status: 'pending', order: 0, dependencies: [] },
        ],
      });
    });

    it('should save validation conversations with questionIndex metadata', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;
      const decision = {
        questionText: 'Which database to use?',
        category: 'technical',
        priority: 1,
        options: [
          { label: 'PostgreSQL', recommended: true },
          { label: 'MongoDB', recommended: false },
        ],
      };

      mockValidator.setMockResults([{
        decision,
        action: 'pass',
        reason: 'Valid architectural decision',
        validatedAt: new Date().toISOString(),
        durationMs: 150,
        prompt: 'Validate: Which database to use?',
        output: '{"action": "pass", "reason": "Valid architectural decision"}',
      }]);

      const result: ClaudeResult = {
        output: 'Here are my questions',
        sessionId: 'claude-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [decision],
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

      await handlerWithValidator.handleStage1Result(mockSession, result, 'Test prompt');

      const conversations = await storage.readJson<{ entries: Array<{
        postProcessingType?: string;
        validationAction?: string;
        questionIndex?: number;
      }> }>(`${sessionDir}/conversations.json`);

      // Find the validation conversation entry
      const validationEntry = conversations!.entries.find(
        e => e.postProcessingType === 'decision_validation'
      );

      expect(validationEntry).toBeDefined();
      expect(validationEntry!.validationAction).toBe('pass');
      expect(validationEntry!.questionIndex).toBe(1);
    });

    it('should save multiple validation conversations with correct indices', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;
      const decisions = [
        {
          questionText: 'Which database?',
          category: 'technical',
          priority: 1,
          options: [{ label: 'PostgreSQL', recommended: true }],
        },
        {
          questionText: 'Which auth method?',
          category: 'technical',
          priority: 2,
          options: [{ label: 'JWT', recommended: true }],
        },
      ];

      mockValidator.setMockResults([
        {
          decision: decisions[0],
          action: 'pass',
          reason: 'Valid',
          validatedAt: new Date().toISOString(),
          durationMs: 100,
          prompt: 'Validate: Which database?',
          output: '{"action": "pass"}',
        },
        {
          decision: decisions[1],
          action: 'filter',
          reason: 'Already decided',
          validatedAt: new Date().toISOString(),
          durationMs: 100,
          prompt: 'Validate: Which auth method?',
          output: '{"action": "filter"}',
        },
      ]);

      const result: ClaudeResult = {
        output: 'Questions',
        sessionId: 'claude-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions,
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

      await handlerWithValidator.handleStage1Result(mockSession, result, 'Test prompt');

      const conversations = await storage.readJson<{ entries: Array<{
        postProcessingType?: string;
        validationAction?: string;
        questionIndex?: number;
      }> }>(`${sessionDir}/conversations.json`);

      const validationEntries = conversations!.entries.filter(
        e => e.postProcessingType === 'decision_validation'
      );

      expect(validationEntries).toHaveLength(2);
      expect(validationEntries[0].validationAction).toBe('pass');
      expect(validationEntries[0].questionIndex).toBe(1);
      expect(validationEntries[1].validationAction).toBe('filter');
      expect(validationEntries[1].questionIndex).toBe(2);
    });

    it('should save filter validation action with correct metadata', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;
      const decision = {
        questionText: 'Duplicate question?',
        category: 'scope',
        priority: 1,
        options: [{ label: 'Yes', recommended: true }],
      };

      mockValidator.setMockResults([{
        decision,
        action: 'filter',
        reason: 'This is a duplicate question',
        validatedAt: new Date().toISOString(),
        durationMs: 80,
        prompt: 'Validate: Duplicate question?',
        output: '{"action": "filter", "reason": "Duplicate"}',
      }]);

      const result: ClaudeResult = {
        output: 'Question',
        sessionId: 'claude-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [decision],
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

      await handlerWithValidator.handleStage1Result(mockSession, result, 'Test prompt');

      const conversations = await storage.readJson<{ entries: Array<{
        postProcessingType?: string;
        validationAction?: string;
        questionIndex?: number;
      }> }>(`${sessionDir}/conversations.json`);

      const validationEntry = conversations!.entries.find(
        e => e.postProcessingType === 'decision_validation'
      );

      expect(validationEntry).toBeDefined();
      expect(validationEntry!.validationAction).toBe('filter');
      expect(validationEntry!.questionIndex).toBe(1);
    });

    it('should save repurpose validation action with correct metadata', async () => {
      const sessionDir = `${mockSession.projectId}/${mockSession.featureId}`;
      const decision = {
        questionText: 'Vague question?',
        category: 'approach',
        priority: 2,
        options: [{ label: 'Option A', recommended: true }],
      };

      mockValidator.setMockResults([{
        decision,
        action: 'repurpose',
        reason: 'Question needs rephrasing',
        repurposedQuestions: [{
          questionText: 'Better phrased question?',
          category: 'approach',
          priority: 2,
          options: [{ label: 'Better Option', recommended: true }],
        }],
        validatedAt: new Date().toISOString(),
        durationMs: 200,
        prompt: 'Validate: Vague question?',
        output: '{"action": "repurpose", "reason": "Needs rephrasing"}',
      }]);

      const result: ClaudeResult = {
        output: 'Question',
        sessionId: 'claude-123',
        costUsd: 0.05,
        isError: false,
        parsed: {
          decisions: [decision],
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

      await handlerWithValidator.handleStage1Result(mockSession, result, 'Test prompt');

      const conversations = await storage.readJson<{ entries: Array<{
        postProcessingType?: string;
        validationAction?: string;
        questionIndex?: number;
      }> }>(`${sessionDir}/conversations.json`);

      const validationEntry = conversations!.entries.find(
        e => e.postProcessingType === 'decision_validation'
      );

      expect(validationEntry).toBeDefined();
      expect(validationEntry!.validationAction).toBe('repurpose');
      expect(validationEntry!.questionIndex).toBe(1);
    });
  });
});

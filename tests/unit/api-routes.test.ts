import request from 'supertest';
import express, { Express } from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { FileStorageService } from '../../server/src/data/FileStorageService';
import { SessionManager } from '../../server/src/services/SessionManager';
import { createApp } from '../../server/src/app';

describe('API Routes', () => {
  let app: Express;
  let testDir: string;
  let storage: FileStorageService;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `test-api-${Date.now()}`);
    await fs.ensureDir(testDir);
    storage = new FileStorageService(testDir);
    sessionManager = new SessionManager(storage);
    const result = createApp(storage, sessionManager);
    app = result.app;
  });

  afterEach(async () => {
    // Small delay to allow fire-and-forget async operations to settle
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      await fs.remove(testDir);
    } catch {
      // Ignore cleanup errors - async background operations may still be running
    }
  });

  describe('GET /health', () => {
    it('should return health status with all checks', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'healthy',
        version: expect.any(String),
        uptime: expect.any(Number),
        checks: {
          storage: true,
        },
      });
    });

    it('should include uptime in seconds', async () => {
      const response = await request(app).get('/health');

      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return version from package.json', async () => {
      const response = await request(app).get('/health');

      expect(response.body.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('POST /api/sessions/:projectId/:featureId/questions/:questionId/answer', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      // Create a session first
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
      });
      projectId = session.projectId;
      featureId = session.featureId;

      // Add questions to the session
      // Note: We add two questions with different askedAt timestamps to prevent
      // the batch completion logic from triggering Claude spawn during tests
      const questionsPath = `${projectId}/${featureId}/questions.json`;
      const baseTime = new Date().toISOString();
      await storage.writeJson(questionsPath, {
        version: '1.0',
        sessionId: session.id,
        questions: [
          {
            id: 'q1',
            stage: 'discovery',
            questionType: 'single_choice',
            questionText: 'Which auth method?',
            options: [
              { value: 'jwt', label: 'JWT tokens', recommended: true },
              { value: 'session', label: 'Session cookies', recommended: false },
            ],
            answer: null,
            isRequired: true,
            priority: 1,
            askedAt: baseTime,
            answeredAt: null,
          },
          {
            // Second unanswered question in the same batch prevents Claude spawn
            id: 'q1-batch-placeholder',
            stage: 'discovery',
            questionType: 'single_choice',
            questionText: 'Placeholder question (same batch)',
            options: [
              { value: 'a', label: 'Option A', recommended: true },
            ],
            answer: null,
            isRequired: false,
            priority: 3,
            askedAt: baseTime,
            answeredAt: null,
          },
        ],
      });
    });

    it('should answer a question successfully', async () => {
      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/questions/q1/answer`)
        .send({ value: 'jwt' });

      expect(response.status).toBe(200);
      expect(response.body.answer).toEqual({ value: 'jwt' });
      expect(response.body.answeredAt).toBeDefined();
    });

    it('should persist the answer to questions.json', async () => {
      await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/questions/q1/answer`)
        .send({ value: 'session' });

      const questions = await storage.readJson<{ questions: Array<{ id: string; answer: { value: string } | null }> }>(
        `${projectId}/${featureId}/questions.json`
      );

      expect(questions?.questions[0].answer).toEqual({ value: 'session' });
    });

    it('should return 404 for non-existent question', async () => {
      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/questions/nonexistent/answer`)
        .send({ value: 'jwt' });

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/question not found/i);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await request(app)
        .post('/api/sessions/nonexistent/session/questions/q1/answer')
        .send({ value: 'jwt' });

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/session not found/i);
    });

    it('should return 400 for missing answer value', async () => {
      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/questions/q1/answer`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/validation failed/i);
    });

    it('should support text input answers', async () => {
      // Add a text input question with a placeholder to prevent batch completion
      const questionsPath = `${projectId}/${featureId}/questions.json`;
      const questionsData = await storage.readJson<{ questions: Array<Record<string, unknown>> }>(questionsPath);
      const q2Time = new Date().toISOString();
      questionsData!.questions.push(
        {
          id: 'q2',
          stage: 'discovery',
          questionType: 'text_input',
          questionText: 'Any additional notes?',
          options: [],
          answer: null,
          isRequired: false,
          priority: 2,
          askedAt: q2Time,
          answeredAt: null,
        },
        {
          // Placeholder to prevent batch completion triggering Claude spawn
          id: 'q2-batch-placeholder',
          stage: 'discovery',
          questionType: 'single_choice',
          questionText: 'Placeholder',
          options: [{ value: 'a', label: 'A', recommended: true }],
          answer: null,
          isRequired: false,
          priority: 3,
          askedAt: q2Time,
          answeredAt: null,
        }
      );
      await storage.writeJson(questionsPath, questionsData);

      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/questions/q2/answer`)
        .send({ text: 'Use refresh tokens for session management' });

      expect(response.status).toBe(200);
      expect(response.body.answer).toEqual({ text: 'Use refresh tokens for session management' });
    });

    it('should support multi-choice answers', async () => {
      // Add a multi-choice question with a placeholder to prevent batch completion
      const questionsPath = `${projectId}/${featureId}/questions.json`;
      const questionsData = await storage.readJson<{ questions: Array<Record<string, unknown>> }>(questionsPath);
      const q3Time = new Date().toISOString();
      questionsData!.questions.push(
        {
          id: 'q3',
          stage: 'discovery',
          questionType: 'multi_choice',
          questionText: 'Which features to include?',
          options: [
            { value: 'login', label: 'Login' },
            { value: 'register', label: 'Register' },
            { value: 'forgot', label: 'Forgot Password' },
          ],
          answer: null,
          isRequired: true,
          priority: 1,
          askedAt: q3Time,
          answeredAt: null,
        },
        {
          // Placeholder to prevent batch completion triggering Claude spawn
          id: 'q3-batch-placeholder',
          stage: 'discovery',
          questionType: 'single_choice',
          questionText: 'Placeholder',
          options: [{ value: 'a', label: 'A', recommended: true }],
          answer: null,
          isRequired: false,
          priority: 3,
          askedAt: q3Time,
          answeredAt: null,
        }
      );
      await storage.writeJson(questionsPath, questionsData);

      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/questions/q3/answer`)
        .send({ values: ['login', 'register'] });

      expect(response.status).toBe(200);
      expect(response.body.answer).toEqual({ values: ['login', 'register'] });
    });
  });

  describe('GET /api/sessions/:projectId/:featureId/conversations', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      // Create a session first
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
      });
      projectId = session.projectId;
      featureId = session.featureId;
    });

    it('should return empty entries when no conversations exist', async () => {
      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/conversations`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ entries: [] });
    });

    it('should return conversation entries when they exist', async () => {
      const conversationsPath = `${projectId}/${featureId}/conversations.json`;
      const mockConversations = {
        entries: [
          {
            stage: 1,
            timestamp: '2026-01-11T12:00:00Z',
            prompt: 'Explore the codebase',
            output: 'I found the following files...',
            sessionId: 'claude-session-123',
            costUsd: 0.05,
            isError: false,
            parsed: {
              decisions: [],
              planSteps: [],
              planFilePath: null,
              planApproved: false,
              planModeEntered: false,
              planModeExited: false,
            },
          },
        ],
      };
      await storage.writeJson(conversationsPath, mockConversations);

      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/conversations`);

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(1);
      expect(response.body.entries[0]).toMatchObject({
        stage: 1,
        prompt: 'Explore the codebase',
        output: 'I found the following files...',
        costUsd: 0.05,
      });
    });

    it('should return multiple conversation entries in order', async () => {
      const conversationsPath = `${projectId}/${featureId}/conversations.json`;
      const mockConversations = {
        entries: [
          {
            stage: 1,
            timestamp: '2026-01-11T12:00:00Z',
            prompt: 'Stage 1 prompt',
            output: 'Stage 1 output',
            sessionId: 'session-1',
            costUsd: 0.03,
            isError: false,
            parsed: { decisions: [], planSteps: [], planFilePath: null, planApproved: false, planModeEntered: false, planModeExited: false },
          },
          {
            stage: 2,
            timestamp: '2026-01-11T13:00:00Z',
            prompt: 'Stage 2 prompt',
            output: 'Stage 2 output',
            sessionId: 'session-1',
            costUsd: 0.07,
            isError: false,
            parsed: { decisions: [], planSteps: [], planFilePath: null, planApproved: true, planModeEntered: false, planModeExited: false },
          },
        ],
      };
      await storage.writeJson(conversationsPath, mockConversations);

      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/conversations`);

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(2);
      expect(response.body.entries[0].stage).toBe(1);
      expect(response.body.entries[1].stage).toBe(2);
    });

    it('should include error information when conversation had errors', async () => {
      const conversationsPath = `${projectId}/${featureId}/conversations.json`;
      const mockConversations = {
        entries: [
          {
            stage: 1,
            timestamp: '2026-01-11T12:00:00Z',
            prompt: 'Explore the codebase',
            output: '',
            sessionId: null,
            costUsd: 0,
            isError: true,
            error: 'Claude process timed out',
            parsed: { decisions: [], planSteps: [], planFilePath: null, planApproved: false, planModeEntered: false, planModeExited: false },
          },
        ],
      };
      await storage.writeJson(conversationsPath, mockConversations);

      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/conversations`);

      expect(response.status).toBe(200);
      expect(response.body.entries[0].isError).toBe(true);
      expect(response.body.entries[0].error).toBe('Claude process timed out');
    });

    it('should return 200 with empty entries for non-existent project', async () => {
      const response = await request(app)
        .get('/api/sessions/nonexistent/session/conversations');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ entries: [] });
    });
  });

  describe('POST /api/sessions/:projectId/:featureId/re-review', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      // Create a session in Stage 5
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
      });
      projectId = session.projectId;
      featureId = session.featureId;

      // Update session to Stage 5
      const sessionPath = `${projectId}/${featureId}/session.json`;
      const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
      sessionData!.currentStage = 5;
      await storage.writeJson(sessionPath, sessionData);

      // Add plan.json
      await storage.writeJson(`${projectId}/${featureId}/plan.json`, {
        version: '1.0',
        planVersion: 1,
        sessionId: session.id,
        isApproved: true,
        reviewCount: 1,
        steps: [
          { id: 'step-1', title: 'Step 1', status: 'completed' },
        ],
      });

      // Add pr.json
      await storage.writeJson(`${projectId}/${featureId}/pr.json`, {
        title: 'Test PR',
        branch: 'feature/test',
        url: 'https://github.com/test/repo/pull/1',
        createdAt: '2026-01-11T12:00:00Z',
      });
    });

    it('should accept re-review request with remarks', async () => {
      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/re-review`)
        .send({ remarks: 'Please check the error handling' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        remarks: 'Please check the error handling',
      });
    });

    it('should accept re-review request without remarks', async () => {
      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/re-review`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        remarks: null,
      });
    });

    it('should return 404 for non-existent session', async () => {
      const response = await request(app)
        .post('/api/sessions/nonexistent/session/re-review')
        .send({ remarks: 'test' });

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/session not found/i);
    });

    it('should return 400 if session is not in Stage 5', async () => {
      // Update session to Stage 3
      const sessionPath = `${projectId}/${featureId}/session.json`;
      const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
      sessionData!.currentStage = 3;
      await storage.writeJson(sessionPath, sessionData);

      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/re-review`)
        .send({ remarks: 'test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/stage 5/i);
    });

    it('should return 404 if plan is missing', async () => {
      // Remove plan.json
      const planPath = `${projectId}/${featureId}/plan.json`;
      await storage.delete(planPath);

      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/re-review`)
        .send({ remarks: 'test' });

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/plan not found/i);
    });

    it('should return 404 if PR info is missing', async () => {
      // Remove pr.json
      const prPath = `${projectId}/${featureId}/pr.json`;
      await storage.delete(prPath);

      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/re-review`)
        .send({ remarks: 'test' });

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/pr info not found/i);
    });
  });
});

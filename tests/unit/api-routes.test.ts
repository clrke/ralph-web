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

    it('should include validation metadata (questionIndex, validationAction) in response', async () => {
      const conversationsPath = `${projectId}/${featureId}/conversations.json`;
      const mockConversations = {
        entries: [
          {
            stage: 1,
            timestamp: '2026-01-11T12:00:00Z',
            prompt: 'Main discovery call',
            output: 'Discovered files...',
            sessionId: 'claude-session-123',
            costUsd: 0.05,
            isError: false,
            parsed: { decisions: [], planSteps: [], planFilePath: null, planApproved: false, planModeEntered: false, planModeExited: false },
          },
          {
            stage: 1,
            timestamp: '2026-01-11T12:01:00Z',
            prompt: 'Validate question: Which database?',
            output: 'pass',
            sessionId: null,
            costUsd: 0,
            isError: false,
            parsed: { decisions: [], planSteps: [], planFilePath: null, planApproved: false, planModeEntered: false, planModeExited: false },
            postProcessingType: 'decision_validation',
            validationAction: 'pass',
            questionIndex: 1,
          },
          {
            stage: 1,
            timestamp: '2026-01-11T12:02:00Z',
            prompt: 'Validate question: Which auth method?',
            output: 'filter',
            sessionId: null,
            costUsd: 0,
            isError: false,
            parsed: { decisions: [], planSteps: [], planFilePath: null, planApproved: false, planModeEntered: false, planModeExited: false },
            postProcessingType: 'decision_validation',
            validationAction: 'filter',
            questionIndex: 2,
          },
        ],
      };
      await storage.writeJson(conversationsPath, mockConversations);

      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/conversations`);

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(3);

      // First entry - no validation metadata
      expect(response.body.entries[0].postProcessingType).toBeUndefined();
      expect(response.body.entries[0].validationAction).toBeUndefined();
      expect(response.body.entries[0].questionIndex).toBeUndefined();

      // Second entry - validation with pass action
      expect(response.body.entries[1].postProcessingType).toBe('decision_validation');
      expect(response.body.entries[1].validationAction).toBe('pass');
      expect(response.body.entries[1].questionIndex).toBe(1);

      // Third entry - validation with filter action
      expect(response.body.entries[2].postProcessingType).toBe('decision_validation');
      expect(response.body.entries[2].validationAction).toBe('filter');
      expect(response.body.entries[2].questionIndex).toBe(2);
    });

    it('should include stepId for Stage 3 implementation entries', async () => {
      const conversationsPath = `${projectId}/${featureId}/conversations.json`;
      const mockConversations = {
        entries: [
          {
            stage: 3,
            stepId: 'step-abc-123',
            timestamp: '2026-01-11T12:00:00Z',
            prompt: 'Implement step 1',
            output: 'Implemented feature...',
            sessionId: 'claude-session-456',
            costUsd: 0.10,
            isError: false,
            parsed: { decisions: [], planSteps: [], planFilePath: null, planApproved: false, planModeEntered: false, planModeExited: false },
          },
        ],
      };
      await storage.writeJson(conversationsPath, mockConversations);

      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/conversations`);

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(1);
      expect(response.body.entries[0].stage).toBe(3);
      expect(response.body.entries[0].stepId).toBe('step-abc-123');
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

  describe('GET /api/sessions/:projectId/:featureId/plan/validation', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
      });
      projectId = session.projectId;
      featureId = session.featureId;
    });

    it('should return validation result for composable plan', async () => {
      // Create a composable plan with all required sections
      // Note: description must be at least 50 characters for validation to pass
      await storage.writeJson(`${projectId}/${featureId}/plan.json`, {
        meta: {
          version: '1.0',
          sessionId: 'test-session',
          createdAt: '2026-01-11T12:00:00Z',
          updatedAt: '2026-01-11T12:00:00Z',
          isApproved: false,
          reviewCount: 0,
        },
        steps: [
          {
            id: 'step-1',
            parentId: null,
            orderIndex: 0,
            title: 'First Step',
            description: 'This is a detailed implementation plan for the first step that contains enough characters to pass validation.',
            status: 'pending',
            metadata: {},
            complexity: 'medium',
            acceptanceCriteriaIds: ['ac-1'],
            estimatedFiles: ['file1.ts'],
          },
        ],
        dependencies: {
          stepDependencies: [],
          externalDependencies: [],
        },
        testCoverage: {
          framework: 'jest',
          requiredTestTypes: ['unit'],
          stepCoverage: [],
          globalCoverageTarget: 80,
        },
        acceptanceMapping: {
          mappings: [],
          updatedAt: '2026-01-11T12:00:00Z',
        },
        validationStatus: {
          meta: true,
          steps: true,
          dependencies: true,
          testCoverage: true,
          acceptanceMapping: true,
          overall: true,
        },
      });

      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/plan/validation`);

      expect(response.status).toBe(200);
      expect(response.body.complete).toBe(true);
      expect(response.body.validationResult).toBeDefined();
      expect(response.body.validationResult.overall).toBe(true);
    });

    it('should return validation errors for incomplete plan', async () => {
      // Create a legacy plan without all composable sections
      await storage.writeJson(`${projectId}/${featureId}/plan.json`, {
        version: '1.0',
        planVersion: 1,
        sessionId: 'test-session',
        isApproved: false,
        reviewCount: 0,
        createdAt: '2026-01-11T12:00:00Z',
        steps: [],  // Empty steps should fail validation
      });

      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/plan/validation`);

      expect(response.status).toBe(200);
      expect(response.body.complete).toBe(false);
      expect(response.body.validationResult).toBeDefined();
      expect(response.body.missingContext).toBeTruthy();
    });

    it('should return incomplete when plan does not exist', async () => {
      // Delete the plan that was created by session creation
      await storage.delete(`${projectId}/${featureId}/plan.json`);

      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/plan/validation`);

      expect(response.status).toBe(200);
      expect(response.body.complete).toBe(false);
      // When plan is null, checkPlanCompletenessSync returns "No plan provided"
      expect(response.body.missingContext).toMatch(/no plan provided/i);
    });
  });

  describe('POST /api/sessions/:projectId/:featureId/plan/revalidate', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
      });
      projectId = session.projectId;
      featureId = session.featureId;
    });

    it('should revalidate composable plan and update validationStatus', async () => {
      // Create a composable plan with proper description (min 50 chars)
      await storage.writeJson(`${projectId}/${featureId}/plan.json`, {
        meta: {
          version: '1.0',
          sessionId: 'test-session',
          createdAt: '2026-01-11T12:00:00Z',
          updatedAt: '2026-01-11T12:00:00Z',
          isApproved: false,
          reviewCount: 0,
        },
        steps: [
          {
            id: 'step-1',
            parentId: null,
            orderIndex: 0,
            title: 'First Step',
            description: 'This is a detailed implementation description that contains enough characters to pass the minimum length validation requirement.',
            status: 'pending',
            metadata: {},
            complexity: 'low',
            acceptanceCriteriaIds: [],
            estimatedFiles: [],
          },
        ],
        dependencies: {
          stepDependencies: [],
          externalDependencies: [],
        },
        testCoverage: {
          framework: 'jest',
          requiredTestTypes: ['unit'],
          stepCoverage: [],
          globalCoverageTarget: 80,
        },
        acceptanceMapping: {
          mappings: [],
          updatedAt: '2026-01-11T12:00:00Z',
        },
        validationStatus: {
          meta: false, // Intentionally wrong - should be updated
          steps: false,
          dependencies: false,
          testCoverage: false,
          acceptanceMapping: false,
          overall: false,
        },
      });

      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/plan/revalidate`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.complete).toBe(true);
      expect(response.body.validationResult.overall).toBe(true);
      expect(response.body.updated).toBe(true);

      // Verify the plan file was updated
      const updatedPlan = await storage.readJson<Record<string, unknown>>(`${projectId}/${featureId}/plan.json`);
      const validationStatus = updatedPlan?.validationStatus as Record<string, boolean>;
      expect(validationStatus.overall).toBe(true);
    });

    it('should return 404 when plan does not exist', async () => {
      // Make sure there's no plan file
      try {
        await storage.delete(`${projectId}/${featureId}/plan.json`);
      } catch {
        // ignore if doesn't exist
      }

      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/plan/revalidate`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/plan not found/i);
    });

    it('should update session planValidationContext on validation failure', async () => {
      // Create a plan with incomplete steps
      await storage.writeJson(`${projectId}/${featureId}/plan.json`, {
        meta: {
          version: '1.0',
          sessionId: 'test-session',
          createdAt: '2026-01-11T12:00:00Z',
          updatedAt: '2026-01-11T12:00:00Z',
          isApproved: false,
          reviewCount: 0,
        },
        steps: [], // Empty steps - validation should fail
        dependencies: {
          stepDependencies: [],
          externalDependencies: [],
        },
        testCoverage: {
          framework: 'jest',
          requiredTestTypes: ['unit'],
          stepCoverage: [],
          globalCoverageTarget: 80,
        },
        acceptanceMapping: {
          mappings: [],
          updatedAt: '2026-01-11T12:00:00Z',
        },
        validationStatus: {
          meta: true,
          steps: true, // Intentionally wrong
          dependencies: true,
          testCoverage: true,
          acceptanceMapping: true,
          overall: true,
        },
      });

      const response = await request(app)
        .post(`/api/sessions/${projectId}/${featureId}/plan/revalidate`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.complete).toBe(false);
      expect(response.body.updated).toBe(true);

      // Verify session planValidationContext was updated
      const session = await sessionManager.getSession(projectId, featureId);
      expect(session?.planValidationContext).toBeTruthy();
    });
  });

  describe('GET /api/sessions/:projectId/:featureId/plan with validation', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
      });
      projectId = session.projectId;
      featureId = session.featureId;

      // Create a plan
      await storage.writeJson(`${projectId}/${featureId}/plan.json`, {
        meta: {
          version: '1.0',
          sessionId: 'test-session',
          createdAt: '2026-01-11T12:00:00Z',
          updatedAt: '2026-01-11T12:00:00Z',
          isApproved: false,
          reviewCount: 0,
        },
        steps: [
          {
            id: 'step-1',
            parentId: null,
            orderIndex: 0,
            title: 'First Step',
            description: 'Implementation details',
            status: 'pending',
            metadata: {},
            complexity: 'medium',
          },
        ],
        dependencies: {
          stepDependencies: [],
          externalDependencies: [],
        },
        testCoverage: {
          framework: 'jest',
          requiredTestTypes: ['unit'],
          stepCoverage: [],
        },
        acceptanceMapping: {
          mappings: [],
          updatedAt: '2026-01-11T12:00:00Z',
        },
        validationStatus: {
          meta: true,
          steps: true,
          dependencies: true,
          testCoverage: true,
          acceptanceMapping: true,
          overall: true,
        },
      });
    });

    it('should return plan without validation by default', async () => {
      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/plan`);

      expect(response.status).toBe(200);
      expect(response.body.meta).toBeDefined();
      expect(response.body.steps).toBeDefined();
      expect(response.body.validation).toBeUndefined();
    });

    it('should return plan with validation when validate=true', async () => {
      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/plan?validate=true`);

      expect(response.status).toBe(200);
      expect(response.body.plan).toBeDefined();
      expect(response.body.validation).toBeDefined();
      // Validation returns result - it may not be complete depending on test setup
      expect(response.body.validation.validationResult).toBeDefined();
    });

    it('should return 404 when plan does not exist', async () => {
      // Remove the plan
      await storage.delete(`${projectId}/${featureId}/plan.json`);

      const response = await request(app)
        .get(`/api/sessions/${projectId}/${featureId}/plan`);

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/plan not found/i);
    });
  });

  describe('PUT /api/sessions/:projectId/queue-order', () => {
    const projectPath = '/test/queue-project';
    let projectId: string;

    beforeEach(async () => {
      projectId = sessionManager.getProjectId(projectPath);
    });

    it('should reorder queued sessions successfully', async () => {
      // Create active session
      await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Create queued sessions
      const second = await sessionManager.createSession({
        title: 'Second Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const third = await sessionManager.createSession({
        title: 'Third Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Reorder: third first, then second
      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: [third.featureId, second.featureId] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].featureId).toBe(third.featureId);
      expect(response.body[0].queuePosition).toBe(1);
      expect(response.body[1].featureId).toBe(second.featureId);
      expect(response.body[1].queuePosition).toBe(2);
    });

    it('should return 400 for invalid feature IDs', async () => {
      // Create active session
      await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Create queued session
      await sessionManager.createSession({
        title: 'Queued Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: ['non-existent-feature'] });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/not queued sessions/i);
    });

    it('should return 400 for non-queued session IDs', async () => {
      // Create active session
      const active = await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Create queued session
      await sessionManager.createSession({
        title: 'Queued Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Try to reorder with active session ID
      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: [active.featureId] });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/not queued sessions/i);
    });

    it('should handle duplicate feature IDs gracefully', async () => {
      // Create active session
      await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Create queued sessions
      const second = await sessionManager.createSession({
        title: 'Second Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const third = await sessionManager.createSession({
        title: 'Third Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Send duplicates - should deduplicate
      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: [third.featureId, second.featureId, third.featureId] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].featureId).toBe(third.featureId);
      expect(response.body[1].featureId).toBe(second.featureId);
    });

    it('should return empty array when no queued sessions', async () => {
      // Create only an active session (no queued)
      await sessionManager.createSession({
        title: 'Only Session',
        featureDescription: 'Test',
        projectPath,
      });

      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: [] });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return 400 for missing orderedFeatureIds', async () => {
      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/validation failed/i);
    });

    it('should persist reordering to storage', async () => {
      // Create active session
      await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Create queued sessions
      const second = await sessionManager.createSession({
        title: 'Second Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const third = await sessionManager.createSession({
        title: 'Third Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Reorder
      await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: [third.featureId, second.featureId] });

      // Verify persistence by reading sessions directly
      const updatedSecond = await sessionManager.getSession(projectId, second.featureId);
      const updatedThird = await sessionManager.getSession(projectId, third.featureId);

      expect(updatedThird!.queuePosition).toBe(1);
      expect(updatedSecond!.queuePosition).toBe(2);
    });

    it('should handle partial reordering (subset of queued sessions)', async () => {
      // Create active session
      await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Create queued sessions
      const second = await sessionManager.createSession({
        title: 'Second Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const third = await sessionManager.createSession({
        title: 'Third Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const fourth = await sessionManager.createSession({
        title: 'Fourth Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Only specify one session - should move to front, others maintain relative order
      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: [fourth.featureId] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3);
      expect(response.body[0].featureId).toBe(fourth.featureId);
      expect(response.body[0].queuePosition).toBe(1);
      expect(response.body[1].featureId).toBe(second.featureId);
      expect(response.body[1].queuePosition).toBe(2);
      expect(response.body[2].featureId).toBe(third.featureId);
      expect(response.body[2].queuePosition).toBe(3);
    });

    it('should handle concurrent reordering attempts sequentially', async () => {
      // Create active session
      await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Create queued sessions
      const second = await sessionManager.createSession({
        title: 'Second Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const third = await sessionManager.createSession({
        title: 'Third Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const fourth = await sessionManager.createSession({
        title: 'Fourth Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Send two reordering requests concurrently
      const [response1, response2] = await Promise.all([
        request(app)
          .put(`/api/sessions/${projectId}/queue-order`)
          .send({ orderedFeatureIds: [fourth.featureId, third.featureId, second.featureId] }),
        request(app)
          .put(`/api/sessions/${projectId}/queue-order`)
          .send({ orderedFeatureIds: [second.featureId, fourth.featureId, third.featureId] }),
      ]);

      // Both should succeed (one wins due to locking)
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Final state should be consistent (whichever finished last)
      const queued = await sessionManager.getQueuedSessions(projectId);
      expect(queued).toHaveLength(3);
      // Positions should be sequential 1, 2, 3
      expect(queued[0].queuePosition).toBe(1);
      expect(queued[1].queuePosition).toBe(2);
      expect(queued[2].queuePosition).toBe(3);
    });

    it('should return proper JSON content-type', async () => {
      // Create active session
      await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      await sessionManager.createSession({
        title: 'Queued Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: [] });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should work with project that has no sessions', async () => {
      const emptyProjectPath = '/empty/project';
      const emptyProjectId = sessionManager.getProjectId(emptyProjectPath);

      const response = await request(app)
        .put(`/api/sessions/${emptyProjectId}/queue-order`)
        .send({ orderedFeatureIds: [] });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should validate orderedFeatureIds is an array', async () => {
      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/validation failed/i);
    });
  });
});

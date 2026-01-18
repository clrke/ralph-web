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
    await new Promise(resolve => setTimeout(resolve, 50));
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
              planApproved: false,
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
            parsed: { decisions: [], planSteps: [], planApproved: false },
          },
          {
            stage: 2,
            timestamp: '2026-01-11T13:00:00Z',
            prompt: 'Stage 2 prompt',
            output: 'Stage 2 output',
            sessionId: 'session-1',
            costUsd: 0.07,
            isError: false,
            parsed: { decisions: [], planSteps: [], planApproved: true },
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
            parsed: { decisions: [], planSteps: [], planApproved: false },
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
            parsed: { decisions: [], planSteps: [], planApproved: false },
          },
          {
            stage: 1,
            timestamp: '2026-01-11T12:01:00Z',
            prompt: 'Validate question: Which database?',
            output: 'pass',
            sessionId: null,
            costUsd: 0,
            isError: false,
            parsed: { decisions: [], planSteps: [], planApproved: false },
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
            parsed: { decisions: [], planSteps: [], planApproved: false },
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
            parsed: { decisions: [], planSteps: [], planApproved: false },
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

    it('should silently ignore invalid feature IDs', async () => {
      // Create active session
      await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Create queued session
      const queued = await sessionManager.createSession({
        title: 'Queued Feature',
        featureDescription: 'Test',
        projectPath,
      });

      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: ['non-existent-feature'] });

      // Should succeed and return remaining queued sessions
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].featureId).toBe(queued.featureId);
    });

    it('should silently ignore non-queued session IDs', async () => {
      // Create active session
      const active = await sessionManager.createSession({
        title: 'Active Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Create queued session
      const queued = await sessionManager.createSession({
        title: 'Queued Feature',
        featureDescription: 'Test',
        projectPath,
      });

      // Try to reorder with active session ID - should be silently filtered
      const response = await request(app)
        .put(`/api/sessions/${projectId}/queue-order`)
        .send({ orderedFeatureIds: [active.featureId] });

      // Should succeed and return remaining queued sessions
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].featureId).toBe(queued.featureId);
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

  describe('POST /api/sessions/:projectId/:featureId/final-approval (Stage 6 transitions)', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      // Create a session
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
      });
      projectId = session.projectId;
      featureId = session.featureId;

      // Set up session in Stage 6
      const sessionPath = `${projectId}/${featureId}/session.json`;
      const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
      sessionData!.currentStage = 6;
      sessionData!.status = 'final_approval';
      await storage.writeJson(sessionPath, sessionData);

      // Add plan.json (required for some transitions)
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

      // Add pr.json (required for re_review)
      await storage.writeJson(`${projectId}/${featureId}/pr.json`, {
        title: 'Test PR',
        branch: 'feature/test',
        url: 'https://github.com/test/repo/pull/1',
        createdAt: '2026-01-11T12:00:00Z',
      });
    });

    describe('Stage 6 → 7 transition (merge)', () => {
      it('should transition to Stage 7 when action is merge', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'merge' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.session.currentStage).toBe(7);
        expect(response.body.session.status).toBe('completed');
      });

      it('should accept optional feedback when merging', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'merge', feedback: 'Great work!' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.session.currentStage).toBe(7);
      });

      it('should persist Stage 7 to storage', async () => {
        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'merge' });

        const session = await sessionManager.getSession(projectId, featureId);
        expect(session!.currentStage).toBe(7);
        expect(session!.status).toBe('completed');
      });
    });

    describe('Stage 6 → 2 transition (plan_changes)', () => {
      it('should transition to Stage 2 when action is plan_changes', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'plan_changes', feedback: 'Need to refactor the auth module' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.session.currentStage).toBe(2);
        expect(response.body.session.status).toBe('planning');
      });

      it('should require feedback for plan_changes', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'plan_changes' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/feedback.*required/i);
      });

      it('should persist Stage 2 transition to storage', async () => {
        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'plan_changes', feedback: 'Change the approach' });

        const session = await sessionManager.getSession(projectId, featureId);
        expect(session!.currentStage).toBe(2);
        expect(session!.status).toBe('planning');
      });

      it('should initialize isPlanModificationSession flag', async () => {
        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'plan_changes', feedback: 'Need modifications' });

        const session = await sessionManager.getSession(projectId, featureId);
        expect(session!.isPlanModificationSession).toBe(true);
      });

      it('should clear previous modification tracking fields', async () => {
        // First, set some modification tracking fields on the session
        await sessionManager.updateSession(projectId, featureId, {
          modifiedStepIds: ['old-step-1'],
          addedStepIds: ['old-step-2'],
          removedStepIds: ['old-step-3'],
        });

        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'plan_changes', feedback: 'Need modifications' });

        const session = await sessionManager.getSession(projectId, featureId);
        // Previous tracking should be cleared
        expect(session!.modifiedStepIds).toBeUndefined();
        expect(session!.addedStepIds).toBeUndefined();
        expect(session!.removedStepIds).toBeUndefined();
        // But new tracking should be initialized
        expect(session!.isPlanModificationSession).toBe(true);
      });

      it('should return 400 if plan not found', async () => {
        // Remove the plan
        await storage.delete(`${projectId}/${featureId}/plan.json`);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'plan_changes', feedback: 'Need modifications' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/plan not found/i);
      });

    });

    describe('Stage 6 → 5 transition (re_review)', () => {
      it('should transition to Stage 5 when action is re_review', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 're_review', feedback: 'Please check edge cases more carefully' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.session.currentStage).toBe(5);
        expect(response.body.session.status).toBe('pr_review');
      });

      it('should require feedback for re_review', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 're_review' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/feedback.*required/i);
      });

      it('should persist Stage 5 transition to storage', async () => {
        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 're_review', feedback: 'Check error handling' });

        const session = await sessionManager.getSession(projectId, featureId);
        expect(session!.currentStage).toBe(5);
        expect(session!.status).toBe('pr_review');
      });
    });

    describe('Validation and error handling', () => {
      it('should return 404 for non-existent session', async () => {
        const response = await request(app)
          .post('/api/sessions/nonexistent/session/final-approval')
          .send({ action: 'merge' });

        expect(response.status).toBe(404);
        expect(response.body.error).toMatch(/session not found/i);
      });

      it('should return 400 if session is not in Stage 6', async () => {
        // Set session to Stage 3
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.currentStage = 3;
        sessionData!.status = 'implementing';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'merge' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/stage 6/i);
      });

      it('should return 400 for invalid action', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({ action: 'invalid_action' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/invalid action/i);
      });

      it('should return 400 for missing action', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/final-approval`)
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/invalid action/i);
      });
    });
  });

  describe('Stage 5 → 6 transition (validation schema allows it)', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      // Create a session
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
      });
      projectId = session.projectId;
      featureId = session.featureId;

      // Set up session in Stage 5
      const sessionPath = `${projectId}/${featureId}/session.json`;
      const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
      sessionData!.currentStage = 5;
      sessionData!.status = 'pr_review';
      await storage.writeJson(sessionPath, sessionData);
    });

    it('should allow updating session to Stage 6 via PATCH', async () => {
      // This tests that the validation schema now accepts Stage 6
      const response = await request(app)
        .patch(`/api/sessions/${projectId}/${featureId}`)
        .send({ currentStage: 6, status: 'final_approval' });

      expect(response.status).toBe(200);
      expect(response.body.currentStage).toBe(6);
      expect(response.body.status).toBe('final_approval');
    });

    it('should allow updating session to Stage 7 via PATCH', async () => {
      // First transition to Stage 6
      await request(app)
        .patch(`/api/sessions/${projectId}/${featureId}`)
        .send({ currentStage: 6, status: 'final_approval' });

      // Then transition to Stage 7
      const response = await request(app)
        .patch(`/api/sessions/${projectId}/${featureId}`)
        .send({ currentStage: 7, status: 'completed' });

      expect(response.status).toBe(200);
      expect(response.body.currentStage).toBe(7);
      expect(response.body.status).toBe('completed');
    });

    it('should reject Stage 8 via PATCH (out of range)', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${projectId}/${featureId}`)
        .send({ currentStage: 8 });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/validation failed/i);
    });
  });

  describe('POST /api/sessions/:projectId/:featureId/backout', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      // Create a session in active state (discovery)
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/project',
      });
      projectId = session.projectId;
      featureId = session.featureId;
    });

    describe('pause action', () => {
      it('should pause an active session', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause', reason: 'user_requested' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('paused');
        expect(response.body.session.backoutReason).toBe('user_requested');
        expect(response.body.session.backoutTimestamp).toBeDefined();
      });

      it('should pause session with blocked reason', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause', reason: 'blocked' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('paused');
        expect(response.body.session.backoutReason).toBe('blocked');
      });

      it('should pause session with deprioritized reason', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause', reason: 'deprioritized' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('paused');
        expect(response.body.session.backoutReason).toBe('deprioritized');
      });

      it('should default to user_requested reason when not provided', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(200);
        expect(response.body.session.backoutReason).toBe('user_requested');
      });

      it('should persist pause to storage', async () => {
        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause' });

        const session = await sessionManager.getSession(projectId, featureId);
        expect(session!.status).toBe('paused');
        expect(session!.backoutReason).toBe('user_requested');
      });
    });

    describe('abandon action', () => {
      it('should abandon an active session', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'abandon', reason: 'deprioritized' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('failed');
        expect(response.body.session.backoutReason).toBe('deprioritized');
        expect(response.body.session.backoutTimestamp).toBeDefined();
      });

      it('should persist abandon to storage', async () => {
        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'abandon' });

        const session = await sessionManager.getSession(projectId, featureId);
        expect(session!.status).toBe('failed');
      });
    });

    describe('queue promotion', () => {
      it('should promote next queued session when active session is backed out', async () => {
        // Create a second session (will be queued)
        const queuedSession = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath: '/test/project',
        });

        expect(queuedSession.status).toBe('queued');

        // Back out the active session
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(200);
        expect(response.body.promotedSession).toBeDefined();
        expect(response.body.promotedSession.featureId).toBe(queuedSession.featureId);
        expect(response.body.promotedSession.status).toBe('discovery');
      });

      it('should not promote when no queued sessions exist', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(200);
        expect(response.body.promotedSession).toBeNull();
      });
    });

    describe('validation and error handling', () => {
      it('should return 404 for non-existent session', async () => {
        const response = await request(app)
          .post('/api/sessions/nonexistent/session/backout')
          .send({ action: 'pause' });

        expect(response.status).toBe(404);
        expect(response.body.error).toMatch(/session not found/i);
      });

      it('should return 400 for invalid action', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'invalid_action' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/validation failed/i);
      });

      it('should return 400 for missing action', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/validation failed/i);
      });

      it('should return 400 for invalid reason', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause', reason: 'invalid_reason' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/validation failed/i);
      });

      it('should return 400 for completed session', async () => {
        // Set session to completed (Stage 7)
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.currentStage = 7;
        sessionData!.status = 'completed';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot back out/i);
      });

      it('should return 400 for already paused session', async () => {
        // First pause the session
        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause' });

        // Try to pause again
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot back out/i);
      });

      it('should return 400 for failed session', async () => {
        // Set session to failed
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.status = 'failed';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'abandon' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot back out/i);
      });
    });

    describe('backout from different stages', () => {
      it('should allow backout from Stage 2 (planning)', async () => {
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.currentStage = 2;
        sessionData!.status = 'planning';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('paused');
      });

      it('should allow backout from Stage 3 (implementing)', async () => {
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.currentStage = 3;
        sessionData!.status = 'implementing';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'abandon' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('failed');
      });

      it('should allow backout from Stage 6 (final_approval)', async () => {
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.currentStage = 6;
        sessionData!.status = 'final_approval';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/backout`)
          .send({ action: 'pause' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('paused');
      });

      it('should allow backout from queued status', async () => {
        // Create active session first
        await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath: '/test/backout-queue',
        });

        // Create queued session
        const queuedSession = await sessionManager.createSession({
          title: 'Queued Feature',
          featureDescription: 'Test',
          projectPath: '/test/backout-queue',
        });

        expect(queuedSession.status).toBe('queued');

        const response = await request(app)
          .post(`/api/sessions/${queuedSession.projectId}/${queuedSession.featureId}/backout`)
          .send({ action: 'abandon' });

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('failed');
      });
    });
  });

  describe('POST /api/sessions/:projectId/:featureId/resume', () => {
    let projectId: string;
    let featureId: string;

    beforeEach(async () => {
      // Create a session and pause it
      const session = await sessionManager.createSession({
        title: 'Test Feature',
        featureDescription: 'Test description',
        projectPath: '/test/resume-project',
      });
      projectId = session.projectId;
      featureId = session.featureId;

      // Pause the session
      await sessionManager.backoutSession(projectId, featureId, 'pause', 'user_requested');
    });

    describe('successful resume', () => {
      it('should resume a paused session', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(200);
        expect(response.body.session.status).not.toBe('paused');
        expect(response.body.session.backoutReason).toBeNull();
        expect(response.body.session.backoutTimestamp).toBeNull();
      });

      it('should restore appropriate status based on stage', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(200);
        // Session was in Stage 1 (discovery) when paused
        expect(response.body.session.status).toBe('discovery');
      });

      it('should return wasQueued false when no other active session', async () => {
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(200);
        expect(response.body.wasQueued).toBe(false);
      });

      it('should queue resumed session when another session is active', async () => {
        // Create another active session
        const activeSession = await sessionManager.createSession({
          title: 'Active Feature',
          featureDescription: 'Test',
          projectPath: '/test/resume-project',
        });

        expect(activeSession.status).toBe('discovery');

        // Now resume the paused session
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('queued');
        expect(response.body.wasQueued).toBe(true);
        expect(response.body.session.queuePosition).toBe(1); // Front of queue
      });

      it('should persist resume to storage', async () => {
        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        const session = await sessionManager.getSession(projectId, featureId);
        expect(session!.status).not.toBe('paused');
        expect(session!.backoutReason).toBeNull();
      });
    });

    describe('stage-based status restoration', () => {
      it('should restore planning status for Stage 2', async () => {
        // Update to Stage 2 and re-pause
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.currentStage = 2;
        sessionData!.status = 'paused';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('planning');
      });

      it('should restore implementing status for Stage 3', async () => {
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.currentStage = 3;
        sessionData!.status = 'paused';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(200);
        expect(response.body.session.status).toBe('implementing');
      });
    });

    describe('validation and error handling', () => {
      it('should return 404 for non-existent session', async () => {
        const response = await request(app)
          .post('/api/sessions/nonexistent/session/resume');

        expect(response.status).toBe(404);
        expect(response.body.error).toMatch(/session not found/i);
      });

      it('should return 400 for non-paused session (discovery)', async () => {
        // Resume first to make it active
        await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        // Try to resume again
        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot resume/i);
        expect(response.body.error).toMatch(/only paused sessions/i);
      });

      it('should return 400 for completed session', async () => {
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.currentStage = 7;
        sessionData!.status = 'completed';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot resume/i);
      });

      it('should return 400 for failed session', async () => {
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.status = 'failed';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot resume/i);
      });

      it('should return 400 for queued session', async () => {
        const sessionPath = `${projectId}/${featureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.status = 'queued';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .post(`/api/sessions/${projectId}/${featureId}/resume`);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/cannot resume/i);
      });
    });
  });

  describe('PATCH /api/sessions/:projectId/:featureId/edit', () => {
    const projectPath = '/Users/test/project';
    let activeProjectId: string;
    let queuedProjectId: string;
    let queuedFeatureId: string;

    beforeEach(async () => {
      // Create active session first (so next session will be queued)
      const activeSession = await sessionManager.createSession({
        title: 'Active Session',
        featureDescription: 'Active description',
        projectPath,
      });
      activeProjectId = activeSession.projectId;

      // Create queued session
      const queuedSession = await sessionManager.createSession({
        title: 'Queued Session',
        featureDescription: 'Queued description',
        projectPath,
      });
      queuedProjectId = queuedSession.projectId;
      queuedFeatureId = queuedSession.featureId;
    });

    describe('successful edits', () => {
      it('should edit a queued session successfully', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Updated Title',
          });

        expect(response.status).toBe(200);
        expect(response.body.title).toBe('Updated Title');
        expect(response.body.dataVersion).toBe(2);
      });

      it('should update multiple fields at once', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'New Title',
            featureDescription: 'New description',
            technicalNotes: 'New notes',
            baseBranch: 'develop',
          });

        expect(response.status).toBe(200);
        expect(response.body.title).toBe('New Title');
        expect(response.body.featureDescription).toBe('New description');
        expect(response.body.technicalNotes).toBe('New notes');
        expect(response.body.baseBranch).toBe('develop');
      });

      it('should persist changes to storage', async () => {
        await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Persisted Title',
          });

        // Fetch session via GET to verify persistence
        const getResponse = await request(app)
          .get(`/api/sessions/${queuedProjectId}/${queuedFeatureId}`);

        expect(getResponse.status).toBe(200);
        expect(getResponse.body.title).toBe('Persisted Title');
        expect(getResponse.body.dataVersion).toBe(2);
      });

      it('should update updatedAt timestamp', async () => {
        const beforeResponse = await request(app)
          .get(`/api/sessions/${queuedProjectId}/${queuedFeatureId}`);
        const originalUpdatedAt = beforeResponse.body.updatedAt;

        // Wait a bit to ensure time difference
        await new Promise(resolve => setTimeout(resolve, 10));

        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Updated',
          });

        expect(response.status).toBe(200);
        expect(new Date(response.body.updatedAt).getTime())
          .toBeGreaterThan(new Date(originalUpdatedAt).getTime());
      });

      it('should allow editing acceptanceCriteria', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            acceptanceCriteria: [
              { text: 'New criteria 1', checked: false, type: 'manual' },
              { text: 'New criteria 2', checked: true, type: 'automated' },
            ],
          });

        expect(response.status).toBe(200);
        expect(response.body.acceptanceCriteria).toHaveLength(2);
        expect(response.body.acceptanceCriteria[0].text).toBe('New criteria 1');
      });

      it('should allow editing affectedFiles', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            affectedFiles: ['src/new.ts', 'src/other.ts'],
          });

        expect(response.status).toBe(200);
        expect(response.body.affectedFiles).toEqual(['src/new.ts', 'src/other.ts']);
      });

      it('should allow editing preferences', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            preferences: {
              riskComfort: 'high',
              speedVsQuality: 'quality',
              scopeFlexibility: 'open',
              detailLevel: 'detailed',
              autonomyLevel: 'autonomous',
            },
          });

        expect(response.status).toBe(200);
        expect(response.body.preferences.riskComfort).toBe('high');
        expect(response.body.preferences.autonomyLevel).toBe('autonomous');
      });
    });

    describe('validation errors', () => {
      it('should return 404 for non-existent session', async () => {
        const response = await request(app)
          .patch('/api/sessions/nonexistent/session/edit')
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(404);
        expect(response.body.error).toMatch(/not found/i);
      });

      it('should return 400 when dataVersion is missing', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            title: 'Test',
          });

        expect(response.status).toBe(400);
        // Zod validation error for missing dataVersion
      });

      it('should return 400 when dataVersion is not a number', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 'not-a-number',
            title: 'Test',
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 when dataVersion is negative', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: -1,
            title: 'Test',
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 when title is empty', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: '',
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 when title is too long', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'a'.repeat(201),
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 for invalid baseBranch', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            baseBranch: 'invalid branch name with spaces',
          });

        expect(response.status).toBe(400);
      });
    });

    describe('session status validation', () => {
      it('should return 400 for discovery status session', async () => {
        // The active session is in discovery status
        const activeFeatureId = 'active-session';

        const response = await request(app)
          .patch(`/api/sessions/${activeProjectId}/${activeFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('SESSION_NOT_QUEUED');
        expect(response.body.error).toMatch(/cannot edit session with status 'discovery'/i);
      });

      it('should return 400 for paused status session', async () => {
        // First backout the queued session to pause it
        // But queued sessions can't be backed out, so we need to modify the status directly
        const sessionPath = `${queuedProjectId}/${queuedFeatureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.status = 'paused';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('SESSION_NOT_QUEUED');
        expect(response.body.error).toMatch(/cannot edit session with status 'paused'/i);
      });

      it('should return 400 for failed status session', async () => {
        const sessionPath = `${queuedProjectId}/${queuedFeatureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.status = 'failed';
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('SESSION_NOT_QUEUED');
        expect(response.body.error).toMatch(/cannot edit session with status 'failed'/i);
      });

      it('should return 400 for completed status session', async () => {
        const sessionPath = `${queuedProjectId}/${queuedFeatureId}/session.json`;
        const sessionData = await storage.readJson<Record<string, unknown>>(sessionPath);
        sessionData!.status = 'completed';
        sessionData!.currentStage = 7;
        await storage.writeJson(sessionPath, sessionData);

        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Test',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('SESSION_NOT_QUEUED');
      });
    });

    describe('version conflict handling', () => {
      it('should return 409 when dataVersion does not match', async () => {
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 999, // Wrong version
            title: 'Test',
          });

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('VERSION_CONFLICT');
        expect(response.body.error).toMatch(/version conflict/i);
      });

      it('should return 409 on concurrent edits with stale version', async () => {
        // First edit succeeds
        await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'First Edit',
          });

        // Second edit with stale version fails
        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1, // Stale version
            title: 'Second Edit',
          });

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('VERSION_CONFLICT');
      });

      it('should succeed with correct version after previous edit', async () => {
        // First edit
        const firstResponse = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'First Edit',
          });

        expect(firstResponse.status).toBe(200);
        expect(firstResponse.body.dataVersion).toBe(2);

        // Second edit with updated version
        const secondResponse = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 2, // Updated version
            title: 'Second Edit',
          });

        expect(secondResponse.status).toBe(200);
        expect(secondResponse.body.title).toBe('Second Edit');
        expect(secondResponse.body.dataVersion).toBe(3);
      });
    });

    describe('field preservation', () => {
      it('should not change featureId when title changes', async () => {
        const originalFeatureId = queuedFeatureId;

        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'Completely Different Title',
          });

        expect(response.status).toBe(200);
        expect(response.body.featureId).toBe(originalFeatureId);
        expect(response.body.title).toBe('Completely Different Title');
      });

      it('should preserve protected fields', async () => {
        const getResponse = await request(app)
          .get(`/api/sessions/${queuedProjectId}/${queuedFeatureId}`);
        const originalSession = getResponse.body;

        const response = await request(app)
          .patch(`/api/sessions/${queuedProjectId}/${queuedFeatureId}/edit`)
          .send({
            dataVersion: 1,
            title: 'New Title',
          });

        expect(response.status).toBe(200);
        expect(response.body.id).toBe(originalSession.id);
        expect(response.body.projectId).toBe(originalSession.projectId);
        expect(response.body.featureId).toBe(originalSession.featureId);
        expect(response.body.createdAt).toBe(originalSession.createdAt);
        expect(response.body.status).toBe('queued');
        expect(response.body.queuePosition).toBe(originalSession.queuePosition);
      });
    });
  });
});

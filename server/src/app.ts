import express, { Express, Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { FileStorageService } from './data/FileStorageService';
import { SessionManager } from './services/SessionManager';
import {
  CreateSessionInputSchema,
  UpdateSessionInputSchema,
  StageTransitionInputSchema,
  AnswerQuestionInputSchema,
  RequestChangesInputSchema,
} from './validation/schemas';
import * as packageJson from '../package.json';

const startTime = Date.now();

// Validation middleware factory
function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        res.status(400).json({ error: `Validation failed: ${messages}` });
        return;
      }
      next(error);
    }
  };
}

export function createApp(storage: FileStorageService, sessionManager: SessionManager): Express {
  const app = express();

  // Middleware
  app.use(express.json());

  // Health check endpoint (README lines 651-667)
  app.get('/health', async (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    // Check storage is accessible
    let storageHealthy = true;
    try {
      await storage.ensureDir('.');
    } catch {
      storageHealthy = false;
    }

    res.json({
      status: storageHealthy ? 'healthy' : 'degraded',
      version: packageJson.version,
      uptime,
      checks: {
        storage: storageHealthy,
      },
    });
  });

  // API Routes

  // Create session (with Zod validation)
  app.post('/api/sessions', validate(CreateSessionInputSchema), async (req, res) => {
    try {
      const session = await sessionManager.createSession(req.body);
      res.status(201).json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      res.status(400).json({ error: message });
    }
  });

  // Get session
  app.get('/api/sessions/:projectId/:featureId', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const session = await sessionManager.getSession(projectId, featureId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get session';
      res.status(500).json({ error: message });
    }
  });

  // Update session (with Zod validation)
  app.patch('/api/sessions/:projectId/:featureId', validate(UpdateSessionInputSchema), async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const session = await sessionManager.updateSession(projectId, featureId, req.body);
      res.json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update session';
      res.status(400).json({ error: message });
    }
  });

  // List sessions for project
  app.get('/api/sessions/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params;
      const sessions = await sessionManager.listSessions(projectId);
      res.json(sessions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list sessions';
      res.status(500).json({ error: message });
    }
  });

  // Transition stage (with Zod validation)
  app.post('/api/sessions/:projectId/:featureId/transition', validate(StageTransitionInputSchema), async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const { targetStage } = req.body;
      const session = await sessionManager.transitionStage(projectId, featureId, targetStage);
      res.json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to transition stage';
      res.status(400).json({ error: message });
    }
  });

  // Get plan
  app.get('/api/sessions/:projectId/:featureId/plan', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const plan = await storage.readJson(`${projectId}/${featureId}/plan.json`);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      res.json(plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get plan';
      res.status(500).json({ error: message });
    }
  });

  // Get questions
  app.get('/api/sessions/:projectId/:featureId/questions', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const questions = await storage.readJson(`${projectId}/${featureId}/questions.json`);
      res.json(questions || { questions: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get questions';
      res.status(500).json({ error: message });
    }
  });

  // Answer question (README lines 814-834, with Zod validation)
  app.post('/api/sessions/:projectId/:featureId/questions/:questionId/answer', validate(AnswerQuestionInputSchema), async (req, res) => {
    try {
      const { projectId, featureId, questionId } = req.params;
      const answer = req.body;

      // Check session exists
      const session = await sessionManager.getSession(projectId, featureId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Read questions
      const questionsPath = `${projectId}/${featureId}/questions.json`;
      const questionsData = await storage.readJson<{
        version: string;
        sessionId: string;
        questions: Array<{
          id: string;
          answer: Record<string, unknown> | null;
          answeredAt: string | null;
          [key: string]: unknown;
        }>;
      }>(questionsPath);

      if (!questionsData) {
        return res.status(404).json({ error: 'Questions not found' });
      }

      // Find the question
      const questionIndex = questionsData.questions.findIndex((q) => q.id === questionId);
      if (questionIndex === -1) {
        return res.status(404).json({ error: 'Question not found' });
      }

      // Update the answer
      const answeredAt = new Date().toISOString();
      questionsData.questions[questionIndex].answer = answer;
      questionsData.questions[questionIndex].answeredAt = answeredAt;

      // Save
      await storage.writeJson(questionsPath, questionsData);

      res.json({
        ...questionsData.questions[questionIndex],
        answer,
        answeredAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to answer question';
      res.status(500).json({ error: message });
    }
  });

  // Approve plan
  app.post('/api/sessions/:projectId/:featureId/plan/approve', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const planPath = `${projectId}/${featureId}/plan.json`;
      const plan = await storage.readJson<{ isApproved: boolean }>(planPath);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      plan.isApproved = true;
      await storage.writeJson(planPath, plan);
      res.json(plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve plan';
      res.status(500).json({ error: message });
    }
  });

  // Request plan changes (with Zod validation)
  app.post('/api/sessions/:projectId/:featureId/plan/request-changes', validate(RequestChangesInputSchema), async (req, res) => {
    try {
      const { feedback } = req.body;
      res.json({ success: true, feedback });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request changes';
      res.status(500).json({ error: message });
    }
  });

  return app;
}

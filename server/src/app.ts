import express, { Express, Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { FileStorageService } from './data/FileStorageService';
import { SessionManager } from './services/SessionManager';
import { ClaudeOrchestrator } from './services/ClaudeOrchestrator';
import { OutputParser } from './services/OutputParser';
import { ClaudeResultHandler } from './services/ClaudeResultHandler';
import { EventBroadcaster } from './services/EventBroadcaster';
import { buildStage1Prompt, buildStage2Prompt } from './prompts/stagePrompts';
import { Plan, Question } from '@claude-code-web/shared';
import {
  CreateSessionInputSchema,
  UpdateSessionInputSchema,
  StageTransitionInputSchema,
  AnswerQuestionInputSchema,
  RequestChangesInputSchema,
} from './validation/schemas';
import * as packageJson from '../package.json';

const startTime = Date.now();

// Initialize orchestrator
const outputParser = new OutputParser();
const orchestrator = new ClaudeOrchestrator(outputParser);

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

export function createApp(
  storage: FileStorageService,
  sessionManager: SessionManager,
  eventBroadcaster?: EventBroadcaster
): Express {
  const app = express();
  const resultHandler = new ClaudeResultHandler(storage, sessionManager);

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

  // Create session (with Zod validation) - automatically starts Stage 1
  app.post('/api/sessions', validate(CreateSessionInputSchema), async (req, res) => {
    try {
      const session = await sessionManager.createSession(req.body);

      // Return response immediately, then start Claude in background
      res.status(201).json(session);

      // Start Stage 1 Discovery asynchronously
      const prompt = buildStage1Prompt(session);
      const statusPath = `${session.projectId}/${session.featureId}/status.json`;

      // Update status to running
      const status = await storage.readJson<Record<string, unknown>>(statusPath);
      if (status) {
        status.status = 'running';
        status.lastAction = 'stage1_started';
        status.lastActionAt = new Date().toISOString();
        await storage.writeJson(statusPath, status);
      }

      // Broadcast execution started
      eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage1_started');

      // Spawn Claude (fire and forget, errors logged)
      orchestrator.spawn({
        prompt,
        projectPath: session.projectPath,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
      }).then(async (result) => {
        // Use ClaudeResultHandler to save all parsed data
        await resultHandler.handleStage1Result(session, result, prompt);

        // Broadcast events for parsed data
        if (eventBroadcaster) {
          // Broadcast questions if any were asked
          if (result.parsed.decisions.length > 0) {
            const questionsPath = `${session.projectId}/${session.featureId}/questions.json`;
            const questionsData = await storage.readJson<{ questions: Question[] }>(questionsPath);
            if (questionsData) {
              // Get the newly added questions (last N where N = decisions length)
              const newQuestions = questionsData.questions.slice(-result.parsed.decisions.length);
              eventBroadcaster.questionsAsked(session.projectId, session.featureId, newQuestions);
            }
          }

          // Broadcast plan update if plan steps were generated
          if (result.parsed.planSteps.length > 0) {
            const planPath = `${session.projectId}/${session.featureId}/plan.json`;
            const plan = await storage.readJson<Plan>(planPath);
            if (plan) {
              eventBroadcaster.planUpdated(session.projectId, session.featureId, plan);
            }
          }

          // Broadcast execution complete
          eventBroadcaster.executionStatus(
            session.projectId,
            session.featureId,
            result.isError ? 'error' : 'idle',
            result.isError ? 'stage1_error' : 'stage1_complete'
          );
        }

        console.log(`Stage 1 ${result.isError ? 'failed' : 'completed'} for ${session.featureId}`);
      }).catch((error) => {
        console.error(`Stage 1 spawn error for ${session.featureId}:`, error);
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage1_spawn_error');
      });

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

      // Return response immediately
      res.json(session);

      // If transitioning to Stage 2, spawn Claude for plan review
      if (targetStage === 2) {
        const sessionDir = `${projectId}/${featureId}`;
        const statusPath = `${sessionDir}/status.json`;

        // Read current plan
        const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
        if (!plan) {
          console.error(`No plan found for Stage 2 transition: ${featureId}`);
          return;
        }

        // Get review iteration count (starts at 1)
        const currentIteration = (plan.reviewCount || 0) + 1;

        // Build Stage 2 prompt
        const prompt = buildStage2Prompt(session, plan, currentIteration);

        // Update status to running
        const status = await storage.readJson<Record<string, unknown>>(statusPath);
        if (status) {
          status.status = 'running';
          status.lastAction = 'stage2_started';
          status.lastActionAt = new Date().toISOString();
          await storage.writeJson(statusPath, status);
        }

        // Broadcast execution started
        eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'stage2_started');

        // Spawn Claude with --resume if we have a session ID
        orchestrator.spawn({
          prompt,
          projectPath: session.projectPath,
          sessionId: session.claudeSessionId || undefined, // Use --resume if available
          allowedTools: orchestrator.getStageTools(2),
        }).then(async (result) => {
          await resultHandler.handleStage2Result(session, result, prompt);

          // Broadcast events for parsed data
          if (eventBroadcaster) {
            // Broadcast questions (review findings) if any were asked
            if (result.parsed.decisions.length > 0) {
              const questionsPath = `${sessionDir}/questions.json`;
              const questionsData = await storage.readJson<{ questions: Question[] }>(questionsPath);
              if (questionsData) {
                const newQuestions = questionsData.questions.slice(-result.parsed.decisions.length);
                eventBroadcaster.questionsAsked(projectId, featureId, newQuestions);
              }
            }

            // Check if plan was approved
            if (result.parsed.planApproved) {
              const updatedPlan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
              if (updatedPlan) {
                eventBroadcaster.planApproved(projectId, featureId, updatedPlan);
              }
            }

            // Broadcast execution complete
            eventBroadcaster.executionStatus(
              projectId,
              featureId,
              result.isError ? 'error' : 'idle',
              result.isError ? 'stage2_error' : 'stage2_complete'
            );
          }

          console.log(`Stage 2 review ${currentIteration} ${result.isError ? 'failed' : 'completed'} for ${featureId}`);
        }).catch((error) => {
          console.error(`Stage 2 spawn error for ${featureId}:`, error);
          eventBroadcaster?.executionStatus(projectId, featureId, 'error', 'stage2_spawn_error');
        });
      }
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

      // Broadcast question answered event
      eventBroadcaster?.questionAnswered(projectId, featureId, questionsData.questions[questionIndex] as Question);

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

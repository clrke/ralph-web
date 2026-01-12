import express, { Express, Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { FileStorageService } from './data/FileStorageService';
import { SessionManager } from './services/SessionManager';
import { ClaudeOrchestrator } from './services/ClaudeOrchestrator';
import { OutputParser } from './services/OutputParser';
import { ClaudeResultHandler } from './services/ClaudeResultHandler';
import { DecisionValidator } from './services/DecisionValidator';
import { EventBroadcaster } from './services/EventBroadcaster';
import { buildStage1Prompt, buildStage2Prompt, buildPlanRevisionPrompt, buildBatchAnswersContinuationPrompt } from './prompts/stagePrompts';
import { Session } from '@claude-code-web/shared';
import { ClaudeResult } from './services/ClaudeOrchestrator';
import { Plan, Question } from '@claude-code-web/shared';
import {
  CreateSessionInputSchema,
  UpdateSessionInputSchema,
  StageTransitionInputSchema,
  AnswerQuestionInputSchema,
  BatchAnswersInputSchema,
  RequestChangesInputSchema,
} from './validation/schemas';
import * as packageJson from '../package.json';

const startTime = Date.now();

// Initialize orchestrator
const outputParser = new OutputParser();
const orchestrator = new ClaudeOrchestrator(outputParser);

/**
 * Apply Haiku post-processing to extract questions when Claude's output
 * contains unformatted questions. Mutates result.parsed if questions are found.
 */
async function applyHaikuPostProcessing(
  result: ClaudeResult,
  projectPath: string,
  storage: FileStorageService,
  session: Session,
  resultHandler: ClaudeResultHandler
): Promise<number> {
  // Skip if already have decisions or if there's an error
  if (result.parsed.decisions.length > 0 || result.isError) {
    return 0;
  }

  // Try Haiku post-processing
  const extractedParsed = await orchestrator.postProcessWithHaiku(result.output, projectPath);
  if (extractedParsed && extractedParsed.decisions.length > 0) {
    // Merge extracted decisions into result
    result.parsed.decisions = extractedParsed.decisions;

    // Save the extracted questions (with validation)
    const sessionDir = `${session.projectId}/${session.featureId}`;
    const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
    await resultHandler['saveQuestions'](sessionDir, session, extractedParsed.decisions, plan);

    console.log(`Haiku fallback extracted ${extractedParsed.decisions.length} questions for ${session.featureId}`);
    return extractedParsed.decisions.length;
  }

  return 0;
}

/**
 * Spawn Stage 2 review Claude. Used by:
 * - Auto-transition from Stage 1 when plan file is created
 * - Manual /transition endpoint (kept for edge cases)
 * - Resume after batch answers
 */
async function spawnStage2Review(
  session: Session,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined,
  prompt: string
): Promise<void> {
  const sessionDir = `${session.projectId}/${session.featureId}`;
  const statusPath = `${sessionDir}/status.json`;

  // Update status to running
  const status = await storage.readJson<Record<string, unknown>>(statusPath);
  if (status) {
    status.status = 'running';
    status.lastAction = 'stage2_started';
    status.lastActionAt = new Date().toISOString();
    await storage.writeJson(statusPath, status);
  }

  // Broadcast execution started
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage2_started');

  // Spawn Claude with --resume if we have a session ID
  orchestrator.spawn({
    prompt,
    projectPath: session.projectPath,
    sessionId: session.claudeSessionId || undefined,
    allowedTools: orchestrator.getStageTools(2),
    onOutput: (output, isComplete) => {
      eventBroadcaster?.claudeOutput(session.projectId, session.featureId, output, isComplete);
    },
  }).then(async (result) => {
    await resultHandler.handleStage2Result(session, result, prompt);

    // Apply Haiku fallback if no decisions were parsed but output looks like questions
    const extractedCount = await applyHaikuPostProcessing(result, session.projectPath, storage, session, resultHandler);

    // Increment review count after Stage 2 completes
    await resultHandler.incrementReviewCount(sessionDir);

    // Broadcast events for parsed data
    if (eventBroadcaster) {
      // Broadcast questions (review findings) if any were asked (including Haiku-extracted)
      if (result.parsed.decisions.length > 0) {
        const questionsPath = `${sessionDir}/questions.json`;
        const questionsData = await storage.readJson<{ questions: Question[] }>(questionsPath);
        if (questionsData) {
          const newQuestions = questionsData.questions.slice(-result.parsed.decisions.length);
          eventBroadcaster.questionsAsked(session.projectId, session.featureId, newQuestions);
        }
      }

      // Broadcast plan update (includes new reviewCount)
      const updatedPlan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
      if (updatedPlan) {
        eventBroadcaster.planUpdated(session.projectId, session.featureId, updatedPlan);
      }

      // Broadcast execution complete
      eventBroadcaster.executionStatus(
        session.projectId,
        session.featureId,
        result.isError ? 'error' : 'idle',
        result.isError ? 'stage2_error' : 'stage2_complete'
      );
    }

    // Check for auto Stage 2→3 transition
    await handleStage2Completion(session, result, sessionDir, storage, sessionManager, eventBroadcaster);

    console.log(`Stage 2 review ${result.isError ? 'failed' : 'completed'} for ${session.featureId}${extractedCount > 0 ? ` (${extractedCount} questions via Haiku)` : ''}`);
  }).catch((error) => {
    console.error(`Stage 2 spawn error for ${session.featureId}:`, error);
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage2_spawn_error');
  });
}

/**
 * Handle Stage 2 completion - auto-transition to Stage 3 when [PLAN_APPROVED]
 */
async function handleStage2Completion(
  session: Session,
  result: ClaudeResult,
  sessionDir: string,
  storage: FileStorageService,
  sessionManager: SessionManager,
  eventBroadcaster: EventBroadcaster | undefined
): Promise<void> {
  if (!result.parsed.planApproved) return;

  console.log(`Plan approved, auto-transitioning to Stage 3 for ${session.featureId}`);

  // Mark plan as approved
  const planPath = `${sessionDir}/plan.json`;
  const plan = await storage.readJson<Plan>(planPath);
  if (plan) {
    plan.isApproved = true;
    await storage.writeJson(planPath, plan);
    eventBroadcaster?.planApproved(session.projectId, session.featureId, plan);
  }

  // Transition to Stage 3
  const previousStage = session.currentStage;
  const updatedSession = await sessionManager.transitionStage(session.projectId, session.featureId, 3);
  eventBroadcaster?.stageChanged(updatedSession, previousStage);
}

/**
 * Handle Stage 1 completion - auto-transition to Stage 2 when plan file is created
 */
async function handleStage1Completion(
  session: Session,
  result: ClaudeResult,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined
): Promise<void> {
  if (!result.parsed.planFilePath) return;

  console.log(`Plan file created at ${result.parsed.planFilePath}, auto-transitioning to Stage 2`);

  // Transition to Stage 2
  const previousStage = session.currentStage;
  const updatedSession = await sessionManager.transitionStage(session.projectId, session.featureId, 2);
  eventBroadcaster?.stageChanged(updatedSession, previousStage);

  // Read current plan for Stage 2 prompt
  const sessionDir = `${session.projectId}/${session.featureId}`;
  const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
  if (!plan) {
    console.error(`No plan found after Stage 1 for ${session.featureId}`);
    return;
  }

  // Build Stage 2 prompt and spawn review
  const currentIteration = (plan.reviewCount || 0) + 1;
  const prompt = buildStage2Prompt(updatedSession, plan, currentIteration);
  await spawnStage2Review(updatedSession, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
}

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

  // Create decision validator for filtering false positives (README line 1461)
  const decisionValidator = new DecisionValidator();
  const resultHandler = new ClaudeResultHandler(storage, sessionManager, decisionValidator);

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

  // List all sessions across all projects
  app.get('/api/sessions', async (_req, res) => {
    try {
      const sessions = await sessionManager.listAllSessions();
      res.json(sessions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list sessions';
      res.status(500).json({ error: message });
    }
  });

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
        onOutput: (output, isComplete) => {
          eventBroadcaster?.claudeOutput(session.projectId, session.featureId, output, isComplete);
        },
      }).then(async (result) => {
        // Use ClaudeResultHandler to save all parsed data
        await resultHandler.handleStage1Result(session, result, prompt);

        // Apply Haiku fallback if no decisions were parsed but output looks like questions
        const extractedCount = await applyHaikuPostProcessing(result, session.projectPath, storage, session, resultHandler);

        // Broadcast events for parsed data
        if (eventBroadcaster) {
          // Broadcast questions if any were asked (including Haiku-extracted ones)
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

        // Check for auto Stage 1→2 transition when plan file is created
        if (!result.isError) {
          await handleStage1Completion(session, result, storage, sessionManager, resultHandler, eventBroadcaster);
        }

        console.log(`Stage 1 ${result.isError ? 'failed' : 'completed'} for ${session.featureId}${extractedCount > 0 ? ` (${extractedCount} questions via Haiku)` : ''}`);
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

      // Get current session to capture previous stage
      const currentSession = await sessionManager.getSession(projectId, featureId);
      const previousStage = currentSession?.currentStage || 0;

      const session = await sessionManager.transitionStage(projectId, featureId, targetStage);

      // Broadcast stage change event
      if (eventBroadcaster && currentSession) {
        eventBroadcaster.stageChanged(session, previousStage);
      }

      // Return response immediately
      res.json(session);

      // If transitioning to Stage 2, spawn Claude for plan review
      if (targetStage === 2) {
        const sessionDir = `${projectId}/${featureId}`;

        // Read current plan
        const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
        if (!plan) {
          console.error(`No plan found for Stage 2 transition: ${featureId}`);
          return;
        }

        // Build Stage 2 prompt and spawn review using helper function
        const currentIteration = (plan.reviewCount || 0) + 1;
        const prompt = buildStage2Prompt(session, plan, currentIteration);
        await spawnStage2Review(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
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
        questions: Question[];
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
      eventBroadcaster?.questionAnswered(projectId, featureId, questionsData.questions[questionIndex]);

      // Return response immediately
      res.json({
        ...questionsData.questions[questionIndex],
        answer,
        answeredAt,
      });

      // After response is sent, check batch completion and resume Claude
      // This is fire-and-forget - errors are logged, not sent to client
      (async () => {
        try {
          // Check if all questions in this batch are answered (same askedAt timestamp)
          const batchTimestamp = questionsData.questions[questionIndex].askedAt as string;
          const batchQuestions = questionsData.questions.filter(q => q.askedAt === batchTimestamp);
          const allBatchAnswered = batchQuestions.every(q => q.answeredAt !== null);

          if (allBatchAnswered && batchQuestions.length > 0) {
            console.log(`All ${batchQuestions.length} questions in batch answered, resuming Claude`);

            // Build continuation prompt with all batch answers
            const prompt = buildBatchAnswersContinuationPrompt(batchQuestions, session.currentStage);
            const sessionDir = `${projectId}/${featureId}`;
            const statusPath = `${sessionDir}/status.json`;

            // Update status to running
            const status = await storage.readJson<Record<string, unknown>>(statusPath);
            if (status) {
              status.status = 'running';
              status.lastAction = 'batch_answers_resume';
              status.lastActionAt = new Date().toISOString();
              await storage.writeJson(statusPath, status);
            }

            // Broadcast execution started
            eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'batch_answers_resume');

            // Resume Claude with the batch answers
            const result = await orchestrator.spawn({
              prompt,
              projectPath: session.projectPath,
              sessionId: session.claudeSessionId || undefined,
              allowedTools: orchestrator.getStageTools(session.currentStage),
              onOutput: (output, isComplete) => {
                eventBroadcaster?.claudeOutput(projectId, featureId, output, isComplete);
              },
            });

            // Handle based on current stage
            if (session.currentStage === 1) {
              await resultHandler.handleStage1Result(session, result, prompt);
              // Check for Stage 1→2 auto-transition
              if (!result.isError) {
                await handleStage1Completion(session, result, storage, sessionManager, resultHandler, eventBroadcaster);
              }
            } else if (session.currentStage === 2) {
              await resultHandler.handleStage2Result(session, result, prompt);
              await resultHandler.incrementReviewCount(sessionDir);
              // Check for Stage 2→3 auto-transition
              await handleStage2Completion(session, result, sessionDir, storage, sessionManager, eventBroadcaster);
            }

            // Apply Haiku fallback if no decisions were parsed but output looks like questions
            const extractedCount = await applyHaikuPostProcessing(result, session.projectPath, storage, session, resultHandler);

            // Broadcast events
            if (eventBroadcaster) {
              if (result.parsed.decisions.length > 0) {
                const questionsPath2 = `${sessionDir}/questions.json`;
                const questionsData2 = await storage.readJson<{ questions: Question[] }>(questionsPath2);
                if (questionsData2) {
                  const newQuestions = questionsData2.questions.slice(-result.parsed.decisions.length);
                  eventBroadcaster.questionsAsked(projectId, featureId, newQuestions);
                }
              }

              if (result.parsed.planSteps.length > 0 || session.currentStage === 2) {
                const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
                if (plan) {
                  eventBroadcaster.planUpdated(projectId, featureId, plan);
                }
              }

              eventBroadcaster.executionStatus(
                projectId,
                featureId,
                result.isError ? 'error' : 'idle',
                result.isError ? 'batch_resume_error' : 'batch_resume_complete'
              );
            }

            console.log(`Batch resume ${result.isError ? 'failed' : 'completed'} for ${featureId}${extractedCount > 0 ? ` (${extractedCount} questions via Haiku)` : ''}`);
          }
        } catch (error) {
          console.error(`Batch resume error for ${featureId}:`, error);
          eventBroadcaster?.executionStatus(projectId, featureId, 'error', 'batch_resume_error');
        }
      })();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to answer question';
      res.status(500).json({ error: message });
    }
  });

  // Batch answer all unanswered questions (requires answering ALL unanswered questions)
  app.post('/api/sessions/:projectId/:featureId/questions/answers', validate(BatchAnswersInputSchema), async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const answers = req.body as Array<{ questionId: string; answer: { value?: string; text?: string; values?: string[] } }>;

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
        questions: Question[];
      }>(questionsPath);

      if (!questionsData) {
        return res.status(404).json({ error: 'Questions not found' });
      }

      // Find all unanswered questions
      const unansweredQuestions = questionsData.questions.filter(q => q.answeredAt === null);
      if (unansweredQuestions.length === 0) {
        return res.status(400).json({ error: 'No unanswered questions' });
      }

      // Validate that ALL unanswered questions are being answered
      const answeredIds = new Set(answers.map(a => a.questionId));
      const unansweredIds = unansweredQuestions.map(q => q.id);
      const missingAnswers = unansweredIds.filter(id => !answeredIds.has(id));

      if (missingAnswers.length > 0) {
        return res.status(400).json({
          error: 'All unanswered questions must be answered',
          missingQuestionIds: missingAnswers,
          requiredCount: unansweredIds.length,
          providedCount: answers.length,
        });
      }

      // Validate that all provided question IDs exist and are unanswered
      const unansweredIdSet = new Set(unansweredIds);
      const invalidIds = answers.filter(a => !unansweredIdSet.has(a.questionId)).map(a => a.questionId);
      if (invalidIds.length > 0) {
        return res.status(400).json({
          error: 'Some question IDs are invalid or already answered',
          invalidQuestionIds: invalidIds,
        });
      }

      // Apply all answers
      const now = new Date().toISOString();
      const answeredQuestions: Question[] = [];

      for (const { questionId, answer } of answers) {
        const questionIndex = questionsData.questions.findIndex(q => q.id === questionId);
        if (questionIndex !== -1) {
          // Normalize answer to QuestionAnswer format { value: string | string[] }
          const normalizedAnswer = {
            value: (answer as { value?: string; text?: string; values?: string[] }).value
              ?? (answer as { text?: string }).text
              ?? (answer as { values?: string[] }).values
              ?? '',
          };
          questionsData.questions[questionIndex].answer = normalizedAnswer;
          questionsData.questions[questionIndex].answeredAt = now;
          answeredQuestions.push(questionsData.questions[questionIndex]);
        }
      }

      // Save all answers
      await storage.writeJson(questionsPath, questionsData);

      // Broadcast question answered events
      for (const question of answeredQuestions) {
        eventBroadcaster?.questionAnswered(projectId, featureId, question);
      }

      // Return success immediately
      res.json({
        answered: answeredQuestions.length,
        questions: answeredQuestions.map(q => ({ id: q.id, answeredAt: q.answeredAt })),
      });

      // Fire-and-forget: Resume Claude with all batch answers
      (async () => {
        try {
          console.log(`All ${answeredQuestions.length} questions answered via batch, resuming Claude`);

          const prompt = buildBatchAnswersContinuationPrompt(answeredQuestions, session.currentStage);
          const sessionDir = `${projectId}/${featureId}`;
          const statusPath = `${sessionDir}/status.json`;

          // Update status to running
          const status = await storage.readJson<Record<string, unknown>>(statusPath);
          if (status) {
            status.status = 'running';
            status.lastAction = 'batch_answers_resume';
            status.lastActionAt = new Date().toISOString();
            await storage.writeJson(statusPath, status);
          }

          // Broadcast execution started
          eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'batch_answers_resume');

          // Resume Claude with the batch answers
          const result = await orchestrator.spawn({
            prompt,
            projectPath: session.projectPath,
            sessionId: session.claudeSessionId || undefined,
            allowedTools: orchestrator.getStageTools(session.currentStage),
            onOutput: (output, isComplete) => {
              eventBroadcaster?.claudeOutput(projectId, featureId, output, isComplete);
            },
          });

          // Handle based on current stage
          if (session.currentStage === 1) {
            await resultHandler.handleStage1Result(session, result, prompt);
            if (!result.isError) {
              await handleStage1Completion(session, result, storage, sessionManager, resultHandler, eventBroadcaster);
            }
          } else if (session.currentStage === 2) {
            await resultHandler.handleStage2Result(session, result, prompt);
            await resultHandler.incrementReviewCount(sessionDir);
            await handleStage2Completion(session, result, sessionDir, storage, sessionManager, eventBroadcaster);
          }

          // Apply Haiku fallback if no decisions were parsed but output looks like questions
          const extractedCount = await applyHaikuPostProcessing(result, session.projectPath, storage, session, resultHandler);

          // Broadcast events
          if (eventBroadcaster) {
            if (result.parsed.decisions.length > 0) {
              const questionsPath2 = `${sessionDir}/questions.json`;
              const questionsData2 = await storage.readJson<{ questions: Question[] }>(questionsPath2);
              if (questionsData2) {
                const newQuestions = questionsData2.questions.slice(-result.parsed.decisions.length);
                eventBroadcaster.questionsAsked(projectId, featureId, newQuestions);
              }
            }

            if (result.parsed.planSteps.length > 0 || session.currentStage === 2) {
              const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
              if (plan) {
                eventBroadcaster.planUpdated(projectId, featureId, plan);
              }
            }

            eventBroadcaster.executionStatus(
              projectId,
              featureId,
              result.isError ? 'error' : 'idle',
              result.isError ? 'batch_resume_error' : 'batch_resume_complete'
            );
          }

          console.log(`Batch resume ${result.isError ? 'failed' : 'completed'} for ${featureId}${extractedCount > 0 ? ` (${extractedCount} questions via Haiku)` : ''}`);
        } catch (error) {
          console.error(`Batch resume error for ${featureId}:`, error);
          eventBroadcaster?.executionStatus(projectId, featureId, 'error', 'batch_resume_error');
        }
      })();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to answer questions';
      res.status(500).json({ error: message });
    }
  });

  // Approve plan
  app.post('/api/sessions/:projectId/:featureId/plan/approve', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;

      // Get session
      const session = await sessionManager.getSession(projectId, featureId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Update plan
      const planPath = `${projectId}/${featureId}/plan.json`;
      const plan = await storage.readJson<Plan>(planPath);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      plan.isApproved = true;
      await storage.writeJson(planPath, plan);

      // Transition to Stage 3 (Implementation)
      const previousStage = session.currentStage;
      const updatedSession = await sessionManager.transitionStage(projectId, featureId, 3);

      // Broadcast events
      if (eventBroadcaster) {
        eventBroadcaster.planApproved(projectId, featureId, plan);
        eventBroadcaster.stageChanged(updatedSession, previousStage);
      }

      res.json({ plan, session: updatedSession });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve plan';
      res.status(500).json({ error: message });
    }
  });

  // Request plan changes (with Zod validation)
  app.post('/api/sessions/:projectId/:featureId/plan/request-changes', validate(RequestChangesInputSchema), async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const { feedback } = req.body;

      // Get session and plan
      const session = await sessionManager.getSession(projectId, featureId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const sessionDir = `${projectId}/${featureId}`;
      const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      // Return response immediately
      res.json({ success: true, feedback });

      // Build revision prompt
      const prompt = buildPlanRevisionPrompt(session, plan, feedback);
      const statusPath = `${sessionDir}/status.json`;

      // Update status to running
      const status = await storage.readJson<Record<string, unknown>>(statusPath);
      if (status) {
        status.status = 'running';
        status.lastAction = 'plan_revision_started';
        status.lastActionAt = new Date().toISOString();
        await storage.writeJson(statusPath, status);
      }

      // Broadcast execution started
      eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'plan_revision_started');

      // Spawn Claude to revise the plan
      orchestrator.spawn({
        prompt,
        projectPath: session.projectPath,
        sessionId: session.claudeSessionId || undefined,
        allowedTools: orchestrator.getStageTools(2),
        onOutput: (output, isComplete) => {
          eventBroadcaster?.claudeOutput(projectId, featureId, output, isComplete);
        },
      }).then(async (result) => {
        await resultHandler.handleStage2Result(session, result, prompt);

        // Increment review count
        await resultHandler.incrementReviewCount(sessionDir);

        // Broadcast events
        if (eventBroadcaster) {
          // Broadcast questions if any
          if (result.parsed.decisions.length > 0) {
            const questionsPath = `${sessionDir}/questions.json`;
            const questionsData = await storage.readJson<{ questions: Question[] }>(questionsPath);
            if (questionsData) {
              const newQuestions = questionsData.questions.slice(-result.parsed.decisions.length);
              eventBroadcaster.questionsAsked(projectId, featureId, newQuestions);
            }
          }

          // Broadcast plan update
          const updatedPlan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
          if (updatedPlan) {
            eventBroadcaster.planUpdated(projectId, featureId, updatedPlan);
          }

          // Broadcast execution complete
          eventBroadcaster.executionStatus(
            projectId,
            featureId,
            result.isError ? 'error' : 'idle',
            result.isError ? 'plan_revision_error' : 'plan_revision_complete'
          );
        }

        // Check for auto Stage 2→3 transition if plan was approved after revision
        await handleStage2Completion(session, result, sessionDir, storage, sessionManager, eventBroadcaster);

        console.log(`Plan revision ${result.isError ? 'failed' : 'completed'} for ${featureId}`);
      }).catch((error) => {
        console.error(`Plan revision spawn error for ${featureId}:`, error);
        eventBroadcaster?.executionStatus(projectId, featureId, 'error', 'plan_revision_spawn_error');
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request changes';
      res.status(500).json({ error: message });
    }
  });

  // Get conversations (full Claude interaction history)
  app.get('/api/sessions/:projectId/:featureId/conversations', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const conversations = await storage.readJson(`${projectId}/${featureId}/conversations.json`);
      res.json(conversations || { entries: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get conversations';
      res.status(500).json({ error: message });
    }
  });

  return app;
}

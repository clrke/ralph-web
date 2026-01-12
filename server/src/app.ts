import express, { Express, Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { FileStorageService } from './data/FileStorageService';
import { SessionManager } from './services/SessionManager';
import { ClaudeOrchestrator } from './services/ClaudeOrchestrator';
import { OutputParser } from './services/OutputParser';
import { ClaudeResultHandler } from './services/ClaudeResultHandler';
import { DecisionValidator } from './services/DecisionValidator';
import { TestRequirementAssessor } from './services/TestRequirementAssessor';
import { IncompleteStepsAssessor } from './services/IncompleteStepsAssessor';
import { EventBroadcaster } from './services/EventBroadcaster';
import { buildStage1Prompt, buildStage2Prompt, buildStage3Prompt, buildStage4Prompt, buildStage5Prompt, buildPlanRevisionPrompt, buildBatchAnswersContinuationPrompt } from './prompts/stagePrompts';
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
  const haikuResult = await orchestrator.postProcessWithHaiku(result.output, projectPath);
  if (haikuResult && haikuResult.parsed.decisions.length > 0) {
    // Merge extracted decisions into result
    result.parsed.decisions = haikuResult.parsed.decisions;

    // Save the extracted questions (with validation)
    const sessionDir = `${session.projectId}/${session.featureId}`;
    const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
    await resultHandler['saveQuestions'](sessionDir, session, haikuResult.parsed.decisions, plan);

    // Save post-processing conversation
    await resultHandler.savePostProcessingConversation(
      sessionDir,
      session.currentStage,
      'question_extraction',
      haikuResult.prompt,
      haikuResult.output,
      haikuResult.durationMs,
      false
    );

    console.log(`Haiku fallback extracted ${haikuResult.parsed.decisions.length} questions for ${session.featureId}`);
    return haikuResult.parsed.decisions.length;
  }

  return 0;
}

/**
 * Verify PR creation using gh pr list command.
 * More reliable than parsing Claude's output markers.
 * Returns PR info if found, null if not.
 */
async function verifyPRCreation(
  projectPath: string,
  _projectId: string,
  _featureId: string
): Promise<{ title: string; branch: string; url: string; number: number; createdAt: string } | null> {
  const { execSync } = await import('child_process');

  try {
    // Get current branch name
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    // Query GitHub for PRs from this branch
    // gh pr list --head <branch> --json number,url,title
    const result = execSync(`gh pr list --head "${branch}" --json number,url,title --limit 1`, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30000,
    });

    const prs = JSON.parse(result);
    if (prs.length === 0) {
      // No PR found, try querying by state=open
      const openResult = execSync('gh pr list --state open --json number,url,title,headRefName --limit 10', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const openPrs = JSON.parse(openResult);
      const matchingPr = openPrs.find((pr: { headRefName: string }) => pr.headRefName === branch);
      if (matchingPr) {
        return {
          title: matchingPr.title,
          branch: branch,
          url: matchingPr.url,
          number: matchingPr.number,
          createdAt: new Date().toISOString(),
        };
      }
      return null;
    }

    const pr = prs[0];
    return {
      title: pr.title,
      branch: branch,
      url: pr.url,
      number: pr.number,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error verifying PR creation:', error);
    return null;
  }
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
  console.log(`Starting Stage 2 review for ${session.featureId}`);
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

  // Save "started" conversation entry immediately
  await resultHandler.saveConversationStart(sessionDir, 2, prompt);

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
    await handleStage2Completion(session, result, sessionDir, storage, sessionManager, resultHandler, eventBroadcaster);

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
  resultHandler: ClaudeResultHandler,
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

  // Auto-start Stage 3 implementation
  if (plan) {
    const stage3Prompt = buildStage3Prompt(updatedSession, plan);
    await spawnStage3Implementation(
      updatedSession,
      storage,
      sessionManager,
      resultHandler,
      eventBroadcaster,
      stage3Prompt
    );
  }
}

/**
 * Spawn Stage 3 implementation Claude. Used by:
 * - Auto-start after plan approval
 * - Resume after blocker answers
 * - Manual /transition endpoint
 */
async function spawnStage3Implementation(
  session: Session,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined,
  prompt: string
): Promise<void> {
  console.log(`Starting Stage 3 implementation for ${session.featureId}`);
  const sessionDir = `${session.projectId}/${session.featureId}`;
  const statusPath = `${sessionDir}/status.json`;

  // Update status to running
  const status = await storage.readJson<Record<string, unknown>>(statusPath);
  if (status) {
    status.status = 'running';
    status.lastAction = 'stage3_started';
    status.lastActionAt = new Date().toISOString();
    await storage.writeJson(statusPath, status);
  }

  // Broadcast execution started
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage3_started');

  // Save "started" conversation entry immediately
  await resultHandler.saveConversationStart(sessionDir, 3, prompt);

  // Track current step for real-time broadcasting
  let currentStepId: string | null = null;

  // Spawn Claude with Stage 3 tools (includes Bash for git)
  orchestrator.spawn({
    prompt,
    projectPath: session.projectPath,
    sessionId: session.claudeSessionId || undefined,
    allowedTools: orchestrator.getStageTools(3),
    onOutput: (output, isComplete) => {
      // Broadcast raw output
      eventBroadcaster?.claudeOutput(session.projectId, session.featureId, output, isComplete);

      // Parse and broadcast IMPLEMENTATION_STATUS in real-time
      const statusMatch = output.match(/\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/);
      if (statusMatch && eventBroadcaster) {
        const statusContent = statusMatch[1];
        const getValue = (key: string): string => {
          const match = statusContent.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
          return match ? match[1].trim() : '';
        };

        const stepId = getValue('step_id');
        const progressStatus = getValue('status');

        // Broadcast step.started if this is a new step
        if (stepId && stepId !== currentStepId) {
          currentStepId = stepId;
          eventBroadcaster.stepStarted(session.projectId, session.featureId, stepId);
        }

        // Broadcast implementation progress
        eventBroadcaster.implementationProgress(session.projectId, session.featureId, {
          stepId,
          status: progressStatus,
          filesModified: [],
          testsStatus: getValue('tests_status') || null,
          retryCount: parseInt(getValue('retry_count') || '0', 10) || 0,
          message: getValue('message'),
        });
      }
    },
  }).then(async (result) => {
    // Handle Stage 3 result
    const { hasBlocker, implementationComplete } = await resultHandler.handleStage3Result(session, result, prompt);

    // Broadcast events for completed steps
    if (eventBroadcaster && result.parsed.stepsCompleted.length > 0) {
      const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
      if (plan) {
        for (const completed of result.parsed.stepsCompleted) {
          const step = plan.steps.find(s => s.id === completed.id);
          if (step) {
            eventBroadcaster.stepCompleted(
              session.projectId,
              session.featureId,
              step,
              completed.summary,
              [] // filesModified would need to be parsed from summary
            );
          }
        }
        // Broadcast plan update with new step statuses
        eventBroadcaster.planUpdated(session.projectId, session.featureId, plan);
      }
    }

    // Broadcast blocker questions if any
    if (hasBlocker && eventBroadcaster) {
      const questionsPath = `${sessionDir}/questions.json`;
      const questionsData = await storage.readJson<{ questions: Question[] }>(questionsPath);
      if (questionsData) {
        const blockerQuestions = questionsData.questions.filter(
          q => q.category === 'blocker' && !q.answer
        );
        if (blockerQuestions.length > 0) {
          eventBroadcaster.questionsAsked(session.projectId, session.featureId, blockerQuestions);
        }
      }
    }

    // Broadcast execution status
    const finalStatus = hasBlocker ? 'idle' : (implementationComplete ? 'idle' : 'running');
    const finalAction = hasBlocker
      ? 'stage3_blocked'
      : (implementationComplete ? 'stage3_complete' : 'stage3_progress');

    eventBroadcaster?.executionStatus(session.projectId, session.featureId, finalStatus, finalAction);

    // Handle Stage 3→4 transition when implementation complete
    if (implementationComplete) {
      await handleStage3Completion(session, sessionDir, storage, sessionManager, resultHandler, eventBroadcaster, result);
    }

    console.log(`Stage 3 ${implementationComplete ? 'completed' : (hasBlocker ? 'blocked' : 'in progress')} for ${session.featureId}`);
  }).catch((error) => {
    console.error(`Stage 3 spawn error for ${session.featureId}:`, error);
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage3_spawn_error');
  });
}

/**
 * Handle Stage 3 completion - transition to Stage 4 when implementation complete
 * Requires all tests to be passing before allowing transition (if tests were required).
 */
async function handleStage3Completion(
  session: Session,
  sessionDir: string,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined,
  result: ClaudeResult
): Promise<void> {
  // Verify all steps are completed
  const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
  if (!plan) return;

  const allCompleted = plan.steps.every(s => s.status === 'completed');
  if (!allCompleted) {
    console.log(`Stage 3 marked complete but not all steps are completed for ${session.featureId}`);
    return;
  }

  // Check test requirements based on assessment
  const testsRequired = plan.testRequirement?.required ?? true; // Default to required if not assessed

  if (testsRequired) {
    // Verify all tests are passing (REQUIRED for Stage 3→4 transition)
    if (!result.parsed.allTestsPassing) {
      console.log(`Stage 3 cannot transition: tests required but not passing for ${session.featureId}`);
      return;
    }
    const testsCount = result.parsed.testsAdded.length;
    console.log(`All ${plan.steps.length} steps completed with ${testsCount} tests passing, transitioning to Stage 4 for ${session.featureId}`);
  } else {
    console.log(`All ${plan.steps.length} steps completed (tests not required: ${plan.testRequirement?.reason}), transitioning to Stage 4 for ${session.featureId}`);
  }

  // Transition to Stage 4
  const previousStage = session.currentStage;
  const updatedSession = await sessionManager.transitionStage(session.projectId, session.featureId, 4);
  eventBroadcaster?.stageChanged(updatedSession, previousStage);

  // Auto-start Stage 4 PR creation
  const stage4Prompt = buildStage4Prompt(updatedSession, plan);
  await spawnStage4PRCreation(updatedSession, storage, sessionManager, resultHandler, eventBroadcaster, stage4Prompt);
}

/**
 * Spawn Stage 4 PR Creation Claude. Used by:
 * - Auto-start after Stage 3 implementation complete
 * - Manual /transition endpoint
 */
async function spawnStage4PRCreation(
  session: Session,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined,
  prompt: string
): Promise<void> {
  console.log(`Starting Stage 4 PR creation for ${session.featureId}`);
  const sessionDir = `${session.projectId}/${session.featureId}`;
  const statusPath = `${sessionDir}/status.json`;

  // Update status to running
  const status = await storage.readJson<Record<string, unknown>>(statusPath);
  if (status) {
    status.status = 'running';
    status.lastAction = 'stage4_started';
    status.lastActionAt = new Date().toISOString();
    await storage.writeJson(statusPath, status);
  }

  // Broadcast execution started
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage4_started');

  // Save "started" conversation entry immediately
  await resultHandler.saveConversationStart(sessionDir, 4, prompt);

  // Spawn Claude with Stage 4 tools (git and gh commands)
  orchestrator.spawn({
    prompt,
    projectPath: session.projectPath,
    sessionId: session.claudeSessionId || undefined,
    allowedTools: orchestrator.getStageTools(4),
    onOutput: (output, isComplete) => {
      eventBroadcaster?.claudeOutput(session.projectId, session.featureId, output, isComplete);
    },
  }).then(async (result) => {
    // Save Stage 4 conversation first
    const conversationsPath = `${sessionDir}/conversations.json`;
    const conversations = await storage.readJson<{ entries: unknown[] }>(conversationsPath) || { entries: [] };
    conversations.entries.push({
      stage: 4,
      timestamp: new Date().toISOString(),
      prompt: prompt,
      output: result.output,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      isError: result.isError,
      parsed: result.parsed,
    });
    await storage.writeJson(conversationsPath, conversations);

    // Verify PR creation using gh pr list command instead of parsing markers
    // This is more reliable than relying on Claude's output markers
    const prInfo = await verifyPRCreation(session.projectPath, session.projectId, session.featureId);

    if (prInfo) {
      // Save PR info
      await storage.writeJson(`${sessionDir}/pr.json`, prInfo);

      console.log(`PR verified: ${prInfo.url || prInfo.title}`);

      // Broadcast PR created event
      eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage4_complete');

      // Update status
      const finalStatus = await storage.readJson<Record<string, unknown>>(statusPath);
      if (finalStatus) {
        finalStatus.status = 'idle';
        finalStatus.lastAction = 'stage4_complete';
        finalStatus.lastActionAt = new Date().toISOString();
        await storage.writeJson(statusPath, finalStatus);
      }

      // Auto-transition to Stage 5 and start PR review
      console.log(`Auto-transitioning to Stage 5 for ${session.featureId}`);
      const previousStage = session.currentStage;
      const updatedSession = await sessionManager.transitionStage(session.projectId, session.featureId, 5);
      eventBroadcaster?.stageChanged(updatedSession, previousStage);

      // Read plan for Stage 5 prompt and auto-start review
      const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
      if (plan) {
        const stage5Prompt = buildStage5Prompt(updatedSession, plan, prInfo);
        await spawnStage5PRReview(updatedSession, storage, sessionManager, resultHandler, eventBroadcaster, stage5Prompt);
      }
    } else {
      console.log(`Stage 4 completed but no PR found via gh pr list for ${session.featureId}`);

      eventBroadcaster?.executionStatus(
        session.projectId,
        session.featureId,
        'error',
        'stage4_no_pr_found'
      );

      // Update status as error
      const finalStatus = await storage.readJson<Record<string, unknown>>(statusPath);
      if (finalStatus) {
        finalStatus.status = 'error';
        finalStatus.lastAction = 'stage4_no_pr_found';
        finalStatus.lastActionAt = new Date().toISOString();
        await storage.writeJson(statusPath, finalStatus);
      }
    }
  }).catch((error) => {
    console.error(`Stage 4 spawn error for ${session.featureId}:`, error);
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage4_spawn_error');
  });
}

/**
 * Spawn Stage 5 PR Review Claude. Used by:
 * - Auto-start after Stage 4 PR creation
 * - Manual /transition endpoint
 */
async function spawnStage5PRReview(
  session: Session,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined,
  prompt: string
): Promise<void> {
  console.log(`Starting Stage 5 PR review for ${session.featureId}`);
  const sessionDir = `${session.projectId}/${session.featureId}`;
  const statusPath = `${sessionDir}/status.json`;

  // Update status to running
  const status = await storage.readJson<Record<string, unknown>>(statusPath);
  if (status) {
    status.status = 'running';
    status.lastAction = 'stage5_started';
    status.lastActionAt = new Date().toISOString();
    await storage.writeJson(statusPath, status);
  }

  // Broadcast execution started
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage5_started');

  // Save "started" conversation entry immediately
  await resultHandler.saveConversationStart(sessionDir, 5, prompt);

  // Spawn Claude with Stage 5 tools
  orchestrator.spawn({
    prompt,
    projectPath: session.projectPath,
    sessionId: session.claudeSessionId || undefined,
    allowedTools: orchestrator.getStageTools(5),
    onOutput: (output, isComplete) => {
      eventBroadcaster?.claudeOutput(session.projectId, session.featureId, output, isComplete);
    },
  }).then(async (result) => {
    // Handle Stage 5 result
    await handleStage5Result(session, result, sessionDir, prompt, storage, sessionManager, resultHandler, eventBroadcaster);
  }).catch((error) => {
    console.error(`Stage 5 spawn error for ${session.featureId}:`, error);
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage5_spawn_error');
  });
}

/**
 * Handle Stage 5 result - check for CI failures, review issues, or PR approval
 */
async function handleStage5Result(
  session: Session,
  result: ClaudeResult,
  sessionDir: string,
  prompt: string,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined
): Promise<void> {
  const statusPath = `${sessionDir}/status.json`;

  // Save Stage 5 conversation
  const conversationsPath = `${sessionDir}/conversations.json`;
  const conversations = await storage.readJson<{ entries: unknown[] }>(conversationsPath) || { entries: [] };
  conversations.entries.push({
    stage: 5,
    timestamp: new Date().toISOString(),
    prompt: prompt,
    output: result.output,
    sessionId: result.sessionId,
    costUsd: result.costUsd,
    isError: result.isError,
    parsed: result.parsed,
  });
  await storage.writeJson(conversationsPath, conversations);

  // Check for CI failure - requires return to Stage 2
  if (result.parsed.ciFailed || result.parsed.returnToStage2) {
    const reason = result.parsed.returnToStage2?.reason || 'CI checks failed';
    console.log(`Stage 5 returning to Stage 2: ${reason}`);

    // Transition back to Stage 2
    const previousStage = session.currentStage;
    const updatedSession = await sessionManager.transitionStage(session.projectId, session.featureId, 2);
    eventBroadcaster?.stageChanged(updatedSession, previousStage);

    // Use LLM to identify which steps are actually incomplete
    const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
    if (plan) {
      // Assess which steps are affected by the CI/review issues
      const incompleteAssessor = new IncompleteStepsAssessor();
      const assessment = await incompleteAssessor.assess(plan, reason, session.projectPath);

      // Save post-processing conversation
      await resultHandler.savePostProcessingConversation(
        sessionDir,
        5, // Stage 5 spawned this
        'incomplete_steps',
        assessment.prompt,
        assessment.output,
        assessment.durationMs,
        false
      );

      // Update plan based on assessment
      plan.isApproved = false;
      plan.planVersion = (plan.planVersion || 1) + 1;

      // Only mark affected steps as needs_review or pending
      for (const affected of assessment.affectedSteps) {
        const step = plan.steps.find(s => s.id === affected.stepId);
        if (step) {
          step.status = affected.status;
        }
      }

      await storage.writeJson(`${sessionDir}/plan.json`, plan);

      // Auto-spawn Stage 2 with plan revision prompt including assessment summary
      const revisionFeedback = `CI/Review Issues from Stage 5:\n${reason}\n\nAssessment: ${assessment.summary}\n\nAffected steps:\n${assessment.affectedSteps.map(s => `- ${s.stepId}: ${s.reason}`).join('\n')}\n\nPlease update the plan to address these issues.`;
      const revisionPrompt = buildPlanRevisionPrompt(updatedSession, plan, revisionFeedback);
      await spawnStage2Review(updatedSession, storage, sessionManager, resultHandler, eventBroadcaster, revisionPrompt);
    }

    return;
  }

  // Check for PR approval
  if (result.parsed.prApproved) {
    console.log(`PR approved for ${session.featureId}`);

    // Update status to completed
    const finalStatus = await storage.readJson<Record<string, unknown>>(statusPath);
    if (finalStatus) {
      finalStatus.status = 'idle';
      finalStatus.lastAction = 'stage5_pr_approved';
      finalStatus.lastActionAt = new Date().toISOString();
      await storage.writeJson(statusPath, finalStatus);
    }

    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage5_pr_approved');
    return;
  }

  // Check for review issues that need user decisions
  if (result.parsed.decisions.length > 0) {
    console.log(`Stage 5 found ${result.parsed.decisions.length} issues requiring user input`);

    // Save questions for user to answer
    // Skip validation for Stage 5 - these are actual code review findings, not implementation questions
    await resultHandler['saveQuestions'](sessionDir, session, result.parsed.decisions, null);

    // Broadcast questions
    const questionsPath = `${sessionDir}/questions.json`;
    const questionsData = await storage.readJson<{ questions: Question[] }>(questionsPath);
    if (questionsData && eventBroadcaster) {
      const newQuestions = questionsData.questions.slice(-result.parsed.decisions.length);
      eventBroadcaster.questionsAsked(session.projectId, session.featureId, newQuestions);
    }

    // Update status
    const finalStatus = await storage.readJson<Record<string, unknown>>(statusPath);
    if (finalStatus) {
      finalStatus.status = 'idle';
      finalStatus.lastAction = 'stage5_awaiting_user';
      finalStatus.lastActionAt = new Date().toISOString();
      await storage.writeJson(statusPath, finalStatus);
    }

    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage5_awaiting_user');
    return;
  }

  // No specific outcome detected
  console.log(`Stage 5 completed for ${session.featureId} (no specific outcome detected)`);
  const finalStatus = await storage.readJson<Record<string, unknown>>(statusPath);
  if (finalStatus) {
    finalStatus.status = result.isError ? 'error' : 'idle';
    finalStatus.lastAction = result.isError ? 'stage5_error' : 'stage5_complete';
    finalStatus.lastActionAt = new Date().toISOString();
    await storage.writeJson(statusPath, finalStatus);
  }

  eventBroadcaster?.executionStatus(
    session.projectId,
    session.featureId,
    result.isError ? 'error' : 'idle',
    result.isError ? 'stage5_error' : 'stage5_complete'
  );
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
): { app: Express; resumeStuckSessions: () => Promise<void> } {
  const app = express();

  // Create decision validator for filtering false positives (README line 1461)
  const decisionValidator = new DecisionValidator();
  // Create test requirement assessor to determine if tests are needed
  const testAssessor = new TestRequirementAssessor();
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

      // Save "started" conversation entry immediately
      const sessionDir = `${session.projectId}/${session.featureId}`;
      await resultHandler.saveConversationStart(sessionDir, 1, prompt);

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

        // Check for unanswered Stage 2 questions before starting new iteration
        const questionsData = await storage.readJson<{ questions: Question[] }>(`${sessionDir}/questions.json`);
        const unansweredStage2Questions = questionsData?.questions.filter(
          q => q.stage === 'planning' && !q.answeredAt
        ) || [];
        if (unansweredStage2Questions.length > 0) {
          console.log(`Cannot start Stage 2 iteration: ${unansweredStage2Questions.length} unanswered questions for ${featureId}`);
          return;
        }

        // Build Stage 2 prompt and spawn review using helper function
        const currentIteration = (plan.reviewCount || 0) + 1;
        const prompt = buildStage2Prompt(session, plan, currentIteration);
        await spawnStage2Review(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
      } else if (targetStage === 3) {
        // If transitioning to Stage 3, verify plan is approved and spawn implementation
        const sessionDir = `${projectId}/${featureId}`;

        // Read current plan
        const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
        if (!plan) {
          console.error(`No plan found for Stage 3 transition: ${featureId}`);
          return;
        }

        // Verify plan is approved
        if (!plan.isApproved) {
          console.error(`Plan not approved for Stage 3 transition: ${featureId}`);
          return;
        }

        // Build Stage 3 prompt and spawn implementation
        const prompt = buildStage3Prompt(session, plan);
        await spawnStage3Implementation(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
      } else if (targetStage === 4) {
        // If transitioning to Stage 4, spawn PR creation
        const sessionDir = `${projectId}/${featureId}`;

        // Read current plan
        const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
        if (!plan) {
          console.error(`No plan found for Stage 4 transition: ${featureId}`);
          return;
        }

        // Build Stage 4 prompt and spawn PR creation
        const prompt = buildStage4Prompt(session, plan);
        await spawnStage4PRCreation(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
      } else if (targetStage === 5) {
        // If transitioning to Stage 5, spawn PR review
        const sessionDir = `${projectId}/${featureId}`;

        // Read current plan and PR info
        const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
        const prInfo = await storage.readJson<{ title: string; branch: string; url: string }>(`${sessionDir}/pr.json`);

        if (!plan) {
          console.error(`No plan found for Stage 5 transition: ${featureId}`);
          return;
        }

        if (!prInfo) {
          console.error(`No PR info found for Stage 5 transition: ${featureId}`);
          return;
        }

        // Build Stage 5 prompt and spawn PR review
        const prompt = buildStage5Prompt(session, plan, prInfo);
        await spawnStage5PRReview(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
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
              await handleStage2Completion(session, result, sessionDir, storage, sessionManager, resultHandler, eventBroadcaster);
            }

            // Apply Haiku fallback if no decisions were parsed but output looks like questions
            const extractedCount = await applyHaikuPostProcessing(result, session.projectPath, storage, session, resultHandler);

            // Check if we need to auto-resume: Stage 1, no plan, no unanswered questions
            // This handles the case where validation filtered all new questions
            if (session.currentStage === 1 && !result.isError && !result.parsed.planFilePath) {
              const questionsData = await storage.readJson<{ questions: Question[] }>(`${sessionDir}/questions.json`);
              const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
              const unansweredCount = questionsData?.questions.filter(q => !q.answer).length || 0;
              const planStepsCount = plan?.steps?.length || 0;

              if (unansweredCount === 0 && planStepsCount === 0) {
                console.log(`No unanswered questions and no plan - auto-resuming to create plan for ${featureId}`);
                // Resume Claude to create the plan
                const createPlanPrompt = `All questions have been answered. Now create the implementation plan.

Generate the plan using [PLAN_STEP] markers:
[PLAN_STEP id="step-1" parent="null" status="pending"]
Step title
Step description referencing specific files found during exploration.
[/PLAN_STEP]

After creating all steps, write the plan to a file and output:
[PLAN_FILE path="/path/to/plan.md"]
[PLAN_MODE_EXITED]`;

                // Fire and forget - spawn Claude to create plan
                orchestrator.spawn({
                  prompt: createPlanPrompt,
                  projectPath: session.projectPath,
                  sessionId: session.claudeSessionId || undefined,
                  onOutput: (output, isComplete) => {
                    eventBroadcaster?.claudeOutput(projectId, featureId, output, isComplete);
                  },
                }).then(async (planResult) => {
                  await resultHandler.handleStage1Result(session, planResult, createPlanPrompt);
                  if (!planResult.isError) {
                    await handleStage1Completion(session, planResult, storage, sessionManager, resultHandler, eventBroadcaster);
                  }
                  console.log(`Plan creation ${planResult.isError ? 'failed' : 'completed'} for ${featureId}`);
                }).catch((error) => {
                  console.error(`Plan creation error for ${featureId}:`, error);
                });
              }
            }

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

          // Save "started" conversation entry
          await resultHandler.saveConversationStart(sessionDir, session.currentStage, prompt);

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
            await handleStage2Completion(session, result, sessionDir, storage, sessionManager, resultHandler, eventBroadcaster);
          } else if (session.currentStage === 3) {
            // Stage 3: Resume implementation after blocker answer
            // Use spawnStage3Implementation with blocker answer context
            const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
            if (plan) {
              const stage3ResumePrompt = `The user answered your blocker question:

${answeredQuestions.map(q => `**Q:** ${q.questionText}\n**A:** ${typeof q.answer?.value === 'string' ? q.answer.value : JSON.stringify(q.answer?.value)}`).join('\n\n')}

Continue implementing the plan. Pick up where you left off.`;

              await spawnStage3Implementation(
                session,
                storage,
                sessionManager,
                resultHandler,
                eventBroadcaster,
                stage3ResumePrompt
              );
            }
            return; // Stage 3 handles its own completion
          } else if (session.currentStage === 5) {
            // Stage 5: Re-review after user addresses review findings
            const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
            const prInfo = await storage.readJson<{ title: string; branch: string; url: string }>(`${sessionDir}/pr.json`);

            if (plan) {
              const reviewAnswersSummary = answeredQuestions.map(q =>
                `**Issue:** ${q.questionText}\n**Resolution:** ${typeof q.answer?.value === 'string' ? q.answer.value : JSON.stringify(q.answer?.value)}`
              ).join('\n\n');

              const stage5ResumePrompt = `The user has addressed your review findings:

${reviewAnswersSummary}

Please re-review the PR to verify the issues have been addressed. Check:
1. Have the user's resolutions adequately addressed the issues?
2. Are there any remaining concerns?
3. Is the PR ready to merge?

${prInfo?.url ? `PR URL: ${prInfo.url}` : ''}

If all issues are resolved, output [PR_APPROVED]. Otherwise, raise new [DECISION_NEEDED] markers for any remaining concerns.`;

              await spawnStage5PRReview(
                session,
                storage,
                sessionManager,
                resultHandler,
                eventBroadcaster,
                stage5ResumePrompt
              );
            }
            return; // Stage 5 handles its own completion
          }

          // Apply Haiku fallback if no decisions were parsed but output looks like questions
          const extractedCount = await applyHaikuPostProcessing(result, session.projectPath, storage, session, resultHandler);

          // Check if we need to auto-resume: Stage 1, no plan, no unanswered questions
          // This handles the case where validation filtered all new questions
          if (session.currentStage === 1 && !result.isError && !result.parsed.planFilePath) {
            const questionsData = await storage.readJson<{ questions: Question[] }>(`${sessionDir}/questions.json`);
            const planData = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
            const unansweredCount = questionsData?.questions.filter(q => !q.answer).length || 0;
            const planStepsCount = planData?.steps?.length || 0;

            if (unansweredCount === 0 && planStepsCount === 0) {
              console.log(`No unanswered questions and no plan - auto-resuming to create plan for ${featureId}`);
              const createPlanPrompt = `All questions have been answered. Now create the implementation plan.

Generate the plan using [PLAN_STEP] markers:
[PLAN_STEP id="step-1" parent="null" status="pending"]
Step title
Step description referencing specific files found during exploration.
[/PLAN_STEP]

After creating all steps, write the plan to a file and output:
[PLAN_FILE path="/path/to/plan.md"]
[PLAN_MODE_EXITED]`;

              // Save "started" conversation entry
              await resultHandler.saveConversationStart(sessionDir, 1, createPlanPrompt);

              orchestrator.spawn({
                prompt: createPlanPrompt,
                projectPath: session.projectPath,
                sessionId: session.claudeSessionId || undefined,
                onOutput: (output, isComplete) => {
                  eventBroadcaster?.claudeOutput(projectId, featureId, output, isComplete);
                },
              }).then(async (planResult) => {
                await resultHandler.handleStage1Result(session, planResult, createPlanPrompt);
                if (!planResult.isError) {
                  await handleStage1Completion(session, planResult, storage, sessionManager, resultHandler, eventBroadcaster);
                }
                console.log(`Plan creation ${planResult.isError ? 'failed' : 'completed'} for ${featureId}`);
              }).catch((error) => {
                console.error(`Plan creation error for ${featureId}:`, error);
              });
            }
          }

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

      // Check for unanswered Stage 2 questions - must answer before approving
      const questionsData = await storage.readJson<{ questions: Question[] }>(`${projectId}/${featureId}/questions.json`);
      const unansweredStage2Questions = questionsData?.questions.filter(
        q => q.stage === 'planning' && !q.answeredAt
      ) || [];
      if (unansweredStage2Questions.length > 0) {
        return res.status(400).json({
          error: 'Cannot approve plan while there are unanswered plan review questions',
          unansweredCount: unansweredStage2Questions.length,
        });
      }

      plan.isApproved = true;

      // Assess test requirements using Haiku (fire-and-forget, but save result)
      console.log(`Assessing test requirements for ${featureId}...`);
      const testRequirement = await testAssessor.assess(session, plan, session.projectPath);

      // Save post-processing conversation
      await resultHandler.savePostProcessingConversation(
        `${projectId}/${featureId}`,
        2, // Stage 2 spawned this (plan approval)
        'test_assessment',
        testRequirement.prompt,
        testRequirement.output,
        testRequirement.durationMs,
        false
      );

      plan.testRequirement = {
        required: testRequirement.required,
        reason: testRequirement.reason,
        testTypes: testRequirement.testTypes,
        existingFramework: testRequirement.existingFramework,
        suggestedCoverage: testRequirement.suggestedCoverage,
        assessedAt: testRequirement.assessedAt,
      };

      await storage.writeJson(planPath, plan);

      // Transition to Stage 3 (Implementation)
      const previousStage = session.currentStage;
      const updatedSession = await sessionManager.transitionStage(projectId, featureId, 3);

      // Broadcast events
      if (eventBroadcaster) {
        eventBroadcaster.planApproved(projectId, featureId, plan);
        eventBroadcaster.stageChanged(updatedSession, previousStage);
      }

      // Auto-start Stage 3 implementation
      const stage3Prompt = buildStage3Prompt(updatedSession, plan);
      spawnStage3Implementation(
        updatedSession,
        storage,
        sessionManager,
        resultHandler,
        eventBroadcaster,
        stage3Prompt
      );

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

      // Check for unanswered Stage 2 questions - must answer before requesting changes
      const questionsData = await storage.readJson<{ questions: Question[] }>(`${sessionDir}/questions.json`);
      const unansweredStage2Questions = questionsData?.questions.filter(
        q => q.stage === 'planning' && !q.answeredAt
      ) || [];
      if (unansweredStage2Questions.length > 0) {
        return res.status(400).json({
          error: 'Cannot request changes while there are unanswered plan review questions',
          unansweredCount: unansweredStage2Questions.length,
        });
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

      // Save "started" conversation entry
      await resultHandler.saveConversationStart(sessionDir, 2, prompt);

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
        await handleStage2Completion(session, result, sessionDir, storage, sessionManager, resultHandler, eventBroadcaster);

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

  // Request re-review with optional remarks (Stage 5)
  app.post('/api/sessions/:projectId/:featureId/re-review', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const { remarks } = req.body as { remarks?: string };

      // Get session
      const session = await sessionManager.getSession(projectId, featureId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Verify we're in Stage 5
      if (session.currentStage !== 5) {
        return res.status(400).json({ error: 'Re-review is only available in Stage 5' });
      }

      const sessionDir = `${projectId}/${featureId}`;

      // Read plan and PR info
      const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
      const prInfo = await storage.readJson<{ title: string; branch: string; url: string }>(`${sessionDir}/pr.json`);

      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      if (!prInfo) {
        return res.status(404).json({ error: 'PR info not found' });
      }

      // Return success immediately
      res.json({ success: true, remarks: remarks || null });

      // Build Stage 5 prompt with user remarks
      let prompt = buildStage5Prompt(session, plan, prInfo);
      if (remarks && remarks.trim()) {
        prompt = `${prompt}\n\n## User Remarks for Re-Review\nThe user has requested a re-review with the following additional remarks:\n\n${remarks.trim()}`;
      }

      // Spawn Stage 5 review
      await spawnStage5PRReview(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);

      console.log(`Re-review requested for ${featureId}${remarks ? ' with remarks' : ''}`);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request re-review';
      res.status(500).json({ error: message });
    }
  });

  /**
   * Resume sessions that were interrupted by server restart.
   * Detects stuck sessions (status=running/implementing, stale lastActionAt)
   * and re-spawns Claude with --resume to continue where it left off.
   */
  async function resumeStuckSessions(): Promise<void> {
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    try {
      const allSessions = await sessionManager.listAllSessions();

      for (const session of allSessions) {
        // Only check running/implementing sessions
        if (session.status !== 'implementing' && session.status !== 'discovery' && session.status !== 'planning' && session.status !== 'pr_creation' && session.status !== 'pr_review') {
          continue;
        }

        // Check if session is stale (no activity for 5+ minutes)
        const sessionDir = `${session.projectId}/${session.featureId}`;
        const status = await storage.readJson<{ lastActionAt?: string; status?: string }>(`${sessionDir}/status.json`);

        if (!status?.lastActionAt) continue;

        const lastActionTime = new Date(status.lastActionAt).getTime();
        const isStale = (now - lastActionTime) > STALE_THRESHOLD_MS;

        if (!isStale) continue;

        // Check if last conversation entry is incomplete (started but not completed)
        const conversations = await storage.readJson<{ entries: Array<{ stage: number; status: string }> }>(`${sessionDir}/conversations.json`);
        const lastEntry = conversations?.entries?.[conversations.entries.length - 1];

        if (!lastEntry || lastEntry.status !== 'started') continue;

        // This session is stuck - resume it
        console.log(`Resuming stuck session: ${session.featureId} (Stage ${session.currentStage}, stale for ${Math.round((now - lastActionTime) / 1000 / 60)} minutes)`);

        try {
          // Mark incomplete conversation entries as interrupted before resuming
          const interruptedCount = await resultHandler.markIncompleteConversationsAsInterrupted(sessionDir);
          if (interruptedCount > 0) {
            console.log(`Marked ${interruptedCount} incomplete conversation(s) as interrupted for ${session.featureId}`);
          }

          // Update session.updatedAt to reflect the resume
          await sessionManager.updateSession(session.projectId, session.featureId, {});

          const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);

          switch (session.currentStage) {
            case 1: {
              // Stage 1: Discovery - skip auto-resume (user can restart session)
              console.log(`Skipping Stage 1 auto-resume for ${session.featureId} - user can restart session`);
              break;
            }
            case 2: {
              // Stage 2: Plan Review - resume with stage 2 prompt
              if (!plan) break;
              const currentIteration = (plan.reviewCount || 0) + 1;
              const prompt = buildStage2Prompt(session, plan, currentIteration);
              await spawnStage2Review(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
              break;
            }
            case 3: {
              // Stage 3: Implementation - resume with stage 3 prompt
              if (!plan) break;
              const prompt = buildStage3Prompt(session, plan);
              await spawnStage3Implementation(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
              break;
            }
            case 4: {
              // Stage 4: PR Creation - resume with stage 4 prompt
              if (!plan) break;
              const prompt = buildStage4Prompt(session, plan);
              await spawnStage4PRCreation(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
              break;
            }
            case 5: {
              // Stage 5: PR Review - resume with stage 5 prompt
              if (!plan) break;
              const prInfo = await storage.readJson<{ title: string; branch: string; url: string }>(`${sessionDir}/pr.json`);
              if (!prInfo) break;
              const prompt = buildStage5Prompt(session, plan, prInfo);
              await spawnStage5PRReview(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
              break;
            }
          }
        } catch (error) {
          console.error(`Failed to resume session ${session.featureId}:`, error);
        }
      }
    } catch (error) {
      console.error('Error scanning for stuck sessions:', error);
    }
  }

  return { app, resumeStuckSessions };
}

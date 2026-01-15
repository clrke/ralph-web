import express, { Express, Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { ZodSchema, ZodError } from 'zod';
import { FileStorageService } from './data/FileStorageService';
import { SessionManager } from './services/SessionManager';
import { ClaudeOrchestrator, hasActionableContent, MAX_PLAN_VALIDATION_ATTEMPTS } from './services/ClaudeOrchestrator';
import { OutputParser } from './services/OutputParser';
import { HaikuPostProcessor } from './services/HaikuPostProcessor';
import { ClaudeResultHandler } from './services/ClaudeResultHandler';
import { planCompletionChecker, PlanCompletenessResult } from './services/PlanCompletionChecker';
import { DecisionValidator } from './services/DecisionValidator';
import { TestRequirementAssessor } from './services/TestRequirementAssessor';
import { IncompleteStepsAssessor } from './services/IncompleteStepsAssessor';
import { EventBroadcaster } from './services/EventBroadcaster';
import {
  buildStage1Prompt,
  buildStage2Prompt,
  buildStage2PromptLean,
  buildStage4Prompt,
  buildStage4PromptLean,
  buildStage5Prompt,
  buildStage5PromptLean,
  buildPlanRevisionPrompt,
  buildBatchAnswersContinuationPrompt,
  buildSingleStepPrompt,
  buildSingleStepPromptLean,
} from './prompts/stagePrompts';
import { Session, PlanStep } from '@claude-code-web/shared';
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
import {
  isPlanApproved,
  getHeadCommitSha,
} from './utils/stateVerification';
import * as packageJson from '../package.json';

const startTime = Date.now();

// Initialize orchestrator and post-processor
const outputParser = new OutputParser();
const orchestrator = new ClaudeOrchestrator(outputParser);
const haikuPostProcessor = new HaikuPostProcessor(outputParser);

// Lock to prevent concurrent Stage 3 executions per session
const stage3ExecutionLocks = new Map<string, boolean>();

function getSessionKey(projectId: string, featureId: string): string {
  return `${projectId}/${featureId}`;
}

function acquireStage3Lock(projectId: string, featureId: string): boolean {
  const key = getSessionKey(projectId, featureId);
  if (stage3ExecutionLocks.get(key)) {
    console.log(`[Stage 3 Lock] Execution already in progress for ${featureId}, skipping`);
    return false;
  }
  stage3ExecutionLocks.set(key, true);
  console.log(`[Stage 3 Lock] Acquired lock for ${featureId}`);
  return true;
}

function releaseStage3Lock(projectId: string, featureId: string): void {
  const key = getSessionKey(projectId, featureId);
  stage3ExecutionLocks.delete(key);
  console.log(`[Stage 3 Lock] Released lock for ${featureId}`);
}

/**
 * Apply Haiku post-processing to extract various content types when Claude's output
 * lacks proper markers. Uses smart extraction based on current stage.
 *
 * Extracts:
 * - Stage 1: Questions, Plan steps
 * - Stage 2: Questions (review decisions)
 * - Stage 3: Implementation status
 * - Stage 4: PR info
 * - Stage 5: Review findings (as questions)
 *
 * @returns Number of items extracted
 */
async function applyHaikuPostProcessing(
  result: ClaudeResult,
  projectPath: string,
  storage: FileStorageService,
  session: Session,
  resultHandler: ClaudeResultHandler
): Promise<number> {
  // Skip if error
  if (result.isError) {
    return 0;
  }

  // Check what's already in the parsed output
  const hasDecisions = result.parsed.decisions.length > 0;
  const hasPlanSteps = result.parsed.planSteps.length > 0;
  const hasImplementationStatus = result.parsed.implementationStatus !== null;
  const hasPRCreated = result.parsed.prCreated !== null;

  // Skip if we already have all the content we need for this stage
  if (hasActionableContent(result.parsed)) {
    // Still try to extract additional content if some types are missing
    const shouldExtract = (
      (session.currentStage === 1 && (!hasDecisions || !hasPlanSteps)) ||
      (session.currentStage === 2 && !hasDecisions) ||
      (session.currentStage === 3 && !hasImplementationStatus) ||
      (session.currentStage === 4 && !hasPRCreated) ||
      (session.currentStage === 5 && !hasDecisions)
    );

    if (!shouldExtract) {
      return 0;
    }
  }

  // Use smart extraction based on stage context
  const extractionResult = await haikuPostProcessor.smartExtract(
    result.output,
    projectPath,
    {
      stage: session.currentStage,
      hasDecisions,
      hasPlanSteps,
      hasImplementationStatus,
      hasPRCreated,
    }
  );

  const sessionDir = `${session.projectId}/${session.featureId}`;
  let totalExtracted = 0;

  // Merge extracted questions into result
  if (extractionResult.questions && extractionResult.questions.length > 0) {
    result.parsed.decisions = extractionResult.questions;
    const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
    await resultHandler['saveQuestions'](sessionDir, session, extractionResult.questions, plan);
    totalExtracted += extractionResult.questions.length;
    console.log(`Haiku extracted ${extractionResult.questions.length} questions for ${session.featureId}`);
  }

  // Merge extracted plan steps into result
  if (extractionResult.planSteps && extractionResult.planSteps.length > 0) {
    result.parsed.planSteps = extractionResult.planSteps;
    totalExtracted += extractionResult.planSteps.length;
    console.log(`Haiku extracted ${extractionResult.planSteps.length} plan steps for ${session.featureId}`);
  }

  // Merge extracted PR info into result
  if (extractionResult.prInfo) {
    result.parsed.prCreated = extractionResult.prInfo;
    totalExtracted += 1;
    console.log(`Haiku extracted PR info for ${session.featureId}: ${extractionResult.prInfo.title}`);
  }

  // Merge extracted implementation status into result
  if (extractionResult.implementationStatus) {
    result.parsed.implementationStatus = extractionResult.implementationStatus;
    totalExtracted += 1;
    console.log(`Haiku extracted implementation status for ${session.featureId}`);
  }

  // Merge extracted review findings into result (as decisions)
  if (extractionResult.reviewFindings && extractionResult.reviewFindings.length > 0) {
    result.parsed.decisions = extractionResult.reviewFindings;
    const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
    await resultHandler['saveQuestions'](sessionDir, session, extractionResult.reviewFindings, plan);
    totalExtracted += extractionResult.reviewFindings.length;
    console.log(`Haiku extracted ${extractionResult.reviewFindings.length} review findings for ${session.featureId}`);
  }

  // Save all post-processing conversations
  for (const ppResult of extractionResult.postProcessResults) {
    await resultHandler.savePostProcessingConversation(
      sessionDir,
      session.currentStage,
      ppResult.type,
      ppResult.prompt,
      ppResult.output,
      ppResult.durationMs,
      false
    );
  }

  return totalExtracted;
}

/**
 * Generate a commit message from implementation output using Haiku.
 * @internal Reserved for future use
 */
async function _generateCommitMessage(
  output: string,
  projectPath: string
): Promise<string | null> {
  const result = await haikuPostProcessor.generateCommitMessage(output, projectPath);
  return result?.data || null;
}

/**
 * Generate a brief summary of Claude output using Haiku.
 * @internal Reserved for future use
 */
async function _generateOutputSummary(
  output: string,
  projectPath: string
): Promise<string | null> {
  const result = await haikuPostProcessor.generateSummary(output, projectPath);
  return result?.data || null;
}

/**
 * Extract test results from output using Haiku.
 * @internal Reserved for future use
 */
async function _extractTestResults(
  output: string,
  projectPath: string
): Promise<{ testsPassing: boolean; summary: string } | null> {
  const result = await haikuPostProcessor.extractTestResults(output, projectPath);
  if (!result) return null;
  return {
    testsPassing: result.data.testsPassing,
    summary: result.data.summary,
  };
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
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage2_started', { stage: 2, subState: 'spawning_agent' });

  // Save "started" conversation entry immediately
  await resultHandler.saveConversationStart(sessionDir, 2, prompt);

  // Spawn Claude with --resume if we have a session ID
  let hasReceivedOutput = false;
  orchestrator.spawn({
    prompt,
    projectPath: session.projectPath,
    sessionId: session.claudeSessionId || undefined,
    allowedTools: orchestrator.getStageTools(2),
    onOutput: (output, isComplete) => {
      // Broadcast processing_output on first output received
      if (!hasReceivedOutput) {
        hasReceivedOutput = true;
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage2_started', { stage: 2, subState: 'processing_output' });
      }
      eventBroadcaster?.claudeOutput(session.projectId, session.featureId, output, isComplete);
    },
  }).then(async (result) => {
    // Broadcast parsing_response before handling result
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage2_started', { stage: 2, subState: 'parsing_response' });

    const { allFiltered, planValidation } = await resultHandler.handleStage2Result(session, result, prompt);

    // Broadcast validating_output before Haiku post-processing
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage2_started', { stage: 2, subState: 'validating_output' });

    // Apply Haiku fallback if no decisions were parsed but output looks like questions
    const extractedCount = await applyHaikuPostProcessing(result, session.projectPath, storage, session, resultHandler);

    // Increment review count after Stage 2 completes
    await resultHandler.incrementReviewCount(sessionDir);

    // Broadcast saving_results before broadcasting parsed data events
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage2_started', { stage: 2, subState: 'saving_results' });

    // Broadcast events for parsed data
    if (eventBroadcaster) {
      // Broadcast questions (review findings) if any were asked (including Haiku-extracted)
      if (result.parsed.decisions.length > 0 && !allFiltered) {
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
        result.isError ? 'stage2_error' : 'stage2_complete',
        { stage: 2 }
      );
    }

    // Auto-approve plan if all questions were filtered as false positives
    if (allFiltered && result.parsed.decisions.length > 0) {
      console.log(`All ${result.parsed.decisions.length} question(s) filtered - auto-approving plan for ${session.featureId}`);
      result.parsed.planApproved = true;
    }

    // Check for auto Stage 2→3 transition (pass planValidation for structure check)
    await handleStage2Completion(session, result, sessionDir, storage, sessionManager, resultHandler, eventBroadcaster, planValidation);

    console.log(`Stage 2 review ${result.isError ? 'failed' : 'completed'} for ${session.featureId}${extractedCount > 0 ? ` (${extractedCount} questions via Haiku)` : ''}`);
  }).catch((error) => {
    console.error(`Stage 2 spawn error for ${session.featureId}:`, error);
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage2_spawn_error', { stage: 2 });
  });
}

/**
 * Handle Stage 2 completion - auto-transition to Stage 3 when plan is approved AND valid.
 *
 * Uses state-based verification as primary check (all planning questions answered),
 * with [PLAN_APPROVED] marker as secondary signal. This reduces dependency on
 * indeterministic Claude markers.
 *
 * Additionally validates plan structure completeness. If plan is approved but
 * structure is incomplete (missing sections), re-spawns Stage 2 with validation
 * context to fix the plan. This prevents transitioning to Stage 3 with incomplete plans.
 */
async function handleStage2Completion(
  session: Session,
  result: ClaudeResult,
  sessionDir: string,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined,
  planValidation?: PlanCompletenessResult
): Promise<void> {
  // Re-fetch current session state to avoid stale data
  const currentSession = await sessionManager.getSession(session.projectId, session.featureId);
  if (currentSession && currentSession.currentStage >= 3) {
    console.log(`Session ${session.featureId} already at Stage ${currentSession.currentStage}, skipping Stage 2 completion`);
    return;
  }

  // Load plan and questions for state-based verification
  const planPath = `${sessionDir}/plan.json`;
  const questionsPath = `${sessionDir}/questions.json`;
  const plan = await storage.readJson<Plan>(planPath);
  const questionsFile = await storage.readJson<{ questions: Question[] }>(questionsPath);

  // Check approval via state (primary) or marker (secondary)
  const stateApproved = isPlanApproved(plan, questionsFile);
  const markerApproved = result.parsed.planApproved;

  if (!stateApproved && !markerApproved) return;

  // Log which method triggered approval
  const approvalMethod = stateApproved
    ? (markerApproved ? 'state+marker' : 'state (all questions answered)')
    : 'marker only';
  console.log(`Plan approved via ${approvalMethod} for ${session.featureId}`);

  // Check if plan structure is complete before transitioning to Stage 3
  if (planValidation && !planValidation.complete) {
    // Get current validation attempts from session
    const currentAttempts = currentSession?.planValidationAttempts ?? 0;
    const nextAttempt = currentAttempts + 1;

    // Check if we should continue validation attempts
    if (orchestrator.shouldContinueValidation(currentAttempts)) {
      orchestrator.logValidationAttempt(
        session.featureId,
        nextAttempt,
        MAX_PLAN_VALIDATION_ATTEMPTS,
        planValidation.missingContext
      );

      // Update session with incremented attempt count
      await sessionManager.updateSession(
        session.projectId,
        session.featureId,
        { planValidationAttempts: nextAttempt }
      );

      // Build validation context prompt and re-spawn Stage 2
      const validationPrompt = buildPlanValidationPrompt(planValidation.missingContext);

      // Re-spawn Stage 2 with validation context (don't transition to Stage 3)
      console.log(`Re-spawning Stage 2 for ${session.featureId} to fix incomplete plan structure (attempt ${nextAttempt}/${MAX_PLAN_VALIDATION_ATTEMPTS})`);

      // Re-fetch updated session before re-spawning
      const updatedSession = await sessionManager.getSession(session.projectId, session.featureId);
      if (updatedSession) {
        await spawnStage2Review(
          updatedSession,
          storage,
          sessionManager,
          resultHandler,
          eventBroadcaster,
          validationPrompt
        );
      }
      return; // Don't transition to Stage 3
    } else {
      // Max attempts reached - log warning and proceed anyway
      orchestrator.logValidationMaxAttemptsReached(session.featureId, MAX_PLAN_VALIDATION_ATTEMPTS);
      console.warn(`Proceeding to Stage 3 for ${session.featureId} despite incomplete plan structure`);
    }
  } else if (planValidation?.complete) {
    // Plan structure is complete - log success
    const attempts = currentSession?.planValidationAttempts ?? 0;
    orchestrator.logValidationSuccess(session.featureId, attempts + 1);

    // Clear validation attempts on success
    await sessionManager.updateSession(
      session.projectId,
      session.featureId,
      { planValidationAttempts: 0, planValidationContext: null }
    );
  }

  console.log(`Auto-transitioning to Stage 3 for ${session.featureId}`);

  // Mark plan as approved (plan already loaded above for state verification)
  if (plan) {
    plan.isApproved = true;
    await storage.writeJson(planPath, plan);
    eventBroadcaster?.planApproved(session.projectId, session.featureId, plan);
  }

  // Transition to Stage 3
  const previousStage = session.currentStage;
  const updatedSession = await sessionManager.transitionStage(session.projectId, session.featureId, 3);
  eventBroadcaster?.stageChanged(updatedSession, previousStage);

  // Auto-start Stage 3 implementation (step-by-step)
  if (plan) {
    executeStage3Steps(
      updatedSession,
      storage,
      sessionManager,
      resultHandler,
      eventBroadcaster
    ).catch(err => {
      console.error('Stage 3 step execution error:', err);
      eventBroadcaster?.executionStatus(updatedSession.projectId, updatedSession.featureId, 'error', 'stage3_error', { stage: 3 });
    });
  }
}

/**
 * Build a prompt for Stage 2 re-spawn with plan validation context.
 * This prompt asks Claude to complete the missing sections of the plan.
 */
function buildPlanValidationPrompt(missingContext: string): string {
  return `The plan structure is incomplete and needs additional sections before we can proceed to implementation.

${missingContext}

Please review and complete the plan file with all missing sections. Ensure all required sections are properly filled out:
- Meta section with title, description, status, and completedSteps tracking
- Steps array with all implementation steps (id, title, description, status, orderIndex, parentId, complexity, testStrategy)
- Dependencies array mapping step relationships
- TestCoverage section with coverage strategy and target percentage
- AcceptanceMapping linking acceptance criteria to implementing steps

After completing the plan, output [PLAN_APPROVED] to indicate readiness for implementation.`;
}

/**
 * Spawn Stage 3 implementation Claude. Used by:
 * - Auto-start after plan approval
 * - Resume after blocker answers
 * - Manual /transition endpoint
 * @internal Reserved for future Stage 3 implementation
 */
async function _spawnStage3Implementation(
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
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage3_started', { stage: 3, subState: 'spawning_agent' });

  // Save "started" conversation entry immediately
  await resultHandler.saveConversationStart(sessionDir, 3, prompt);

  // Track current step for real-time broadcasting
  let currentStepId: string | null = null;
  let hasReceivedOutput = false;

  // Spawn Claude with Stage 3 tools (includes Bash for git)
  orchestrator.spawn({
    prompt,
    projectPath: session.projectPath,
    sessionId: session.claudeSessionId || undefined,
    allowedTools: orchestrator.getStageTools(3),
    onOutput: (output, isComplete) => {
      // Broadcast processing_output on first output received
      if (!hasReceivedOutput) {
        hasReceivedOutput = true;
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage3_started', { stage: 3, subState: 'processing_output' });
      }
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
    // Broadcast parsing_response before handling result
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage3_started', { stage: 3, subState: 'parsing_response' });

    // Handle Stage 3 result
    const { hasBlocker, implementationComplete } = await resultHandler.handleStage3Result(session, result, prompt);

    // Broadcast saving_results before broadcasting events
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage3_started', { stage: 3, subState: 'saving_results' });

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

    eventBroadcaster?.executionStatus(session.projectId, session.featureId, finalStatus, finalAction, { stage: 3 });

    // Handle Stage 3→4 transition when implementation complete
    if (implementationComplete) {
      await handleStage3Completion(session, sessionDir, storage, sessionManager, resultHandler, eventBroadcaster, result);
    }

    console.log(`Stage 3 ${implementationComplete ? 'completed' : (hasBlocker ? 'blocked' : 'in progress')} for ${session.featureId}`);
  }).catch((error) => {
    console.error(`Stage 3 spawn error for ${session.featureId}:`, error);
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage3_spawn_error', { stage: 3 });
  });
}

/**
 * Compute a hash of step content (title + description) for change detection.
 * Used to skip re-implementation of steps that haven't changed.
 */
function computeStepContentHash(step: PlanStep): string {
  const content = `${step.title}|${step.description || ''}`;
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 12);
}

/**
 * Check if a step's content has changed since it was last completed.
 * Returns true if the step should be skipped (content unchanged).
 */
function shouldSkipUnchangedStep(step: PlanStep): boolean {
  if (!step.contentHash) return false;  // No hash = never completed, don't skip
  const currentHash = computeStepContentHash(step);
  return step.contentHash === currentHash;
}

/**
 * Get the next step ready for execution (respects dependencies).
 */
function getNextReadyStep(plan: Plan): PlanStep | null {
  return plan.steps.find(step =>
    step.status === 'pending' &&
    (step.parentId === null ||
      plan.steps.find(p => p.id === step.parentId)?.status === 'completed')
  ) || null;
}

/**
 * Get completed steps with their summaries for prompt context.
 */
function getCompletedStepsSummary(plan: Plan): Array<{ id: string; title: string; summary: string }> {
  return plan.steps
    .filter(step => step.status === 'completed')
    .map(step => ({
      id: step.id,
      title: step.title,
      summary: (step.metadata?.completionSummary as string) || 'Completed',
    }));
}

/**
 * Execute a single step of Stage 3 implementation.
 * Returns after the step completes or is blocked.
 */
async function executeSingleStep(
  session: Session,
  plan: Plan,
  step: PlanStep,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined,
  resumeContext?: string
): Promise<{ stepCompleted: boolean; hasBlocker: boolean; sessionId: string | null }> {
  const sessionDir = `${session.projectId}/${session.featureId}`;
  const statusPath = `${sessionDir}/status.json`;

  // Check if step content has changed since last completion
  // If unchanged, skip re-implementation and mark as completed
  if (shouldSkipUnchangedStep(step)) {
    console.log(`Skipping step [${step.id}] - content unchanged (hash: ${step.contentHash})`);

    // Mark step as completed (preserve existing completion data)
    step.status = 'completed';
    await storage.writeJson(`${sessionDir}/plan.json`, plan);

    // Broadcast step skipped/completed
    eventBroadcaster?.stepCompleted(session.projectId, session.featureId, step, 'Skipped - unchanged', []);

    return { stepCompleted: true, hasBlocker: false, sessionId: session.claudeStage3SessionId || null };
  }

  // Update currentStepId in status
  const status = await storage.readJson<Record<string, unknown>>(statusPath);
  if (status) {
    status.currentStepId = step.id;
    status.lastAction = 'step_started';
    status.lastActionAt = new Date().toISOString();
    await storage.writeJson(statusPath, status);
  }

  // Build prompt for this single step
  // Use lean prompt for steps 2+ (when we have a Stage 3 session to resume)
  const completedSteps = getCompletedStepsSummary(plan);
  const testsRequired = plan.testRequirement?.required ?? true;
  const useLeanPrompt = session.claudeStage3SessionId !== null && completedSteps.length > 0;

  let prompt = useLeanPrompt
    ? buildSingleStepPromptLean(step, completedSteps, testsRequired)
    : buildSingleStepPrompt(session, plan, step, completedSteps);

  // Add resume context if this is a resume after blocker answer
  if (resumeContext) {
    prompt = `${resumeContext}\n\n---\n\n${prompt}`;
  }

  // Broadcast step started
  eventBroadcaster?.stepStarted(session.projectId, session.featureId, step.id);

  // Save "started" conversation entry
  await resultHandler.saveConversationStart(sessionDir, 3, prompt, step.id);

  // Capture HEAD SHA before spawning Claude for deterministic completion verification
  const preStepCommitSha = await getHeadCommitSha(session.projectPath);

  // Determine which sessionId to use
  // First step of Stage 3: don't resume (fresh session)
  // Subsequent steps: resume with Stage 3 sessionId
  const sessionIdToUse = session.claudeStage3SessionId || undefined;

  console.log(`Executing step [${step.id}] ${step.title} for ${session.featureId}${sessionIdToUse ? ' (resuming session)' : ' (fresh session)'}`);

  // Broadcast spawning_agent sub-state
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage3_progress', { stage: 3, stepId: step.id, subState: 'spawning_agent' });

  let hasReceivedOutput = false;
  return new Promise((resolve, reject) => {
    orchestrator.spawn({
      prompt,
      projectPath: session.projectPath,
      sessionId: sessionIdToUse,
      allowedTools: orchestrator.getStageTools(3),
      onOutput: (output, isComplete) => {
        // Broadcast processing_output on first output received
        if (!hasReceivedOutput) {
          hasReceivedOutput = true;
          eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage3_progress', { stage: 3, stepId: step.id, subState: 'processing_output' });
        }
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

          eventBroadcaster.implementationProgress(session.projectId, session.featureId, {
            stepId: step.id,
            status: getValue('status'),
            filesModified: [],
            testsStatus: getValue('tests_status') || null,
            retryCount: parseInt(getValue('retry_count') || '0', 10) || 0,
            message: getValue('message'),
          });
        }
      },
    }).then(async (result) => {
      // Broadcast parsing_response before handling result
      eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage3_progress', { stage: 3, stepId: step.id, subState: 'parsing_response' });

      // Capture sessionId from first spawn (for subsequent steps)
      const capturedSessionId = result.sessionId;

      // If this is the first step (no claudeStage3SessionId), save the new sessionId
      if (!session.claudeStage3SessionId && capturedSessionId) {
        await sessionManager.updateSession(session.projectId, session.featureId, {
          claudeStage3SessionId: capturedSessionId,
        });
        // Update local session object for next iteration
        session.claudeStage3SessionId = capturedSessionId;
      }

      // Handle Stage 3 result with stepId and pre-step commit SHA for git-based verification
      const { hasBlocker, implementationComplete: _implementationComplete } = await resultHandler.handleStage3Result(
        session, result, prompt, step.id, preStepCommitSha || undefined
      );

      // Broadcast validating_output before checking completion
      eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage3_progress', { stage: 3, stepId: step.id, subState: 'validating_output' });

      // Check if this step was completed
      const stepCompleted = result.parsed.stepsCompleted.some(s => s.id === step.id);

      // If step not completed and no blocker detected, try Haiku post-processing
      // to extract any implicit blockers from Claude's output
      if (!stepCompleted && !hasBlocker && result.output.length > 100) {
        console.log(`Step ${step.id} incomplete without blocker, attempting Haiku extraction for ${session.featureId}`);

        const extractionResult = await haikuPostProcessor.smartExtract(
          result.output,
          session.projectPath,
          {
            stage: 3,
            hasDecisions: result.parsed.decisions.length > 0,
            hasPlanSteps: false,
            hasImplementationStatus: result.parsed.implementationStatus !== null,
            hasPRCreated: false,
          }
        );

        // If Haiku found blockers, redirect to Stage 2 with blocker context
        if (extractionResult.questions && extractionResult.questions.length > 0) {
          console.log(`Haiku extracted ${extractionResult.questions.length} blocker(s) from incomplete step ${step.id}, redirecting to Stage 2`);

          // Build blocker context for Stage 2
          const blockerSummary = extractionResult.questions
            .map((q, i) => `${i + 1}. ${q.questionText}`)
            .join('\n');

          const blockerContext = `Step ${step.id} (${step.title}) encountered the following issue(s) that need to be addressed in the plan:\n\n${blockerSummary}\n\nPlease review and update the plan to address these issues. You may need to:\n1. Add prerequisite steps\n2. Provide more detailed instructions\n3. Break this step into smaller steps\n4. Clarify any ambiguous requirements`;

          // Transition to Stage 2
          const previousStage = session.currentStage;
          const updatedSession = await sessionManager.transitionStage(
            session.projectId, session.featureId, 2
          );
          eventBroadcaster?.stageChanged(updatedSession, previousStage);
          eventBroadcaster?.executionStatus(
            session.projectId, session.featureId, 'idle', 'stage2_blocker_review', { stage: 2 }
          );

          // Spawn Stage 2 review with blocker context
          spawnStage2Review(
            updatedSession,
            storage,
            sessionManager,
            resultHandler,
            eventBroadcaster,
            blockerContext
          );

          resolve({
            stepCompleted: false,
            hasBlocker: true,
            sessionId: capturedSessionId,
          });
          return;
        }

        // No blocker found - retry the step with additional context
        console.log(`Step ${step.id} incomplete with no extractable blocker, retrying with context for ${session.featureId}`);

        // Track retry count
        const statusPath3 = `${sessionDir}/status.json`;
        const status3 = await storage.readJson<Record<string, unknown>>(statusPath3);
        const stepRetries = (status3?.stepRetries as Record<string, number>) || {};
        const currentRetries = stepRetries[step.id] || 0;

        if (currentRetries >= 2) {
          // Max retries reached - now go to Stage 2 for replanning
          console.log(`Step ${step.id} failed after ${currentRetries + 1} attempts, returning to Stage 2`);

          const planPath = `${sessionDir}/plan.json`;
          const currentPlan = await storage.readJson<Plan>(planPath);
          if (currentPlan) {
            const stepToUpdate = currentPlan.steps.find(s => s.id === step.id);
            if (stepToUpdate) {
              stepToUpdate.status = 'needs_review';
              stepToUpdate.metadata = {
                ...stepToUpdate.metadata,
                incompleteReason: `Step failed after ${currentRetries + 1} attempts`,
                lastOutput: result.output.slice(-500),
              };
              await storage.writeJson(planPath, currentPlan);
            }
          }

          resolve({
            stepCompleted: false,
            hasBlocker: false,
            sessionId: capturedSessionId,
          });
          return;
        }

        // Update retry count
        stepRetries[step.id] = currentRetries + 1;
        if (status3) {
          status3.stepRetries = stepRetries;
          status3.lastAction = 'step_retry';
          status3.lastActionAt = new Date().toISOString();
          await storage.writeJson(statusPath3, status3);
        }

        // Build retry context from the incomplete output
        const retryContext = `Previous attempt did not complete successfully. Here's what happened:\n\n${result.output.slice(-1000)}\n\nPlease complete this step. Make sure to:\n1. Finish any incomplete work\n2. Run tests if applicable\n3. Commit your changes with "Step ${step.id}: <description>"`;

        console.log(`Retrying step ${step.id} (attempt ${currentRetries + 2}) for ${session.featureId}`);

        // Re-execute the step with retry context
        const retryResult = await executeSingleStep(
          session, plan, step, storage, sessionManager,
          resultHandler, eventBroadcaster, retryContext
        );

        resolve(retryResult);
        return;
      }

      // Broadcast step completed if applicable
      if (stepCompleted && eventBroadcaster) {
        // Broadcast saving_results before broadcasting completion events
        eventBroadcaster.executionStatus(session.projectId, session.featureId, 'running', 'stage3_progress', { stage: 3, stepId: step.id, subState: 'saving_results' });

        const completedStep = result.parsed.stepsCompleted.find(s => s.id === step.id);
        eventBroadcaster.stepCompleted(
          session.projectId,
          session.featureId,
          step,
          completedStep?.summary || '',
          []
        );

        // Reload and broadcast updated plan
        const updatedPlan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
        if (updatedPlan) {
          eventBroadcaster.planUpdated(session.projectId, session.featureId, updatedPlan);
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

      resolve({
        stepCompleted,
        hasBlocker,
        sessionId: capturedSessionId,
      });
    }).catch((error) => {
      console.error(`Step ${step.id} spawn error for ${session.featureId}:`, error);
      eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'step_spawn_error', { stage: 3, stepId: step.id });
      reject(error);
    });
  });
}

/**
 * Execute Stage 3 steps one at a time.
 * Main orchestration loop that processes steps sequentially.
 */
async function executeStage3Steps(
  session: Session,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined,
  resumeStepId?: string,
  resumeContext?: string
): Promise<void> {
  // Acquire lock to prevent concurrent executions
  if (!acquireStage3Lock(session.projectId, session.featureId)) {
    return; // Another execution is already in progress
  }

  try {
    const sessionDir = `${session.projectId}/${session.featureId}`;

    // Load current plan
    let plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
    if (!plan) {
      console.error(`No plan found for ${session.featureId}`);
      return;
    }

    console.log(`Starting Stage 3 step-by-step execution for ${session.featureId}`);

  // Convert any 'needs_review' steps to 'pending' at the start of Stage 3
  // This handles the transition from Stage 2 planning to Stage 3 implementation
  let stepsConverted = false;
  for (const step of plan.steps) {
    if (step.status === 'needs_review') {
      step.status = 'pending';
      stepsConverted = true;
    }
  }
  if (stepsConverted) {
    await storage.writeJson(`${sessionDir}/plan.json`, plan);
    console.log(`Converted needs_review steps to pending for ${session.featureId}`);
  }

  // If resuming a specific step (after blocker answer), find and execute that step
  if (resumeStepId) {
    const resumeStep = plan.steps.find(s => s.id === resumeStepId);
    if (resumeStep && resumeStep.status !== 'completed') {
      console.log(`Resuming step [${resumeStepId}] after blocker answer`);
      const result = await executeSingleStep(
        session, plan, resumeStep, storage, sessionManager,
        resultHandler, eventBroadcaster, resumeContext
      );

      if (result.hasBlocker) {
        // Still blocked - wait for user
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage3_blocked', { stage: 3 });
        return;
      }

      // Reload plan after step execution
      plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
      if (!plan) return;
    }
  }

  // Main execution loop - process steps one at a time
  let hasMoreSteps = true;
  while (hasMoreSteps && plan) {
    const nextStep = getNextReadyStep(plan);

    if (!nextStep) {
      // Check if all steps are completed
      const allCompleted = plan.steps.every(s => s.status === 'completed');
      if (allCompleted) {
        console.log(`All steps completed for ${session.featureId}, transitioning to Stage 4`);

        // Trigger Stage 3→4 transition
        await handleStage3Completion(
          session, sessionDir, storage, sessionManager,
          resultHandler, eventBroadcaster, null
        );
      } else {
        // Some steps are blocked or have unmet dependencies
        console.log(`No more steps ready for ${session.featureId}, waiting for user input`);
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage3_waiting', { stage: 3 });
      }
      hasMoreSteps = false;
      continue;
    }

    // Execute the next step
    const result = await executeSingleStep(
      session, plan, nextStep, storage, sessionManager,
      resultHandler, eventBroadcaster
    );

    if (result.hasBlocker) {
      // Step is blocked - pause and wait for user
      console.log(`Step [${nextStep.id}] blocked, waiting for user input`);
      eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage3_blocked', { stage: 3, stepId: nextStep.id });
      hasMoreSteps = false;
      continue;
    }

    if (!result.stepCompleted) {
      // Step didn't complete - check if it needs review (return to Stage 2)
      const updatedPlan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
      const stepStatus = updatedPlan?.steps.find(s => s.id === nextStep.id)?.status;

      if (stepStatus === 'needs_review') {
        console.log(`Step [${nextStep.id}] needs review, returning to Stage 2 for replanning`);

        // Transition back to Stage 2 for replanning
        const previousStage = session.currentStage;
        const updatedSession = await sessionManager.transitionStage(
          session.projectId, session.featureId, 2
        );
        eventBroadcaster?.stageChanged(updatedSession, previousStage);
        eventBroadcaster?.executionStatus(
          session.projectId, session.featureId, 'idle', 'stage2_replanning_needed', { stage: 2 }
        );

        // Spawn Stage 2 review with context about the failed step
        const failedStepContext = `The following step could not be completed and needs review:\n\nStep ${nextStep.id}: ${nextStep.title}\n\nReason: The step did not complete successfully and no specific blocker was identified. Please review the plan and either:\n1. Provide more detailed instructions for this step\n2. Break it into smaller steps\n3. Identify any missing prerequisites`;

        spawnStage2Review(
          updatedSession,
          storage,
          sessionManager,
          resultHandler,
          eventBroadcaster,
          failedStepContext
        );
      } else {
        console.warn(`Step [${nextStep.id}] did not complete, stopping execution`);
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage3_waiting', { stage: 3, stepId: nextStep.id });
      }
      hasMoreSteps = false;
      continue;
    }

    // Reload plan for next iteration
    plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
    if (!plan) {
      hasMoreSteps = false;
      continue;
    }

    console.log(`Step [${nextStep.id}] completed, checking for next step...`);
  }
  } finally {
    // Always release the lock when done
    releaseStage3Lock(session.projectId, session.featureId);
  }
}

/**
 * Handle Stage 3 completion - transition to Stage 4 when implementation complete
 * Requires all tests to be passing before allowing transition (if tests were required).
 * @param result - Optional ClaudeResult (null when called from step-by-step execution)
 */
async function handleStage3Completion(
  session: Session,
  sessionDir: string,
  storage: FileStorageService,
  sessionManager: SessionManager,
  resultHandler: ClaudeResultHandler,
  eventBroadcaster: EventBroadcaster | undefined,
  result: ClaudeResult | null
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

  if (testsRequired && result) {
    // Verify all tests are passing (REQUIRED for Stage 3→4 transition)
    // Only check if we have a result (from old all-at-once execution)
    if (!result.parsed.allTestsPassing) {
      console.log(`Stage 3 cannot transition: tests required but not passing for ${session.featureId}`);
      return;
    }
    const testsCount = result.parsed.testsAdded.length;
    console.log(`All ${plan.steps.length} steps completed with ${testsCount} tests passing, transitioning to Stage 4 for ${session.featureId}`);
  } else if (testsRequired) {
    // Step-by-step execution: tests are run per-step, trust that they passed
    console.log(`All ${plan.steps.length} steps completed (tests run per-step), transitioning to Stage 4 for ${session.featureId}`);
  } else {
    console.log(`All ${plan.steps.length} steps completed (tests not required: ${plan.testRequirement?.reason}), transitioning to Stage 4 for ${session.featureId}`);
  }

  // Transition to Stage 4
  const previousStage = session.currentStage;
  const updatedSession = await sessionManager.transitionStage(session.projectId, session.featureId, 4);
  eventBroadcaster?.stageChanged(updatedSession, previousStage);

  // Auto-start Stage 4 PR creation
  // Use lean prompt when we have existing session context
  const completedStepsCount = plan.steps.filter(s => s.status === 'completed').length;
  const stage4Prompt = updatedSession.claudeSessionId
    ? buildStage4PromptLean(updatedSession, completedStepsCount)
    : buildStage4Prompt(updatedSession, plan);
  await spawnStage4PRCreation(updatedSession, storage, sessionManager, resultHandler, eventBroadcaster, stage4Prompt);
}

/**
 * Perform deterministic git operations before Stage 4 PR creation.
 * This ensures git state is correct without relying on Claude.
 *
 * Operations performed:
 * 1. Checkout feature branch (create if needed)
 * 2. Stage and commit any uncommitted changes
 * 3. Push to remote with -u flag
 *
 * Returns { success: boolean, error?: string, pushed?: boolean }
 */
async function prepareGitForPR(
  projectPath: string,
  featureBranch: string,
  eventBroadcaster: EventBroadcaster | undefined,
  projectId: string,
  featureId: string
): Promise<{ success: boolean; error?: string; pushed?: boolean }> {
  const { execSync } = await import('child_process');

  const runGit = (cmd: string): string => {
    try {
      return execSync(cmd, { cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (error) {
      const err = error as { stderr?: Buffer; message?: string };
      throw new Error(err.stderr?.toString() || err.message || 'Git command failed');
    }
  };

  try {
    console.log(`[Stage 4] Preparing git state for ${featureId}...`);
    eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'stage4_git_prep', { stage: 4 });

    // 1. Check current branch
    const currentBranch = runGit('git branch --show-current');
    console.log(`[Stage 4] Current branch: ${currentBranch}`);

    // 2. Checkout feature branch if not already on it
    if (currentBranch !== featureBranch) {
      try {
        runGit(`git checkout ${featureBranch}`);
        console.log(`[Stage 4] Checked out ${featureBranch}`);
      } catch {
        // Branch might not exist, create it
        runGit(`git checkout -b ${featureBranch}`);
        console.log(`[Stage 4] Created and checked out ${featureBranch}`);
      }
    }

    // 3. Check for uncommitted changes
    const status = runGit('git status --porcelain');
    if (status) {
      console.log(`[Stage 4] Found uncommitted changes, committing...`);
      runGit('git add -A');
      try {
        runGit('git commit -m "feat: final changes before PR"');
        console.log(`[Stage 4] Committed changes`);
      } catch (e) {
        // Might fail if nothing to commit (all changes already staged)
        console.log(`[Stage 4] Nothing to commit: ${e}`);
      }
    }

    // 4. Push to remote
    console.log(`[Stage 4] Pushing to origin/${featureBranch}...`);
    try {
      runGit(`git push -u origin ${featureBranch}`);
      console.log(`[Stage 4] Pushed to remote`);
    } catch (pushError) {
      // Try force push if regular push fails (e.g., diverged history)
      console.log(`[Stage 4] Regular push failed, trying with --force-with-lease...`);
      runGit(`git push -u origin ${featureBranch} --force-with-lease`);
      console.log(`[Stage 4] Force pushed to remote`);
    }

    console.log(`[Stage 4] Git preparation complete for ${featureId}`);
    return { success: true, pushed: true };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Git preparation failed';
    console.error(`[Stage 4] Git preparation failed for ${featureId}:`, message);
    return { success: false, error: message };
  }
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
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage4_started', { stage: 4, subState: 'spawning_agent' });

  // DETERMINISTIC: Prepare git state before Claude (checkout, commit, push)
  const gitResult = await prepareGitForPR(
    session.projectPath,
    session.featureBranch,
    eventBroadcaster,
    session.projectId,
    session.featureId
  );

  if (!gitResult.success) {
    console.error(`[Stage 4] Git preparation failed, aborting PR creation: ${gitResult.error}`);
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage4_git_error', { stage: 4 });

    const finalStatus = await storage.readJson<Record<string, unknown>>(statusPath);
    if (finalStatus) {
      finalStatus.status = 'error';
      finalStatus.lastAction = 'stage4_git_error';
      finalStatus.lastActionAt = new Date().toISOString();
      finalStatus.lastError = gitResult.error;
      await storage.writeJson(statusPath, finalStatus);
    }
    return;
  }

  // Save "started" conversation entry immediately
  await resultHandler.saveConversationStart(sessionDir, 4, prompt);

  // Spawn Claude with Stage 4 tools (git and gh commands) - git push already done
  let hasReceivedOutput = false;
  orchestrator.spawn({
    prompt,
    projectPath: session.projectPath,
    sessionId: session.claudeSessionId || undefined,
    allowedTools: orchestrator.getStageTools(4),
    onOutput: (output, isComplete) => {
      // Broadcast processing_output on first output received
      if (!hasReceivedOutput) {
        hasReceivedOutput = true;
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage4_started', { stage: 4, subState: 'processing_output' });
      }
      eventBroadcaster?.claudeOutput(session.projectId, session.featureId, output, isComplete);
    },
  }).then(async (result) => {
    // Broadcast parsing_response before handling result
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage4_started', { stage: 4, subState: 'parsing_response' });

    // Save Stage 4 conversation - find and update the "started" entry
    const conversationsPath = `${sessionDir}/conversations.json`;
    const conversations = await storage.readJson<{ entries: Array<{ stage: number; status?: string; [key: string]: unknown }> }>(conversationsPath) || { entries: [] };

    // Find the most recent "started" entry for Stage 4 and update it
    let startedIndex = -1;
    for (let i = conversations.entries.length - 1; i >= 0; i--) {
      if (conversations.entries[i].stage === 4 && conversations.entries[i].status === 'started') {
        startedIndex = i;
        break;
      }
    }

    const entryData = {
      stage: 4,
      timestamp: new Date().toISOString(),
      prompt: prompt,
      output: result.output,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      isError: result.isError,
      parsed: result.parsed,
      status: 'completed' as const,
    };

    if (startedIndex !== -1) {
      conversations.entries[startedIndex] = entryData;
    } else {
      conversations.entries.push(entryData);
    }
    await storage.writeJson(conversationsPath, conversations);

    // Broadcast validating_output before verifying PR
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage4_started', { stage: 4, subState: 'validating_output' });

    // Verify PR creation using gh pr list command instead of parsing markers
    // This is more reliable than relying on Claude's output markers
    const prInfo = await verifyPRCreation(session.projectPath, session.projectId, session.featureId);

    if (prInfo) {
      // Broadcast saving_results before saving PR info
      eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage4_started', { stage: 4, subState: 'saving_results' });

      // Save PR info
      await storage.writeJson(`${sessionDir}/pr.json`, prInfo);

      // Save PR URL to session
      const sessionPath = `${sessionDir}/session.json`;
      const sessionData = await storage.readJson<Session>(sessionPath);
      if (sessionData) {
        sessionData.prUrl = prInfo.url;
        sessionData.updatedAt = new Date().toISOString();
        await storage.writeJson(sessionPath, sessionData);
      }

      console.log(`PR verified: ${prInfo.url || prInfo.title}`);

      // Broadcast PR created event
      eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage4_complete', { stage: 4 });

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
        const stage5Prompt = updatedSession.claudeSessionId
          ? buildStage5PromptLean(prInfo)
          : buildStage5Prompt(updatedSession, plan, prInfo);
        await spawnStage5PRReview(updatedSession, storage, sessionManager, resultHandler, eventBroadcaster, stage5Prompt);
      }
    } else {
      console.log(`Stage 4 completed but no PR found via gh pr list for ${session.featureId}`);

      eventBroadcaster?.executionStatus(
        session.projectId,
        session.featureId,
        'error',
        'stage4_no_pr_found',
        { stage: 4 }
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
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage4_spawn_error', { stage: 4 });
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
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage5_started', { stage: 5, subState: 'spawning_agent' });

  // Save "started" conversation entry immediately
  await resultHandler.saveConversationStart(sessionDir, 5, prompt);

  // Spawn Claude with Stage 5 tools
  let hasReceivedOutput = false;
  orchestrator.spawn({
    prompt,
    projectPath: session.projectPath,
    sessionId: session.claudeSessionId || undefined,
    allowedTools: orchestrator.getStageTools(5),
    onOutput: (output, isComplete) => {
      // Broadcast processing_output on first output received
      if (!hasReceivedOutput) {
        hasReceivedOutput = true;
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage5_started', { stage: 5, subState: 'processing_output' });
      }
      eventBroadcaster?.claudeOutput(session.projectId, session.featureId, output, isComplete);
    },
  }).then(async (result) => {
    // Broadcast parsing_response before handling result
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage5_started', { stage: 5, subState: 'parsing_response' });

    // Handle Stage 5 result
    await handleStage5Result(session, result, sessionDir, prompt, storage, sessionManager, resultHandler, eventBroadcaster);
  }).catch((error) => {
    console.error(`Stage 5 spawn error for ${session.featureId}:`, error);
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage5_spawn_error', { stage: 5 });
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

  // Broadcast saving_results before saving conversation
  eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage5_started', { stage: 5, subState: 'saving_results' });

  // Save Stage 5 conversation - find and update the "started" entry
  const conversationsPath = `${sessionDir}/conversations.json`;
  const conversations = await storage.readJson<{ entries: Array<{ stage: number; status?: string; [key: string]: unknown }> }>(conversationsPath) || { entries: [] };

  // Find the most recent "started" entry for Stage 5 and update it
  let startedIndex = -1;
  for (let i = conversations.entries.length - 1; i >= 0; i--) {
    if (conversations.entries[i].stage === 5 && conversations.entries[i].status === 'started') {
      startedIndex = i;
      break;
    }
  }

  const entryData = {
    stage: 5,
    timestamp: new Date().toISOString(),
    prompt: prompt,
    output: result.output,
    sessionId: result.sessionId,
    costUsd: result.costUsd,
    isError: result.isError,
    parsed: result.parsed,
    status: 'completed' as const,
  };

  if (startedIndex !== -1) {
    conversations.entries[startedIndex] = entryData;
  } else {
    conversations.entries.push(entryData);
  }
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

  // Check for PR approval - transition to Stage 6 for user final approval
  if (result.parsed.prApproved) {
    console.log(`PR approved by Claude for ${session.featureId}, transitioning to Stage 6 for user final approval`);

    // Transition to Stage 6
    const previousStage = session.currentStage;
    const updatedSession = await sessionManager.transitionStage(session.projectId, session.featureId, 6);

    // Update status
    const finalStatus = await storage.readJson<Record<string, unknown>>(statusPath);
    if (finalStatus) {
      finalStatus.currentStage = 6;
      finalStatus.status = 'idle';
      finalStatus.lastAction = 'stage6_awaiting_approval';
      finalStatus.lastActionAt = new Date().toISOString();
      await storage.writeJson(statusPath, finalStatus);
    }

    eventBroadcaster?.stageChanged(updatedSession, previousStage);
    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage6_awaiting_approval', { stage: 6 });
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

    eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'idle', 'stage5_awaiting_user', { stage: 5 });
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
    result.isError ? 'stage5_error' : 'stage5_complete',
    { stage: 5 }
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
  // Use lean prompt for iteration 2+ when resuming an existing session
  const currentIteration = (plan.reviewCount || 0) + 1;
  const useLean = updatedSession.claudeSessionId && currentIteration > 1;
  const prompt = useLean
    ? buildStage2PromptLean(plan, currentIteration, updatedSession.planValidationContext, updatedSession.claudePlanFilePath)
    : buildStage2Prompt(updatedSession, plan, currentIteration);
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

  // Serve built frontend static files
  const clientDistPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDistPath));

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
      eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage1_started', { stage: 1, subState: 'spawning_agent' });

      // Save "started" conversation entry immediately
      const sessionDir = `${session.projectId}/${session.featureId}`;
      await resultHandler.saveConversationStart(sessionDir, 1, prompt);

      // Spawn Claude (fire and forget, errors logged)
      let hasReceivedOutput = false;
      orchestrator.spawn({
        prompt,
        projectPath: session.projectPath,
        allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
        onOutput: (output, isComplete) => {
          // Broadcast processing_output on first output received
          if (!hasReceivedOutput) {
            hasReceivedOutput = true;
            eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage1_started', { stage: 1, subState: 'processing_output' });
          }
          eventBroadcaster?.claudeOutput(session.projectId, session.featureId, output, isComplete);
        },
      }).then(async (result) => {
        // Broadcast parsing_response before handling result
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage1_started', { stage: 1, subState: 'parsing_response' });

        // Use ClaudeResultHandler to save all parsed data
        await resultHandler.handleStage1Result(session, result, prompt);

        // Broadcast validating_output before Haiku post-processing
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage1_started', { stage: 1, subState: 'validating_output' });

        // Apply Haiku fallback if no decisions were parsed but output looks like questions
        const extractedCount = await applyHaikuPostProcessing(result, session.projectPath, storage, session, resultHandler);

        // Broadcast saving_results before broadcasting events
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'running', 'stage1_started', { stage: 1, subState: 'saving_results' });

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
            result.isError ? 'stage1_error' : 'stage1_complete',
            { stage: 1 }
          );
        }

        // Check for auto Stage 1→2 transition when plan file is created
        if (!result.isError) {
          await handleStage1Completion(session, result, storage, sessionManager, resultHandler, eventBroadcaster);
        }

        console.log(`Stage 1 ${result.isError ? 'failed' : 'completed'} for ${session.featureId}${extractedCount > 0 ? ` (${extractedCount} questions via Haiku)` : ''}`);
      }).catch((error) => {
        console.error(`Stage 1 spawn error for ${session.featureId}:`, error);
        eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage1_spawn_error', { stage: 1 });
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
        const useLean = session.claudeSessionId && currentIteration > 1;
        const prompt = useLean
          ? buildStage2PromptLean(plan, currentIteration, session.planValidationContext, session.claudePlanFilePath)
          : buildStage2Prompt(session, plan, currentIteration);
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

        // Start Stage 3 step-by-step execution
        executeStage3Steps(session, storage, sessionManager, resultHandler, eventBroadcaster)
          .catch(err => {
            console.error('Stage 3 step execution error:', err);
            eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage3_error');
          });
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
        const completedCount = plan.steps.filter(s => s.status === 'completed').length;
        const prompt = session.claudeSessionId
          ? buildStage4PromptLean(session, completedCount)
          : buildStage4Prompt(session, plan);
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
        const prompt = session.claudeSessionId
          ? buildStage5PromptLean(prInfo)
          : buildStage5Prompt(session, plan, prInfo);
        await spawnStage5PRReview(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to transition stage';
      res.status(400).json({ error: message });
    }
  });

  // Stage 6: Final approval actions (merge, plan_changes, re_review)
  app.post('/api/sessions/:projectId/:featureId/final-approval', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const { action, feedback } = req.body as { action: 'merge' | 'plan_changes' | 're_review'; feedback?: string };

      if (!['merge', 'plan_changes', 're_review'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action. Must be: merge, plan_changes, or re_review' });
      }

      const session = await sessionManager.getSession(projectId, featureId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (session.currentStage !== 6) {
        return res.status(400).json({ error: 'Session is not in Stage 6 (Final Approval)' });
      }

      const sessionDir = `${projectId}/${featureId}`;
      const previousStage = session.currentStage;

      if (action === 'merge') {
        // Mark session as completed
        const updatedSession = await sessionManager.updateSession(projectId, featureId, {
          status: 'completed',
        });

        // Update status.json
        const statusPath = `${sessionDir}/status.json`;
        const status = await storage.readJson<Record<string, unknown>>(statusPath);
        if (status) {
          status.status = 'idle';
          status.lastAction = 'session_completed';
          status.lastActionAt = new Date().toISOString();
          if (feedback) {
            status.completionNotes = feedback;
          }
          await storage.writeJson(statusPath, status);
        }

        eventBroadcaster?.executionStatus(projectId, featureId, 'idle', 'session_completed', { stage: 6 });

        console.log(`Session ${featureId} marked as completed by user`);
        res.json({ success: true, session: updatedSession });

      } else if (action === 'plan_changes') {
        // Return to Stage 2 for plan changes
        if (!feedback) {
          return res.status(400).json({ error: 'Feedback is required when requesting plan changes' });
        }

        const updatedSession = await sessionManager.transitionStage(projectId, featureId, 2);

        eventBroadcaster?.stageChanged(updatedSession, previousStage);

        // Build Stage 2 prompt with user's feedback
        const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
        if (plan) {
          const _currentIteration = (plan.reviewCount || 0) + 1; // Track iteration for future use
          const prompt = buildPlanRevisionPrompt(updatedSession, plan, feedback);
          await spawnStage2Review(updatedSession, storage, sessionManager, resultHandler, eventBroadcaster, prompt);
        }

        console.log(`Session ${featureId} returned to Stage 2 for plan changes`);
        res.json({ success: true, session: updatedSession });

      } else if (action === 're_review') {
        // Return to Stage 5 for another PR review
        if (!feedback) {
          return res.status(400).json({ error: 'Feedback is required when requesting re-review' });
        }

        const updatedSession = await sessionManager.transitionStage(projectId, featureId, 5);

        eventBroadcaster?.stageChanged(updatedSession, previousStage);

        // Spawn Stage 5 PR review with user's focus areas
        const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
        if (!plan) {
          return res.status(400).json({ error: 'Plan not found for re-review' });
        }

        // Get PR info for the prompt
        const prInfo = {
          url: updatedSession.prUrl || '',
          title: updatedSession.title,
          branch: updatedSession.featureBranch,
        };

        const basePrompt = updatedSession.claudeSessionId
          ? buildStage5PromptLean(prInfo)
          : buildStage5Prompt(updatedSession, plan, prInfo);
        const prompt = basePrompt + `

## Additional Focus Areas (User Request)
${feedback}

Please pay special attention to the above areas during your review.`;
        spawnStage5PRReview(updatedSession, storage, sessionManager, resultHandler, eventBroadcaster, prompt);

        console.log(`Session ${featureId} returned to Stage 5 for re-review`);
        res.json({ success: true, session: updatedSession });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process final approval action';
      console.error('Final approval error:', error);
      res.status(500).json({ error: message });
    }
  });

  // Get plan (optionally include validation status via ?validate=true query param)
  app.get('/api/sessions/:projectId/:featureId/plan', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const includeValidation = req.query.validate === 'true';

      const plan = await storage.readJson(`${projectId}/${featureId}/plan.json`);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      // If validation requested, include validation result in response
      if (includeValidation) {
        const validationResult = planCompletionChecker.checkPlanCompletenessSync(plan);
        return res.json({
          plan,
          validation: {
            complete: validationResult.complete,
            validationResult: validationResult.validationResult,
            missingContext: validationResult.missingContext || null,
          },
        });
      }

      res.json(plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get plan';
      res.status(500).json({ error: message });
    }
  });

  // Get plan validation status
  // Returns detailed validation status for each section of the composable plan
  app.get('/api/sessions/:projectId/:featureId/plan/validation', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const sessionDir = `${projectId}/${featureId}`;

      // Read plan from storage and validate synchronously
      const plan = await storage.readJson(`${sessionDir}/plan.json`);
      const result = planCompletionChecker.checkPlanCompletenessSync(plan);

      res.json({
        complete: result.complete,
        validationResult: result.validationResult,
        missingContext: result.missingContext || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate plan';
      res.status(500).json({ error: message });
    }
  });

  // Trigger plan re-validation
  // Reads the current plan and validates it, returning the result
  // Useful after manual plan edits or to refresh validation status
  app.post('/api/sessions/:projectId/:featureId/plan/revalidate', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;
      const sessionDir = `${projectId}/${featureId}`;

      // Read the current plan
      const plan = await storage.readJson(`${sessionDir}/plan.json`);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      // Validate the plan synchronously (plan is already loaded)
      const result = planCompletionChecker.checkPlanCompletenessSync(plan);

      // If plan has validationStatus field (ComposablePlan), update it with latest results
      if ('validationStatus' in (plan as Record<string, unknown>)) {
        const updatedPlan = {
          ...plan,
          validationStatus: {
            meta: result.validationResult.meta.valid,
            steps: result.validationResult.steps.valid,
            dependencies: result.validationResult.dependencies.valid,
            testCoverage: result.validationResult.testCoverage.valid,
            acceptanceMapping: result.validationResult.acceptanceMapping.valid,
            overall: result.validationResult.overall,
            errors: {
              ...(result.validationResult.meta.errors.length > 0 ? { meta: result.validationResult.meta.errors } : {}),
              ...(result.validationResult.steps.errors.length > 0 ? { steps: result.validationResult.steps.errors } : {}),
              ...(result.validationResult.dependencies.errors.length > 0 ? { dependencies: result.validationResult.dependencies.errors } : {}),
              ...(result.validationResult.testCoverage.errors.length > 0 ? { testCoverage: result.validationResult.testCoverage.errors } : {}),
              ...(result.validationResult.acceptanceMapping.errors.length > 0 ? { acceptanceMapping: result.validationResult.acceptanceMapping.errors } : {}),
            },
          },
        };

        // Save the updated plan with validation status
        await storage.writeJson(`${sessionDir}/plan.json`, updatedPlan);

        // Also update session's planValidationContext if incomplete
        const session = await sessionManager.getSession(projectId, featureId);
        if (session) {
          await sessionManager.updateSession(projectId, featureId, {
            planValidationContext: result.complete ? null : result.missingContext,
          });
        }
      }

      res.json({
        complete: result.complete,
        validationResult: result.validationResult,
        missingContext: result.missingContext || null,
        updated: 'validationStatus' in (plan as Record<string, unknown>),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revalidate plan';
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
            const prompt = buildBatchAnswersContinuationPrompt(batchQuestions, session.currentStage, session.claudePlanFilePath);
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
            eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'batch_answers_resume', { stage: session.currentStage, subState: 'spawning_agent' });

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
              const { allFiltered } = await resultHandler.handleStage2Result(session, result, prompt);
              await resultHandler.incrementReviewCount(sessionDir);
              // Auto-approve plan if all questions were filtered as false positives
              if (allFiltered && result.parsed.decisions.length > 0) {
                console.log(`All ${result.parsed.decisions.length} question(s) filtered - auto-approving plan for ${featureId}`);
                result.parsed.planApproved = true;
              }
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
                result.isError ? 'batch_resume_error' : 'batch_resume_complete',
                { stage: session.currentStage }
              );
            }

            console.log(`Batch resume ${result.isError ? 'failed' : 'completed'} for ${featureId}${extractedCount > 0 ? ` (${extractedCount} questions via Haiku)` : ''}`);
          }
        } catch (error) {
          console.error(`Batch resume error for ${featureId}:`, error);
          eventBroadcaster?.executionStatus(projectId, featureId, 'error', 'batch_resume_error', { stage: session.currentStage });
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
      const { answers, remarks } = req.body as {
        answers: Array<{ questionId: string; answer: { value?: string; text?: string; values?: string[] } }>;
        remarks?: string;
      };

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
          console.log(`All ${answeredQuestions.length} questions answered via batch, resuming Claude${remarks ? ' (with remarks)' : ''}`);

          const prompt = buildBatchAnswersContinuationPrompt(answeredQuestions, session.currentStage, session.claudePlanFilePath, remarks);
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
          eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'batch_answers_resume', { stage: session.currentStage, subState: 'spawning_agent' });

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
            const { allFiltered } = await resultHandler.handleStage2Result(session, result, prompt);
            await resultHandler.incrementReviewCount(sessionDir);
            // Auto-approve plan if all questions were filtered as false positives
            if (allFiltered && result.parsed.decisions.length > 0) {
              console.log(`All ${result.parsed.decisions.length} question(s) filtered - auto-approving plan for ${featureId}`);
              result.parsed.planApproved = true;
            }
            await handleStage2Completion(session, result, sessionDir, storage, sessionManager, resultHandler, eventBroadcaster);
          } else if (session.currentStage === 3) {
            // Stage 3: Resume step-by-step execution after blocker answer
            // Get the blocked step from status.json or from the answered question's stepId
            const status = await storage.readJson<{ blockedStepId?: string | null }>(statusPath);
            const blockedStepId = status?.blockedStepId ||
              answeredQuestions.find(q => q.stepId)?.stepId;

            if (blockedStepId) {
              const resumeContext = `The user answered your blocker question:

${answeredQuestions.map(q => `**Q:** ${q.questionText}\n**A:** ${typeof q.answer?.value === 'string' ? q.answer.value : JSON.stringify(q.answer?.value)}`).join('\n\n')}

Continue implementing step [${blockedStepId}].`;

              // Use step-by-step execution with resume
              executeStage3Steps(
                session,
                storage,
                sessionManager,
                resultHandler,
                eventBroadcaster,
                blockedStepId,
                resumeContext
              ).catch(err => {
                console.error('Stage 3 step execution error:', err);
                eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage3_error', { stage: 3 });
              });
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
              result.isError ? 'batch_resume_error' : 'batch_resume_complete',
              { stage: session.currentStage }
            );
          }

          console.log(`Batch resume ${result.isError ? 'failed' : 'completed'} for ${featureId}${extractedCount > 0 ? ` (${extractedCount} questions via Haiku)` : ''}`);
        } catch (error) {
          console.error(`Batch resume error for ${featureId}:`, error);
          eventBroadcaster?.executionStatus(projectId, featureId, 'error', 'batch_resume_error', { stage: session.currentStage });
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

      // Auto-start Stage 3 step-by-step execution
      executeStage3Steps(
        updatedSession,
        storage,
        sessionManager,
        resultHandler,
        eventBroadcaster
      ).catch(err => {
        console.error('Stage 3 step execution error:', err);
        eventBroadcaster?.executionStatus(updatedSession.projectId, updatedSession.featureId, 'error', 'stage3_error', { stage: 3 });
      });

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
      eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'plan_revision_started', { stage: 2, subState: 'spawning_agent' });

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
        const { allFiltered } = await resultHandler.handleStage2Result(session, result, prompt);

        // Increment review count
        await resultHandler.incrementReviewCount(sessionDir);

        // Broadcast events
        if (eventBroadcaster) {
          // Broadcast questions if any (unless all were filtered)
          if (result.parsed.decisions.length > 0 && !allFiltered) {
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
            result.isError ? 'plan_revision_error' : 'plan_revision_complete',
            { stage: 2 }
          );
        }

        // Auto-approve plan if all questions were filtered as false positives
        if (allFiltered && result.parsed.decisions.length > 0) {
          console.log(`All ${result.parsed.decisions.length} question(s) filtered - auto-approving plan for ${featureId}`);
          result.parsed.planApproved = true;
        }

        // Check for auto Stage 2→3 transition if plan was approved after revision
        await handleStage2Completion(session, result, sessionDir, storage, sessionManager, resultHandler, eventBroadcaster);

        console.log(`Plan revision ${result.isError ? 'failed' : 'completed'} for ${featureId}`);
      }).catch((error) => {
        console.error(`Plan revision spawn error for ${featureId}:`, error);
        eventBroadcaster?.executionStatus(projectId, featureId, 'error', 'plan_revision_spawn_error', { stage: 2 });
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

  // Restart Stage 3 execution (for stuck sessions)
  app.post('/api/sessions/:projectId/:featureId/restart-stage3', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;

      // Get session
      const session = await sessionManager.getSession(projectId, featureId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Verify we're in Stage 3
      if (session.currentStage !== 3) {
        return res.status(400).json({ error: `Session is at Stage ${session.currentStage}, not Stage 3` });
      }

      const sessionDir = `${projectId}/${featureId}`;

      // Read plan
      const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
      if (!plan) {
        return res.status(404).json({ error: 'No plan found' });
      }

      // Verify plan is approved
      if (!plan.isApproved) {
        return res.status(400).json({ error: 'Plan not approved' });
      }

      // Return success immediately
      res.json({ message: 'Stage 3 execution restarted', featureId });

      // Start Stage 3 step-by-step execution (fire-and-forget)
      executeStage3Steps(session, storage, sessionManager, resultHandler, eventBroadcaster)
        .catch(err => {
          console.error('Stage 3 restart error:', err);
          eventBroadcaster?.executionStatus(session.projectId, session.featureId, 'error', 'stage3_restart_error', { stage: 3 });
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restart Stage 3';
      res.status(500).json({ error: message });
    }
  });

  // Retry current stage (for stuck sessions)
  app.post('/api/sessions/:projectId/:featureId/retry', async (req, res) => {
    try {
      const { projectId, featureId } = req.params;

      // Get session
      const session = await sessionManager.getSession(projectId, featureId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const sessionDir = `${projectId}/${featureId}`;
      const stage = session.currentStage;

      // Clear stuck conversation entry (status = "started" with no output)
      const conversationsPath = `${sessionDir}/conversations.json`;
      const conversationsData = await storage.readJson<{ entries: Array<{ stage: number; status?: string; output?: string }> }>(conversationsPath);
      if (conversationsData) {
        // Remove stuck entries for current stage
        conversationsData.entries = conversationsData.entries.filter(
          entry => !(entry.stage === stage && entry.status === 'started' && (!entry.output || entry.output === ''))
        );
        await storage.writeJson(conversationsPath, conversationsData);
      }

      // Return success immediately
      res.json({ message: `Stage ${stage} retry started`, stage });

      // Restart the current stage based on which stage we're in
      switch (stage) {
        case 1: {
          // Stage 1: Discovery
          const prompt = buildStage1Prompt(session);
          eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'stage1_retry', { stage: 1, subState: 'spawning_agent' });
          await resultHandler.saveConversationStart(sessionDir, 1, prompt);

          orchestrator.spawn({
            prompt,
            projectPath: session.projectPath,
            allowedTools: ['Read', 'Glob', 'Grep', 'Task'],
            onOutput: (output, isComplete) => {
              eventBroadcaster?.claudeOutput(projectId, featureId, output, isComplete);
            },
          }).then(async (result) => {
            await resultHandler.handleStage1Result(session, result, prompt);
            await applyHaikuPostProcessing(result, session.projectPath, storage, session, resultHandler);
            if (!result.isError) {
              await handleStage1Completion(session, result, storage, sessionManager, resultHandler, eventBroadcaster);
            }
            console.log(`Stage 1 retry ${result.isError ? 'failed' : 'completed'} for ${featureId}`);
            eventBroadcaster?.executionStatus(projectId, featureId, result.isError ? 'error' : 'idle', 'stage1_complete', { stage: 1 });
          }).catch((error) => {
            console.error(`Stage 1 retry spawn error for ${featureId}:`, error);
            eventBroadcaster?.executionStatus(projectId, featureId, 'error', 'stage1_retry_error', { stage: 1 });
          });
          break;
        }

        case 2: {
          // Stage 2: Plan Review
          const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
          if (!plan) {
            console.error(`No plan found for Stage 2 retry: ${featureId}`);
            return;
          }
          const stage2Prompt = buildStage2Prompt(session, plan, 1);
          eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'stage2_retry', { stage: 2, subState: 'spawning_agent' });
          spawnStage2Review(session, storage, sessionManager, resultHandler, eventBroadcaster, stage2Prompt);
          break;
        }

        case 3: {
          // Stage 3: Implementation
          const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
          if (!plan || !plan.isApproved) {
            console.error(`No approved plan found for Stage 3 retry: ${featureId}`);
            return;
          }
          eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'stage3_retry', { stage: 3, subState: 'spawning_agent' });
          executeStage3Steps(session, storage, sessionManager, resultHandler, eventBroadcaster)
            .catch(err => {
              console.error(`Stage 3 retry error: ${err}`);
              eventBroadcaster?.executionStatus(projectId, featureId, 'error', 'stage3_retry_error', { stage: 3 });
            });
          break;
        }

        case 4: {
          // Stage 4: PR Creation
          const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
          if (!plan) {
            console.error(`No plan found for Stage 4 retry: ${featureId}`);
            return;
          }
          const stage4Prompt = buildStage4Prompt(session, plan);
          eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'stage4_retry', { stage: 4, subState: 'spawning_agent' });
          spawnStage4PRCreation(session, storage, sessionManager, resultHandler, eventBroadcaster, stage4Prompt);
          break;
        }

        case 5: {
          // Stage 5: PR Review
          if (!session.prUrl) {
            console.error(`No PR URL found for Stage 5 retry: ${featureId}`);
            return;
          }
          const plan = await storage.readJson<Plan>(`${sessionDir}/plan.json`);
          if (!plan) {
            console.error(`No plan found for Stage 5 retry: ${featureId}`);
            return;
          }
          const prInfo = {
            title: session.title,
            url: session.prUrl,
            branch: session.featureBranch,
          };
          const stage5Prompt = buildStage5Prompt(session, plan, prInfo);
          eventBroadcaster?.executionStatus(projectId, featureId, 'running', 'stage5_retry', { stage: 5, subState: 'spawning_agent' });
          spawnStage5PRReview(session, storage, sessionManager, resultHandler, eventBroadcaster, stage5Prompt);
          break;
        }

        default:
          console.error(`Unknown stage ${stage} for retry: ${featureId}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry stage';
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
      let prompt = session.claudeSessionId
        ? buildStage5PromptLean(prInfo)
        : buildStage5Prompt(session, plan, prInfo);
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
              const useLean2 = session.claudeSessionId && currentIteration > 1;
              const prompt2 = useLean2
                ? buildStage2PromptLean(plan, currentIteration, session.planValidationContext, session.claudePlanFilePath)
                : buildStage2Prompt(session, plan, currentIteration);
              await spawnStage2Review(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt2);
              break;
            }
            case 3: {
              // Stage 3: Implementation - resume step-by-step execution
              if (!plan) break;
              // Get currentStepId from status to resume from interrupted step
              const status3 = await storage.readJson<{ currentStepId?: string | null }>(`${sessionDir}/status.json`);
              const resumeStepId = status3?.currentStepId || undefined;
              executeStage3Steps(session, storage, sessionManager, resultHandler, eventBroadcaster, resumeStepId)
                .catch(err => console.error('Stage 3 resume error:', err));
              break;
            }
            case 4: {
              // Stage 4: PR Creation - resume with stage 4 prompt
              if (!plan) break;
              const completedCount4 = plan.steps.filter(s => s.status === 'completed').length;
              const prompt4 = session.claudeSessionId
                ? buildStage4PromptLean(session, completedCount4)
                : buildStage4Prompt(session, plan);
              await spawnStage4PRCreation(session, storage, sessionManager, resultHandler, eventBroadcaster, prompt4);
              break;
            }
            case 5: {
              // Stage 5: PR Review - resume with stage 5 prompt
              if (!plan) break;
              const prInfo = await storage.readJson<{ title: string; branch: string; url: string }>(`${sessionDir}/pr.json`);
              if (!prInfo) break;
              const prompt = session.claudeSessionId
                ? buildStage5PromptLean(prInfo)
                : buildStage5Prompt(session, plan, prInfo);
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

  // SPA fallback: serve index.html for non-API routes
  app.get('*', (req, res, next) => {
    // Skip API routes (shouldn't reach here but be safe)
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' });
    }
    // Skip if headers already sent (prevents crash)
    if (res.headersSent) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });

  return { app, resumeStuckSessions };
}

import { v4 as uuidv4 } from 'uuid';
import { readFile } from 'fs/promises';
import crypto from 'crypto';
import { FileStorageService } from '../data/FileStorageService';
import { SessionManager } from './SessionManager';
import { ClaudeResult } from './ClaudeOrchestrator';
import { DecisionValidator, ValidationLog } from './DecisionValidator';
import { OutputParser, ParsedPlanStep } from './OutputParser';
import { PostProcessingType } from './HaikuPostProcessor';
import { buildDecisionValidationPrompt } from '../prompts/validationPrompts';
import {
  PlanCompletionChecker,
  planCompletionChecker,
  PlanCompletenessResult,
} from './PlanCompletionChecker';
import { Session, Plan, Question, QuestionStage, QuestionCategory, ComposablePlan, ValidationAction } from '@claude-code-web/shared';
import { isImplementationComplete, hasNewCommitSince } from '../utils/stateVerification';

const STAGE_TO_QUESTION_STAGE: Record<number, QuestionStage> = {
  1: 'discovery',
  2: 'planning',
  3: 'implementation',
  4: 'review',
  5: 'review',
};

const VALID_CATEGORIES: QuestionCategory[] = [
  'scope', 'approach', 'technical', 'design', 'blocker', 'critical', 'major', 'suggestion'
];

interface ConversationEntry {
  stage: number;
  stepId?: string; // Plan step this conversation is for (Stage 3)
  timestamp: string;
  prompt: string;
  output: string;
  sessionId: string | null;
  costUsd: number;
  isError: boolean;
  error?: string;
  parsed: ClaudeResult['parsed'];
  status?: 'started' | 'completed' | 'interrupted';
  /** Post-processing type (if this is a Haiku post-processing call) */
  postProcessingType?: PostProcessingType;
  /** ID of the question this validation is for (for decision_validation entries) */
  questionId?: string;
  /** Validation result action (pass/filter/repurpose) */
  validationAction?: ValidationAction;
  /** 1-based index of the question for display purposes */
  questionIndex?: number;
}

interface ConversationsFile {
  entries: ConversationEntry[];
}

interface QuestionsFile {
  version: string;
  sessionId: string;
  questions: Question[];
}

interface StatusFile {
  version: string;
  sessionId: string;
  timestamp: string;
  currentStage: number;
  currentStepId: string | null;
  blockedStepId?: string | null; // Which step has a blocker
  status: string;
  claudeSpawnCount: number;
  callsThisHour: number;
  maxCallsPerHour: number;
  nextHourReset: string;
  circuitBreakerState: string;
  lastOutputLength: number;
  lastAction: string;
  lastActionAt: string;
  stepRetries?: Record<string, number>; // Track retry count per step for Stage 3
}

export class ClaudeResultHandler {
  private readonly completionChecker: PlanCompletionChecker;

  constructor(
    private readonly storage: FileStorageService,
    private readonly sessionManager: SessionManager,
    private readonly validator?: DecisionValidator,
    completionChecker?: PlanCompletionChecker
  ) {
    this.completionChecker = completionChecker || planCompletionChecker;
  }

  /**
   * Handle Stage 1 (Discovery) result from Claude.
   * Saves conversation, extracts questions/plan steps, updates session.
   */
  async handleStage1Result(
    session: Session,
    result: ClaudeResult,
    prompt: string
  ): Promise<void> {
    const sessionDir = `${session.projectId}/${session.featureId}`;
    const now = new Date().toISOString();

    // Save conversation entry
    await this.saveConversation(sessionDir, {
      stage: 1,
      timestamp: now,
      prompt,
      output: result.output,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      isError: result.isError,
      error: result.error,
      parsed: result.parsed,
    });

    // Save parsed questions to questions.json (with validation)
    if (result.parsed.decisions.length > 0) {
      // Read plan for validation context
      const plan = await this.storage.readJson<Plan>(`${sessionDir}/plan.json`);
      await this.saveQuestions(sessionDir, session, result.parsed.decisions, plan);
    }

    // Save parsed plan steps to plan.json
    // If no plan steps in output but planFilePath exists, read steps from the plan file
    let planSteps = result.parsed.planSteps;
    if (planSteps.length === 0 && result.parsed.planFilePath) {
      console.log(`No PLAN_STEP markers in output, reading from plan file: ${result.parsed.planFilePath}`);
      planSteps = await this.parsePlanStepsFromFile(result.parsed.planFilePath);
      console.log(`Found ${planSteps.length} plan steps in file`);
    }
    if (planSteps.length > 0) {
      await this.savePlanSteps(sessionDir, planSteps);
    }

    // Update session with Claude session ID and plan file path
    const sessionUpdates: Partial<Session> = {};

    if (result.sessionId) {
      sessionUpdates.claudeSessionId = result.sessionId;
    }

    if (result.parsed.planFilePath) {
      sessionUpdates.claudePlanFilePath = result.parsed.planFilePath;
    }

    if (Object.keys(sessionUpdates).length > 0) {
      await this.sessionManager.updateSession(
        session.projectId,
        session.featureId,
        sessionUpdates
      );
    }

    // Update status.json
    await this.updateStatus(sessionDir, result, 1);
  }

  /**
   * Handle Stage 2 (Plan Review) result from Claude.
   * Also handles plan modifications when returning from Stage 3 blockers.
   * After saving plan updates, validates plan completeness and sets validation context if incomplete.
   */
  async handleStage2Result(
    session: Session,
    result: ClaudeResult,
    prompt: string
  ): Promise<{ allFiltered: boolean; planValidation?: PlanCompletenessResult }> {
    const sessionDir = `${session.projectId}/${session.featureId}`;
    const now = new Date().toISOString();

    // Save conversation entry
    await this.saveConversation(sessionDir, {
      stage: 2,
      timestamp: now,
      prompt,
      output: result.output,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      isError: result.isError,
      error: result.error,
      parsed: result.parsed,
    });

    // Parse and add any new plan steps (supports plan modifications during re-review)
    let planSteps = result.parsed.planSteps;
    if (planSteps.length === 0 && result.parsed.planFilePath) {
      console.log(`[Stage 2] No PLAN_STEP markers in output, reading from plan file: ${result.parsed.planFilePath}`);
      planSteps = await this.parsePlanStepsFromFile(result.parsed.planFilePath);
      console.log(`[Stage 2] Found ${planSteps.length} plan steps in file`);
    }
    if (planSteps.length > 0) {
      console.log(`[Stage 2] Adding/updating ${planSteps.length} plan steps for ${session.featureId}`);
      await this.mergePlanSteps(sessionDir, planSteps);
    }

    // Save any new questions (review findings) with validation
    let allFiltered = false;
    if (result.parsed.decisions.length > 0) {
      // Read plan for validation context
      const plan = await this.storage.readJson<Plan>(`${sessionDir}/plan.json`);
      const saveResult = await this.saveQuestions(sessionDir, session, result.parsed.decisions, plan);
      allFiltered = saveResult.allFiltered;
    }

    // Update status.json
    await this.updateStatus(sessionDir, result, 2);

    // Validate plan completeness after Stage 2 session
    const planValidation = await this.validatePlanCompleteness(session, sessionDir);

    return { allFiltered, planValidation };
  }

  /**
   * Validate plan completeness and update session with validation context if incomplete.
   * This is called after Stage 2 saves plan updates.
   */
  private async validatePlanCompleteness(
    session: Session,
    sessionDir: string
  ): Promise<PlanCompletenessResult> {
    // Check plan completeness - use the absolute path for the session directory
    const absoluteSessionDir = this.storage.getAbsolutePath(sessionDir);
    const planValidation = await this.completionChecker.checkPlanCompleteness(absoluteSessionDir);

    // Update session with validation context
    if (!planValidation.complete) {
      // Set validation context for re-prompting Claude
      await this.sessionManager.updateSession(
        session.projectId,
        session.featureId,
        { planValidationContext: planValidation.missingContext }
      );
      console.log(`Plan validation incomplete for ${session.featureId}. Context: ${planValidation.missingContext.substring(0, 100)}...`);
    } else {
      // Clear validation context if plan is complete
      await this.sessionManager.updateSession(
        session.projectId,
        session.featureId,
        { planValidationContext: null }
      );
      console.log(`Plan validation complete for ${session.featureId}`);
    }

    return planValidation;
  }

  /**
   * Handle Stage 3 (Implementation) result from Claude.
   * Updates step statuses, tracks retries, handles blockers.
   * @param stepId - The plan step being executed (for one-step-at-a-time execution)
   */
  async handleStage3Result(
    session: Session,
    result: ClaudeResult,
    prompt: string,
    stepId?: string,
    preStepCommitSha?: string
  ): Promise<{ hasBlocker: boolean; implementationComplete: boolean }> {
    const sessionDir = `${session.projectId}/${session.featureId}`;
    const now = new Date().toISOString();

    // Save conversation entry (with stepId if provided)
    await this.saveConversation(sessionDir, {
      stage: 3,
      stepId,
      timestamp: now,
      prompt,
      output: result.output,
      sessionId: result.sessionId,
      costUsd: result.costUsd,
      isError: result.isError,
      error: result.error,
      parsed: result.parsed,
    });

    // Deterministic step completion: check if a git commit was made
    // This is more reliable than parsing Claude's output for markers
    if (stepId && preStepCommitSha && session.projectPath) {
      const hasNewCommit = await hasNewCommitSince(session.projectPath, preStepCommitSha);
      if (hasNewCommit && !result.parsed.stepsCompleted.some(s => s.id === stepId)) {
        console.log(`Step ${stepId} completed via git commit detection for ${session.featureId}`);
        result.parsed.stepsCompleted.push({
          id: stepId,
          summary: 'Completed (verified by git commit)',
          testsAdded: [],
          testsPassing: true,
        });
      }
    }

    // Update plan step statuses based on stepsCompleted
    if (result.parsed.stepsCompleted.length > 0) {
      await this.updatePlanStepStatuses(sessionDir, result.parsed.stepsCompleted);
    }

    // Handle blocker decisions (category="blocker")
    const blockerDecisions = result.parsed.decisions.filter(
      d => d.category === 'blocker'
    );

    if (blockerDecisions.length > 0) {
      // Read plan for validation context (skip validation for blockers - they're urgent)
      await this.saveQuestions(sessionDir, session, blockerDecisions, null, stepId);
    }

    // Update status.json with Stage 3 specific fields (including blockedStepId if blocker)
    const hasBlocker = blockerDecisions.length > 0;
    await this.updateStage3Status(sessionDir, result, hasBlocker ? stepId : undefined);

    // Check implementation completion via state ONLY (ignore unreliable marker)
    // State check: all plan steps have status 'completed' or 'skipped'
    const planPath = `${sessionDir}/plan.json`;
    const plan = await this.storage.readJson<Plan>(planPath);
    const stateComplete = isImplementationComplete(plan);
    const markerComplete = result.parsed.implementationComplete;

    // Log completion detection - state is authoritative, marker is for logging only
    if (stateComplete) {
      console.log(`Implementation complete via state (all steps completed) for ${session.featureId}`);
    } else if (markerComplete) {
      // Claude claimed completion but state disagrees - ignore the marker
      console.log(`[WARN] Claude output [IMPLEMENTATION_COMPLETE] but state shows incomplete for ${session.featureId} - ignoring marker`);
    }

    return {
      hasBlocker,
      implementationComplete: stateComplete,  // State-only verification (marker ignored)
    };
  }

  /**
   * Update plan step statuses based on completed steps from Claude output.
   */
  private async updatePlanStepStatuses(
    sessionDir: string,
    stepsCompleted: ClaudeResult['parsed']['stepsCompleted']
  ): Promise<void> {
    const planPath = `${sessionDir}/plan.json`;
    const plan = await this.storage.readJson<Plan>(planPath);

    if (!plan) return;

    for (const completed of stepsCompleted) {
      const step = plan.steps.find(s => s.id === completed.id);
      if (step) {
        step.status = 'completed';
        // Compute and store content hash for change detection on re-runs
        const content = `${step.title}|${step.description || ''}`;
        step.contentHash = crypto.createHash('md5').update(content).digest('hex').substring(0, 12);
        // Store summary in metadata
        step.metadata = {
          ...step.metadata,
          completionSummary: completed.summary,
          completedAt: new Date().toISOString(),
        };
      }
    }

    await this.storage.writeJson(planPath, plan);
  }

  /**
   * Update status.json for Stage 3 with step tracking and retry counts.
   * @param blockedStepId - If provided, set as the blocked step (when blocker detected)
   */
  private async updateStage3Status(
    sessionDir: string,
    result: ClaudeResult,
    blockedStepId?: string
  ): Promise<void> {
    const statusPath = `${sessionDir}/status.json`;
    const status = await this.storage.readJson<StatusFile>(statusPath);

    if (!status) return;

    const now = new Date().toISOString();

    // Track current step from implementation status
    if (result.parsed.implementationStatus) {
      status.currentStepId = result.parsed.implementationStatus.stepId;
    }

    // Track blocked step if blocker detected
    if (blockedStepId) {
      status.blockedStepId = blockedStepId;
    } else if (result.parsed.stepsCompleted.length > 0) {
      // Clear blockedStepId when step completes
      status.blockedStepId = null;
    }

    // Initialize stepRetries if not present
    if (!status.stepRetries) {
      status.stepRetries = {};
    }

    // Update retry count if tests are failing
    if (result.parsed.implementationStatus?.testsStatus === 'failing') {
      const stepId = result.parsed.implementationStatus.stepId;
      status.stepRetries[stepId] = (status.stepRetries[stepId] || 0) + 1;
    }

    // Clear retry count for completed steps
    for (const completed of result.parsed.stepsCompleted) {
      delete status.stepRetries[completed.id];
    }

    // Don't set status to 'completed' here based on marker - let state verification handle it
    // Status will be set to 'idle' in app.ts after all steps are verified complete
    const hasBlocker = result.parsed.decisions.some(d => d.category === 'blocker');
    status.status = result.isError ? 'error' : (hasBlocker ? 'blocked' : 'running');
    status.claudeSpawnCount = (status.claudeSpawnCount || 0) + 1;
    status.lastAction = hasBlocker ? 'stage3_blocked' : 'stage3_progress';
    status.lastActionAt = now;
    status.lastOutputLength = result.output.length;

    await this.storage.writeJson(statusPath, status);
  }

  /**
   * Mark a step as blocked after max retries exceeded.
   */
  async markStepBlocked(sessionDir: string, stepId: string): Promise<void> {
    const planPath = `${sessionDir}/plan.json`;
    const plan = await this.storage.readJson<Plan>(planPath);

    if (!plan) return;

    const step = plan.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'blocked';
      step.metadata = {
        ...step.metadata,
        blockedAt: new Date().toISOString(),
        blockedReason: 'Max retry attempts exceeded',
      };
    }

    await this.storage.writeJson(planPath, plan);
  }

  /**
   * Get retry count for a specific step.
   */
  async getStepRetryCount(sessionDir: string, stepId: string): Promise<number> {
    const statusPath = `${sessionDir}/status.json`;
    const status = await this.storage.readJson<StatusFile>(statusPath);
    return status?.stepRetries?.[stepId] || 0;
  }

  /**
   * Save a post-processing (Haiku) conversation entry.
   * These are lightweight LLM calls for validation, assessment, etc.
   */
  async savePostProcessingConversation(
    sessionDir: string,
    stage: number,
    postProcessingType: PostProcessingType,
    prompt: string,
    output: string,
    durationMs: number,
    isError: boolean = false,
    error?: string,
    validationMeta?: {
      questionId?: string;
      validationAction?: ValidationAction;
      questionIndex?: number;
    }
  ): Promise<void> {
    // Extract just the result field from Haiku JSON output
    let cleanOutput = output;
    try {
      const parsed = JSON.parse(output);
      if (parsed.result !== undefined) {
        cleanOutput = parsed.result;
      }
    } catch {
      // Not valid JSON, use as-is
    }

    const conversationPath = `${sessionDir}/conversations.json`;
    const conversations = await this.storage.readJson<ConversationsFile>(conversationPath) || { entries: [] };
    conversations.entries.push({
      stage,
      timestamp: new Date().toISOString(),
      prompt,
      output: cleanOutput,
      sessionId: null,
      costUsd: 0, // Haiku costs are minimal, could calculate if needed
      isError,
      error,
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
        allTestsPassing: false,
        testsAdded: [],
        prCreated: null,
        planApproved: false,
        ciStatus: null,
        ciFailed: false,
        prApproved: false,
        returnToStage2: null,
      },
      status: 'completed',
      postProcessingType,
      // Validation metadata (only for decision_validation entries)
      ...(validationMeta?.questionId && { questionId: validationMeta.questionId }),
      ...(validationMeta?.validationAction && { validationAction: validationMeta.validationAction }),
      ...(validationMeta?.questionIndex !== undefined && { questionIndex: validationMeta.questionIndex }),
    });
    await this.storage.writeJson(conversationPath, conversations);
  }

  /**
   * Save a "started" validation entry for each decision before validation begins.
   * This allows the frontend to show validation progress immediately.
   */
  async saveValidationStarts(
    sessionDir: string,
    stage: number,
    decisions: Array<{ questionText: string }>,
    prompts: string[]
  ): Promise<void> {
    const now = new Date().toISOString();
    const conversationPath = `${sessionDir}/conversations.json`;
    const conversations = await this.storage.readJson<ConversationsFile>(conversationPath) || { entries: [] };

    for (let i = 0; i < decisions.length; i++) {
      conversations.entries.push({
        stage,
        timestamp: now,
        prompt: prompts[i] || `Validating: ${decisions[i].questionText.substring(0, 100)}...`,
        output: '',
        sessionId: null,
        costUsd: 0,
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
          allTestsPassing: false,
          testsAdded: [],
          prCreated: null,
          planApproved: false,
          ciStatus: null,
          ciFailed: false,
          prApproved: false,
          returnToStage2: null,
        },
        status: 'started',
        postProcessingType: 'decision_validation',
        questionIndex: i + 1,
      });
    }

    await this.storage.writeJson(conversationPath, conversations);
  }

  /**
   * Update a "started" validation entry with completion data.
   * Finds the entry by questionIndex and status="started".
   */
  async updateValidationEntry(
    sessionDir: string,
    stage: number,
    questionIndex: number,
    prompt: string,
    output: string,
    durationMs: number,
    validationAction: ValidationAction
  ): Promise<void> {
    // Extract just the result field from Haiku JSON output
    let cleanOutput = output;
    try {
      const parsed = JSON.parse(output);
      if (parsed.result !== undefined) {
        cleanOutput = parsed.result;
      }
    } catch {
      // Not valid JSON, use as-is
    }

    const conversationPath = `${sessionDir}/conversations.json`;
    const conversations = await this.storage.readJson<ConversationsFile>(conversationPath);
    if (!conversations) return;

    // Find the started validation entry for this question
    for (let i = conversations.entries.length - 1; i >= 0; i--) {
      const entry = conversations.entries[i];
      if (
        entry.stage === stage &&
        entry.status === 'started' &&
        entry.postProcessingType === 'decision_validation' &&
        entry.questionIndex === questionIndex
      ) {
        entry.prompt = prompt;
        entry.output = cleanOutput;
        entry.status = 'completed';
        entry.validationAction = validationAction;
        break;
      }
    }

    await this.storage.writeJson(conversationPath, conversations);
  }

  /**
   * Mark any incomplete "started" conversation entries as "interrupted".
   * Called before resuming a stuck session to clean up orphaned entries.
   */
  async markIncompleteConversationsAsInterrupted(sessionDir: string): Promise<number> {
    const conversationPath = `${sessionDir}/conversations.json`;
    const conversations = await this.storage.readJson<ConversationsFile>(conversationPath);
    if (!conversations) return 0;

    let count = 0;
    for (const entry of conversations.entries) {
      if (entry.status === 'started') {
        entry.status = 'interrupted';
        entry.error = 'Session interrupted by server restart';
        count++;
      }
    }

    if (count > 0) {
      await this.storage.writeJson(conversationPath, conversations);
    }
    return count;
  }

  async saveConversationStart(sessionDir: string, stage: number, prompt: string, stepId?: string): Promise<void> {
    const now = new Date().toISOString();
    const conversationPath = `${sessionDir}/conversations.json`;
    const conversations = await this.storage.readJson<ConversationsFile>(conversationPath) || { entries: [] };
    conversations.entries.push({
      stage,
      stepId,
      timestamp: now,
      prompt,
      output: '',
      sessionId: null,
      costUsd: 0,
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
        allTestsPassing: false,
        testsAdded: [],
        prCreated: null,
        planApproved: false,
        ciStatus: null,
        ciFailed: false,
        prApproved: false,
        returnToStage2: null,
      },
      status: 'started',
    });
    await this.storage.writeJson(conversationPath, conversations);

    // Update session.updatedAt
    const sessionPath = `${sessionDir}/session.json`;
    const session = await this.storage.readJson<{ updatedAt?: string }>(sessionPath);
    if (session) {
      session.updatedAt = now;
      await this.storage.writeJson(sessionPath, session);
    }
  }

  private async saveConversation(
    sessionDir: string,
    entry: ConversationEntry
  ): Promise<void> {
    const conversationPath = `${sessionDir}/conversations.json`;
    const conversations = await this.storage.readJson<ConversationsFile>(conversationPath) || { entries: [] };

    // Find the most recent "started" entry for this stage and update it
    let startedIndex = -1;
    for (let i = conversations.entries.length - 1; i >= 0; i--) {
      if (conversations.entries[i].stage === entry.stage && conversations.entries[i].status === 'started') {
        startedIndex = i;
        break;
      }
    }

    if (startedIndex !== -1) {
      // Update the existing "started" entry with completed data
      conversations.entries[startedIndex] = { ...entry, status: 'completed' };
    } else {
      // No "started" entry found, append new entry
      conversations.entries.push({ ...entry, status: entry.status || 'completed' });
    }

    await this.storage.writeJson(conversationPath, conversations);
  }

  private async saveQuestions(
    sessionDir: string,
    session: Session,
    decisions: ClaudeResult['parsed']['decisions'],
    plan: Plan | null,
    stepId?: string
  ): Promise<{ savedCount: number; allFiltered: boolean }> {
    // Validate decisions if we have a validator and a plan
    let validatedDecisions = decisions;
    if (this.validator && plan && decisions.length > 0) {
      // Build prompts upfront so we can save "started" entries immediately
      const prompts = decisions.map(d => buildDecisionValidationPrompt(d, plan, session.preferences));

      // Save "started" entries for all validations immediately
      // This allows frontend to show validation progress right away
      await this.saveValidationStarts(sessionDir, session.currentStage, decisions, prompts);

      // Run validations in parallel
      const { validDecisions, log } = await this.validator.validateDecisions(
        decisions,
        plan,
        session.projectPath,
        session.preferences
      );
      validatedDecisions = validDecisions;

      // Save validation log for debugging/auditing
      await this.saveValidationLog(sessionDir, log);

      // Update each validation entry with completion data
      for (let i = 0; i < log.results.length; i++) {
        const result = log.results[i];
        await this.updateValidationEntry(
          sessionDir,
          session.currentStage,
          i + 1, // 1-based questionIndex
          result.prompt,
          result.output,
          result.durationMs,
          result.action
        );
      }

      // If all decisions were filtered, signal this to caller
      if (validatedDecisions.length === 0) {
        console.log(`All ${decisions.length} decision(s) filtered as false positives`);
        return { savedCount: 0, allFiltered: true };
      }
    }

    const questionsPath = `${sessionDir}/questions.json`;
    const questionsFile = await this.storage.readJson<QuestionsFile>(questionsPath) || {
      version: '1.0',
      sessionId: session.id,
      questions: [],
    };

    const now = new Date().toISOString();

    for (const decision of validatedDecisions) {
      // Map category to valid QuestionCategory, default to 'technical'
      const category: QuestionCategory = VALID_CATEGORIES.includes(decision.category as QuestionCategory)
        ? (decision.category as QuestionCategory)
        : 'technical';

      // Map priority to valid 1 | 2 | 3
      const priority = Math.min(3, Math.max(1, decision.priority)) as 1 | 2 | 3;

      const question: Question = {
        id: uuidv4(),
        stage: STAGE_TO_QUESTION_STAGE[session.currentStage] || 'discovery',
        questionType: this.inferQuestionType(decision.options),
        questionText: decision.questionText,
        options: decision.options.map(opt => ({
          value: opt.label.toLowerCase().replace(/\s+/g, '_'),
          label: opt.label,
          recommended: opt.recommended,
        })),
        answer: null,
        isRequired: decision.priority <= 2,
        priority,
        category,
        stepId, // Include stepId for Stage 3 blockers
        askedAt: now,
        answeredAt: null,
      };

      questionsFile.questions.push(question);
    }

    await this.storage.writeJson(questionsPath, questionsFile);
    return { savedCount: validatedDecisions.length, allFiltered: false };
  }

  private inferQuestionType(options: { label: string; recommended: boolean }[]): 'single_choice' | 'multi_choice' | 'text' {
    if (options.length === 0) return 'text';
    if (options.length <= 4) return 'single_choice';
    return 'multi_choice';
  }

  /**
   * Save validation audit log for debugging/auditing filtered decisions.
   */
  private async saveValidationLog(
    sessionDir: string,
    log: ValidationLog
  ): Promise<void> {
    const logPath = `${sessionDir}/validation-logs.json`;
    const logs = await this.storage.readJson<{ entries: ValidationLog[] }>(logPath) || {
      entries: [],
    };
    logs.entries.push(log);
    await this.storage.writeJson(logPath, logs);
  }

  /**
   * Read plan file and parse PLAN_STEP markers from it.
   * Used when Claude writes a plan file but doesn't output markers in the response.
   */
  private async parsePlanStepsFromFile(planFilePath: string): Promise<ParsedPlanStep[]> {
    try {
      const content = await readFile(planFilePath, 'utf-8');
      const parser = new OutputParser();
      return parser.parsePlanSteps(content);
    } catch (error) {
      console.error(`Failed to read plan file ${planFilePath}:`, error);
      return [];
    }
  }

  private async savePlanSteps(
    sessionDir: string,
    planSteps: ClaudeResult['parsed']['planSteps']
  ): Promise<void> {
    const planPath = `${sessionDir}/plan.json`;
    const plan = await this.storage.readJson<Plan>(planPath);

    if (!plan) return;

    // Map plan steps, including new composable plan attributes if available
    plan.steps = planSteps.map((step, index) => ({
      id: step.id,
      parentId: step.parentId,
      orderIndex: index,
      title: step.title,
      description: step.description,
      status: step.status as 'pending' | 'in_progress' | 'completed' | 'blocked',
      metadata: {},
      // Include composable plan attributes if present
      complexity: step.complexity,
      acceptanceCriteriaIds: step.acceptanceCriteriaIds,
      estimatedFiles: step.estimatedFiles,
    }));

    plan.planVersion = (plan.planVersion || 0) + 1;
    plan.createdAt = new Date().toISOString();
    // Reset approval when plan steps change - plan needs re-approval
    plan.isApproved = false;

    await this.storage.writeJson(planPath, plan);
  }

  /**
   * Save a composable plan structure to plan.json.
   * This is the new plan format with separate sections for meta, dependencies, etc.
   */
  async saveComposablePlan(
    sessionDir: string,
    composablePlan: ComposablePlan
  ): Promise<void> {
    const planPath = `${sessionDir}/plan.json`;
    await this.storage.writeJson(planPath, composablePlan);
  }

  /**
   * Merge new plan steps into existing plan, preserving statuses of existing steps.
   * Used during Stage 2 re-review to add new steps without losing progress.
   */
  private async mergePlanSteps(
    sessionDir: string,
    newSteps: ClaudeResult['parsed']['planSteps']
  ): Promise<void> {
    const planPath = `${sessionDir}/plan.json`;
    const plan = await this.storage.readJson<Plan>(planPath);

    if (!plan) return;

    const existingStepIds = new Set(plan.steps.map(s => s.id));
    let addedCount = 0;

    for (const newStep of newSteps) {
      if (!existingStepIds.has(newStep.id)) {
        // Add new step at the end with next orderIndex
        const maxOrderIndex = plan.steps.length > 0
          ? Math.max(...plan.steps.map(s => s.orderIndex))
          : -1;

        plan.steps.push({
          id: newStep.id,
          parentId: newStep.parentId,
          orderIndex: maxOrderIndex + 1,
          title: newStep.title,
          description: newStep.description,
          status: 'pending',
          metadata: {},
        });
        addedCount++;
        console.log(`[Stage 2] Added new step: ${newStep.id} - ${newStep.title}`);
      }
    }

    if (addedCount > 0) {
      plan.planVersion = (plan.planVersion || 0) + 1;
      // Don't reset approval - Stage 2 will handle approval flow
      await this.storage.writeJson(planPath, plan);
      console.log(`[Stage 2] Merged ${addedCount} new steps into plan for ${sessionDir}`);
    }
  }

  /**
   * Increment plan.reviewCount after Stage 2 review completes.
   */
  async incrementReviewCount(sessionDir: string): Promise<void> {
    const planPath = `${sessionDir}/plan.json`;
    const plan = await this.storage.readJson<Plan>(planPath);

    if (!plan) return;

    plan.reviewCount = (plan.reviewCount || 0) + 1;
    await this.storage.writeJson(planPath, plan);
  }

  private async updateStatus(
    sessionDir: string,
    result: ClaudeResult,
    stage: number
  ): Promise<void> {
    const statusPath = `${sessionDir}/status.json`;
    const status = await this.storage.readJson<StatusFile>(statusPath);

    if (!status) return;

    const now = new Date().toISOString();

    status.status = result.isError ? 'error' : 'idle';
    status.claudeSpawnCount = (status.claudeSpawnCount || 0) + 1;
    status.lastAction = result.isError ? `stage${stage}_error` : `stage${stage}_complete`;
    status.lastActionAt = now;
    status.lastOutputLength = result.output.length;

    await this.storage.writeJson(statusPath, status);
  }
}

import { v4 as uuidv4 } from 'uuid';
import { readFile } from 'fs/promises';
import { FileStorageService } from '../data/FileStorageService';
import { SessionManager } from './SessionManager';
import { ClaudeResult } from './ClaudeOrchestrator';
import { DecisionValidator, ValidationLog } from './DecisionValidator';
import { OutputParser, ParsedPlanStep } from './OutputParser';
import { Session, Plan, Question, QuestionStage, QuestionCategory } from '@claude-code-web/shared';

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
  timestamp: string;
  prompt: string;
  output: string;
  sessionId: string | null;
  costUsd: number;
  isError: boolean;
  error?: string;
  parsed: ClaudeResult['parsed'];
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
  status: string;
  claudeSpawnCount: number;
  callsThisHour: number;
  maxCallsPerHour: number;
  nextHourReset: string;
  circuitBreakerState: string;
  lastOutputLength: number;
  lastAction: string;
  lastActionAt: string;
}

export class ClaudeResultHandler {
  constructor(
    private readonly storage: FileStorageService,
    private readonly sessionManager: SessionManager,
    private readonly validator?: DecisionValidator
  ) {}

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
   */
  async handleStage2Result(
    session: Session,
    result: ClaudeResult,
    prompt: string
  ): Promise<void> {
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

    // Save any new questions (review findings) with validation
    if (result.parsed.decisions.length > 0) {
      // Read plan for validation context
      const plan = await this.storage.readJson<Plan>(`${sessionDir}/plan.json`);
      await this.saveQuestions(sessionDir, session, result.parsed.decisions, plan);
    }

    // Update status.json
    await this.updateStatus(sessionDir, result, 2);
  }

  private async saveConversation(
    sessionDir: string,
    entry: ConversationEntry
  ): Promise<void> {
    const conversationPath = `${sessionDir}/conversations.json`;
    const conversations = await this.storage.readJson<ConversationsFile>(conversationPath) || { entries: [] };
    conversations.entries.push(entry);
    await this.storage.writeJson(conversationPath, conversations);
  }

  private async saveQuestions(
    sessionDir: string,
    session: Session,
    decisions: ClaudeResult['parsed']['decisions'],
    plan: Plan | null
  ): Promise<void> {
    // Validate decisions if we have a validator and a plan
    let validatedDecisions = decisions;
    if (this.validator && plan && decisions.length > 0) {
      const { validDecisions, log } = await this.validator.validateDecisions(
        decisions,
        plan,
        session.projectPath
      );
      validatedDecisions = validDecisions;

      // Save validation log for debugging/auditing
      await this.saveValidationLog(sessionDir, log);

      // If all decisions were filtered, we're done
      if (validatedDecisions.length === 0) {
        console.log(`All ${decisions.length} decision(s) filtered as false positives`);
        return;
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
        askedAt: now,
        answeredAt: null,
      };

      questionsFile.questions.push(question);
    }

    await this.storage.writeJson(questionsPath, questionsFile);
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

    plan.steps = planSteps.map((step, index) => ({
      id: step.id,
      parentId: step.parentId,
      orderIndex: index,
      title: step.title,
      description: step.description,
      status: step.status as 'pending' | 'in_progress' | 'completed' | 'blocked',
      metadata: {},
    }));

    plan.planVersion = (plan.planVersion || 0) + 1;
    plan.createdAt = new Date().toISOString();
    // Reset approval when plan steps change - plan needs re-approval
    plan.isApproved = false;

    await this.storage.writeJson(planPath, plan);
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

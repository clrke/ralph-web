export type QuestionStage = 'discovery' | 'planning' | 'implementation' | 'review';

export type QuestionType =
  | 'single_choice'
  | 'multi_choice'
  | 'text'
  | 'confirmation';

export type QuestionCategory =
  | 'scope'
  | 'approach'
  | 'technical'
  | 'design'
  | 'blocker'
  | 'critical'
  | 'major'
  | 'suggestion';

export interface QuestionOption {
  value: string;
  label: string;
  recommended?: boolean;
  description?: string;
}

export interface QuestionAnswer {
  value: string | string[];
}

export interface Question {
  id: string;
  stage: QuestionStage;
  questionType: QuestionType;
  category: QuestionCategory;
  priority: 1 | 2 | 3;
  questionText: string;
  options: QuestionOption[];
  answer: QuestionAnswer | null;
  isRequired: boolean;
  file?: string;
  line?: number;
  stepId?: string; // Plan step this question relates to (for Stage 3 blockers)
  askedAt: string;
  answeredAt: string | null;
}

export interface QuestionsFile {
  version: string;
  sessionId: string;
  questions: Question[];
}

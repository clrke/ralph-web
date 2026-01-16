import { z } from 'zod';

/**
 * Input validation schemas based on README lines 2146-2176
 * Server-side validation is authoritative (never trust client)
 */

// Acceptance criterion schema
export const AcceptanceCriterionSchema = z.object({
  text: z.string().min(1).max(500),
  checked: z.boolean().default(false),
  type: z.enum(['manual', 'automated']).default('manual'),
});

// Valid git branch name pattern
const gitBranchNamePattern = /^[a-zA-Z0-9._/-]+$/;

// User preferences schema for decision filtering (defined early for use in CreateSessionInputSchema)
export const UserPreferencesSchema = z.object({
  riskComfort: z.enum(['low', 'medium', 'high']),
  speedVsQuality: z.enum(['speed', 'balanced', 'quality']),
  scopeFlexibility: z.enum(['fixed', 'flexible', 'open']),
  detailLevel: z.enum(['minimal', 'standard', 'detailed']),
  autonomyLevel: z.enum(['guided', 'collaborative', 'autonomous']),
});

// Create session input schema
export const CreateSessionInputSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be 200 characters or less')
    .transform((s) => s.trim()),

  featureDescription: z
    .string()
    .min(1, 'Feature description is required')
    .max(10000, 'Feature description must be 10000 characters or less')
    .transform((s) => s.trim()),

  projectPath: z
    .string()
    .min(1, 'Project path is required')
    .refine((path) => path.startsWith('/'), {
      message: 'Project path must be an absolute path',
    })
    .transform((s) => s.trim()),

  acceptanceCriteria: z.array(AcceptanceCriterionSchema).optional().default([]),

  affectedFiles: z
    .array(
      z
        .string()
        .min(1)
        .max(500)
        .refine((path) => !path.startsWith('/'), {
          message: 'Affected files must be relative paths',
        })
    )
    .optional()
    .default([]),

  technicalNotes: z
    .string()
    .max(5000, 'Technical notes must be 5000 characters or less')
    .optional()
    .default('')
    .transform((s) => s?.trim() ?? ''),

  baseBranch: z
    .string()
    .max(100)
    .regex(gitBranchNamePattern, 'Invalid branch name')
    .optional()
    .default('main'),

  preferences: UserPreferencesSchema.optional(),

  // Queue position for new sessions (only used when session is being queued)
  // 'front' = position 1, 'end' = after all existing queued sessions, number = specific position
  insertAtPosition: z.union([
    z.literal('front'),
    z.literal('end'),
    z.number().int().min(1),
  ]).optional(),
});

// Update session input schema (partial, for PATCH requests)
export const UpdateSessionInputSchema = z.object({
  status: z.enum(['discovery', 'planning', 'implementing', 'pr_creation', 'pr_review', 'completed', 'paused', 'error']).optional(),
  currentStage: z.number().int().min(1).max(5).optional(),
  technicalNotes: z.string().max(5000).optional(),
  claudeSessionId: z.string().nullable().optional(),
  claudePlanFilePath: z.string().nullable().optional(),
  queuePosition: z.number().int().min(1).nullable().optional(),
}).strict();

// Stage transition input schema
export const StageTransitionInputSchema = z.object({
  targetStage: z.number().int().min(1).max(5),
});

// Answer question input schema (single question)
export const AnswerQuestionInputSchema = z.union([
  z.object({ value: z.string() }),
  z.object({ text: z.string() }),
  z.object({ values: z.array(z.string()) }),
]);

// Single answer item schema
const AnswerItemSchema = z.object({
  questionId: z.string().min(1),
  answer: AnswerQuestionInputSchema,
});

// Batch answers input schema (all unanswered questions at once)
// Accepts object with answers array and optional remarks
export const BatchAnswersInputSchema = z.object({
  answers: z.array(AnswerItemSchema).min(1, 'At least one answer is required'),
  remarks: z.string().max(5000).optional(),
});

// Plan approval input schema
export const PlanApprovalInputSchema = z.object({}).strict();

// Request changes input schema
export const RequestChangesInputSchema = z.object({
  feedback: z.string().min(1).max(10000),
});

// Queue reorder input schema
export const QueueReorderInputSchema = z.object({
  orderedFeatureIds: z.array(z.string().min(1).max(100)).max(1000, 'Cannot reorder more than 1000 sessions at once'),
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;
export type UpdateSessionInput = z.infer<typeof UpdateSessionInputSchema>;
export type StageTransitionInput = z.infer<typeof StageTransitionInputSchema>;
export type AnswerQuestionInput = z.infer<typeof AnswerQuestionInputSchema>;
export type BatchAnswersInput = z.infer<typeof BatchAnswersInputSchema>;
export type RequestChangesInput = z.infer<typeof RequestChangesInputSchema>;
export type UserPreferencesInput = z.infer<typeof UserPreferencesSchema>;
export type QueueReorderInput = z.infer<typeof QueueReorderInputSchema>;

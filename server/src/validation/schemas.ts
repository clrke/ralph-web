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
});

// Update session input schema (partial, for PATCH requests)
export const UpdateSessionInputSchema = z.object({
  status: z.enum(['discovery', 'planning', 'implementing', 'pr_creation', 'pr_review', 'completed', 'paused', 'error']).optional(),
  currentStage: z.number().int().min(1).max(5).optional(),
  technicalNotes: z.string().max(5000).optional(),
  claudeSessionId: z.string().nullable().optional(),
  claudePlanFilePath: z.string().nullable().optional(),
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

// Batch answers input schema (all unanswered questions at once)
export const BatchAnswersInputSchema = z.array(
  z.object({
    questionId: z.string().min(1),
    answer: AnswerQuestionInputSchema,
  })
).min(1, 'At least one answer is required');

// Plan approval input schema
export const PlanApprovalInputSchema = z.object({}).strict();

// Request changes input schema
export const RequestChangesInputSchema = z.object({
  feedback: z.string().min(1).max(10000),
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;
export type UpdateSessionInput = z.infer<typeof UpdateSessionInputSchema>;
export type StageTransitionInput = z.infer<typeof StageTransitionInputSchema>;
export type AnswerQuestionInput = z.infer<typeof AnswerQuestionInputSchema>;
export type BatchAnswersInput = z.infer<typeof BatchAnswersInputSchema>;
export type RequestChangesInput = z.infer<typeof RequestChangesInputSchema>;

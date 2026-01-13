/**
 * Validation action result from decision validation.
 * - 'pass': Question is valid and should be shown to user
 * - 'filter': Question should be filtered out (duplicate, not relevant, etc.)
 * - 'repurpose': Question should be repurposed into a different question
 */
export type ValidationAction = 'pass' | 'filter' | 'repurpose';

import * as crypto from 'crypto';

/**
 * Normalize whitespace in a string for consistent hashing.
 * - Trims leading/trailing whitespace
 * - Collapses multiple consecutive whitespace characters into single space
 * - Normalizes line endings to \n
 */
export function normalizeWhitespace(text: string): string {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')           // Normalize Windows line endings
    .replace(/\r/g, '\n')              // Normalize old Mac line endings
    .replace(/[ \t]+/g, ' ')           // Collapse horizontal whitespace
    .replace(/\n+/g, '\n')             // Collapse multiple newlines
    .trim();                           // Trim leading/trailing whitespace
}

/**
 * Compute a SHA256 hash of step content (title + description) for change detection.
 * Used to determine if a step's content changed and needs re-implementation.
 *
 * The hash is deterministic:
 * - Whitespace is normalized to handle formatting differences
 * - Uses a consistent separator between fields
 * - Returns a fixed-length hex string (first 16 chars of SHA256)
 *
 * @param title - The step title
 * @param description - The step description (optional)
 * @returns A 16-character hex string hash
 */
export function computeStepContentHash(title: string, description?: string | null): string {
  const normalizedTitle = normalizeWhitespace(title);
  const normalizedDescription = normalizeWhitespace(description || '');

  // Use pipe separator that's unlikely to appear in content
  const content = `${normalizedTitle}|${normalizedDescription}`;

  return crypto
    .createHash('sha256')
    .update(content, 'utf8')
    .digest('hex')
    .substring(0, 16);
}

/**
 * Interface for step-like objects that can have their content hashed.
 */
export interface HashableStep {
  title: string;
  description?: string | null;
}

/**
 * Compute content hash for a step object.
 * Convenience wrapper around computeStepContentHash.
 *
 * @param step - Object with title and optional description
 * @returns A 16-character hex string hash
 */
export function computeStepHash(step: HashableStep): string {
  return computeStepContentHash(step.title, step.description);
}

/**
 * Check if a step's content has changed since it was last completed.
 *
 * @param step - Step object with contentHash, title, and description
 * @returns true if content is unchanged (step should be skipped), false if changed or no hash
 */
export function isStepContentUnchanged(step: HashableStep & { contentHash?: string | null }): boolean {
  if (!step.contentHash) {
    return false; // No hash = never completed or hash cleared, don't skip
  }

  const currentHash = computeStepHash(step);
  return step.contentHash === currentHash;
}

/**
 * Store the content hash on a step object.
 * Call this when a step is marked as completed.
 *
 * @param step - Step object to update (mutates in place)
 */
export function setStepContentHash<T extends HashableStep & { contentHash?: string | null }>(step: T): void {
  step.contentHash = computeStepHash(step);
}

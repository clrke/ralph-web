/**
 * Sanitize user input to prevent prompt injection attacks.
 *
 * Escapes special markers that Claude parses from output to prevent
 * malicious or accidental injection of control markers.
 */

// Markers that should be escaped in user input
// Note: Even deprecated markers are escaped to prevent prompt injection
const ESCAPE_MARKERS = [
  // Plan approval markers
  '[PLAN_APPROVED]',
  '[PLAN_FILE',
  // PR markers
  '[PR_APPROVED]',
  '[PR_CREATED]',
  '[/PR_CREATED]',
  // Decision/question markers
  '[DECISION_NEEDED',
  '[/DECISION_NEEDED]',
  // Implementation markers
  '[STEP_COMPLETE',
  '[IMPLEMENTATION_COMPLETE]',
  '[IMPLEMENTATION_STATUS]',
  // Review markers
  '[REVIEW_CHECKPOINT]',
  '[CI_STATUS',
  '[CI_FAILED]',
  '[RETURN_TO_STAGE_2]',
  // Plan mode markers (deprecated - parsed but not used for business logic)
  '[PLAN_MODE_ENTERED]',
  '[PLAN_MODE_EXITED]',
];

/**
 * Escape special markers in user input to prevent prompt injection.
 * Replaces the opening bracket with an escaped version for known markers.
 *
 * @param text - User input text to sanitize
 * @returns Sanitized text with markers escaped
 */
export function escapeMarkers(text: string): string {
  if (!text) return text;

  let result = text;

  for (const marker of ESCAPE_MARKERS) {
    // Escape by replacing [ with \[ for these specific markers
    // Use case-insensitive matching to catch variations
    const escaped = marker.replace('[', '\\[');
    const regex = new RegExp(escapeRegex(marker), 'gi');
    result = result.replace(regex, escaped);
  }

  return result;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize a session object's user-provided fields
 * Returns a new object with sanitized values
 */
export function sanitizeSessionInput(session: {
  title?: string;
  featureDescription?: string;
  technicalNotes?: string;
  acceptanceCriteria?: string[];
  affectedFiles?: string[];
}): {
  title?: string;
  featureDescription?: string;
  technicalNotes?: string;
  acceptanceCriteria?: string[];
  affectedFiles?: string[];
} {
  return {
    title: session.title ? escapeMarkers(session.title) : session.title,
    featureDescription: session.featureDescription
      ? escapeMarkers(session.featureDescription)
      : session.featureDescription,
    technicalNotes: session.technicalNotes
      ? escapeMarkers(session.technicalNotes)
      : session.technicalNotes,
    acceptanceCriteria: session.acceptanceCriteria?.map(escapeMarkers),
    affectedFiles: session.affectedFiles?.map(escapeMarkers),
  };
}

/**
 * Sanitize remarks/comments from user input
 */
export function sanitizeRemarks(remarks: string): string {
  return escapeMarkers(remarks);
}

/**
 * Check if text contains any unsanitized markers
 * Useful for validation and debugging
 */
export function containsMarkers(text: string): { hasMarkers: boolean; markers: string[] } {
  if (!text) return { hasMarkers: false, markers: [] };

  const foundMarkers: string[] = [];

  for (const marker of ESCAPE_MARKERS) {
    const regex = new RegExp(escapeRegex(marker), 'gi');
    if (regex.test(text)) {
      foundMarkers.push(marker);
    }
  }

  return {
    hasMarkers: foundMarkers.length > 0,
    markers: foundMarkers,
  };
}

/**
 * List of markers that are escaped (exported for reference)
 */
export const ESCAPED_MARKERS = ESCAPE_MARKERS;

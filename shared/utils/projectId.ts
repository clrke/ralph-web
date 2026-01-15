/**
 * Generate a consistent project ID from a project path.
 * Uses SHA-256 hash truncated to 32 hex characters.
 *
 * This utility ensures client and server generate identical project IDs.
 */

/**
 * Generate project ID synchronously (Node.js only)
 * Use this on the server side where crypto module is available.
 */
export function generateProjectIdSync(projectPath: string): string {
  // Dynamic import to avoid bundling issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(projectPath).digest('hex').substring(0, 32);
}

/**
 * Generate project ID asynchronously (Browser + Node.js)
 * Use this on the client side where Web Crypto API is available.
 */
export async function generateProjectId(projectPath: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(projectPath);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 32);
}

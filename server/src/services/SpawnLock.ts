/**
 * SpawnLock - Mutex/Lock for preventing concurrent Claude spawns
 *
 * Prevents race conditions when batch answers trigger multiple spawn attempts.
 * Uses in-memory locks with automatic timeout release for safety.
 */

// Lock timeout in milliseconds (10 minutes)
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

interface LockEntry {
  locked: boolean;
  acquiredAt: Date;
  stage: number;
}

// In-memory lock map: sessionKey -> LockEntry
const locks = new Map<string, LockEntry>();

// Cleanup interval reference (for test teardown)
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Generate a unique key for a session
 */
function getSessionKey(projectId: string, featureId: string): string {
  return `${projectId}/${featureId}`;
}

/**
 * Check if a lock has expired based on timeout
 */
function isLockExpired(entry: LockEntry): boolean {
  const now = new Date();
  const elapsed = now.getTime() - entry.acquiredAt.getTime();
  return elapsed >= LOCK_TIMEOUT_MS;
}

/**
 * Clean up expired locks (called periodically)
 */
export function cleanupExpiredLocks(): void {
  for (const [key, entry] of locks.entries()) {
    if (entry.locked && isLockExpired(entry)) {
      console.log(`[SpawnLock] Auto-releasing expired lock for ${key} (was locked for Stage ${entry.stage})`);
      locks.delete(key);
    }
  }
}

/**
 * Start the cleanup interval
 */
export function startCleanupInterval(): void {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupExpiredLocks, 60 * 1000);
    // Prevent the interval from keeping the process alive during tests
    if (cleanupInterval.unref) {
      cleanupInterval.unref();
    }
  }
}

/**
 * Stop the cleanup interval (for testing)
 */
export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Start cleanup interval on module load
startCleanupInterval();

/**
 * Attempt to acquire a lock for a session
 * Returns true if lock acquired, false if already locked
 */
export function acquireLock(projectId: string, featureId: string, stage: number): boolean {
  const key = getSessionKey(projectId, featureId);
  const existing = locks.get(key);

  // Check if already locked and not expired
  if (existing && existing.locked && !isLockExpired(existing)) {
    console.log(`[SpawnLock] Lock already held for ${key} (Stage ${existing.stage}), cannot acquire for Stage ${stage}`);
    return false;
  }

  // Acquire lock
  locks.set(key, {
    locked: true,
    acquiredAt: new Date(),
    stage,
  });

  console.log(`[SpawnLock] Lock acquired for ${key} (Stage ${stage})`);
  return true;
}

/**
 * Release a lock for a session
 */
export function releaseLock(projectId: string, featureId: string): void {
  const key = getSessionKey(projectId, featureId);
  const existing = locks.get(key);

  if (existing) {
    console.log(`[SpawnLock] Lock released for ${key} (was Stage ${existing.stage})`);
    locks.delete(key);
  }
}

/**
 * Check if a session is currently locked
 */
export function isLocked(projectId: string, featureId: string): boolean {
  const key = getSessionKey(projectId, featureId);
  const existing = locks.get(key);

  if (!existing) return false;
  if (!existing.locked) return false;
  if (isLockExpired(existing)) {
    // Expired - clean it up
    locks.delete(key);
    return false;
  }

  return true;
}

/**
 * Get lock status information for a session
 */
export function getLockStatus(projectId: string, featureId: string): {
  locked: boolean;
  stage?: number;
  acquiredAt?: Date;
  elapsedMs?: number;
} | null {
  const key = getSessionKey(projectId, featureId);
  const existing = locks.get(key);

  if (!existing) return null;
  if (!existing.locked) return { locked: false };
  if (isLockExpired(existing)) {
    locks.delete(key);
    return { locked: false };
  }

  const now = new Date();
  return {
    locked: true,
    stage: existing.stage,
    acquiredAt: existing.acquiredAt,
    elapsedMs: now.getTime() - existing.acquiredAt.getTime(),
  };
}

/**
 * Force release all locks (for testing/emergency reset)
 */
export function releaseAllLocks(): void {
  console.log(`[SpawnLock] Force releasing all ${locks.size} locks`);
  locks.clear();
}

/**
 * Get count of active locks (for monitoring)
 */
export function getActiveLockCount(): number {
  // Clean up expired first
  cleanupExpiredLocks();
  return locks.size;
}

/**
 * Execute a function with a lock held, ensuring lock is released even if function throws
 * @returns Result of the function, or throws if lock couldn't be acquired
 */
export async function withLock<T>(
  projectId: string,
  featureId: string,
  stage: number,
  fn: () => Promise<T>
): Promise<T> {
  if (!acquireLock(projectId, featureId, stage)) {
    throw new SpawnLockError(
      `Cannot acquire spawn lock for ${projectId}/${featureId} - another spawn is in progress`
    );
  }

  try {
    return await fn();
  } finally {
    releaseLock(projectId, featureId);
  }
}

/**
 * Custom error for spawn lock failures
 */
export class SpawnLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpawnLockError';
  }
}

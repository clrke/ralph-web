import {
  acquireLock,
  releaseLock,
  isLocked,
  getLockStatus,
  releaseAllLocks,
  getActiveLockCount,
  withLock,
  SpawnLockError,
  stopCleanupInterval,
} from '../../server/src/services/SpawnLock';

describe('SpawnLock', () => {
  beforeEach(() => {
    // Clean up any locks from previous tests
    releaseAllLocks();
  });

  afterEach(() => {
    releaseAllLocks();
  });

  afterAll(() => {
    // Stop the cleanup interval to allow Jest to exit
    stopCleanupInterval();
  });

  describe('acquireLock', () => {
    it('should acquire lock successfully when not locked', () => {
      const result = acquireLock('project1', 'feature1', 2);
      expect(result).toBe(true);
    });

    it('should fail to acquire lock when already locked', () => {
      const first = acquireLock('project1', 'feature1', 2);
      expect(first).toBe(true);

      const second = acquireLock('project1', 'feature1', 3);
      expect(second).toBe(false);
    });

    it('should allow different sessions to acquire locks independently', () => {
      const first = acquireLock('project1', 'feature1', 2);
      const second = acquireLock('project1', 'feature2', 2);
      const third = acquireLock('project2', 'feature1', 2);

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(third).toBe(true);
    });

    it('should re-acquire lock after release', () => {
      const first = acquireLock('project1', 'feature1', 2);
      expect(first).toBe(true);

      releaseLock('project1', 'feature1');

      const second = acquireLock('project1', 'feature1', 3);
      expect(second).toBe(true);
    });
  });

  describe('releaseLock', () => {
    it('should release an existing lock', () => {
      acquireLock('project1', 'feature1', 2);
      expect(isLocked('project1', 'feature1')).toBe(true);

      releaseLock('project1', 'feature1');
      expect(isLocked('project1', 'feature1')).toBe(false);
    });

    it('should handle releasing non-existent lock gracefully', () => {
      // Should not throw
      expect(() => releaseLock('project1', 'nonexistent')).not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('should return true when locked', () => {
      acquireLock('project1', 'feature1', 2);
      expect(isLocked('project1', 'feature1')).toBe(true);
    });

    it('should return false when not locked', () => {
      expect(isLocked('project1', 'feature1')).toBe(false);
    });

    it('should return false after lock is released', () => {
      acquireLock('project1', 'feature1', 2);
      releaseLock('project1', 'feature1');
      expect(isLocked('project1', 'feature1')).toBe(false);
    });
  });

  describe('getLockStatus', () => {
    it('should return null for non-existent session', () => {
      const status = getLockStatus('project1', 'nonexistent');
      expect(status).toBeNull();
    });

    it('should return lock details when locked', () => {
      acquireLock('project1', 'feature1', 2);
      const status = getLockStatus('project1', 'feature1');

      expect(status).not.toBeNull();
      expect(status?.locked).toBe(true);
      expect(status?.stage).toBe(2);
      expect(status?.acquiredAt).toBeInstanceOf(Date);
      expect(typeof status?.elapsedMs).toBe('number');
    });

    it('should return locked=false after release', () => {
      acquireLock('project1', 'feature1', 2);
      releaseLock('project1', 'feature1');

      const status = getLockStatus('project1', 'feature1');
      expect(status).toBeNull();
    });
  });

  describe('releaseAllLocks', () => {
    it('should clear all locks', () => {
      acquireLock('project1', 'feature1', 2);
      acquireLock('project1', 'feature2', 3);
      acquireLock('project2', 'feature1', 2);

      expect(getActiveLockCount()).toBe(3);

      releaseAllLocks();

      expect(getActiveLockCount()).toBe(0);
      expect(isLocked('project1', 'feature1')).toBe(false);
      expect(isLocked('project1', 'feature2')).toBe(false);
      expect(isLocked('project2', 'feature1')).toBe(false);
    });
  });

  describe('getActiveLockCount', () => {
    it('should return 0 when no locks', () => {
      expect(getActiveLockCount()).toBe(0);
    });

    it('should return correct count of active locks', () => {
      acquireLock('project1', 'feature1', 2);
      expect(getActiveLockCount()).toBe(1);

      acquireLock('project1', 'feature2', 2);
      expect(getActiveLockCount()).toBe(2);

      releaseLock('project1', 'feature1');
      expect(getActiveLockCount()).toBe(1);
    });
  });

  describe('withLock', () => {
    it('should execute function when lock is available', async () => {
      let executed = false;

      await withLock('project1', 'feature1', 2, async () => {
        executed = true;
        return 'result';
      });

      expect(executed).toBe(true);
    });

    it('should release lock after successful execution', async () => {
      await withLock('project1', 'feature1', 2, async () => {
        return 'result';
      });

      expect(isLocked('project1', 'feature1')).toBe(false);
    });

    it('should release lock after failed execution', async () => {
      try {
        await withLock('project1', 'feature1', 2, async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(isLocked('project1', 'feature1')).toBe(false);
    });

    it('should throw SpawnLockError when lock unavailable', async () => {
      acquireLock('project1', 'feature1', 2);

      await expect(
        withLock('project1', 'feature1', 3, async () => {
          return 'result';
        })
      ).rejects.toThrow(SpawnLockError);
    });

    it('should return function result', async () => {
      const result = await withLock('project1', 'feature1', 2, async () => {
        return 'expected result';
      });

      expect(result).toBe('expected result');
    });
  });

  describe('SpawnLockError', () => {
    it('should have correct name', () => {
      const error = new SpawnLockError('test message');
      expect(error.name).toBe('SpawnLockError');
    });

    it('should have correct message', () => {
      const error = new SpawnLockError('test message');
      expect(error.message).toBe('test message');
    });

    it('should be instanceof Error', () => {
      const error = new SpawnLockError('test message');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent acquire attempts', async () => {
      // Simulate concurrent requests
      const results = await Promise.all([
        Promise.resolve(acquireLock('project1', 'feature1', 1)),
        new Promise(resolve => setTimeout(() => resolve(acquireLock('project1', 'feature1', 2)), 1)),
        new Promise(resolve => setTimeout(() => resolve(acquireLock('project1', 'feature1', 3)), 2)),
      ]);

      // Only one should succeed
      const successCount = results.filter(r => r === true).length;
      expect(successCount).toBe(1);
    });
  });
});

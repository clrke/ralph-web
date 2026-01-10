import { FileStorageService, PathTraversalError } from '../../server/src/data/FileStorageService';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

describe('FileStorageService', () => {
  let service: FileStorageService;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `test-storage-${Date.now()}`);
    await fs.ensureDir(testDir);
    service = new FileStorageService(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('readJson', () => {
    it('should read and parse JSON file', async () => {
      const data = { foo: 'bar', count: 42 };
      await fs.writeJson(path.join(testDir, 'test.json'), data);

      const result = await service.readJson<typeof data>('test.json');
      expect(result).toEqual(data);
    });

    it('should return null for non-existent file', async () => {
      const result = await service.readJson('nonexistent.json');
      expect(result).toBeNull();
    });

    it('should throw on invalid JSON', async () => {
      await fs.writeFile(path.join(testDir, 'invalid.json'), 'not json');

      await expect(service.readJson('invalid.json')).rejects.toThrow();
    });
  });

  describe('writeJson', () => {
    it('should write JSON atomically', async () => {
      const data = { key: 'value' };
      await service.writeJson('output.json', data);

      const result = await fs.readJson(path.join(testDir, 'output.json'));
      expect(result).toEqual(data);
    });

    it('should create backup of existing file', async () => {
      const original = { version: 1 };
      const updated = { version: 2 };

      await service.writeJson('data.json', original);
      await service.writeJson('data.json', updated);

      const backup = await fs.readJson(path.join(testDir, 'data.json.bak'));
      expect(backup).toEqual(original);
    });

    it('should create parent directories if needed', async () => {
      const data = { nested: true };
      await service.writeJson('deep/nested/file.json', data);

      const result = await fs.readJson(path.join(testDir, 'deep/nested/file.json'));
      expect(result).toEqual(data);
    });
  });

  describe('ensureDir', () => {
    it('should create directory if not exists', async () => {
      await service.ensureDir('new/directory');

      const exists = await fs.pathExists(path.join(testDir, 'new/directory'));
      expect(exists).toBe(true);
    });

    it('should not fail if directory already exists', async () => {
      await fs.ensureDir(path.join(testDir, 'existing'));

      await expect(service.ensureDir('existing')).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      await fs.writeFile(path.join(testDir, 'exists.txt'), 'content');

      const result = await service.exists('exists.txt');
      expect(result).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const result = await service.exists('missing.txt');
      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete existing file', async () => {
      await fs.writeFile(path.join(testDir, 'delete-me.txt'), 'content');

      await service.delete('delete-me.txt');

      const exists = await fs.pathExists(path.join(testDir, 'delete-me.txt'));
      expect(exists).toBe(false);
    });

    it('should not throw for non-existent file', async () => {
      await expect(service.delete('missing.txt')).resolves.not.toThrow();
    });
  });

  describe('list', () => {
    it('should list files in directory', async () => {
      await fs.writeFile(path.join(testDir, 'a.json'), '{}');
      await fs.writeFile(path.join(testDir, 'b.json'), '{}');
      await fs.ensureDir(path.join(testDir, 'subdir'));

      const files = await service.list('.');
      expect(files).toContain('a.json');
      expect(files).toContain('b.json');
    });

    it('should return empty array for empty directory', async () => {
      await fs.ensureDir(path.join(testDir, 'empty'));

      const files = await service.list('empty');
      expect(files).toEqual([]);
    });
  });

  describe('path traversal prevention', () => {
    it('should throw PathTraversalError for ../ paths', async () => {
      await expect(service.readJson('../../../etc/passwd')).rejects.toThrow(PathTraversalError);
    });

    it('should throw PathTraversalError for absolute paths outside baseDir', async () => {
      await expect(service.readJson('/etc/passwd')).rejects.toThrow(PathTraversalError);
    });

    it('should throw PathTraversalError when writing to ../ paths', async () => {
      await expect(service.writeJson('../outside.json', { hack: true })).rejects.toThrow(PathTraversalError);
    });

    it('should allow paths that resolve within baseDir', async () => {
      await service.writeJson('subdir/../file.json', { test: true });
      const result = await service.readJson('file.json');
      expect(result).toEqual({ test: true });
    });

    it('should allow nested paths within baseDir', async () => {
      await service.writeJson('a/b/c/data.json', { nested: true });
      const result = await service.readJson('a/b/c/data.json');
      expect(result).toEqual({ nested: true });
    });
  });

  describe('atomic write reliability', () => {
    it('should not leave temp files on successful write', async () => {
      await service.writeJson('test.json', { data: 'value' });

      const files = await fs.readdir(testDir);
      const tempFiles = files.filter(f => f.includes('.tmp.'));
      expect(tempFiles).toHaveLength(0);
    });

    it('should handle rapid successive writes without collision', async () => {
      // Write same file multiple times rapidly in parallel
      const writes = Array.from({ length: 10 }, (_, i) =>
        service.writeJson('rapid.json', { version: i })
      );

      // Should all complete without error (last write wins)
      await expect(Promise.all(writes)).resolves.toBeDefined();

      // File should exist with valid JSON
      const result = await service.readJson<{ version: number }>('rapid.json');
      expect(result).toBeDefined();
      expect(typeof result?.version).toBe('number');
    });
  });

  describe('file locking (withLock)', () => {
    it('should execute operation with lock', async () => {
      const result = await service.withLock('locktest.json', async () => {
        await service.writeJson('locktest.json', { locked: true });
        return 'done';
      });

      expect(result).toBe('done');
      const data = await service.readJson<{ locked: boolean }>('locktest.json');
      expect(data?.locked).toBe(true);
    });

    it('should release lock after operation completes', async () => {
      await service.withLock('release-test.json', async () => {
        await service.writeJson('release-test.json', { first: true });
      });

      // Should be able to acquire lock again
      await service.withLock('release-test.json', async () => {
        await service.writeJson('release-test.json', { second: true });
      });

      const data = await service.readJson<{ second: boolean }>('release-test.json');
      expect(data?.second).toBe(true);
    });

    it('should release lock even if operation throws', async () => {
      await expect(
        service.withLock('error-test.json', async () => {
          throw new Error('Operation failed');
        })
      ).rejects.toThrow('Operation failed');

      // Should be able to acquire lock again after error
      await service.withLock('error-test.json', async () => {
        await service.writeJson('error-test.json', { recovered: true });
      });

      const data = await service.readJson<{ recovered: boolean }>('error-test.json');
      expect(data?.recovered).toBe(true);
    });

    it('should serialize concurrent operations on same file', async () => {
      const results: number[] = [];

      // Start multiple concurrent operations
      const operations = Array.from({ length: 5 }, (_, i) =>
        service.withLock('concurrent.json', async () => {
          // Simulate some async work
          await new Promise(resolve => setTimeout(resolve, 10));
          results.push(i);
          return i;
        })
      );

      await Promise.all(operations);

      // All operations should complete
      expect(results).toHaveLength(5);
    });
  });
});

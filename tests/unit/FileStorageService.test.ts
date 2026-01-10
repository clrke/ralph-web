import { FileStorageService } from '../../server/src/data/FileStorageService';
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
});

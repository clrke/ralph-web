import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import * as lockfile from 'proper-lockfile';

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}

export class FileStorageService {
  private readonly normalizedBaseDir: string;

  constructor(private readonly baseDir: string) {
    this.normalizedBaseDir = path.resolve(baseDir);
  }

  private resolvePath(relativePath: string): string {
    // Resolve the full path
    const fullPath = path.resolve(this.normalizedBaseDir, relativePath);

    // Security: Ensure resolved path is within baseDir (prevent path traversal)
    if (!fullPath.startsWith(this.normalizedBaseDir + path.sep) && fullPath !== this.normalizedBaseDir) {
      throw new PathTraversalError(`Path traversal detected: ${relativePath} resolves outside base directory`);
    }

    return fullPath;
  }

  async readJson<T>(relativePath: string): Promise<T | null> {
    const fullPath = this.resolvePath(relativePath);

    if (!(await fs.pathExists(fullPath))) {
      return null;
    }

    return fs.readJson(fullPath);
  }

  async writeJson<T>(relativePath: string, data: T): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    const dir = path.dirname(fullPath);

    // Ensure parent directory exists
    await fs.ensureDir(dir);

    // Create backup if file exists
    if (await fs.pathExists(fullPath)) {
      await fs.copy(fullPath, `${fullPath}.bak`);
    }

    // Atomic write: write to temp file, then rename
    // Use random suffix to avoid collisions in rapid succession
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const tempPath = `${fullPath}.tmp.${Date.now()}.${randomSuffix}`;

    try {
      await fs.writeJson(tempPath, data, { spaces: 2 });
      await fs.rename(tempPath, fullPath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await fs.remove(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  async ensureDir(relativePath: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    await fs.ensureDir(fullPath);
  }

  async exists(relativePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(relativePath);
    return fs.pathExists(fullPath);
  }

  async delete(relativePath: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    await fs.remove(fullPath);
  }

  async list(relativePath: string): Promise<string[]> {
    const fullPath = this.resolvePath(relativePath);

    if (!(await fs.pathExists(fullPath))) {
      return [];
    }

    const entries = await fs.readdir(fullPath);
    const files: string[] = [];

    for (const entry of entries) {
      const entryPath = path.join(fullPath, entry);
      const stat = await fs.stat(entryPath);
      if (stat.isFile()) {
        files.push(entry);
      }
    }

    return files;
  }

  /**
   * Execute an operation with a file lock (README lines 1004-1011)
   * Prevents concurrent write conflicts using proper-lockfile
   */
  async withLock<T>(relativePath: string, operation: () => Promise<T>): Promise<T> {
    const fullPath = this.resolvePath(relativePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists for lock file
    await fs.ensureDir(dir);

    // Create an empty file if it doesn't exist (lockfile needs a file to lock)
    if (!(await fs.pathExists(fullPath))) {
      await fs.writeJson(fullPath, {});
    }

    // Acquire lock with retry options
    const release = await lockfile.lock(fullPath, {
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000,
        factor: 2,
      },
      stale: 10000, // Consider lock stale after 10 seconds
    });

    try {
      return await operation();
    } finally {
      // Always release the lock
      await release();
    }
  }
}

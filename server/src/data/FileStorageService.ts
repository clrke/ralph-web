import * as fs from 'fs-extra';
import * as path from 'path';

export class FileStorageService {
  constructor(private readonly baseDir: string) {}

  private resolvePath(relativePath: string): string {
    return path.join(this.baseDir, relativePath);
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
    const tempPath = `${fullPath}.tmp.${Date.now()}`;
    await fs.writeJson(tempPath, data, { spaces: 2 });
    await fs.rename(tempPath, fullPath);
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
}

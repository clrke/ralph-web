import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Log Rotation Configuration
 * Per README spec:
 * - LOG_MAX_SIZE_MB: 50 (Max size per log file before rotation)
 * - LOG_MAX_FILES: 10 (Number of rotated files to keep)
 * - LOG_RETENTION_DAYS: 30 (Days to keep old logs)
 */
export interface LogRotationConfig {
  maxSizeMB: number;
  maxFiles: number;
  retentionDays: number;
}

export const DEFAULT_LOG_ROTATION_CONFIG: LogRotationConfig = {
  maxSizeMB: 50,
  maxFiles: 10,
  retentionDays: 30,
};

/**
 * Get file size in bytes
 */
async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch (error) {
    // File doesn't exist
    return 0;
  }
}

/**
 * Get file modification time
 */
async function getFileModTime(filePath: string): Promise<Date | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime;
  } catch (error) {
    return null;
  }
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rotate a log file by creating numbered backups
 * file.json -> file.1.json -> file.2.json -> etc.
 */
export async function rotateLogFile(
  filePath: string,
  config: LogRotationConfig = DEFAULT_LOG_ROTATION_CONFIG
): Promise<{ rotated: boolean; backupPath?: string }> {
  // Check if file exists and needs rotation
  const size = await getFileSize(filePath);
  const maxSizeBytes = config.maxSizeMB * 1024 * 1024;

  if (size < maxSizeBytes) {
    return { rotated: false };
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  // Shift existing rotated files
  // file.9.json -> file.10.json, file.8.json -> file.9.json, etc.
  for (let i = config.maxFiles - 1; i >= 1; i--) {
    const oldPath = path.join(dir, `${base}.${i}${ext}`);
    const newPath = path.join(dir, `${base}.${i + 1}${ext}`);

    if (await fileExists(oldPath)) {
      if (i + 1 > config.maxFiles) {
        // Delete files beyond max
        await fs.unlink(oldPath);
      } else {
        await fs.rename(oldPath, newPath);
      }
    }
  }

  // Rotate current file to .1
  const backupPath = path.join(dir, `${base}.1${ext}`);
  await fs.rename(filePath, backupPath);

  // Create empty new file
  await fs.writeFile(filePath, '');

  return { rotated: true, backupPath };
}

/**
 * Clean up old log files based on retention policy
 */
export async function cleanupOldLogs(
  directory: string,
  config: LogRotationConfig = DEFAULT_LOG_ROTATION_CONFIG
): Promise<{ deletedFiles: string[] }> {
  const deletedFiles: string[] = [];
  const now = new Date();
  const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000;

  try {
    const files = await fs.readdir(directory);

    for (const file of files) {
      // Only process rotated log files (files with .N. pattern before extension)
      const rotatedPattern = /\.\d+\.(json|log)$/;
      if (!rotatedPattern.test(file)) {
        continue;
      }

      const filePath = path.join(directory, file);
      const modTime = await getFileModTime(filePath);

      if (modTime) {
        const age = now.getTime() - modTime.getTime();
        if (age > retentionMs) {
          await fs.unlink(filePath);
          deletedFiles.push(file);
        }
      }
    }
  } catch (error) {
    // Directory doesn't exist or other error - silently ignore
  }

  return { deletedFiles };
}

/**
 * Check if file needs rotation and rotate if necessary
 * This is the main entry point for log rotation
 */
export async function checkAndRotate(
  filePath: string,
  config: LogRotationConfig = DEFAULT_LOG_ROTATION_CONFIG
): Promise<{
  rotated: boolean;
  backupPath?: string;
  sizeBeforeBytes?: number;
}> {
  const size = await getFileSize(filePath);
  const maxSizeBytes = config.maxSizeMB * 1024 * 1024;

  if (size >= maxSizeBytes) {
    const result = await rotateLogFile(filePath, config);
    return {
      ...result,
      sizeBeforeBytes: size,
    };
  }

  return { rotated: false };
}

/**
 * Log Rotation Manager for a session directory
 * Handles automatic rotation of common log files
 */
export class LogRotationManager {
  private config: LogRotationConfig;
  private sessionDir: string;

  // Files that should be rotated
  private readonly rotateableFiles = [
    'conversations.json',
    'status.json',
    'questions.json',
  ];

  constructor(sessionDir: string, config: LogRotationConfig = DEFAULT_LOG_ROTATION_CONFIG) {
    this.sessionDir = sessionDir;
    this.config = config;
  }

  /**
   * Check and rotate all rotatable files in the session directory
   */
  async rotateAll(): Promise<{
    rotated: string[];
    errors: Array<{ file: string; error: string }>;
  }> {
    const rotated: string[] = [];
    const errors: Array<{ file: string; error: string }> = [];

    for (const file of this.rotateableFiles) {
      const filePath = path.join(this.sessionDir, file);

      try {
        const result = await checkAndRotate(filePath, this.config);
        if (result.rotated) {
          rotated.push(file);
          console.log(`[LogRotation] Rotated ${file} (was ${result.sizeBeforeBytes} bytes)`);
        }
      } catch (error) {
        errors.push({
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { rotated, errors };
  }

  /**
   * Clean up old rotated log files
   */
  async cleanup(): Promise<{ deletedFiles: string[] }> {
    return cleanupOldLogs(this.sessionDir, this.config);
  }

  /**
   * Get current log file sizes
   */
  async getLogSizes(): Promise<Array<{ file: string; sizeBytes: number; sizeMB: number }>> {
    const sizes: Array<{ file: string; sizeBytes: number; sizeMB: number }> = [];

    for (const file of this.rotateableFiles) {
      const filePath = path.join(this.sessionDir, file);
      const sizeBytes = await getFileSize(filePath);
      sizes.push({
        file,
        sizeBytes,
        sizeMB: sizeBytes / (1024 * 1024),
      });
    }

    return sizes;
  }

  /**
   * Check if any files need rotation
   */
  async needsRotation(): Promise<{ needsRotation: boolean; files: string[] }> {
    const maxSizeBytes = this.config.maxSizeMB * 1024 * 1024;
    const files: string[] = [];

    for (const file of this.rotateableFiles) {
      const filePath = path.join(this.sessionDir, file);
      const size = await getFileSize(filePath);
      if (size >= maxSizeBytes) {
        files.push(file);
      }
    }

    return {
      needsRotation: files.length > 0,
      files,
    };
  }
}

/**
 * Create a LogRotationManager instance
 */
export function createLogRotationManager(
  sessionDir: string,
  config?: Partial<LogRotationConfig>
): LogRotationManager {
  const mergedConfig = { ...DEFAULT_LOG_ROTATION_CONFIG, ...config };
  return new LogRotationManager(sessionDir, mergedConfig);
}

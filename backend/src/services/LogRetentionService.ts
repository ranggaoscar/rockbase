import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_MAX_SIZE_MB = 250;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface LogFileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

export class LogRetentionService {
  private timer: NodeJS.Timeout | null = null;
  private readonly logsDir = path.join(process.cwd(), 'logs');
  private readonly retentionDays = Number(process.env.LOG_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
  private readonly maxSizeBytes = Number(process.env.LOG_MAX_SIZE_MB || DEFAULT_MAX_SIZE_MB) * 1024 * 1024;

  public init() {
    this.cleanup();
    if (!this.timer) {
      this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    }
  }

  public cleanup() {
    if (!fs.existsSync(this.logsDir)) return;

    const files = this.listLogFiles();
    const cutoffMs = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const file of files) {
      if (file.mtimeMs < cutoffMs) {
        if (this.deleteFile(file.path)) deleted++;
      }
    }

    const remaining = this.listLogFiles().sort((a, b) => b.mtimeMs - a.mtimeMs);
    let totalSize = remaining.reduce((sum, file) => sum + file.size, 0);

    for (const file of [...remaining].reverse()) {
      if (totalSize <= this.maxSizeBytes) break;
      if (this.deleteFile(file.path)) {
        totalSize -= file.size;
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(
        `[LogRetention] Deleted ${deleted} old log screenshot(s). ` +
        `Current logs size: ${Math.round(totalSize / 1024 / 1024)}MB`
      );
    }
  }

  private listLogFiles(): LogFileInfo[] {
    return fs.readdirSync(this.logsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(this.logsDir, entry.name);
        const stat = fs.statSync(filePath);
        return { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs };
      });
  }

  private deleteFile(filePath: string): boolean {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      console.warn(`[LogRetention] Failed to delete ${filePath}:`, err);
      return false;
    }
  }
}

export const logRetentionService = new LogRetentionService();

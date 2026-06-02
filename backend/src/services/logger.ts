/**
 * Logging service with file output at /opt/data/rockbase-logs/
 *
 * Usage:
 *   import { logger } from './services/logger';
 *   logger.info('PostJob started', { postId: '...', accountId: '...' });
 *   logger.error('Post failed', { error: err.message, accountId: '...' });
 *
 * Log rotation: New file every day, keep last 30 days.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), '..', 'logs');
const MAX_LOG_AGE_DAYS = 30;

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, any>;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `rockbase-${date}.log`);
}

function writeToFile(entry: LogEntry): void {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(getLogFilePath(), line, 'utf-8');
  } catch (err) {
    console.error('[Logger] Failed to write to log file:', err);
  }
}

function log(level: LogLevel, message: string, data?: Record<string, any>): void {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message,
    data,
  };

  // Console output
  const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';

  switch (level) {
    case 'info':  console.log(`${prefix} ${message}${dataStr}`); break;
    case 'warn':  console.warn(`${prefix} ${message}${dataStr}`); break;
    case 'error': console.error(`${prefix} ${message}${dataStr}`); break;
    case 'debug': console.debug(`${prefix} ${message}${dataStr}`); break;
  }

  // File output
  writeToFile(entry);
}

// Auto-cleanup old log files (run on startup)
function cleanupOldLogs(): void {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAgeMs = MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith('rockbase-') || !file.endsWith('.log')) continue;
      const filePath = path.join(LOG_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        console.log(`[Logger] Cleaned old log: ${file}`);
      }
    }
  } catch (err) {
    // Silently ignore — cleanup is best-effort
  }
}

// Initialize cleanup
cleanupOldLogs();

export const logger = {
  info: (message: string, data?: Record<string, any>) => log('info', message, data),
  warn: (message: string, data?: Record<string, any>) => log('warn', message, data),
  error: (message: string, data?: Record<string, any>) => log('error', message, data),
  debug: (message: string, data?: Record<string, any>) => log('debug', message, data),
};

/**
 * Read recent log entries from the latest log file.
 * Used by the API endpoint to expose logs.
 */
export function readRecentLogs(lines: number = 200): string[] {
  try {
    const logFile = getLogFilePath();
    if (!fs.existsSync(logFile)) return ['No logs yet.'];

    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.trim().split('\n');
    return allLines.slice(-lines);
  } catch (err) {
    return ['Failed to read log file.'];
  }
}

/**
 * List all log files with metadata.
 */
export function listLogFiles(): Array<{ name: string; size: number; modified: string }> {
  try {
    const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log'));
    return files.map((f) => {
      const stat = fs.statSync(path.join(LOG_DIR, f));
      return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
    }).sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export { LOG_DIR };

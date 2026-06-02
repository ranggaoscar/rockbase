import { Request, Response } from 'express';
import { readRecentLogs, listLogFiles, LOG_DIR } from '../services/logger';

/**
 * GET /api/system/logs?lines=200
 * Returns recent log entries from the current day's log file.
 */
export const getLogs = async (req: Request, res: Response) => {
  try {
    const lines = Math.min(parseInt(req.query.lines as string) || 200, 1000);
    const logs = readRecentLogs(lines);

    return res.status(200).json({
      message: 'Recent logs.',
      logDir: LOG_DIR,
      lines: logs.length,
      data: logs,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to read logs.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * GET /api/system/logs/files
 * Lists all available log files.
 */
export const listLogFilesEndpoint = async (_req: Request, res: Response) => {
  try {
    const files = listLogFiles();
    return res.status(200).json({
      message: 'Log files.',
      logDir: LOG_DIR,
      files,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to list log files.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

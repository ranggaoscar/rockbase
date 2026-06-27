import { Request, Response } from 'express';
import { readRecentLogs, listLogFiles, LOG_DIR } from '../services/logger';
import { Queue } from 'bullmq';

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

/**
 * POST /api/system/queue/clear
 * Clears the automationQueue jobs (wait, delayed, failed, completed).
 */
export const clearQueue = async (_req: Request, res: Response) => {
  try {
    const connection = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };
    const queue = new Queue('automationQueue', { connection });

    const statesToClean = ['wait', 'delayed', 'failed', 'completed'] as const;
    const removedByState: Record<string, number> = {};

    for (const state of statesToClean) {
      let total = 0;
      while (true) {
        const removedJobIds = await queue.clean(0, 10000, state);
        total += removedJobIds.length;
        if (removedJobIds.length < 10000) break;
      }
      removedByState[state] = total;
    }

    await queue.close();

    return res.status(200).json({
      message: 'Queue cleared successfully.',
      removed: removedByState,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to clear queue.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * POST /api/system/queue/reset
 * Auto-recover stuck pending jobs, and mark stale jobs as failed.
 */
export const resetQueue = async (_req: Request, res: Response) => {
  try {
    const connection = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };
    const queue = new Queue('automationQueue', { connection });
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    // 1. Re-queue pending jobs
    const pendingPosts = await prisma.post.findMany({
      where: { status: 'pending' },
    });
    
    let queuedCount = 0;
    for (const post of pendingPosts) {
      try {
        const accountIds = JSON.parse(post.accountIds || '[]');
        const mediaUrls = JSON.parse(post.mediaUrls || '[]');
        for (const accountId of accountIds) {
          await queue.add('postJob', {
            postId: post.id,
            accountId: accountId,
            content: post.content,
            mediaUrls: mediaUrls,
          }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 60000 },
            removeOnComplete: true,
            removeOnFail: false
          });
          queuedCount++;
        }
      } catch (err) {
        console.error(`Failed to re-queue post ${post.id}`, err);
      }
    }

    // 2. Mark old pending_verify as failed
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const updatedVerify = await prisma.post.updateMany({
      where: { 
        status: 'pending_verify',
        createdAt: { lt: oneHourAgo }
      },
      data: { status: 'failed' }
    });

    // 3. Mark stale scheduled as failed
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const updatedScheduled = await prisma.post.updateMany({
      where: { 
        status: 'scheduled',
        scheduleAt: { lt: oneWeekAgo }
      },
      data: { status: 'failed' }
    });

    // 4. Delete failed/warning activity logs of type posting or queue
    await prisma.activityLog.deleteMany({
      where: {
        type: { in: ['posting', 'queue'] },
        status: { in: ['failed', 'warning'] }
      }
    });

    await queue.close();
    await prisma.$disconnect();

    return res.status(200).json({
      message: 'Queue reset successfully.',
      requeuedPending: queuedCount,
      markedFailedPendingVerify: updatedVerify.count,
      markedFailedScheduled: updatedScheduled.count
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to reset queue.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

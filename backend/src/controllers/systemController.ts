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
    
    // 1. Instantiate queues
    const queue = new Queue('automationQueue', { connection });
    const engQueue = new Queue('engagementQueue', { connection });

    // 2. FORCE-KILL all active browsers & Playwright contexts instantly
    console.log('[Emergency Reset] Force-killing Playwright browsers and contexts...');
    const { browserManager } = require('../services/BrowserManager');
    const { sessionPool } = require('../services/SessionPool');
    
    await browserManager.forceKillAll().catch((e: any) => console.error('Error force-killing browsers:', e));
    await sessionPool.releaseAll().catch((e: any) => console.error('Error releasing session pool:', e));

    // 3. WIPE/DRAIN the BullMQ Queues completely
    console.log('[Emergency Reset] Draining automationQueue and engagementQueue...');
    try {
      await queue.drain(true);
      const states = ['wait', 'active', 'delayed', 'paused', 'failed', 'completed'] as const;
      for (const state of states) {
        await queue.clean(0, 100000, state);
      }
    } catch (e: any) {
      console.error('Error cleaning automationQueue:', e);
    }

    try {
      await engQueue.drain(true);
      const states = ['wait', 'active', 'delayed', 'paused', 'failed', 'completed'] as const;
      for (const state of states) {
        await engQueue.clean(0, 100000, state);
      }
    } catch (e: any) {
      console.error('Error cleaning engagementQueue:', e);
    }

    // 4. Update Database statuses of currently pending/running posts to failed
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    // Mark all 'pending' or 'pending_verify' posts as 'failed' (Emergency Stopped)
    const runningPosts = await prisma.post.findMany({
      where: {
        status: { in: ['pending', 'pending_verify'] }
      }
    });

    let updatedPostsCount = 0;
    for (const post of runningPosts) {
      let resultsObj: Record<string, any> = {};
      try {
        resultsObj = JSON.parse(post.results || '{}');
      } catch {}

      // Add emergency stopped note to each account in results
      let accountIds: string[] = [];
      try {
        accountIds = JSON.parse(post.accountIds || '[]');
      } catch {}

      for (const accountId of accountIds) {
        if (!resultsObj[accountId] || resultsObj[accountId].status !== 'success') {
          resultsObj[accountId] = {
            status: 'failed',
            error: 'Emergency Stop triggered by User / Operator',
            message: 'Posting aborted'
          };
        }
      }

      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: 'failed',
          results: JSON.stringify(resultsObj)
        }
      });
      updatedPostsCount++;
    }

    // 5. Clean stale scheduled posts (stale = schedule date is more than 1 day old and not published)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const updatedScheduled = await prisma.post.updateMany({
      where: {
        status: 'scheduled',
        scheduleAt: { lt: oneDayAgo }
      },
      data: {
        status: 'failed'
      }
    });

    // 6. Log the emergency action in activity log
    const { logActivity } = require('../services/ActivityLogService');
    await logActivity({
      workspaceId: 'workspace-default',
      type: 'queue',
      entityType: 'queue',
      entityId: 'emergency-reset',
      action: 'emergency_reset_triggered',
      status: 'warning',
      message: '🚨 Emergency Stop & Reset triggered! All pending and running posting processes have been force-aborted and queues cleared.',
      metadata: { abortedPostsCount: updatedPostsCount }
    }).catch((e: any) => console.error('Error logging activity:', e));

    // 7. Delete warning and failed activity logs of type posting or queue to clean up timeline if they want,
    // but keep our emergency reset log visible!
    await prisma.activityLog.deleteMany({
      where: {
        type: { in: ['posting', 'queue'] },
        status: { in: ['failed', 'warning'] },
        entityId: { not: 'emergency-reset' }
      }
    });

    await queue.close();
    await engQueue.close();
    await prisma.$disconnect();

    return res.status(200).json({
      message: '🚨 Emergency Stop and Queue Wiped successfully! All active automation browsers have been killed and queues drained.',
      abortedPosts: updatedPostsCount,
      markedFailedStaleScheduled: updatedScheduled.count
    });

  } catch (error) {
    return res.status(500).json({
      message: 'Failed to perform emergency stop and queue reset.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

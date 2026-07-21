/**
 * Engagement Routes — REST API for targeted engagement actions.
 */
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { automationGuard } from '../middleware/automation';
import { targetedEngagementService } from '../services/TargetedEngagementService';
import { sessionPool } from '../services/SessionPool';
import { HumanBehavior } from '../services/HumanBehavior';

const router = Router();
const prisma = new PrismaClient();
router.use(authenticateToken);

// ── BullMQ engagement queue (optional) ──────────────────────────────────────
let engagementQueue: Queue | null = null;
try {
  const connection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  };
  engagementQueue = new Queue('engagementQueue', { connection });
} catch {
  console.warn('[engagementRoutes] Redis not available — using direct mode');
}

// Track running engagement tasks
const runningTasks = new Map<string, { aborted: boolean }>();

// ── POST /api/engagement/like — All selected accounts like a post ─────────
router.post('/like', automationGuard, async (req: AuthRequest, res: Response) => {
  try {
    const { postUrl, accountIds } = req.body;
    if (!postUrl || !accountIds?.length) {
      res.status(400).json({ error: 'postUrl and accountIds are required' });
      return;
    }

    const taskId = `like-${Date.now()}`;
    runningTasks.set(taskId, { aborted: false });

    res.status(202).json({
      success: true,
      taskId,
      message: `Queued like action for ${accountIds.length} accounts on ${postUrl}`,
      accountCount: accountIds.length,
      activeHours: HumanBehavior.isActiveHours(),
    });

    // Process in background with staggered timing
    targetedEngagementService.runTargetedAction({
      accountIds,
      actionType: 'like',
      target: postUrl,
      force: true,
      checkAborted: () => runningTasks.get(taskId)?.aborted || false,
    }).catch((err) => {
      console.error(`[Engagement] Like task failed:`, err.message);
    }).finally(() => {
      runningTasks.delete(taskId);
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/engagement/follow — All selected accounts follow a user ─────
router.post('/follow', automationGuard, async (req: AuthRequest, res: Response) => {
  try {
    const { username, accountIds } = req.body;
    if (!username || !accountIds?.length) {
      res.status(400).json({ error: 'username and accountIds are required' });
      return;
    }

    const taskId = `follow-${Date.now()}`;
    runningTasks.set(taskId, { aborted: false });

    res.status(202).json({
      success: true,
      taskId,
      message: `Queued follow action for ${accountIds.length} accounts → @${username}`,
      accountCount: accountIds.length,
    });

    targetedEngagementService.runTargetedAction({
      accountIds,
      actionType: 'follow',
      target: username,
      force: true,
      checkAborted: () => runningTasks.get(taskId)?.aborted || false,
    }).catch((err) => {
      console.error(`[Engagement] Follow task failed:`, err.message);
    }).finally(() => {
      runningTasks.delete(taskId);
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/engagement/comment — All selected accounts comment on a post ─
router.post('/comment', automationGuard, async (req: AuthRequest, res: Response) => {
  try {
    const { postUrl, accountIds } = req.body;
    if (!postUrl || !accountIds?.length) {
      res.status(400).json({ error: 'postUrl and accountIds are required' });
      return;
    }

    const taskId = `comment-${Date.now()}`;
    runningTasks.set(taskId, { aborted: false });

    res.status(202).json({
      success: true,
      taskId,
      message: `Queued AI comment for ${accountIds.length} accounts`,
      accountCount: accountIds.length,
    });

    targetedEngagementService.runTargetedAction({
      accountIds,
      actionType: 'comment',
      target: postUrl,
      aiComment: true,
      force: true,
      checkAborted: () => runningTasks.get(taskId)?.aborted || false,
    }).catch((err) => {
      console.error(`[Engagement] Comment task failed:`, err.message);
    }).finally(() => {
      runningTasks.delete(taskId);
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/engagement/follow-and-like — Follow + like their posts ──────
router.post('/follow-and-like', automationGuard, async (req: AuthRequest, res: Response) => {
  try {
    const { username, accountIds } = req.body;
    if (!username || !accountIds?.length) {
      res.status(400).json({ error: 'username and accountIds are required' });
      return;
    }

    const taskId = `fal-${Date.now()}`;
    runningTasks.set(taskId, { aborted: false });

    res.status(202).json({
      success: true,
      taskId,
      message: `Queued follow+like for ${accountIds.length} accounts → @${username}`,
    });

    targetedEngagementService.runTargetedAction({
      accountIds,
      actionType: 'follow_and_like',
      target: username,
      force: true,
      checkAborted: () => runningTasks.get(taskId)?.aborted || false,
    }).catch((err) => {
      console.error(`[Engagement] Follow+Like task failed:`, err.message);
    }).finally(() => {
      runningTasks.delete(taskId);
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/engagement/hashtag — Auto-engage by hashtag ─────────────────
router.post('/hashtag', automationGuard, async (req: AuthRequest, res: Response) => {
  try {
    const { hashtag, accountIds, actions = { like: true } } = req.body;
    if (!hashtag || !accountIds?.length) {
      res.status(400).json({ error: 'hashtag and accountIds are required' });
      return;
    }

    const taskId = `hashtag-${Date.now()}`;
    runningTasks.set(taskId, { aborted: false });

    res.status(202).json({
      success: true,
      taskId,
      message: `Queued hashtag engagement on #${hashtag.replace('#', '')} for ${accountIds.length} accounts`,
    });

    // Process accounts sequentially with stagger in the background
    (async () => {
      try {
        const delays = HumanBehavior.calculateStaggerDelays(accountIds.length);
        for (let i = 0; i < accountIds.length; i++) {
          if (runningTasks.get(taskId)?.aborted) {
            console.log(`[Engagement] Hashtag engagement campaign aborted.`);
            break;
          }
          if (delays[i] > 0) {
            await new Promise(r => setTimeout(r, delays[i]));
          }
          if (runningTasks.get(taskId)?.aborted) {
            console.log(`[Engagement] Hashtag engagement campaign aborted.`);
            break;
          }
          await targetedEngagementService.engageByHashtag(accountIds[i], hashtag, actions).catch(() => {});
        }
      } finally {
        runningTasks.delete(taskId);
      }
    })();

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/engagement/pool — Session pool status ────────────────────────
router.get('/pool', async (_req: AuthRequest, res: Response) => {
  try {
    const poolStatus = sessionPool.getStatus();
    res.json(poolStatus);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/engagement/status — Current engagement task status ───────────
router.get('/status', async (_req: AuthRequest, res: Response) => {
  try {
    const poolStatus = sessionPool.getStatus();
    const recentLogs = await prisma.engagementLog.findMany({
      orderBy: { executedAt: 'desc' },
      take: 50,
    });

    res.json({
      pool: poolStatus,
      runningTasks: Array.from(runningTasks.keys()),
      isActiveHours: HumanBehavior.isActiveHours(),
      recentActions: recentLogs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/engagement/logs — Engagement history ─────────────────────────
router.get('/logs', async (req: AuthRequest, res: Response) => {
  try {
    const { accountId, limit = '100' } = req.query;
    const where: any = {};
    if (accountId) where.accountId = String(accountId);

    const logs = await prisma.engagementLog.findMany({
      where,
      orderBy: { executedAt: 'desc' },
      take: parseInt(String(limit)),
    });

    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/engagement/stop — Stop all running engagement tasks ─────────
router.post('/stop', async (_req: AuthRequest, res: Response) => {
  try {
    for (const [taskId, control] of runningTasks) {
      control.aborted = true;
    }
    await sessionPool.releaseAll();
    runningTasks.clear();

    res.json({ success: true, message: 'All engagement tasks stopped' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

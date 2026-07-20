import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { automationGuard } from '../middleware/automation';
import { instagramWarmingService } from '../services/InstagramWarmingService';

const router = Router();
const prisma = new PrismaClient();
router.use(authenticateToken);

// ── Track running sessions to prevent parallel runs per account ───────────
const runningSessions = new Set<string>();

// ── Warming task definitions per day range ────────────────────────────────
const WARMING_TASKS: Record<string, { action: string; description: string; count: number }[]> = {
  '1-3':  [
    { action: 'follow',      description: 'Auto-follow 5 accounts',        count: 5 },
    { action: 'like',        description: 'Auto-like 10 posts',            count: 10 },
    { action: 'watch_reel',  description: 'Watch 10 reels',                count: 10 },
  ],
  '4-7':  [
    { action: 'follow',      description: 'Auto-follow 5 accounts',        count: 5 },
    { action: 'like',        description: 'Auto-like 10 posts',            count: 10 },
    { action: 'watch_reel',  description: 'Watch 15 reels',                count: 15 },
    { action: 'comment',     description: 'Comment on 3 posts (AI)',       count: 3 },
  ],
  '8-14': [
    { action: 'follow',      description: 'Auto-follow 5 accounts',        count: 5 },
    { action: 'like',        description: 'Auto-like 10 posts',            count: 10 },
    { action: 'watch_reel',  description: 'Watch 20 reels',                count: 20 },
    { action: 'comment',     description: 'Comment on 3 posts (AI)',       count: 3 },
    { action: 'view_story',  description: 'View 10 stories',               count: 10 },
    { action: 'save_post',   description: 'Save 5 posts',                  count: 5 },
    { action: 'explore',     description: 'Browse Explore for 5 min',      count: 1 },
  ],
};

function getTasksForDay(day: number) {
  if (day <= 3)  return WARMING_TASKS['1-3'];
  if (day <= 7)  return WARMING_TASKS['4-7'];
  return WARMING_TASKS['8-14'];
}

// ── GET /api/warming — list all warming accounts + today's tasks ──────────
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const allAccounts = await prisma.socialAccount.findMany();
    const warming = allAccounts.filter((a: any) => a.status === 'warming_up' || a.warmingDay < 14);
    const result = warming.map((a: any) => ({
      ...a,
      todayTasks: getTasksForDay(a.warmingDay ?? 0),
      progress: Math.round(((a.warmingDay ?? 0) / 14) * 100),
      isRunning: runningSessions.has(a.id),
    }));
    res.json({ accounts: result });
  } catch { res.status(500).json({ error: 'Failed to load warming accounts' }); }
});

// ── POST /api/warming/:accountId/run — start a real Playwright warming session
router.post('/:accountId/run', automationGuard, async (req: AuthRequest, res: Response) => {
  const accountId = String(req.params.accountId);

  try {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    if (account.platform !== 'Instagram') {
      res.status(400).json({ error: 'Only Instagram is supported for automated warming' });
      return;
    }
    if (!account.cookies) {
      res.status(400).json({ error: 'Account has no saved session cookies. Please log in via Farm View first.' });
      return;
    }
    if (runningSessions.has(accountId)) {
      res.status(409).json({ error: 'A warming session is already running for this account' });
      return;
    }

    // Respond immediately — automation runs in background
    res.json({
      success: true,
      message: `Warming session started for @${account.username} (Day ${account.warmingDay})`,
      warmingDay: account.warmingDay,
    });

    // Run in background — don't await in the request handler
    runningSessions.add(accountId);
    instagramWarmingService.runDaySession(accountId)
      .then(async (sessionResult) => {
        console.log(`[Warming] Session done for ${accountId}:`, sessionResult);
        // Auto-advance warming day after a successful full session
        const current = await prisma.socialAccount.findUnique({ where: { id: accountId } });
        if (current) {
          const newDay = Math.min((current.warmingDay ?? 0) + 1, 14);
          const newStatus = newDay >= 14 ? 'active' : 'warming_up';
          await prisma.socialAccount.update({
            where: { id: accountId },
            data: { warmingDay: newDay, status: newStatus, lastActive: new Date() },
          });
        }
      })
      .catch((err) => {
        console.error(`[Warming] Session failed for ${accountId}:`, err.message);
      })
      .finally(() => {
        runningSessions.delete(accountId);
      });
  } catch (err: any) {
    runningSessions.delete(accountId);
    res.status(500).json({ error: 'Failed to start warming session', details: err.message });
  }
});

// ── POST /api/warming/:accountId/run-task — run a single specific task ───
router.post('/:accountId/run-task', automationGuard, async (req: AuthRequest, res: Response) => {
  const accountId = String(req.params.accountId);
  const { task, count } = req.body as { task: 'follow' | 'like' | 'watch_reel' | 'explore' | 'comment' | 'view_story' | 'save_post'; count?: number };

  try {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    if (account.platform !== 'Instagram') { res.status(400).json({ error: 'Instagram only' }); return; }
    if (!account.cookies) {
      res.status(400).json({ error: 'No saved session. Login via Farm View first.' });
      return;
    }
    if (runningSessions.has(accountId)) {
      res.status(409).json({ error: 'Session already running' });
      return;
    }
    if (!['follow', 'like', 'watch_reel', 'explore', 'comment', 'view_story', 'save_post'].includes(task)) {
      res.status(400).json({ error: 'Invalid task. Use: follow, like, watch_reel, explore, comment, view_story, save_post' });
      return;
    }

    res.json({ success: true, message: `Running task: ${task} for @${account.username}` });

    runningSessions.add(accountId);
    const run = task === 'follow'      ? () => instagramWarmingService.autoFollow(accountId, count ?? 5)
              : task === 'like'        ? () => instagramWarmingService.autoLike(accountId, count ?? 10)
              : task === 'watch_reel'  ? () => instagramWarmingService.autoWatchReels(accountId, count ?? 10)
              : task === 'comment'     ? () => instagramWarmingService.autoComment(accountId, count ?? 3)
              : task === 'view_story'  ? () => instagramWarmingService.autoViewStory(accountId, count ?? 10)
              : task === 'save_post'   ? () => instagramWarmingService.autoSavePost(accountId, count ?? 5)
              :                          () => instagramWarmingService.browseExplore(accountId, (count ?? 5) * 60_000);

    run()
      .then((r) => console.log(`[Warming] Task ${task} done:`, r))
      .catch((e) => console.error(`[Warming] Task ${task} failed:`, e.message))
      .finally(() => runningSessions.delete(accountId));
  } catch (err: any) {
    runningSessions.delete(accountId);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/warming/status — which accounts are currently running ─────────
router.get('/status', async (_req: AuthRequest, res: Response) => {
  res.json({ running: Array.from(runningSessions) });
});

// ── POST /api/warming/:accountId/advance-day — manually advance warming day
router.post('/:accountId/advance-day', automationGuard, async (req: AuthRequest, res: Response) => {
  const accountId = String(req.params.accountId);
  try {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    const newDay = Math.min((account.warmingDay ?? 0) + 1, 14);
    const newStatus = newDay >= 14 ? 'active' : 'warming_up';
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: { warmingDay: newDay, status: newStatus, lastActive: new Date() },
    });

    // Log the tasks for this day
    const tasks = getTasksForDay(newDay);
    for (const task of tasks) {
      await prisma.warmingLog.create({
        data: { accountId, day: newDay, action: task.action, status: 'completed', details: task.description },
      });
    }

    res.json({ success: true, newDay, newStatus, promoted: newDay >= 14 });
  } catch { res.status(500).json({ error: 'Failed to advance day' }); }
});

// ── POST /api/warming/:accountId/reset — reset warming ────────────────────
router.post('/:accountId/reset', async (req: AuthRequest, res: Response) => {
  const accountId = String(req.params.accountId);
  try {
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: { warmingDay: 0, status: 'warming_up', warmingStartDate: new Date() },
    });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to reset warming' }); }
});

// ── GET /api/warming/logs/:accountId ──────────────────────────────────────
router.get('/logs/:accountId', async (req: AuthRequest, res: Response) => {
  const accountId = String(req.params.accountId);
  try {
    const logs = await prisma.warmingLog.findMany({
      where: { accountId },
      orderBy: { executedAt: 'desc' },
      take: 100,
    });
    res.json({ logs });
  } catch { res.status(500).json({ error: 'Failed to fetch logs' }); }
});

export default router;

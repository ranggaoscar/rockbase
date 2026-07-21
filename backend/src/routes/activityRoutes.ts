import { Router, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { postingEventEmitter } from '../services/PostingEventEmitter';

const router = Router();
const prisma = new PrismaClient();
const MAX_LIMIT = 100;
let queue: Queue | null = null;
try {
  queue = new Queue('automationQueue', {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
  });
} catch {
  console.warn('[activityRoutes] Redis not available — BullMQ queue disabled');
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function categoryWhere(category?: string): Prisma.ActivityLogWhereInput {
  switch (category) {
    case 'posting':
      return { OR: [{ type: 'posting' }, { type: 'queue' }] };
    case 'warming':
      return { type: 'warming' };
    case 'campaigns':
      return { type: 'campaign' };
    case 'session_health':
      return { OR: [{ type: 'session' }, { action: { contains: 'session' } }] };
    case 'groups':
      return { type: 'group' };
    case 'ai_planning':
      return {
        OR: [
          { type: 'ai' },
          { action: { contains: 'ai_plan' } },
          { action: { contains: 'content_variations' } },
          { action: { contains: 'caption_seed' } },
        ],
      };
    default:
      return {};
  }
}

router.use(authenticateToken);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), MAX_LIMIT);
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const filters: Prisma.ActivityLogWhereInput = {
      ...(req.query.workspaceId ? { workspaceId: String(req.query.workspaceId) } : {}),
      ...(req.query.type ? { type: String(req.query.type) } : {}),
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(req.query.accountId ? { accountId: String(req.query.accountId) } : {}),
      ...(req.query.groupId ? { groupId: String(req.query.groupId) } : {}),
      ...(req.query.campaignId ? { campaignId: String(req.query.campaignId) } : {}),
      ...categoryWhere(req.query.category ? String(req.query.category) : undefined),
    };

    const rows = await prisma.activityLog.findMany({
      where: filters,
      select: {
        id: true,
        type: true,
        entityType: true,
        entityId: true,
        accountId: true,
        groupId: true,
        campaignId: true,
        action: true,
        status: true,
        message: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const activity = rows.slice(0, limit);
    const accountIds = [...new Set(activity.map(row => row.accountId).filter(Boolean) as string[])];
    const groupIds = [...new Set(activity.map(row => row.groupId).filter(Boolean) as string[])];
    const campaignIds = [...new Set(activity.map(row => row.campaignId).filter(Boolean) as string[])];
    const [accounts, groups, campaigns] = await Promise.all([
      accountIds.length ? prisma.socialAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, username: true } }) : [],
      groupIds.length ? prisma.accountGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }) : [],
      campaignIds.length ? prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true } }) : [],
    ]);
    const accountNameById = new Map(accounts.map(account => [account.id, account.username]));
    const groupNameById = new Map(groups.map(group => [group.id, group.name]));
    const campaignNameById = new Map(campaigns.map(campaign => [campaign.id, campaign.name]));
    const enrichedActivity = activity.map(row => ({
      ...row,
      context: {
        accountUsername: row.accountId ? accountNameById.get(row.accountId) || null : null,
        groupName: row.groupId ? groupNameById.get(row.groupId) || null : null,
        campaignName: row.campaignId ? campaignNameById.get(row.campaignId) || null : null,
        source: (row.metadata as any)?.source || row.type || null,
      },
    }));

    res.json({
      activity: enrichedActivity,
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore ? enrichedActivity[enrichedActivity.length - 1]?.id : null,
      },
    });
  } catch (err) {
    console.error('[Activity] List error:', err);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

router.get('/execution-events', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const events = postingEventEmitter.getRecentEvents(
      limit,
      {
        campaignId: req.query.campaignId ? String(req.query.campaignId) : undefined,
        accountId: req.query.accountId ? String(req.query.accountId) : undefined,
        username: req.query.username ? String(req.query.username) : undefined,
        stage: req.query.stage ? String(req.query.stage) : undefined,
      },
    );
    res.json({ events });
  } catch (err: any) {
    console.error('[Activity] Execution events error:', err.message);
    res.status(500).json({ error: 'Failed to fetch execution events' });
  }
});

router.get('/queue-summary', async (_req: AuthRequest, res: Response) => {
  try {
    const [counts, completedToday, failedToday] = await Promise.all([
      queue ? queue.getJobCounts('waiting', 'active', 'delayed') : Promise.resolve({ waiting: 0, active: 0, delayed: 0 }),
      prisma.activityLog.count({
        where: {
          type: 'queue',
          status: 'success',
          createdAt: { gte: startOfToday() },
        },
      }),
      prisma.activityLog.count({
        where: {
          type: 'queue',
          status: 'failed',
          createdAt: { gte: startOfToday() },
        },
      }),
    ]);

    res.json({
      queue: {
        queued: counts.waiting || 0,
        active: counts.active || 0,
        delayed: counts.delayed || 0,
        completedToday,
        failedToday,
      },
    });
  } catch (err: any) {
    console.warn('[Activity] Queue summary unavailable:', err.message || err);
    res.json({
      queue: {
        queued: 0,
        active: 0,
        delayed: 0,
        completedToday: 0,
        failedToday: 0,
        unavailable: true,
      },
    });
  }
});

// Dev-only fixture seeder so the console can be visually verified with realistic rows
// when no real posting job is running. Gated by EXECUTION_CONSOLE_FIXTURE=1.
router.post('/execution-events/_fixture', async (req: AuthRequest, res: Response) => {
  if (process.env.EXECUTION_CONSOLE_FIXTURE !== '1') {
    return res.status(404).json({ error: 'Not found' });
  }
  const { postingEventEmitter } = await import('../services/PostingEventEmitter');
  const now = Date.now();
  const baseTs = now - 12 * 12_000;
  const make = (i: number, stage: any, level: any, message: string, progress: number, extra: any = {}) => ({
    timestamp: new Date(baseTs + i * 12_000).toISOString(),
    accountId: 'demo-account-1',
    username: 'Arnoldkawat',
    campaignId: 'demo-campaign-1',
    postId: 'demo-post-1',
    stage,
    level,
    message,
    attempt: 1,
    progress,
    ...extra,
  });
  const fixture = [
    make(1,  'campaign_received',      'info',    'Job received for account demo-account-1',          5,  { metadata: { jobId: 'demo-job-1' } }),
    make(2,  'account_selected',       'info',    'Account @Arnoldkawat selected for posting',       10),
    make(3,  'account_lock_acquired',  'success', 'Distributed account lock acquired',               12),
    make(4,  'daily_budget_checked',   'info',    'Daily posting budget reserved',                   14),
    make(5,  'media_resolving',        'info',    'Resolving Reel media for @Arnoldkawat',             8),
    make(6,  'browser_launching',      'info',    'Starting Instagram post for @Arnoldkawat',         12),
    make(7,  'instagram_opening',      'info',    'Opening Instagram for @Arnoldkawat',               15),
    make(8,  'instagram_opened',       'info',    'Instagram opened for @Arnoldkawat',                18),
    make(9,  'browser_ready',          'info',    'Browser ready for posting with @Arnoldkawat',      20),
    make(10, 'media_selected',         'info',    'Selecting media for @Arnoldkawat',                 25),
    make(11, 'upload_started',         'info',    'Upload started for @Arnoldkawat',                  30),
    make(12, 'upload_processing',      'info',    'Instagram is processing the uploaded media',       35),
    make(13, 'upload_completed',       'success', 'Upload completed for @Arnoldkawat',                40),
    make(14, 'next_clicked',           'success', 'Next clicked (Reels step) for @Arnoldkawat',       50),
    make(15, 'cover_next_clicked',     'success', 'Cover Next clicked for @Arnoldkawat',              55),
    make(16, 'caption_inserted',       'success', 'Caption inserted for @Arnoldkawat (87 chars)',     70),
    make(17, 'share_clicked',          'info',    'Share clicked for @Arnoldkawat',                   80),
    make(18, 'verification_started',  'info',    'Verifying publish for @Arnoldkawat',               85),
    make(19, 'verification_poll',      'success', 'Publish verified for @Arnoldkawat',                95),
    make(20, 'published',              'success', 'Published successfully for @Arnoldkawat',        100, { metadata: { postUrl: 'https://www.instagram.com/reel/demo' } }),
    make(21, 'account_lock_released',  'info',    'Account lock released for @Arnoldkawat',          100),
    make(22, 'cleanup_completed',      'success', 'Cleanup completed for @Arnoldkawat',              100),
  ];
  for (const e of fixture) postingEventEmitter.emit(e as any);
  res.json({ seeded: fixture.length });
});

router.delete('/execution-events', async (req: AuthRequest, res: Response) => {
  // Clears in-memory buffer (NOT DB, NOT Redis, NOT queue). Dev-only.
  if (process.env.EXECUTION_CONSOLE_FIXTURE !== '1') {
    return res.status(404).json({ error: 'Not found' });
  }
  const { postingEventEmitter } = await import('../services/PostingEventEmitter');
  postingEventEmitter.clear();
  res.json({ cleared: true });
});

export default router;

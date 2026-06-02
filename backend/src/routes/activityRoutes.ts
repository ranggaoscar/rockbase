import { Router, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { authenticateToken, AuthRequest } from '../middleware/auth';

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

export default router;

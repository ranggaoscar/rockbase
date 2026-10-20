import { Router, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { needsOperatorAttention } from '../services/OperatorAttention';
import { createGrowthBlockersRouter } from './growthBlockersRoutes';
import { getRockBaseMode } from '../middleware/runtimeMode';

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
router.use(createGrowthBlockersRouter({ workspaceUser: prisma.workspaceUser, socialAccount: prisma.socialAccount, post: prisma.post }));

async function activityWorkspace(req: AuthRequest): Promise<string | null> {
  const requested = req.query.workspace_id ?? req.query.workspaceId;
  if (req.query.workspace_id !== undefined && req.query.workspaceId !== undefined && req.query.workspace_id !== req.query.workspaceId) return null;
  if (requested !== undefined && (typeof requested !== 'string' || !requested || requested.length > 200)) return null;
  const row = await prisma.workspace.findFirst({
    where: { ...(requested ? { id: requested as string } : {}), ...(getRockBaseMode() === 'local' ? {} : { users: { some: { userId: req.user!.id } } }) },
    orderBy: { createdAt: 'asc' }, select: { id: true },
  });
  return row?.id || null;
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const workspaceId = await activityWorkspace(req);
    if (!workspaceId) { res.status(404).json({ error: 'Workspace not found.' }); return; }
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), MAX_LIMIT);
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const filters: Prisma.ActivityLogWhereInput = {
      workspaceId,
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
      accountIds.length ? prisma.socialAccount.findMany({ where: { workspaceId, id: { in: accountIds } }, select: { id: true, username: true } }) : [],
      groupIds.length ? prisma.accountGroup.findMany({ where: { workspaceId, id: { in: groupIds } }, select: { id: true, name: true } }) : [],
      campaignIds.length ? prisma.campaign.findMany({ where: { workspaceId, id: { in: campaignIds } }, select: { id: true, name: true } }) : [],
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

router.get('/operations-summary', async (req: AuthRequest, res: Response) => {
  try {
    const workspaceId = await activityWorkspace(req);
    if (!workspaceId) { res.status(404).json({ error: 'Workspace not found.' }); return; }
    const [accounts, campaigns, queueSummary, recentActivity] = await Promise.all([
      prisma.socialAccount.findMany({ where: { workspaceId }, select: { status: true, sessionHealth: true } }),
      prisma.campaign.findMany({ where: { workspaceId, isArchived: false }, select: { status: true } }),
      prisma.post.findMany({ where: { workspaceId }, select: { status: true } }).then(posts => ({ waiting: posts.filter(p => p.status === 'queued').length, active: posts.filter(p => p.status === 'pending_verify').length, delayed: posts.filter(p => p.status === 'scheduled').length })),
      prisma.activityLog.findMany({
        where: { workspaceId, type: { in: ['campaign', 'posting', 'queue', 'session'] } },
        select: { id: true, type: true, entityType: true, entityId: true, accountId: true, campaignId: true, action: true, status: true, message: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const disconnected = accounts.filter((account) => ['error', 'logged_out', 'flagged'].includes(account.status)).length;
    const attention = accounts.filter(needsOperatorAttention).length;
    const ready = accounts.filter((account) => account.status === 'active' && account.sessionHealth === 'HEALTHY').length;
    const unverified = accounts.filter((account) => account.status === 'active' && (account.sessionHealth || 'UNKNOWN') === 'UNKNOWN').length;

    const accountIds = [...new Set(recentActivity.map((item) => item.accountId).filter(Boolean) as string[])];
    const campaignIds = [...new Set(recentActivity.map((item) => item.campaignId).filter(Boolean) as string[])];
    const [accountRows, campaignRows] = await Promise.all([
      accountIds.length ? prisma.socialAccount.findMany({ where: { workspaceId, id: { in: accountIds } }, select: { id: true, username: true } }) : [],
      campaignIds.length ? prisma.campaign.findMany({ where: { workspaceId, id: { in: campaignIds } }, select: { id: true, name: true } }) : [],
    ]);
    const accountNameById = new Map(accountRows.map((item) => [item.id, item.username]));
    const campaignNameById = new Map(campaignRows.map((item) => [item.id, item.name]));

    res.json({
      accounts: { total: accounts.length, ready, unverified, attention, disconnected },
      campaigns: {
        active: campaigns.filter((campaign) => campaign.status === 'running').length,
        draft: campaigns.filter((campaign) => ['pending', 'draft'].includes(campaign.status)).length,
      },
      publishingScope: 'Workspace Post database states; not live Redis job counts.',
      publishingQueue: {
        queued: queueSummary.waiting || 0,
        running: queueSummary.active || 0,
        delayed: queueSummary.delayed || 0,
      },
      recentActivity: recentActivity.map((item) => ({
        ...item,
        accountUsername: item.accountId ? accountNameById.get(item.accountId) || null : null,
        campaignName: item.campaignId ? campaignNameById.get(item.campaignId) || null : null,
      })),
    });
  } catch (err) {
    console.error('[Activity] Operations summary error:', err);
    res.status(500).json({ error: 'Failed to fetch operations summary' });
  }
});

router.get('/publishing-queue', async (req: AuthRequest, res: Response) => {
  try {
    const workspaceId = await activityWorkspace(req);
    if (!workspaceId) { res.status(404).json({ error: 'Workspace not found.' }); return; }
    const [posts, actions, accounts] = await Promise.all([
      prisma.post.findMany({
        where: { workspaceId },
        select: { id: true, content: true, accountIds: true, status: true, results: true, scheduleAt: true, postedAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      prisma.campaignAction.findMany({
        where: { campaign: { workspaceId } },
        select: { id: true, accountId: true, actionType: true, status: true, result: true, scheduledAt: true, executedAt: true, campaign: { select: { id: true, name: true } } },
        orderBy: { scheduledAt: 'desc' },
        take: 100,
      }),
      prisma.socialAccount.findMany({ where: { workspaceId }, select: { id: true, username: true, platform: true, sessionHealth: true, status: true } }),
    ]);
    const accountById = new Map(accounts.map((account) => [account.id, account]));

    const rows: Array<Record<string, unknown>> = [];

    for (const post of posts) {
      let accountIds: string[] = [];
      let results: Record<string, { status?: string; error?: string }> = {};
      try { accountIds = JSON.parse(post.accountIds); } catch {}
      try { results = JSON.parse(post.results || '{}'); } catch {}
      for (const accountId of accountIds) {
        const account = accountById.get(accountId);
        if (!account) continue; // Never dereference an account from another workspace.
        const result = results[accountId];
        const needsAttention = Boolean(account && needsOperatorAttention(account));
        const status = needsAttention ? 'needs_attention' : result?.status === 'success' ? 'completed' : result?.status === 'failed' ? 'failed' : post.status === 'published' ? 'completed' : post.status === 'pending_verify' ? 'running' : post.status === 'scheduled' ? 'delayed' : 'queued';
        rows.push({
          id: `post:${post.id}:${accountId}`,
          source: 'quick_post',
          accountId,
          account: account?.username || 'Unknown account',
          platform: account?.platform || 'Unknown',
          campaign: 'Quick post',
          status,
          scheduledAt: post.scheduleAt,
          updatedAt: post.updatedAt,
          result: result?.error || null,
        });
      }
    }

    for (const action of actions) {
      const account = accountById.get(action.accountId);
      if (!account) continue;
      const needsAttention = Boolean(account && needsOperatorAttention(account));
      const status = needsAttention ? 'needs_attention' : action.status === 'completed' ? 'completed' : action.status === 'failed' ? 'failed' : ['running', 'in_progress'].includes(action.status) ? 'running' : action.status === 'delayed' ? 'delayed' : 'queued';
      rows.push({
        id: `campaign:${action.id}`,
        source: 'campaign',
        accountId: action.accountId,
        account: account?.username || 'Unknown account',
        platform: account?.platform || 'Unknown',
        campaign: action.campaign.name,
        status,
        scheduledAt: action.scheduledAt,
        updatedAt: action.executedAt || action.scheduledAt,
        result: action.result || null,
      });
    }

    const order = { needs_attention: 0, running: 1, queued: 2, delayed: 3, failed: 4, completed: 5 } as Record<string, number>;
    rows.sort((left, right) => (order[String(left.status)] ?? 9) - (order[String(right.status)] ?? 9));
    res.json({ rows });
  } catch (err) {
    console.error('[Activity] Publishing queue error:', err);
    res.status(500).json({ error: 'Failed to fetch publishing queue' });
  }
});

export default router;

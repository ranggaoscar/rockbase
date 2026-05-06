import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();
router.use(authenticateToken);

// ── Deterministic seeded random (same result per account ID + seed) ─────────
function seededRand(seed: string, min: number, max: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  const norm = Math.abs(h) / 2147483647;
  return Math.floor(norm * (max - min + 1)) + min;
}

// ── Generate fake but realistic metrics per account ────────────────────────
function buildAccountMetrics(account: any) {
  const id = account.id;
  const isActive = account.status === 'active';
  const daysSinceCreated = Math.floor((Date.now() - new Date(account.createdAt).getTime()) / 86400000);

  const followers      = seededRand(id + 'followers', isActive ? 1200 : 80, isActive ? 28000 : 500);
  const following      = seededRand(id + 'following', 200, 1500);
  const posts          = seededRand(id + 'posts', daysSinceCreated > 14 ? 20 : 5, daysSinceCreated * 2 + 10);
  const avgLikes       = seededRand(id + 'likes', Math.floor(followers * 0.01), Math.floor(followers * 0.08));
  const avgComments    = seededRand(id + 'comments', Math.floor(avgLikes * 0.02), Math.floor(avgLikes * 0.12));
  const avgSaves       = seededRand(id + 'saves', Math.floor(avgLikes * 0.05), Math.floor(avgLikes * 0.2));
  const avgReach       = seededRand(id + 'reach', followers, followers * 3);
  const engagementRate = parseFloat(((avgLikes + avgComments + avgSaves) / followers * 100).toFixed(2));
  const weeklyGrowth   = seededRand(id + 'wgrowth', isActive ? 15 : -5, isActive ? 450 : 30);

  return {
    accountId: account.id,
    username: account.username,
    platform: account.platform,
    status: account.status,
    brandTag: account.brandTag,
    followers,
    following,
    posts,
    avgLikes,
    avgComments,
    avgSaves,
    avgReach,
    engagementRate,
    weeklyGrowth,
  };
}

// ── Generate growth series (last N days) ──────────────────────────────────
function buildGrowthSeries(account: any, days: number) {
  const id = account.id;
  const base = seededRand(id + 'base_followers', 500, 8000);
  const series: { date: string; followers: number; likes: number; reach: number }[] = [];
  let curr = base;
  for (let i = days; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const delta = seededRand(id + dateStr, -20, 80);
    curr = Math.max(0, curr + delta);
    series.push({
      date: dateStr,
      followers: curr,
      likes: seededRand(id + dateStr + 'l', 0, Math.floor(curr * 0.06)),
      reach: seededRand(id + dateStr + 'r', curr, curr * 2),
    });
  }
  return series;
}

// ── GET /api/analytics/overview ────────────────────────────────────────────
router.get('/overview', async (_req: AuthRequest, res: Response) => {
  try {
    const accounts = await prisma.socialAccount.findMany();
    const metrics = accounts.map(buildAccountMetrics);

    const totalFollowers    = metrics.reduce((s, m) => s + m.followers, 0);
    const totalPosts        = metrics.reduce((s, m) => s + m.posts, 0);
    const avgEngagement     = metrics.length > 0
      ? parseFloat((metrics.reduce((s, m) => s + m.engagementRate, 0) / metrics.length).toFixed(2))
      : 0;
    const bestAccount = metrics.reduce((best, m) => m.engagementRate > best.engagementRate ? m : best, metrics[0]);
    const totalReach        = metrics.reduce((s, m) => s + m.avgReach, 0);
    const weeklyFollowerGain = metrics.reduce((s, m) => s + m.weeklyGrowth, 0);

    res.json({
      summary: { totalFollowers, totalPosts, avgEngagement, totalReach, weeklyFollowerGain },
      bestAccount: bestAccount ?? null,
      accountMetrics: metrics,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load analytics overview' });
  }
});

// ── GET /api/analytics/growth?accountId=X&days=30 ─────────────────────────
router.get('/growth', async (req: AuthRequest, res: Response) => {
  try {
    const { accountId, days = '30' } = req.query as { accountId?: string; days?: string };
    const numDays = Math.min(parseInt(days as string) || 30, 90);

    if (accountId) {
      const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
      if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
      res.json({ growth: buildGrowthSeries(account, numDays) });
    } else {
      // Aggregate all accounts
      const accounts = await prisma.socialAccount.findMany();
      const allSeries: { date: string; followers: number; likes: number; reach: number }[] = [];
      const dateMap: Record<string, { followers: number; likes: number; reach: number }> = {};

      for (const acc of accounts) {
        const series = buildGrowthSeries(acc, numDays);
        series.forEach(pt => {
          if (!dateMap[pt.date]) dateMap[pt.date] = { followers: 0, likes: 0, reach: 0 };
          dateMap[pt.date].followers += pt.followers;
          dateMap[pt.date].likes     += pt.likes;
          dateMap[pt.date].reach     += pt.reach;
        });
      }

      Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, vals]) => {
        allSeries.push({ date, ...vals });
      });

      res.json({ growth: allSeries });
    }
  } catch {
    res.status(500).json({ error: 'Failed to load growth data' });
  }
});

// ── GET /api/analytics/top-posts?accountId=X ──────────────────────────────
router.get('/top-posts', async (req: AuthRequest, res: Response) => {
  try {
    const { accountId } = req.query as { accountId?: string };
    const accounts = accountId
      ? [await prisma.socialAccount.findUnique({ where: { id: accountId } })].filter(Boolean)
      : (await prisma.socialAccount.findMany()).filter((a: any) => a.status === 'active').slice(0, 5);

    const topPosts = accounts.flatMap((acc: any) => {
      if (!acc) return [];
      return Array.from({ length: 3 }).map((_, i) => {
        const likes    = seededRand(acc.id + `top${i}likes`, 500, 8000);
        const comments = seededRand(acc.id + `top${i}comments`, 20, 300);
        const saves    = seededRand(acc.id + `top${i}saves`, 50, 800);
        const daysAgo  = seededRand(acc.id + `top${i}days`, 1, 30);
        return {
          id: `post-${acc.id}-${i}`,
          username: acc.username,
          platform: acc.platform,
          caption: `Sample top post #${i + 1} for @${acc.username}`,
          likes,
          comments,
          saves,
          engagementRate: parseFloat(((likes + comments + saves) / seededRand(acc.id + 'followers', 1200, 28000) * 100).toFixed(2)),
          postedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
        };
      });
    });

    topPosts.sort((a, b) => b.likes - a.likes);
    res.json({ posts: topPosts.slice(0, 15) });
  } catch {
    res.status(500).json({ error: 'Failed to load top posts' });
  }
});

export default router;

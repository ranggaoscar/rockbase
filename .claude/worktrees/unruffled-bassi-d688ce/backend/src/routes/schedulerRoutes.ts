import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();
router.use(authenticateToken);

// ── GET /api/scheduler ─────────────────────────────────────────────────────
// Query params: status=pending|posted|failed, month=YYYY-MM
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { status, month } = req.query as { status?: string; month?: string };
    let posts = await prisma.scheduledPost.findMany(status ? { where: { status } } : undefined);

    if (month) {
      // Filter by month: YYYY-MM
      posts = posts.filter((p: any) => {
        const d = new Date(p.scheduledAt);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}` === month;
      });
    }

    const parsedPosts = posts.map((p: any) => ({
      ...p,
      mediaUrls: p.mediaUrls ? JSON.parse(p.mediaUrls) : [],
      accountIds: p.accountIds ? JSON.parse(p.accountIds) : [],
    }));

    res.json({ posts: parsedPosts });
  } catch {
    res.status(500).json({ error: 'Failed to load scheduled posts' });
  }
});

// ── POST /api/scheduler ────────────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      content,
      mediaUrls = [],
      accountIds = [],
      scheduledAt,
      timezone = 'Asia/Jakarta',
      recurrence = 'none',
      recurrenceInterval = 1,
      recurrenceEndDate = null,
    } = req.body;

    if (!content?.trim()) { res.status(400).json({ error: 'Content is required' }); return; }
    if (!scheduledAt)      { res.status(400).json({ error: 'scheduledAt is required' }); return; }
    if (!accountIds.length){ res.status(400).json({ error: 'At least one account is required' }); return; }

    const post = await prisma.scheduledPost.create({
      data: {
        content: content.trim(),
        mediaUrls: JSON.stringify(mediaUrls),
        accountIds: JSON.stringify(accountIds),
        scheduledAt: new Date(scheduledAt),
        timezone,
        recurrence,
        recurrenceInterval,
        recurrenceEndDate: recurrenceEndDate ? new Date(recurrenceEndDate) : null,
        status: 'pending',
      },
    });

    res.status(201).json({ post: {
      ...post,
      mediaUrls: JSON.parse(post.mediaUrls),
      accountIds: JSON.parse(post.accountIds),
    } });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create scheduled post' });
  }
});

// ── POST /api/scheduler/bulk-import ───────────────────────────────────────
// Expects JSON array parsed from CSV:
// [{ scheduledAt, content, accountIds: string[], mediaUrls?: string[] }]
router.post('/bulk-import', async (req: AuthRequest, res: Response) => {
  try {
    const { posts } = req.body as { posts: any[] };
    if (!Array.isArray(posts) || posts.length === 0) {
      res.status(400).json({ error: 'No posts provided' });
      return;
    }

    const created: any[] = [];
    const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < posts.length; i++) {
      const row = posts[i];
      try {
        if (!row.content?.trim()) throw new Error('Missing content');
        if (!row.scheduledAt)     throw new Error('Missing scheduledAt');
        const accountIds = Array.isArray(row.accountIds)
          ? row.accountIds
          : (row.accountIds || '').split(';').map((s: string) => s.trim()).filter(Boolean);
        if (!accountIds.length)   throw new Error('Missing accountIds');

        const post = await prisma.scheduledPost.create({
          data: {
            content: row.content.trim(),
            mediaUrls: JSON.stringify(Array.isArray(row.mediaUrls) ? row.mediaUrls : []),
            accountIds: JSON.stringify(accountIds),
            scheduledAt: new Date(row.scheduledAt),
            timezone: row.timezone || 'Asia/Jakarta',
            recurrence: row.recurrence || 'none',
            recurrenceInterval: row.recurrenceInterval || 1,
            recurrenceEndDate: row.recurrenceEndDate ? new Date(row.recurrenceEndDate) : null,
            status: 'pending',
          },
        });
        created.push(post);
      } catch (e: any) {
        errors.push({ row: i + 1, error: e.message });
      }
    }

    res.json({ created: created.length, errors });
  } catch {
    res.status(500).json({ error: 'Bulk import failed' });
  }
});

// ── PATCH /api/scheduler/:id ───────────────────────────────────────────────
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.scheduledPost.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Scheduled post not found' }); return; }

    const {
      content, mediaUrls, accountIds, scheduledAt,
      timezone, recurrence, recurrenceInterval, recurrenceEndDate, status,
    } = req.body;

    const updated = await prisma.scheduledPost.update({
      where: { id: req.params.id },
      data: {
        ...(content      !== undefined && { content }),
        ...(mediaUrls    !== undefined && { mediaUrls: JSON.stringify(mediaUrls) }),
        ...(accountIds   !== undefined && { accountIds: JSON.stringify(accountIds) }),
        ...(scheduledAt  !== undefined && { scheduledAt: new Date(scheduledAt) }),
        ...(timezone     !== undefined && { timezone }),
        ...(recurrence   !== undefined && { recurrence }),
        ...(recurrenceInterval !== undefined && { recurrenceInterval }),
        ...(recurrenceEndDate  !== undefined && { recurrenceEndDate: recurrenceEndDate ? new Date(recurrenceEndDate) : null }),
        ...(status       !== undefined && { status }),
      },
    });

    res.json({ post: {
      ...updated,
      mediaUrls: JSON.parse(updated.mediaUrls),
      accountIds: JSON.parse(updated.accountIds)
    } });
  } catch {
    res.status(500).json({ error: 'Failed to update scheduled post' });
  }
});

// ── DELETE /api/scheduler/:id ──────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.scheduledPost.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    await prisma.scheduledPost.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete scheduled post' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { spinCaptions } from '../services/CaptionSpinnerService';

const router = Router();
const prisma = new PrismaClient();

// ── BullMQ queue (only created if Redis is available) ─────────────────────
let automationQueue: Queue | null = null;
try {
  const connection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  };
  automationQueue = new Queue('automationQueue', { connection });
} catch {
  console.warn('[postRoutes] Redis not available — BullMQ disabled, using direct Playwright mode');
}

// ── Multer: save uploaded images to uploads/ directory ───────────────────
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── POST /api/posts/bulk — Bulk post with AI caption spinning ─────────────
// multipart/form-data: image file + JSON fields
router.post('/bulk', upload.single('media'), async (req: Request, res: Response) => {
  try {
    const {
      baseCaption,
      baseHashtags, // JSON string of string[]
      accountIds,   // JSON string of string[]
      scheduleAt,
      spinCaptions: shouldSpin = 'true',
      workspaceId = 'workspace-default',
    } = req.body;

    const parsedAccountIds: string[] = JSON.parse(accountIds || '[]');
    const parsedHashtags: string[]   = JSON.parse(baseHashtags || '[]');

    if (!baseCaption?.trim())       { res.status(400).json({ error: 'baseCaption is required' }); return; }
    if (parsedAccountIds.length === 0) { res.status(400).json({ error: 'accountIds is required' }); return; }
    if (!req.file)                  { res.status(400).json({ error: 'media file is required — Instagram needs an image' }); return; }

    const mediaLocalPath = req.file.path;

    // ── Generate caption variations (one per account) ─────────────────
    let captions: { caption: string; hashtags: string }[];
    if (shouldSpin === 'true') {
      console.log(`[BulkPost] Spinning ${parsedAccountIds.length} caption variations...`);
      captions = await spinCaptions(baseCaption, parsedHashtags, parsedAccountIds.length);
    } else {
      // Same caption for all accounts, just spin hashtags
      captions = parsedAccountIds.map((_, i) => ({
        caption: baseCaption,
        hashtags: parsedHashtags.join(' '),
      }));
    }

    // ── Queue one job per account with staggered delays ───────────────
    // 5–15 min random delay between accounts to avoid same-timestamp detection
    const MIN_ACCOUNT_DELAY_MS = 5 * 60 * 1000;   // 5 minutes
    const MAX_ACCOUNT_DELAY_MS = 15 * 60 * 1000;  // 15 minutes

    const createdPosts: any[] = [];
    let cumulativeDelay = 0;

    // Base delay from scheduleAt if provided
    if (scheduleAt) {
      const targetTime = new Date(scheduleAt).getTime();
      const now = Date.now();
      cumulativeDelay = targetTime > now ? targetTime - now : 0;
    }

    for (let i = 0; i < parsedAccountIds.length; i++) {
      const accountId = parsedAccountIds[i];
      const { caption, hashtags } = captions[i] ?? { caption: baseCaption, hashtags: parsedHashtags.join(' ') };
      const finalContent = `${caption}\n\n${hashtags}`;

      // Create DB record
      const post = await prisma.post.create({
        data: {
          workspaceId,
          content: finalContent,
          mediaUrls: JSON.stringify([req.file!.filename]),
          accountIds: JSON.stringify([accountId]),
          status: cumulativeDelay > 0 ? 'scheduled' : 'pending',
          scheduleAt: cumulativeDelay > 0 ? new Date(Date.now() + cumulativeDelay) : null,
        },
      });

      // Queue the job
      if (automationQueue) {
        await automationQueue.add(
          'postJob',
          {
            postId: post.id,
            accountId,
            content: finalContent,
            mediaLocalPath,
            mediaUrls: [req.file!.filename],
            spinIndex: i,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30000 },
            delay: cumulativeDelay,
          }
        );
      } else {
        // ── Direct Fallback Mode (No Redis) ──
        console.log(`[BulkPost] Redis missing. Queuing direct post for ${accountId} with ${cumulativeDelay}ms delay`);
        
        // Execute in background without awaiting
        (async () => {
          try {
            if (cumulativeDelay > 0) await new Promise(r => setTimeout(r, cumulativeDelay));
            
            // Re-importing service to ensure it's available in this scope if needed
            const { instagramPostingService } = await import('../services/InstagramPostingService');
            
            // Mark as pending in DB
            await prisma.post.update({ where: { id: post.id }, data: { status: 'pending' } });
            
            const result = await instagramPostingService.postToInstagram(accountId, finalContent, mediaLocalPath);
            
            if (result.status === 'success') {
              await prisma.post.update({
                where: { id: post.id },
                data: {
                  status: 'published',
                  postedAt: new Date(),
                  results: JSON.stringify({ [accountId]: { status: 'success' } })
                }
              });
              console.log(`[DirectPost] ✅ Published for @${result.username}`);
            } else {
              throw new Error(result.error);
            }
          } catch (err: any) {
            console.error(`[DirectPost] ❌ Failed for ${accountId}:`, err.message);
            await prisma.post.update({
              where: { id: post.id },
              data: {
                status: 'failed',
                results: JSON.stringify({ [accountId]: { status: 'failed', error: err.message } })
              }
            }).catch(() => {});
          }
        })();
      }

      createdPosts.push({
        ...post,
        mediaUrls: [req.file!.filename],
        accountIds: [accountId],
        scheduleAt: cumulativeDelay > 0 ? new Date(Date.now() + cumulativeDelay).toISOString() : null,
        captionPreview: caption.slice(0, 80) + (caption.length > 80 ? '…' : ''),
      });

      // Add random delay before next account
      const accountGap = Math.floor(Math.random() * (MAX_ACCOUNT_DELAY_MS - MIN_ACCOUNT_DELAY_MS + 1)) + MIN_ACCOUNT_DELAY_MS;
      cumulativeDelay += accountGap;
    }

    res.status(202).json({
      message: automationQueue 
        ? `Queued ${createdPosts.length} posts via BullMQ.`
        : `Queued ${createdPosts.length} posts via Direct Fallback (Redis is down).`,
      posts: createdPosts,
      redisAvailable: !!automationQueue,
    });

  } catch (error: any) {
    console.error('[BulkPost] Error:', error);
    res.status(500).json({ error: 'Failed to queue bulk posts', details: error.message });
  }
});

// ── POST /api/posts/spin-preview — Preview AI caption variations before posting
router.post('/spin-preview', async (req: Request, res: Response) => {
  try {
    const { baseCaption, baseHashtags = [], count = 3 } = req.body;
    if (!baseCaption?.trim()) { res.status(400).json({ error: 'baseCaption required' }); return; }

    const results = await spinCaptions(baseCaption, baseHashtags, Math.min(Number(count), 10));
    res.json({ variations: results });
  } catch (err: any) {
    res.status(500).json({ error: 'Caption spinning failed', details: err.message });
  }
});

// ── POST /api/posts — Legacy single-account post (kept for backwards compatibility)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId = 'workspace-default', content, mediaUrls, accountIds, scheduleAt } = req.body;

    if (!accountIds || accountIds.length === 0) {
      res.status(400).json({ error: 'No accounts selected for posting' });
      return;
    }

    let baseDelay = 0;
    if (scheduleAt) {
      const targetTime = new Date(scheduleAt).getTime();
      const now = Date.now();
      baseDelay = targetTime > now ? targetTime - now : 0;
    }

    const createdPosts = [];
    for (const accountId of accountIds) {
      const post = await prisma.post.create({
        data: {
          workspaceId,
          content,
          mediaUrls: JSON.stringify(mediaUrls || []),
          accountIds: JSON.stringify([accountId]),
          status: baseDelay > 0 ? 'scheduled' : 'pending',
          scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
        },
      });

      if (automationQueue) {
        await automationQueue.add(
          'postJob',
          { postId: post.id, accountId, content, mediaUrls: mediaUrls || [], spinIndex: 0 },
          { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, delay: baseDelay }
        );
      }
      createdPosts.push(post);
    }

    res.status(202).json({
      message: `Queued ${createdPosts.length} posts`,
      posts: createdPosts,
    });
  } catch (error) {
    console.error('[postRoutes] Error:', error);
    res.status(500).json({ error: 'Failed to queue posts' });
  }
});

// ── GET /api/posts/status/:workspaceId ───────────────────────────────────
router.get('/status/:workspaceId', async (req: Request, res: Response) => {
  try {
    const posts = await prisma.post.findMany({
      where: { workspaceId: String(req.params.workspaceId) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const parsed = posts.map((p: any) => ({
      ...p,
      mediaUrls: p.mediaUrls ? JSON.parse(p.mediaUrls) : [],
      accountIds: p.accountIds ? JSON.parse(p.accountIds) : [],
      results: p.results ? JSON.parse(p.results) : null,
    }));

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch post statuses' });
  }
});

export default router;

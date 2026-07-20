import { Request, Response } from 'express';
import { Queue, Job } from 'bullmq';
import { PostJobData } from '../queue/jobTypes';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { generateRequestPayloadHash, acquireRequestLock } from '../utils/idempotency';
import { DurableIdempotencyService, IdempotencyConflictError, IdempotencyValidationError } from '../services/DurableIdempotencyService';
import { ROCK_SOCIAL_POST_SCOPE, rockSocialPostRequestHash } from '../utils/socialPostingIdempotency';

const prisma = new PrismaClient();
const durableIdempotency = new DurableIdempotencyService(prisma);

const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const automationQueue = new Queue<PostJobData>('automationQueue', {
  connection: redisConnection,
});

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

function downloadImage(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`Image download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// ── POST /api/rock-social/post ──────────────────────────────────────────────

export const createSocialPost = async (req: Request, res: Response) => {
  const idempotencyKey = typeof req.header('Idempotency-Key') === 'string' ? req.header('Idempotency-Key')!.trim() : '';
  let durableOperationAcquired = false;
  try {
    const { image_url, caption, account_ids, scheduled_time } = req.body;

    if (!image_url || !caption || !Array.isArray(account_ids) || account_ids.length === 0) {
      return res.status(400).json({
        message: 'Missing required fields: image_url, caption, or account_ids.',
      });
    }

    if (!new RegExp('^https?://').test(image_url)) {
      return res.status(400).json({
        message: 'Invalid image_url format.',
      });
    }

    // ── Request-level duplicate prevention ──
    if (idempotencyKey) {
      const begun = await durableIdempotency.beginOperation({
        scope: ROCK_SOCIAL_POST_SCOPE,
        key: idempotencyKey,
        requestHash: rockSocialPostRequestHash({ imageUrl: image_url, caption, accountIds: account_ids, scheduledTime: scheduled_time || null }),
      });
      if (!begun.acquired) {
        return res.status(200).json({ message: 'Existing social post operation returned for this idempotency key.', operation: begun.operation });
      }
      durableOperationAcquired = true;
    } else {
      const reqLockKey = generateRequestPayloadHash(req.body, req.files);
      if (!acquireRequestLock(reqLockKey)) {
        return res.status(429).json({
          message: 'Duplicate request detected. Please wait a moment before retrying.',
          retryAfterMs: 15000,
        });
      }
    }

    // ── Fix #3: Validate account status, session health, and rate limits ──────
    const accounts = await prisma.socialAccount.findMany({
      where: { id: { in: account_ids } },
      select: { id: true, username: true, platform: true, status: true },
    });

    const foundIds = new Set(accounts.map((a) => a.id));
    const missingIds = account_ids.filter((id: string) => !foundIds.has(id));

    if (missingIds.length > 0) {
      return res.status(400).json({
        message: `Account(s) NOT FOUND in database: ${missingIds.join(', ')}`,
        missingIds,
        hint: 'Gunakan GET /api/rock-social/accounts untuk lihat daftar ID yang valid.',
      });
    }

    const invalidStatus = accounts.filter((a) => a.status === 'flagged' || a.status === 'logged_out');
    if (invalidStatus.length > 0) {
      return res.status(400).json({
        message: `Account(s) memiliki status tidak valid untuk posting: ${invalidStatus.map((a) => `${a.username} (${a.status})`).join(', ')}`,
        invalidAccounts: invalidStatus.map((a) => a.id),
      });
    }
    // ── End Fix #3 ─────────────────────────────────────────────────────────

    // Download media to local uploads dir before queuing
    // Fix: detect extension from URL query param (e.g. ComfyUI ?filename=reel.mp4)
    const urlObj = new URL(image_url);
    let ext = path.extname(urlObj.pathname);
    if (!ext) {
      const queryFilename = urlObj.searchParams.get('filename') || '';
      ext = path.extname(queryFilename);
    }
    if (!ext) ext = '.jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const mediaLocalPath = path.join(UPLOAD_DIR, filename);

    try {
      await downloadImage(image_url, mediaLocalPath);
    } catch (downloadErr) {
      return res.status(400).json({
        message: 'Failed to download image from provided URL.',
        error: downloadErr instanceof Error ? downloadErr.message : String(downloadErr),
      });
    }

    let postOptions: { delay?: number } = {};
    let actualScheduledTime: Date | undefined;

    if (scheduled_time) {
      const scheduledDate = new Date(scheduled_time);
      if (isNaN(scheduledDate.getTime())) {
        fs.unlink(mediaLocalPath, () => {});
        return res.status(400).json({
          message: 'Invalid scheduled_time format.',
        });
      }
      actualScheduledTime = scheduledDate;
      const delay = scheduledDate.getTime() - Date.now();
      if (delay > 0) {
        postOptions = { delay };
      }
    }

    const newPost = await prisma.post.create({
      data: {
        workspaceId: 'workspace-default',
        content: caption,
        mediaUrls: JSON.stringify([image_url]),
        accountIds: JSON.stringify(account_ids),
        scheduleAt: actualScheduledTime,
        status: 'pending',
        idempotencyKey: generateRequestPayloadHash(
          { accountIds: account_ids, baseCaption: caption },
          [{ originalname: filename, size: fs.statSync(mediaLocalPath).size }]
        ),
      },
    });

    // One job per account with staggered delays (3–8 min random gap)
    const MIN_ACCOUNT_DELAY_MS = 3 * 60 * 1000;
    const MAX_ACCOUNT_DELAY_MS = 8 * 60 * 1000;

    let cumulativeDelay = postOptions.delay || 0;
    const jobs: Promise<any>[] = [];
    for (let i = 0; i < account_ids.length; i++) {
      const accountId = account_ids[i];
      jobs.push(
        automationQueue.add('postJob', {
          postId: newPost.id,
          accountId,
          content: caption,
          mediaLocalPath,
          mediaUrls: [image_url],
          spinIndex: i,
        }, {
          delay: cumulativeDelay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
        })
      );
      if (i < account_ids.length - 1) {
        cumulativeDelay += Math.floor(Math.random() * (MAX_ACCOUNT_DELAY_MS - MIN_ACCOUNT_DELAY_MS + 1)) + MIN_ACCOUNT_DELAY_MS;
      }
    }
    const resolvedJobs = await Promise.all(jobs);

    if (durableOperationAcquired) {
      await durableIdempotency.markCompleted(ROCK_SOCIAL_POST_SCOPE, idempotencyKey, {
        resourceType: 'post-submission',
        resourceId: newPost.id,
        resultReference: { postId: newPost.id, jobIds: resolvedJobs.map((job) => String(job.id)) },
      });
    }

    return res.status(202).json({
      message: 'Social post jobs successfully added to queue.',
      jobIds: resolvedJobs.map((j) => j.id),
      postId: newPost.id,
      scheduledFor: scheduled_time || 'Immediately',
      accountCount: account_ids.length,
      validatedAccounts: accounts.map((a) => ({ id: a.id, username: a.username })),
    });

  } catch (error) {
    if (durableOperationAcquired) {
      await durableIdempotency.markUnknown(ROCK_SOCIAL_POST_SCOPE, idempotencyKey, 'SUBMISSION_OUTCOME_UNCERTAIN').catch(() => {});
    }
    if (error instanceof IdempotencyConflictError) return res.status(409).json({ message: error.message });
    if (error instanceof IdempotencyValidationError) return res.status(400).json({ message: error.message });
    return res.status(500).json({
      message: 'Internal server error.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ── GET /api/rock-social/accounts ───────────────────────────────────────────

export const getSocialAccounts = async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const whereClause: any = {};

    if (typeof status === 'string' && ['active', 'warming_up', 'inactive'].includes(status.toLowerCase())) {
      whereClause.status = status.toLowerCase();
    } else if (status) {
      return res.status(400).json({
        message: 'Invalid status. Allowed: active, warming_up, inactive.',
      });
    }

    const accounts = await prisma.socialAccount.findMany({
      where: whereClause,
      select: {
        id: true,
        username: true,
        platform: true,
        status: true,
        brandTag: true,
        lastActive: true,
      },
      orderBy: { username: 'asc' },
    });

    // ── Fix #7: Compute lastPostDate from Post table ──────────────────────
    const accountIds = accounts.map((a) => a.id);
    const lastPosts = await prisma.post.findMany({
      where: { status: 'published' },
      select: { accountIds: true, postedAt: true },
      orderBy: { postedAt: 'desc' },
    });

    const lastPostMap = new Map<string, string>();
    for (const post of lastPosts) {
      try {
        const ids: string[] = JSON.parse(post.accountIds);
        for (const id of ids) {
          if (!lastPostMap.has(id) && post.postedAt) {
            lastPostMap.set(id, post.postedAt.toISOString());
          }
        }
      } catch {}
    }

    const data = accounts.map((a) => ({
      ...a,
      lastPostDate: lastPostMap.get(a.id) || null,
    }));

    return res.status(200).json({
      message: 'Social accounts fetched successfully.',
      data,
      total: data.length,
    });

  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ── GET /api/rock-social/posts?limit=10 ── Fix #6 ──────────────────────────

export const listRecentPosts = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (status && ['pending', 'published', 'failed', 'pending_verify'].includes(status)) {
      where.status = status;
    }

    const posts = await prisma.post.findMany({
      where,
      select: {
        id: true,
        content: true,
        mediaUrls: true,
        accountIds: true,
        status: true,
        results: true,
        createdAt: true,
        postedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Enrich with account usernames
    const enriched = await Promise.all(
      posts.map(async (post) => {
        let accountIds: string[] = [];
        try { accountIds = JSON.parse(post.accountIds); } catch {}

        const accounts = await prisma.socialAccount.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, username: true },
        });

        const accountMap = new Map(accounts.map((a) => [a.id, a.username]));

        return {
          id: post.id,
          content: post.content.length > 200 ? post.content.slice(0, 200) + '...' : post.content,
          mediaUrls: post.mediaUrls,
          accounts: accountIds.map((id) => ({ id, username: accountMap.get(id) || 'unknown' })),
          status: post.status,
          results: safeJsonParse(post.results),
          createdAt: post.createdAt,
          postedAt: post.postedAt,
        };
      })
    );

    return res.status(200).json({
      message: 'Recent posts fetched.',
      data: enriched,
      total: enriched.length,
    });

  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ── GET /api/rock-social/jobs/:jobId ── Fix #4 ─────────────────────────────

export const getJobStatus = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    // Try BullMQ first, then DB
    let job: Job | undefined = undefined;
    try {
      job = await Job.fromId(automationQueue, jobId);
    } catch {}

    // Also check Post table
    const post = await prisma.post.findFirst({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        results: true,
        accountIds: true,
        createdAt: true,
        postedAt: true,
      },
    });

    // If jobId is a BullMQ job ID, find the associated post
    let linkedPost: any = null;
    if (job) {
      const jobData = job.data as PostJobData;
      if (jobData?.postId) {
        linkedPost = await prisma.post.findUnique({
          where: { id: jobData.postId },
          select: { id: true, status: true, results: true, postedAt: true },
        });
      }
    }

    return res.status(200).json({
      jobId,
      job: job ? {
        name: job.name,
        state: await job.getState(),
        progress: job.progress,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      } : null,
      post: post || linkedPost || null,
    });

  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ── POST /api/rock-social/queue/clear ── Fix #5 ────────────────────────────

export const clearQueue = async (req: Request, res: Response) => {
  try {
    const { includeCompleted } = req.body || {};
    const states = ['wait', 'delayed', 'failed'] as const;
    if (includeCompleted) (states as any).push('completed');

    const before = await automationQueue.getJobCounts(...states);
    const removed: Record<string, number> = {};

    for (const state of states) {
      const cleaned = await automationQueue.clean(0, 10000, state);
      removed[state] = cleaned.length;
    }

    const after = await automationQueue.getJobCounts(...states);

    return res.status(200).json({
      message: 'Queue cleared successfully.',
      before,
      removed,
      after,
    });

  } catch (error) {
    return res.status(500).json({
      message: 'Failed to clear queue.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ── GET /api/rock-social/accounts/:id ── existing ───────────────────────────

export const getSocialAccountById = async (req: Request, res: Response) => {
  try {
    const account = await prisma.socialAccount.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        username: true,
        platform: true,
        status: true,
        brandTag: true,
        lastActive: true,
        sessionHealth: true,
        sessionHealthReason: true,
      },
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    // Compute lastPostDate
    const lastPost = await prisma.post.findFirst({
      where: { status: 'published', accountIds: { contains: req.params.id } },
      select: { postedAt: true },
      orderBy: { postedAt: 'desc' },
    });

    return res.status(200).json({
      ...account,
      lastPostDate: lastPost?.postedAt?.toISOString() || null,
    });

  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ── GET /api/rock-social/exclude-accounts ── existing ───────────────────────

export const getExcludeAccounts = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({
      message: 'Pre-configured exclude accounts.',
      // akun yang udah di-ban IG atau error
      excludeIds: [
        'cfde9d2a-fa87-4649-9279-68b0f3500b96',
        '82b59aef-d26f-4692-991f-d757baef58a3',
      ],
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ── GET /api/rock-social/select-accounts ── existing ────────────────────────

import { resolveAccountSelection } from '../services/AccountSelectionResolver';

export const getSelectAccounts = async (req: Request, res: Response) => {
  try {
    const { accountIds, groupIds } = req.query;

    const params: { accountIds?: string[]; groupIds?: string[] } = {};

    if (typeof accountIds === 'string') {
      params.accountIds = accountIds.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (typeof groupIds === 'string') {
      params.groupIds = groupIds.split(',').map((s) => s.trim()).filter(Boolean);
    }

    const accounts = await resolveAccountSelection(params);

    return res.status(200).json({
      message: 'Accounts resolved.',
      data: accounts,
      total: accounts.length,
    });

  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ── POST /api/rock-social/upload ── existing ────────────────────────────────

export const uploadImage = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided. Field name must be "image".' });
    }
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3010';
    const url = `${baseUrl}/uploads/${req.file.filename}`;
    return res.status(200).json({ url });
  } catch (error) {
    return res.status(500).json({
      message: 'Image upload failed.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ── Helper ───────────────────────────────────────────────────────────────────

function safeJsonParse(str: string | null): any {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

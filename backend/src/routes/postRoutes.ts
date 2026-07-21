import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spinCaptions } from '../services/CaptionSpinnerService';
import { sessionHealthService } from '../services/SessionHealthService';
import { resolveAccountSelection } from '../services/AccountSelectionResolver';
import { logActivity } from '../services/ActivityLogService';
import {
  generateIdempotencyKey,
  generateRequestPayloadHash,
  acquireRequestLock,
  releaseRequestLock,
} from '../utils/idempotency';
import { automationGuard } from '../middleware/automation';
import {
  DurableIdempotencyService,
  IdempotencyConflictError,
  IdempotencyValidationError,
} from '../services/DurableIdempotencyService';
import { canonicalRequestHash } from '../utils/canonicalRequestHash';

const router = Router();
const prisma = new PrismaClient();

const durableIdempotency = new DurableIdempotencyService(prisma);

function idempotencyErrorResponse(res: Response, error: unknown): boolean {
  if (error instanceof IdempotencyConflictError) {
    res.status(409).json({ error: error.message });
    return true;
  }
  if (error instanceof IdempotencyValidationError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}
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

const DEFAULT_DELAY_MINUTES = 15;
const DEFAULT_DELAY_MAX_MINUTES = 45;
const MAX_DELAY_MINUTES = 24 * 60;

function parseDelayMinutes(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function randomDelayMs(minMinutes: number, maxMinutes: number) {
  const minMs = Math.round(minMinutes * 60 * 1000);
  const maxMs = Math.round(maxMinutes * 60 * 1000);
  if (maxMs <= minMs) return minMs;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function minutesFromMs(ms: number) {
  return Math.round((ms / 60 / 1000) * 100) / 100;
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

async function filterPostableAccounts(accountIds: string[], allowUnhealthy: boolean) {
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  if (allowUnhealthy) {
    return { postableAccountIds: uniqueIds, skippedAccounts: [] as any[] };
  }

  const accounts = await prisma.socialAccount.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      username: true,
      platform: true,
      sessionHealth: true,
      sessionHealthReason: true,
      sessionHealthCheckedAt: true,
    },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const skippedAccounts: any[] = [];
  const postableAccountIds: string[] = [];

  for (const accountId of uniqueIds) {
    const account = byId.get(accountId);

    // Block unsupported platforms (only Instagram + TikTok are automated now)
        if (account && account.platform !== 'Instagram' && account.platform !== 'TikTok' && account.platform !== 'Tiktok') {
          skippedAccounts.push({
            accountId,
            username: account.username || accountId,
            platform: account.platform,
            health: 'N/A',
            reason: `Platform "${account.platform}" posting automation is not yet implemented`,
            checkedAt: null,
          });
          continue;
        }

    const health = account?.sessionHealth || 'UNKNOWN';
    if (account && sessionHealthService.isPostableHealth(health)) {
      postableAccountIds.push(accountId);
    } else {
      skippedAccounts.push({
        accountId,
        username: account?.username || accountId,
        health,
        reason: account?.sessionHealthReason || 'Session has not been checked or is not healthy',
        checkedAt: account?.sessionHealthCheckedAt,
      });
    }
  }

  return { postableAccountIds, skippedAccounts };
}

function logSkippedUnhealthyAccounts(workspaceId: string, skippedAccounts: any[], source: string) {
  for (const account of skippedAccounts) {
    logActivity({
      workspaceId,
      type: 'posting',
      entityType: 'account',
      entityId: account.accountId,
      accountId: account.accountId,
      action: 'skipped_unhealthy_account',
      status: 'skipped',
      message: `Skipped @${account.username} because session is ${account.health}`,
      metadata: {
        source,
        health: account.health,
        reason: account.reason,
        checkedAt: account.checkedAt,
      },
    });
  }
}

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
router.post('/bulk', automationGuard, upload.single('media'), async (req: Request, res: Response) => {
  let payloadHash = '';
  const durableKey = req.get('Idempotency-Key');
  let durableAcquired = false;
  try {
    const {
      baseCaption,
      baseHashtags, // JSON string of string[]
      accountIds,   // JSON string of string[]
      scheduleAt,
      spinCaptions: shouldSpin = 'true',
      allowUnhealthy,
      workspaceId = 'workspace-default',
      campaignId = null,
    } = req.body;

    const parsedAccountIdsRaw: string[] = JSON.parse(accountIds || '[]');
    const parsedHashtags: string[]   = JSON.parse(baseHashtags || '[]');
    const { postableAccountIds: parsedAccountIds, skippedAccounts } = await filterPostableAccounts(
      parsedAccountIdsRaw,
      parseBoolean(allowUnhealthy),
    );

    if (!baseCaption?.trim())       { res.status(400).json({ error: 'baseCaption is required' }); return; }
    if (parsedAccountIdsRaw.length === 0) { res.status(400).json({ error: 'accountIds is required' }); return; }
    if (parsedAccountIds.length === 0) {
      res.status(400).json({
        error: 'No healthy accounts selected for posting',
        skippedAccounts,
      });
      return;
    }
    if (!req.file)                  { res.status(400).json({ error: 'media file is required — Instagram needs an image' }); return; }
    if (durableKey) {
      const requestHash = canonicalRequestHash({
        workspaceId,
        baseCaption,
        baseHashtags: parsedHashtags,
        accountIds: parsedAccountIdsRaw,
        scheduleAt: scheduleAt ?? null,
        spinCaptions: shouldSpin,
        allowUnhealthy: parseBoolean(allowUnhealthy),
        campaignId,
        media: {
          sha256: crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex'),
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
      const begun = await durableIdempotency.beginOperation({
        scope: 'post.bulk',
        key: durableKey,
        requestHash,
      });
      if (!begun.acquired) {
        fs.unlink(req.file.path, () => {});
        res.status(200).json({
          message: 'Idempotent operation already exists.',
          operation: begun.operation,
        });
        return;
      }
      durableAcquired = true;
    }
    logSkippedUnhealthyAccounts(workspaceId, skippedAccounts, 'bulk');


    // ── Request-level Lock ──
    if (!durableKey) {
      payloadHash = generateRequestPayloadHash(req.body, req.file);
      if (!acquireRequestLock(payloadHash)) {
        logActivity({
          workspaceId,
          type: 'posting',
          entityType: 'request',
          entityId: 'lock-blocked',
          action: 'duplicate_request_blocked',
          status: 'blocked',
          message: 'Duplicate bulk-post request blocked by request-level lock.',
          metadata: { payloadHash },
        });
        res.status(409).json({
          error: 'Duplicate request blocked (request-level lock). Please wait a few seconds before trying again.',
          createdCount: 0,
          skippedDuplicateCount: 0,
          skippedUnhealthyCount: skippedAccounts.length,
          jobIds: [],
        });
        return;
      }
    }

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
    // 15–45 min random delay between accounts to avoid same-timestamp detection
    const MIN_ACCOUNT_DELAY_MS = 15 * 60 * 1000;   // 15 minutes
    const MAX_ACCOUNT_DELAY_MS = 45 * 60 * 1000;  // 45 minutes

    const createdPosts: any[] = [];
    let skippedDuplicateCount = 0;
    let cumulativeDelay = 0;

    // Base delay from scheduleAt if provided
    if (scheduleAt) {
      const targetTime = new Date(scheduleAt).getTime();
      const now = Date.now();
      cumulativeDelay = targetTime > now ? targetTime - now : 0;
    }

    const accountRows = await prisma.socialAccount.findMany({
      where: { id: { in: parsedAccountIds } },
      select: { id: true, username: true },
    });
    const usernameByAccountId = new Map(accountRows.map(account => [account.id, account.username]));

    for (let i = 0; i < parsedAccountIds.length; i++) {
      const accountId = parsedAccountIds[i];
      const username = usernameByAccountId.get(accountId) || accountId;
      const { caption, hashtags } = captions[i] ?? { caption: baseCaption, hashtags: parsedHashtags.join(' ') };
      const finalContent = `${caption}\n\n${hashtags}`;
      const scheduleDate = cumulativeDelay > 0 ? new Date(Date.now() + cumulativeDelay) : null;

      // ── Idempotency Key ──
      const idempotencyKey = generateIdempotencyKey({
        accountId,
        mediaFilename: req.file!.filename,
        content: finalContent,
        campaignId,
        scheduledAt: scheduleDate,
      });

      // Create DB record with uniqueness constraint handling
      let post;
      try {
        post = await prisma.post.create({
          data: {
            workspaceId,
            content: finalContent,
            mediaUrls: JSON.stringify([req.file!.filename]),
            accountIds: JSON.stringify([accountId]),
            status: cumulativeDelay > 0 ? 'scheduled' : 'pending',
            scheduleAt: scheduleDate,
            idempotencyKey,
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          skippedDuplicateCount++;
          logActivity({
            workspaceId,
            type: 'posting',
            entityType: 'post',
            entityId: 'duplicate-skipped',
            accountId,
            action: 'duplicate_job_skipped',
            status: 'skipped',
            message: `Duplicate job skipped for @${username} (idempotency key conflict)`,
            metadata: { idempotencyKey, username },
          });
          continue; // Skip to next account
        }
        throw err;
      }

      // Log successful job creation
      logActivity({
        workspaceId,
        type: 'posting',
        entityType: 'post',
        entityId: post.id,
        accountId,
        action: 'posting_job_created',
        status: 'created',
        message: `Posting job successfully created for @${username} (Idempotency: ${idempotencyKey})`,
        metadata: { jobId: post.id, idempotencyKey, username },
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
        logActivity({
          workspaceId,
          type: 'queue',
          entityType: 'post',
          entityId: post.id,
          accountId,
          action: 'job_queued',
          status: 'queued',
          message: `Posting job queued for account @${username}`,
          metadata: { source: 'bulk', delayMs: cumulativeDelay, spinIndex: i },
        });
      } else {
        // ── Direct Fallback Mode (No Redis) ──
        console.log(`[BulkPost] Redis missing. Queuing direct post for ${accountId} with ${cumulativeDelay}ms delay`);
        
        // Execute in background without awaiting
        (async () => {
          try {
            if (cumulativeDelay > 0) await new Promise(r => setTimeout(r, cumulativeDelay));
            
            // Re-importing service to ensure it's available in this scope if needed
            const { instagramPostingService } = await import('../services/InstagramPostingService');
            
            await prisma.post.update({
              where: { id: post.id },
              data: {
                status: 'pending_verify',
                results: JSON.stringify({ [accountId]: { status: 'PENDING_VERIFY' } })
              }
            });
            console.log(`[DirectPost] ${accountId} marked PENDING_VERIFY before Instagram publish verification`);
            
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
              logActivity({
                workspaceId,
                type: 'posting',
                entityType: 'post',
                entityId: post.id,
                accountId,
                action: 'publish_success',
                status: 'success',
                message: `Published Instagram post for @${result.username}`,
                metadata: { source: 'direct_fallback' },
              });
              console.log(`[DirectPost] ✅ Published for @${result.username}`);
            } else {
              throw new Error(result.error);
            }
          } catch (err: any) {
            console.error(`[DirectPost] ❌ Failed for ${accountId}:`, err.message);
            const failedStatus = err.message?.includes('FAILED_VERIFY') ? 'FAILED_VERIFY' : 'failed';
            await prisma.post.update({
              where: { id: post.id },
              data: {
                status: 'failed',
                results: JSON.stringify({ [accountId]: { status: failedStatus, error: err.message } })
              }
            }).catch(() => {});
            logActivity({
              workspaceId,
              type: 'posting',
              entityType: 'post',
              entityId: post.id,
              accountId,
              action: 'publish_failure',
              status: 'failed',
              message: `Direct fallback publish failed for ${accountId}`,
              metadata: { source: 'direct_fallback', failedStatus, error: err.message },
            });
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

    if (durableKey && durableAcquired) {
      await durableIdempotency.markCompleted('post.bulk', durableKey, {
        resourceType: 'post-submission',
        ...(createdPosts[0]?.id ? { resourceId: createdPosts[0].id } : {}),
        resultReference: {
          postIds: createdPosts.map((post) => post.id),
          skippedDuplicateCount,
        },
      });
    }

    res.status(202).json({
      message: automationQueue 
        ? `Queued ${createdPosts.length} posts via BullMQ (skipped ${skippedDuplicateCount} duplicates).`
        : `Queued ${createdPosts.length} posts via Direct Fallback (Redis is down, skipped ${skippedDuplicateCount} duplicates).`,
      posts: createdPosts,
      redisAvailable: !!automationQueue,
      skippedAccounts,
    });
  } catch (error: any) {
    console.error('[Bulk] Error:', error);
    if (durableKey && !durableAcquired && req.file) fs.unlink(req.file.path, () => {});
    if (durableKey && durableAcquired) {
      await durableIdempotency.markUnknown('post.bulk', durableKey, 'SUBMISSION_OUTCOME_UNCERTAIN').catch(() => {});
    }
    if (idempotencyErrorResponse(res, error)) return;
    res.status(500).json({ error: 'Failed to queue posts', details: error.message });
  } finally {
    if (payloadHash) {
      releaseRequestLock(payloadHash);
    }
  }
});

// ── POST /api/posts/bulk-multi — Multi-media bulk post (Assignment Mode support) ───────────
router.post('/bulk-multi', automationGuard, upload.array('media', 20), async (req: Request, res: Response) => {
  let payloadHash = '';
  try {
    const {
      mode = 'broadcast',
      baseCaption,
      baseHashtags, // JSON string string[]
      accountIds,   // JSON string string[] (used in broadcast mode)
      groupIds,     // JSON string string[] (used in broadcast mode)
      assignments,  // JSON string {accountId, caption, photoIndex}[] (used in assign mode)
      spinCaptions: shouldSpin = 'true',
      workspaceId = 'workspace-default',
      delayMinMinutes,
      delayMaxMinutes,
      allowUnhealthy,
      campaignId = null,
    } = req.body;

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'At least one media file is required' });
      return;
    }

    let parsedAccountIds = JSON.parse(accountIds || '[]');
    const parsedGroupIds = JSON.parse(groupIds || '[]');
    const parsedHashtags   = JSON.parse(baseHashtags || '[]');
    let parsedAssignments = JSON.parse(assignments || '[]');
    const minDelayMinutes = parseDelayMinutes(delayMinMinutes, DEFAULT_DELAY_MINUTES);
    const maxDelayMinutes = parseDelayMinutes(delayMaxMinutes, DEFAULT_DELAY_MAX_MINUTES);

    if (
      Number.isNaN(minDelayMinutes) ||
      Number.isNaN(maxDelayMinutes) ||
      minDelayMinutes < 0 ||
      maxDelayMinutes < minDelayMinutes ||
      maxDelayMinutes > MAX_DELAY_MINUTES
    ) {
      res.status(400).json({ error: 'Invalid delay settings' });
      return;
    }

    // Validation
    if (mode === 'broadcast') {
      if (!baseCaption?.trim()) { res.status(400).json({ error: 'baseCaption is required' }); return; }
      if (parsedAccountIds.length === 0 && parsedGroupIds.length === 0) { res.status(400).json({ error: 'accountIds or groupIds is required' }); return; }
    } else {
      if (parsedAssignments.length === 0) { res.status(400).json({ error: 'assignments are required' }); return; }
    }

    const createdPosts: any[] = [];
    let skippedAccounts: any[] = [];
    let skippedDuplicateCount = 0;
    let cumulativeDelay = 0;
    let delayFromPrevious = 0;

    if (mode === 'broadcast' && parsedGroupIds.length > 0) {
      const resolvedAccounts = await resolveAccountSelection({
        accountIds: parsedAccountIds,
        groupIds: parsedGroupIds,
      });
      parsedAccountIds = resolvedAccounts.map((account) => account.id);
      if (parsedAccountIds.length === 0) {
        res.status(400).json({ error: 'No accounts resolved from selected accounts or groups' });
        return;
      }
    }

    const targetAccountIds = mode === 'assign'
      ? parsedAssignments.map((as: any) => as.accountId).filter(Boolean)
      : parsedAccountIds;
    const healthFilter = await filterPostableAccounts(targetAccountIds, parseBoolean(allowUnhealthy));
    skippedAccounts = healthFilter.skippedAccounts;
    logSkippedUnhealthyAccounts(workspaceId, skippedAccounts, 'bulk-multi');

    if (mode === 'assign') {
      const allowedIds = new Set(healthFilter.postableAccountIds);
      parsedAssignments = parsedAssignments.filter((as: any) => allowedIds.has(as.accountId));
      if (parsedAssignments.length === 0) {
        res.status(400).json({ error: 'No healthy accounts selected for posting', skippedAccounts });
        return;
      }
    } else {
      parsedAccountIds = healthFilter.postableAccountIds;
      if (parsedAccountIds.length === 0) {
        res.status(400).json({ error: 'No healthy accounts selected for posting', skippedAccounts });
        return;
      }
    }

    const accountRows = await prisma.socialAccount.findMany({
      where: { id: { in: mode === 'assign' ? parsedAssignments.map((as: any) => as.accountId).filter(Boolean) : parsedAccountIds } },
      select: { id: true, username: true },
    });
    const usernameByAccountId = new Map(accountRows.map(account => [account.id, account.username]));

    // ── Request-level Lock ──
    payloadHash = generateRequestPayloadHash(req.body, req.files);
    if (!acquireRequestLock(payloadHash)) {
      logActivity({
        workspaceId,
        type: 'posting',
        entityType: 'request',
        entityId: 'lock-blocked',
        action: 'duplicate_request_blocked',
        status: 'blocked',
        message: 'Duplicate bulk-multi-post request blocked by request-level lock.',
        metadata: { payloadHash },
      });
      res.status(409).json({
        error: 'Duplicate request blocked (request-level lock). Please wait a few seconds before trying again.',
        createdCount: 0,
        skippedDuplicateCount: 0,
        skippedUnhealthyCount: skippedAccounts.length,
        jobIds: [],
      });
      return;
    }

    if (mode === 'assign') {
      // ── ASSIGN MODE Logic ──────────────────────────────────────────
      for (let i = 0; i < parsedAssignments.length; i++) {
        const as = parsedAssignments[i];
        const file = files[as.photoIndex];
        if (!file) continue;

        const finalContent = as.caption;
        const accountId = as.accountId;
        const username = usernameByAccountId.get(accountId) || accountId;
        const scheduledTime = new Date(Date.now() + cumulativeDelay);

        // ── Idempotency Key ──
        const idempotencyKey = generateIdempotencyKey({
          accountId,
          mediaFilename: file.filename,
          content: finalContent,
          campaignId,
          scheduledAt: cumulativeDelay > 0 ? scheduledTime : null,
        });

        // Create DB record with uniqueness check
        let post;
        try {
          post = await prisma.post.create({
            data: {
              workspaceId,
              content: finalContent,
              mediaUrls: JSON.stringify([file.filename]),
              accountIds: JSON.stringify([accountId]),
              status: cumulativeDelay > 0 ? 'scheduled' : 'pending',
              scheduleAt: cumulativeDelay > 0 ? scheduledTime : null,
              idempotencyKey,
            },
          });
        } catch (err: any) {
          if (err.code === 'P2002') {
            skippedDuplicateCount++;
            logActivity({
              workspaceId,
              type: 'posting',
              entityType: 'post',
              entityId: 'duplicate-skipped',
              accountId,
              action: 'duplicate_job_skipped',
              status: 'skipped',
              message: `Duplicate job skipped for @${username} (idempotency key conflict)`,
              metadata: { idempotencyKey, username },
            });
            continue; // Skip
          }
          throw err;
        }

        // Log successful job creation
        logActivity({
          workspaceId,
          type: 'posting',
          entityType: 'post',
          entityId: post.id,
          accountId,
          action: 'posting_job_created',
          status: 'created',
          message: `Posting job successfully created for @${username} (Idempotency: ${idempotencyKey})`,
          metadata: { jobId: post.id, idempotencyKey, username },
        });

        // Queue job
        if (automationQueue) {
          await automationQueue.add('postJob', {
            postId: post.id,
            accountId,
            content: finalContent,
            mediaLocalPath: file.path,
            mediaUrls: [file.filename],
            spinIndex: 0,
          }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30000 },
            delay: cumulativeDelay,
          });
          logActivity({
            workspaceId,
            type: 'queue',
            entityType: 'post',
            entityId: post.id,
            accountId,
            action: 'job_queued',
            status: 'queued',
            message: `Posting job queued for @${username}`,
            metadata: { source: 'bulk-multi', mode: 'assign', delayMs: cumulativeDelay },
          });
        }

        console.log(`[BulkMulti] Scheduled @${username} | delay ${minutesFromMs(delayFromPrevious)} min | scheduled ${scheduledTime.toISOString()}`);

        createdPosts.push({
          ...post,
          scheduledDelayMinutes: minutesFromMs(delayFromPrevious),
          scheduleAt: cumulativeDelay > 0 ? scheduledTime.toISOString() : null,
          username,
        });

        delayFromPrevious = randomDelayMs(minDelayMinutes, maxDelayMinutes);
        cumulativeDelay += delayFromPrevious;
      }
    } else {
      // ── BROADCAST MODE Logic (similar to /bulk but uses first file) ──────
      const file = files[0];
      let captions: { caption: string; hashtags: string }[];
      
      if (shouldSpin === 'true') {
        captions = await spinCaptions(baseCaption, parsedHashtags, parsedAccountIds.length);
      } else {
        captions = parsedAccountIds.map(() => ({ caption: baseCaption, hashtags: parsedHashtags.join(' ') }));
      }

      for (let i = 0; i < parsedAccountIds.length; i++) {
        const accountId = parsedAccountIds[i];
        const username = usernameByAccountId.get(accountId) || accountId;
        const { caption, hashtags } = captions[i];
        const finalContent = `${caption}\n\n${hashtags}`;
        const scheduledTime = new Date(Date.now() + cumulativeDelay);

        // ── Idempotency Key ──
        const idempotencyKey = generateIdempotencyKey({
          accountId,
          mediaFilename: file.filename,
          content: finalContent,
          campaignId,
          scheduledAt: cumulativeDelay > 0 ? scheduledTime : null,
        });

        // Create DB record with uniqueness check
        let post;
        try {
          post = await prisma.post.create({
            data: {
              workspaceId,
              content: finalContent,
              mediaUrls: JSON.stringify([file.filename]),
              accountIds: JSON.stringify([accountId]),
              status: cumulativeDelay > 0 ? 'scheduled' : 'pending',
              scheduleAt: cumulativeDelay > 0 ? scheduledTime : null,
              idempotencyKey,
            },
          });
        } catch (err: any) {
          if (err.code === 'P2002') {
            skippedDuplicateCount++;
            logActivity({
              workspaceId,
              type: 'posting',
              entityType: 'post',
              entityId: 'duplicate-skipped',
              accountId,
              action: 'duplicate_job_skipped',
              status: 'skipped',
              message: `Duplicate job skipped for @${username} (idempotency key conflict)`,
              metadata: { idempotencyKey, username },
            });
            continue; // Skip
          }
          throw err;
        }

        // Log successful job creation
        logActivity({
          workspaceId,
          type: 'posting',
          entityType: 'post',
          entityId: post.id,
          accountId,
          action: 'posting_job_created',
          status: 'created',
          message: `Posting job successfully created for @${username} (Idempotency: ${idempotencyKey})`,
          metadata: { jobId: post.id, idempotencyKey, username },
        });

        if (automationQueue) {
          await automationQueue.add('postJob', {
            postId: post.id,
            accountId,
            content: finalContent,
            mediaLocalPath: file.path,
            mediaUrls: [file.filename],
            spinIndex: i,
          }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30000 },
            delay: cumulativeDelay,
          });
          logActivity({
            workspaceId,
            type: 'queue',
            entityType: 'post',
            entityId: post.id,
            accountId,
            action: 'job_queued',
            status: 'queued',
            message: `Posting job queued for @${username}`,
            metadata: { source: 'bulk-multi', mode: 'broadcast', delayMs: cumulativeDelay, spinIndex: i },
          });
        }

        console.log(`[BulkMulti] Scheduled @${username} | delay ${minutesFromMs(delayFromPrevious)} min | scheduled ${scheduledTime.toISOString()}`);

        createdPosts.push({
          ...post,
          scheduledDelayMinutes: minutesFromMs(delayFromPrevious),
          scheduleAt: cumulativeDelay > 0 ? scheduledTime.toISOString() : null,
          username,
        });

        delayFromPrevious = randomDelayMs(minDelayMinutes, maxDelayMinutes);
        cumulativeDelay += delayFromPrevious;
      }
    }

    res.status(202).json({
      message: `Queued ${createdPosts.length} posts (skipped ${skippedDuplicateCount} duplicates).`,
      posts: createdPosts,
      skippedAccounts,
      delaySettings: {
        minMinutes: minDelayMinutes,
        maxMinutes: maxDelayMinutes,
      },
    });
  } catch (error: any) {
    console.error('[BulkMulti] Error:', error);
    res.status(500).json({ error: 'Failed to queue multi-media posts', details: error.message });
  } finally {
    if (payloadHash) {
      releaseRequestLock(payloadHash);
    }
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
router.post('/', automationGuard, async (req: Request, res: Response) => {
  const durableKey = req.get('Idempotency-Key');
  let durableAcquired = false;
  try {
    const { workspaceId = 'workspace-default', content, mediaUrls, accountIds, scheduleAt } = req.body;

    if (!accountIds || accountIds.length === 0) {
      res.status(400).json({ error: 'No accounts selected for posting' });
      return;
    }
    if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) {
      res.status(400).json({
        error: 'mediaUrls is required for Instagram posting. Upload media or use the bulk post endpoint.',
      });
      return;
    }

    if (durableKey) {
      const begun = await durableIdempotency.beginOperation({
        scope: 'post.submit',
        key: durableKey,
        requestHash: canonicalRequestHash({
          workspaceId,
          content,
          mediaUrls,
          accountIds,
          scheduleAt: scheduleAt ?? null,
        }),
      });
      if (!begun.acquired) {
        res.status(200).json({
          message: 'Idempotent operation already exists.',
          operation: begun.operation,
        });
        return;
      }
      durableAcquired = true;
    }

    let baseDelay = 0;
    if (scheduleAt) {
      const targetTime = new Date(scheduleAt).getTime();
      const now = Date.now();
      baseDelay = targetTime > now ? targetTime - now : 0;
    }

    const createdPosts = [];
    let skippedCount = 0;
    for (const accountId of accountIds) {
      const firstMedia = mediaUrls && mediaUrls.length > 0 ? mediaUrls[0] : 'no-media';
      const scheduleDate = scheduleAt ? new Date(scheduleAt) : null;
      const idempotencyKey = generateIdempotencyKey({
        accountId,
        mediaFilename: firstMedia,
        content,
        scheduledAt: scheduleDate,
      });

      let post;
      try {
        post = await prisma.post.create({
          data: {
            workspaceId,
            content,
            mediaUrls: JSON.stringify(mediaUrls || []),
            accountIds: JSON.stringify([accountId]),
            status: baseDelay > 0 ? 'scheduled' : 'pending',
            scheduleAt: scheduleDate,
            idempotencyKey,
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          skippedCount++;
          logActivity({
            workspaceId,
            type: 'posting',
            entityType: 'post',
            entityId: 'duplicate-skipped-legacy',
            accountId,
            action: 'duplicate_job_skipped',
            status: 'skipped',
            message: `Duplicate legacy job skipped for account ${accountId} (idempotency key conflict)`,
            metadata: { idempotencyKey },
          });
          continue;
        }
        throw err;
      }

      if (automationQueue) {
        await automationQueue.add(
          'postJob',
          { postId: post.id, accountId, content, mediaUrls: mediaUrls || [], spinIndex: 0 },
          { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, delay: baseDelay }
        );
        logActivity({
          workspaceId,
          type: 'queue',
          entityType: 'post',
          entityId: post.id,
          accountId,
          action: 'job_queued',
          status: 'queued',
          message: `Posting job queued for account ${accountId}`,
          metadata: { source: 'legacy', delayMs: baseDelay },
        });
      }

      createdPosts.push(post);
    }

    if (durableKey && durableAcquired) {
      await durableIdempotency.markCompleted('post.submit', durableKey, {
        resourceType: 'post-submission',
        ...(createdPosts[0]?.id ? { resourceId: createdPosts[0].id } : {}),
        resultReference: {
          postIds: createdPosts.map((post) => post.id),
          skippedCount,
        },
      });
    }

    res.status(202).json({
      message: `Queued ${createdPosts.length} posts (skipped ${skippedCount} duplicates).`,
      posts: createdPosts,
    });
  } catch (error: any) {
    console.error('[postRoutes] Error:', error);
    if (durableKey && durableAcquired) {
      await durableIdempotency.markUnknown('post.submit', durableKey, 'SUBMISSION_OUTCOME_UNCERTAIN').catch(() => {});
    }
    if (idempotencyErrorResponse(res, error)) return;
    res.status(500).json({ error: 'Failed to queue posts', details: error.message });
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

// ── GET /api/posts/:id — Single post detail with full result breakdown ───
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: String(req.params.id) } });
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    // Resolve account usernames for readability
    const accountIds: string[] = post.accountIds ? JSON.parse(post.accountIds) : [];
    const accounts = accountIds.length > 0
      ? await prisma.socialAccount.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, username: true, platform: true, sessionHealth: true },
        })
      : [];
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const results: Record<string, any> = post.results ? JSON.parse(post.results) : {};
    const enrichedResults: Record<string, any> = {};
    for (const [accountId, result] of Object.entries(results)) {
      const acc = accountMap.get(accountId);
      enrichedResults[accountId] = {
        ...(result as object),
        accountUsername: acc?.username || accountId,
        accountPlatform: acc?.platform || 'unknown',
        accountSessionHealth: acc?.sessionHealth || 'UNKNOWN',
      };
    }

    // Get related activity log entries for this post
    const activities = await prisma.activityLog.findMany({
      where: { entityId: post.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true, status: true, message: true, createdAt: true, metadata: true },
    });

    res.json({
      id: post.id,
      status: post.status,
      workspaceId: post.workspaceId,
      content: post.content,
      mediaUrls: post.mediaUrls ? JSON.parse(post.mediaUrls) : [],
      accountIds,
      accounts: Array.from(accountMap.values()),
      scheduleAt: post.scheduleAt,
      postedAt: post.postedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      results: enrichedResults,
      activity: activities,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch post', details: error.message });
  }
});

// ── GET /api/posts?status=...&workspaceId=...&limit=... — Filtered post list ─
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, workspaceId = 'workspace-default', limit = '50', accountId } = req.query;
    const take = Math.min(parseInt(String(limit)) || 50, 200);

    const where: any = { workspaceId: String(workspaceId) };
    if (status) where.status = String(status);
    if (accountId) where.accountIds = { contains: String(accountId) };

    const posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });

    const parsed = posts.map((p: any) => ({
      id: p.id,
      status: p.status,
      workspaceId: p.workspaceId,
      contentPreview: (p.content || '').slice(0, 120),
      mediaUrls: p.mediaUrls ? JSON.parse(p.mediaUrls) : [],
      accountIds: p.accountIds ? JSON.parse(p.accountIds) : [],
      scheduleAt: p.scheduleAt,
      postedAt: p.postedAt,
      createdAt: p.createdAt,
      results: p.results ? JSON.parse(p.results) : null,
    }));

    // Aggregate by status for at-a-glance dashboard view
    const counts = await prisma.post.groupBy({
      by: ['status'],
      where: { workspaceId: String(workspaceId) },
      _count: { _all: true },
    });

    res.json({
      total: parsed.length,
      counts: counts.reduce((acc: any, c: any) => ({ ...acc, [c.status]: c._count._all }), {}),
      filter: { status: status || 'all', workspaceId, accountId: accountId || null, limit: take },
      posts: parsed,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch posts', details: error.message });
  }
});

export default router;

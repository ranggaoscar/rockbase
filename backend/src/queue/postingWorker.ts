import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { instagramPostingService } from '../services/InstagramPostingService';
import { tiktokPostingService } from '../services/TikTokPostingService';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { logActivity } from '../services/ActivityLogService';
import { logger } from '../services/logger';
import { sessionHealthService } from '../services/SessionHealthService';
import { categorizeError } from '../utils/errorClassifier';
import { PostJobData } from './jobTypes';
import { DurableIdempotencyService, IdempotencyConflictError } from '../services/DurableIdempotencyService';
import { postingWorkerDeliveryIdentity } from '../utils/socialPostingIdempotency';

const prisma = new PrismaClient();
const durableIdempotency = new DurableIdempotencyService(prisma);
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const HUMAN_CONFIG = {
  throttle: { min: 30, max: 90 }, // seconds between ANY post globally (delay between different accounts)
  batchDelay: 300, // 5 minutes between batches
  maxBatchSize: 5, // Posts per batch before delaying
  randomize: true
};

const workerState = {
  lastGlobalJobTime: 0,
  batchCount: 0,
};

const REMOTE_MEDIA_TIMEOUT_MS = 60_000;

function sanitizeUploadFilename(filename: string): string {
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return safeName || `remote-media-${Date.now()}.jpg`;
}

function filenameFromMediaUrl(mediaUrl: string): string {
  const parsed = new URL(mediaUrl);
  const candidate = parsed.searchParams.get('filename') || parsed.pathname.split('/').pop() || '';
  const filename = sanitizeUploadFilename(decodeURIComponent(candidate));

  return path.extname(filename) ? filename : `${filename}.jpg`;
}

async function downloadToFile(mediaUrl: string, destinationPath: string, redirectCount = 0): Promise<void> {
  if (redirectCount > 3) {
    throw new Error(`Too many redirects while downloading media from ${mediaUrl}`);
  }

  await new Promise<void>((resolve, reject) => {
    const parsed = new URL(mediaUrl);
    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.get(parsed, (response) => {
      const statusCode = response.statusCode || 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        const redirectedUrl = new URL(response.headers.location, parsed).toString();
        downloadToFile(redirectedUrl, destinationPath, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Failed to download media (${statusCode}) from ${mediaUrl}`));
        return;
      }

      const fileStream = fs.createWriteStream(destinationPath);
      response.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(() => resolve()));
      fileStream.on('error', reject);
    });

    request.setTimeout(REMOTE_MEDIA_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out downloading media from ${mediaUrl}`));
    });
    request.on('error', (err) => {
      reject(new Error(`Download failed for ${mediaUrl}: ${err.message}`));
    });
  });
}

async function resolveRemoteMediaPath(mediaUrl: string): Promise<string> {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  await fs.promises.mkdir(uploadsDir, { recursive: true });

  let targetUrl = mediaUrl;
  if (targetUrl.includes('comfyui.bresciastone.com')) {
    const localUrl = process.env.COMFYUI_LOCAL_URL || 'http://127.0.0.1:8188';
    targetUrl = targetUrl.replace('https://comfyui.bresciastone.com', localUrl)
                         .replace('http://comfyui.bresciastone.com', localUrl);
    console.log(`[Worker] Redirecting Cloudflare ComfyUI URL to local network: ${targetUrl}`);
  }

  const targetPath = path.join(uploadsDir, filenameFromMediaUrl(targetUrl));
  try {
    const existing = await fs.promises.stat(targetPath);
    if (existing.size > 0) return targetPath;
  } catch {}

  const tempPath = path.join(
    uploadsDir,
    `.${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(targetPath)}.tmp`,
  );

  try {
    await downloadToFile(targetUrl, tempPath);
    try {
      await fs.promises.rename(tempPath, targetPath);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      await fs.promises.unlink(tempPath).catch(() => {});
    }
    return targetPath;
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

export const postingWorker = new Worker<PostJobData>(
  'automationQueue',
  async (job: Job<PostJobData>) => {
    const { postId, accountId, content, mediaLocalPath: rawMediaPath, mediaUrls } = job.data;
    console.log(`[Worker] Processing job ${job.id} | post ${postId} | account ${accountId}`);

    // Fetch the post from database
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new Error(`Post ${postId} not found`);

    // ── PER-ACCOUNT DEDUP CHECK: skip if this account already posted successfully ──
    let existingResults: Record<string, any> = {};
    try { existingResults = JSON.parse(post.results || '{}'); } catch {}

    if (existingResults[accountId]?.status === 'success') {
      console.log(`[Worker] Skipping job ${job.id} — account ${accountId} already posted successfully for post ${postId}`);
      return { status: 'skipped', reason: 'already_posted_by_this_account' };
    }

    if (existingResults[accountId]?.status === 'PENDING_VERIFY') {
      console.log(`[Worker] Skipping job ${job.id} — account ${accountId} is stuck in PENDING_VERIFY, not retrying to avoid duplicate`);
      return { status: 'skipped', reason: 'pending_verify_no_retry' };
    }

    // Worker safety check: skip if a job with same idempotencyKey already succeeded
    if (post.idempotencyKey) {
      const alreadySuccess = await prisma.post.findFirst({
        where: {
          id: { not: postId },
          idempotencyKey: post.idempotencyKey,
          status: 'published',
        },
      });

      if (alreadySuccess) {
        console.log(`[Worker] Skipping job ${job.id} for post ${postId} because a successful post with the same idempotencyKey (${post.idempotencyKey}) already exists.`);
        
        // Merge, don't overwrite
        existingResults[accountId] = {
          status: 'skipped',
          reason: 'duplicate_job_skipped_existing_success',
          message: 'Content already posted successfully by another job',
        };
        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'skipped',
            results: JSON.stringify(existingResults),
          },
        });

        const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
        logActivity({
          workspaceId: account?.workspaceId || 'workspace-default',
          type: 'posting',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: 'posting_job_skipped_existing_success',
          status: 'skipped',
          message: `Post job skipped for @${account?.username || accountId} because same content was already published successfully.`,
          metadata: { jobId: job.id, idempotencyKey: post.idempotencyKey, username: account?.username },
        });

        return { status: 'skipped', reason: 'duplicate_job_skipped_existing_success' };
      }
    }

    // ── Human-like Rate Limiting & Throttling ──
    const now = Date.now();
    let delayMs = 0;
    
    // 1. Throttle: random delay between posts globally
    if (workerState.lastGlobalJobTime > 0) {
      const minThrottle = HUMAN_CONFIG.throttle.min * 1000;
      const maxThrottle = HUMAN_CONFIG.throttle.max * 1000;
      const randomThrottle = HUMAN_CONFIG.randomize 
        ? Math.floor(Math.random() * (maxThrottle - minThrottle + 1)) + minThrottle
        : minThrottle;
        
      const timeSinceLastGlobal = now - workerState.lastGlobalJobTime;
      if (timeSinceLastGlobal < randomThrottle) {
        delayMs = Math.max(delayMs, randomThrottle - timeSinceLastGlobal);
      }
    }

    // 2. Batch delay: pause for several minutes after processing a batch of posts
    if (workerState.batchCount >= HUMAN_CONFIG.maxBatchSize) {
      workerState.batchCount = 0;
      const batchWait = HUMAN_CONFIG.batchDelay * 1000;
      delayMs = Math.max(delayMs, batchWait);
      console.log(`[Worker] Batch limit reached. Applying batch delay of ${HUMAN_CONFIG.batchDelay}s.`);
    }

    if (delayMs > 0) {
      console.log(`[Worker] Human behavior throttle: sleeping for ${Math.round(delayMs / 1000)}s before processing job ${job.id}`);
      await new Promise(r => setTimeout(r, delayMs));
    }

    // Update state to account for this action
    workerState.lastGlobalJobTime = Date.now();
    workerState.batchCount += 1;

    let account: any = null;
    let reachedPendingVerify = false;
    let deliveryOperationKey: string | undefined;
    let deliveryOperationAcquired = false;
    let deliveryOperationCompleted = false;

    const beginExternalDelivery = async () => {
      const identity = postingWorkerDeliveryIdentity({
        postId,
        accountId,
        content,
        mediaUrls: mediaUrls || [],
        postIdempotencyKey: post.idempotencyKey,
      });
      try {
        const begun = await durableIdempotency.beginOperation(identity);
        if (!begun.acquired) return { shouldExecute: false, reason: `durable_operation_${begun.operation.status.toLowerCase()}` };
        deliveryOperationKey = identity.key;
        deliveryOperationAcquired = true;
        return { shouldExecute: true };
      } catch (error) {
        if (error instanceof IdempotencyConflictError) return { shouldExecute: false, reason: 'idempotency_conflict' };
        throw error;
      }
    };

    try {
      account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new Error(`Account ${accountId} not found`);

      // Resolve media path: use explicit path, or fall back to an uploads filename/URL in mediaUrls.
      let resolvedMediaPath: string | undefined = rawMediaPath;
      if (!resolvedMediaPath && mediaUrls?.length > 0) {
        const first = mediaUrls[0];
        if (first) {
          let parsed: URL | undefined;
          try {
            parsed = new URL(first);
          } catch {}

          if (parsed) {
            const uploadPrefix = '/uploads/';
            if (parsed.pathname.startsWith(uploadPrefix)) {
              resolvedMediaPath = path.join(process.cwd(), 'uploads', path.basename(parsed.pathname));
            } else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
              resolvedMediaPath = await resolveRemoteMediaPath(first);
            }
          } else {
            const normalized = first.replace(/\\/g, '/');
            const uploadIndex = normalized.lastIndexOf('/uploads/');
            const filename = uploadIndex >= 0
              ? normalized.slice(uploadIndex + '/uploads/'.length)
              : normalized;
            resolvedMediaPath = path.isAbsolute(filename)
              ? filename
              : path.join(process.cwd(), 'uploads', path.basename(filename));
          }
        }
      }
      console.log(`[Worker] Media path: ${resolvedMediaPath}`);

      // Mark as running — but don't reset if already progressed
      const progressStates = ['pending_verify', 'published', 'pending'];
      if (!progressStates.includes(post.status)) {
        await prisma.post.update({ where: { id: postId }, data: { status: 'pending' } });
      }

      if (account.platform === 'Instagram') {
        // Real Playwright automation
        if (!resolvedMediaPath || !fs.existsSync(resolvedMediaPath)) {
          throw new Error('No valid media file path provided. Instagram posts require an image.');
        }

        // narrowed: resolvedMediaPath is string from here
        const mediaPath: string = resolvedMediaPath;

        const delivery = await beginExternalDelivery();
        if (!delivery.shouldExecute) return { status: 'skipped', reason: delivery.reason };

        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'pending_verify',
            results: JSON.stringify({ [accountId]: { status: 'PENDING_VERIFY', username: account.username } }),
          },
        });
        reachedPendingVerify = true;
        console.log(`[Worker] @${account.username} marked PENDING_VERIFY before Instagram publish verification`);

        const result = await instagramPostingService.postToInstagram(accountId, content, mediaPath);

        if (result.status !== 'success') throw new Error(result.error || 'Instagram posting failed');

        await durableIdempotency.markCompleted('posting-worker.delivery', deliveryOperationKey!, {
          resourceType: 'post-delivery',
          resourceId: postId,
          resultReference: { accountId, platform: account.platform, postedAt: result.postedAt || null },
        });
        deliveryOperationCompleted = true;

        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'published',
            postedAt: new Date(result.postedAt || Date.now()),
            results: JSON.stringify({ ...existingResults, [accountId]: { status: 'success', postedAt: result.postedAt } }),
          },
        });

        logActivity({
          workspaceId: account.workspaceId,
          type: 'posting',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: 'publish_success',
          status: 'success',
          message: `Published Instagram post for @${account.username}`,
          metadata: { jobId: job.id, postedAt: result.postedAt },
        });
        logActivity({
          workspaceId: account.workspaceId,
          type: 'queue',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: 'job_success',
          status: 'success',
          message: `Posting queue job ${job.id} completed`,
          metadata: { jobId: job.id },
        });

        console.log(`[Worker] Published to Instagram @${account.username}`);

      } else if (account.platform === 'TikTok' || account.platform === 'Tiktok') {
        // TikTok automation via TikTok Studio
        if (!resolvedMediaPath || !fs.existsSync(resolvedMediaPath)) {
          throw new Error('No valid media file path provided. TikTok posts require a video.');
        }

        // narrowed: resolvedMediaPath is string from here
        const mediaPath: string = resolvedMediaPath;

        const delivery = await beginExternalDelivery();
        if (!delivery.shouldExecute) return { status: 'skipped', reason: delivery.reason };

        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'pending_verify',
            results: JSON.stringify({ [accountId]: { status: 'PENDING_VERIFY', username: account.username } }),
          },
        });
        reachedPendingVerify = true;
        console.log(`[Worker] @${account.username} marked PENDING_VERIFY before TikTok publish verification`);

        const result = await tiktokPostingService.postToTikTok(accountId, content, mediaPath);

        if (result.status !== 'success') throw new Error(result.error || 'TikTok posting failed');

        await durableIdempotency.markCompleted('posting-worker.delivery', deliveryOperationKey!, {
          resourceType: 'post-delivery',
          resourceId: postId,
          resultReference: { accountId, platform: account.platform, postedAt: result.postedAt || null },
        });
        deliveryOperationCompleted = true;

        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'published',
            postedAt: new Date(result.postedAt || Date.now()),
            results: JSON.stringify({ ...existingResults, [accountId]: { status: 'success', postedAt: result.postedAt } }),
          },
        });

        logActivity({
          workspaceId: account.workspaceId,
          type: 'posting',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: 'publish_success',
          status: 'success',
          message: `Published TikTok post for @${account.username}`,
          metadata: { jobId: job.id, postedAt: result.postedAt, platform: 'TikTok' },
        });
        logActivity({
          workspaceId: account.workspaceId,
          type: 'queue',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: 'job_success',
          status: 'success',
          message: `Posting queue job ${job.id} completed`,
          metadata: { jobId: job.id, platform: 'TikTok' },
        });

        console.log(`[Worker] Published to TikTok @${account.username}`);

      } else {
        // Platform not yet automated — graceful skip instead of hard fail
        console.warn(`[Worker] Platform "${account.platform}" automation not yet implemented — skipping job ${job.id} for @${account.username} gracefully`);
        
        existingResults[accountId] = {
          status: 'skipped',
          reason: `platform_not_automated:${account.platform}`,
          message: `Platform "${account.platform}" posting is not yet implemented`,
        };
        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'skipped',
            results: JSON.stringify(existingResults),
          },
        }).catch(() => {});

        logActivity({
          workspaceId: account?.workspaceId || 'workspace-default',
          type: 'posting',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: 'platform_not_implemented',
          status: 'skipped',
          message: `Skipped @${account.username} — platform "${account.platform}" not yet automated`,
          metadata: { jobId: job.id, platform: account.platform },
        });
        logActivity({
          workspaceId: account?.workspaceId || 'workspace-default',
          type: 'queue',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: 'job_skipped_platform',
          status: 'skipped',
          message: `Posting queue job ${job.id} skipped — platform not implemented`,
          metadata: { jobId: job.id, platform: account.platform },
        });

        return { status: 'skipped', reason: `platform_${account.platform}_not_implemented` };
      }

    } catch (error: any) {
      if (deliveryOperationAcquired && !deliveryOperationCompleted && deliveryOperationKey) {
        await durableIdempotency.markUnknown('posting-worker.delivery', deliveryOperationKey, 'POSTING_OUTCOME_UNCERTAIN').catch(() => {});
      }
      console.error(`[Worker] Job ${job.id} failed:`, error.message);
      const categorized = categorizeError(error.message);
      logger.error('Posting job error', {
        jobId: job.id,
        postId,
        accountId,
        category: categorized.category,
        retryable: categorized.retryable,
        error: error.message,
      });

      const isPrePublishFailure = !reachedPendingVerify;

      if (isPrePublishFailure && job.attemptsMade < (job.opts.attempts || 3) - 1) {
        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'pending',
            results: JSON.stringify({
              ...existingResults,
              [accountId]: {
                status: 'retrying',
                error: error.message,
                category: categorized.category,
                retryAttempt: job.attemptsMade + 1,
              },
            }),
          },
        }).catch(() => {});
      }

      // On final retry, update post in DB
      if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
        const isFailedVerify = error.message?.includes('FAILED_VERIFY');
        const postStatus = isFailedVerify ? 'published' : 'failed';
        const resultStatus = isFailedVerify ? 'FAILED_VERIFY' : 'failed';

        await prisma.post.update({
          where: { id: postId },
          data: {
            status: postStatus,
            results: JSON.stringify({
              ...existingResults,
              [accountId]: {
                status: resultStatus,
                error: error.message,
                category: categorized.category,
                humanReadable: categorized.humanReadable,
                suggestedAction: categorized.suggestedAction,
                retryable: categorized.retryable,
              },
            }),
          },
        }).catch(() => {});
        logActivity({
          workspaceId: account?.workspaceId || 'workspace-default',
          type: 'posting',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: isFailedVerify ? 'publish_unverified' : 'publish_failure',
          status: isFailedVerify ? 'warning' : 'failed',
          message: isFailedVerify
            ? `Publish unverified for @${account?.username || accountId} (likely succeeded)`
            : `Publishing failed for @${account?.username || accountId}: ${categorized.humanReadable}`,
          metadata: {
            jobId: job.id,
            resultStatus,
            error: error.message,
            category: categorized.category,
            suggestedAction: categorized.suggestedAction,
            retryable: categorized.retryable,
          },
        });
        logActivity({
          workspaceId: account?.workspaceId || 'workspace-default',
          type: 'queue',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: 'job_failure',
          status: 'failed',
          message: `Posting queue job ${job.id} failed (${categorized.category})`,
          metadata: { jobId: job.id, error: error.message, category: categorized.category },
        });

        // Auto re-check session health on certain error categories.
        // These indicate the session itself is broken, not transient network issues.
        if (
          account &&
          (categorized.category === 'AUTH_EXPIRED' ||
            categorized.category === 'CHECKPOINT' ||
            categorized.category === 'BROWSER_LAUNCH')
        ) {
          logActivity({
            workspaceId: account.workspaceId,
            type: 'session',
            entityType: 'account',
            entityId: accountId,
            accountId,
            action: 'auto_health_check_triggered',
            status: 'pending',
            message: `Auto re-checking session for @${account.username} due to ${categorized.category}`,
            metadata: { reason: categorized.category, failedPostId: postId },
          });

          // Fire-and-forget — don't block the worker on this.
          sessionHealthService
            .checkAccount(accountId)
            .then((result) => {
              logger.info('Auto session health check completed', {
                accountId,
                username: account.username,
                health: result.health,
                reason: result.reason,
              });
            })
            .catch((err) => {
              logger.error('Auto session health check failed', {
                accountId,
                username: account.username,
                error: err.message,
              });
            });
        }
      }
      throw error; // Re-throw so BullMQ handles retries
    }
  },
  {
    connection,
    // Concurrency 1 — multiple accounts posting from same IP triggers IG
    // bot detection and ECONNRESET. Serialize so each post has clean
    // connection state and reduces rate-limit risk.
    concurrency: 1,
    // Instagram posting flow can take 3-5 min (warmup browse, click + waitFor
    // selectors, upload processing, caption type, share, verify). Default
    // lockDuration (30s) is far too short — worker loses lock mid-flow and
    // BullMQ silently marks job as stalled without surfacing the timeout.
    // 10 min gives headroom for slow accounts while still detecting real hangs.
    lockDuration: 600000,
    // Run stalled-check less aggressively — every 60s instead of 30s.
    stalledInterval: 60000,
    // Give stalled jobs 1 chance to recover before permanent fail.
    maxStalledCount: 1,
  },
);

postingWorker.on('ready', () => {
  console.log('[PostingWorker] Worker is ready and listening to automationQueue');
  logger.info('PostingWorker ready', { pid: process.pid, concurrency: 1 });
});

postingWorker.on('error', (err) => {
  console.error('[PostingWorker] Error:', err);
  logger.error('PostingWorker error', { error: err.message, stack: err.stack });
});

postingWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} permanently failed: ${err.message}`);
  logger.error('Posting job permanently failed', {
    jobId: job?.id,
    postId: job?.data?.postId,
    accountId: job?.data?.accountId,
    error: err.message,
    attempts: job?.attemptsMade,
  });
});

postingWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
  logger.info('Posting job completed', {
    jobId: job.id,
    postId: job.data?.postId,
    accountId: job.data?.accountId,
  });
});

postingWorker.on('stalled', (jobId) => {
  console.warn(`[Worker] ⚠️ STALLED: job ${jobId}`);
  logger.warn('Posting job stalled — lock expired', { jobId });
});

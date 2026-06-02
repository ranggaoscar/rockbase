import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { instagramPostingService } from '../services/InstagramPostingService';
import * as fs from 'fs';
import * as path from 'path';
import { logActivity } from '../services/ActivityLogService';
import { PostJobData } from './jobTypes';

const prisma = new PrismaClient();
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

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

    // Resolve media path: use explicit path, or fall back to a local filename in mediaUrls
    let resolvedMediaPath: string | undefined = rawMediaPath;
    if (!resolvedMediaPath && mediaUrls?.length > 0) {
      const first = mediaUrls[0];
      if (first && !first.startsWith('http')) {
        resolvedMediaPath = path.join(process.cwd(), 'uploads', first);
      }
    }
    console.log(`[Worker] Media path: ${resolvedMediaPath}`);

    // Mark as running — but don't reset if already progressed
    const progressStates = ['pending_verify', 'published', 'pending'];
    if (!progressStates.includes(post.status)) {
      await prisma.post.update({ where: { id: postId }, data: { status: 'pending' } });
    }

    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`Account ${accountId} not found`);

    try {
      if (account.platform === 'Instagram') {
        // Real Playwright automation
        if (!resolvedMediaPath || !fs.existsSync(resolvedMediaPath)) {
          throw new Error('No valid media file path provided. Instagram posts require an image.');
        }

        // narrowed: resolvedMediaPath is string from here
        const mediaPath: string = resolvedMediaPath;

        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'pending_verify',
            results: JSON.stringify({ [accountId]: { status: 'PENDING_VERIFY', username: account.username } }),
          },
        });
        console.log(`[Worker] @${account.username} marked PENDING_VERIFY before Instagram publish verification`);

        const result = await instagramPostingService.postToInstagram(accountId, content, mediaPath);

        if (result.status !== 'success') throw new Error(result.error || 'Instagram posting failed');

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

      } else {
        // Platform not yet automated - mark as failed with clear message
        throw new Error(`Platform "${account.platform}" automation not yet implemented`);
      }

    } catch (error: any) {
      console.error(`[Worker] Job ${job.id} failed:`, error.message);

      // On final retry, update post in DB
      if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
        const isFailedVerify = error.message?.includes('FAILED_VERIFY');
        const postStatus = isFailedVerify ? 'published' : 'failed';
        const resultStatus = isFailedVerify ? 'FAILED_VERIFY' : 'failed';

        await prisma.post.update({
          where: { id: postId },
          data: {
            status: postStatus,
            results: JSON.stringify({ ...existingResults, [accountId]: { status: resultStatus, error: error.message } }),
          },
        }).catch(() => {});
        logActivity({
          workspaceId: account.workspaceId,
          type: 'posting',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: isFailedVerify ? 'publish_unverified' : 'publish_failure',
          status: isFailedVerify ? 'warning' : 'failed',
          message: isFailedVerify
            ? `Publish unverified for @${account.username} (likely succeeded)`
            : `Publishing failed for @${account.username}`,
          metadata: { jobId: job.id, resultStatus, error: error.message },
        });
        logActivity({
          workspaceId: account.workspaceId,
          type: 'queue',
          entityType: 'post',
          entityId: postId,
          accountId,
          action: 'job_failure',
          status: 'failed',
          message: `Posting queue job ${job.id} failed`,
          metadata: { jobId: job.id, error: error.message },
        });
      }
      throw error; // Re-throw so BullMQ handles retries
    }
  },
  { connection, concurrency: 3 },
);

postingWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} permanently failed: ${err.message}`);
});

postingWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

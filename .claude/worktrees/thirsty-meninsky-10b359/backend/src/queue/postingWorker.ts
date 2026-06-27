import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { instagramPostingService } from '../services/InstagramPostingService';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export interface PostJobData {
  postId: string;
  accountId: string;
  content: string;
  mediaLocalPath?: string;   // Absolute path to file on disk (set by bulk-post route)
  mediaUrls: string[];       // Public URLs (for future CDN support)
  spinIndex: number;         // Which caption variation this account uses
}

export const postingWorker = new Worker<PostJobData>(
  'automationQueue',
  async (job: Job<PostJobData>) => {
    const { postId, accountId, content, mediaLocalPath } = job.data;
    console.log(`[Worker] Processing job ${job.id} | post ${postId} | account ${accountId}`);

    // Mark as running
    await prisma.post.update({ where: { id: postId }, data: { status: 'pending' } });

    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`Account ${accountId} not found`);

    try {
      if (account.platform === 'Instagram') {
        // ── Real Playwright automation ──
        if (!mediaLocalPath || !fs.existsSync(mediaLocalPath)) {
          throw new Error('No valid media file path provided. Instagram posts require an image.');
        }

        const result = await instagramPostingService.postToInstagram(accountId, content, mediaLocalPath);

        if (result.status === 'failed') throw new Error(result.error || 'Instagram posting failed');

        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'published',
            postedAt: new Date(result.postedAt || Date.now()),
            results: JSON.stringify({ [accountId]: { status: 'success', postedAt: result.postedAt } }),
          },
        });

        console.log(`[Worker] ✅ Published to Instagram @${account.username}`);

      } else {
        // Platform not yet automated — mark as failed with clear message
        throw new Error(`Platform "${account.platform}" automation not yet implemented`);
      }

    } catch (error: any) {
      console.error(`[Worker] ❌ Job ${job.id} failed:`, error.message);

      // On final retry, mark post as failed in DB
      if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
        await prisma.post.update({
          where: { id: postId },
          data: {
            status: 'failed',
            results: JSON.stringify({ [accountId]: { status: 'failed', error: error.message } }),
          },
        }).catch(() => {});
      }
      throw error; // Re-throw so BullMQ handles retries
    }
  },
  { connection },
);

postingWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} permanently failed: ${err.message}`);
});

postingWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

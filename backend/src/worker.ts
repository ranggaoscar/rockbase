import dotenv from 'dotenv';
dotenv.config();

console.log('================================================');
console.log('         ROCK BASE QUEUE WORKER SYSTEM          ');
console.log('================================================');
console.log(`[Worker Process] Starting at: ${new Date().toISOString()}`);

// Load workers
import './queue/postingWorker';
import './queue/analyticsWorker';
import './queue/engagementWorker';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

const prisma = new PrismaClient();
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};
const automationQueue = new Queue('automationQueue', { connection });

console.log('[Worker Process] All queue workers successfully initialized.');
console.log('[Worker Process] Listening for incoming jobs on Redis...');

// ── Automated Queue Recovery ──
setInterval(async () => {
  console.log('[Worker Process] Running automated queue recovery check...');
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const updatedVerify = await prisma.post.updateMany({
      where: { status: 'pending_verify', createdAt: { lt: oneHourAgo } },
      data: { status: 'failed' }
    });
    if (updatedVerify.count > 0) {
      console.log(`[Worker Process] Recovered ${updatedVerify.count} stale pending_verify posts.`);
    }

    const pendingPosts = await prisma.post.findMany({ where: { status: 'pending' } });
    if (pendingPosts.length > 0) {
      const activeJobs = await automationQueue.getActive();
      const waitingJobs = await automationQueue.getWaiting();
      const delayedJobs = await automationQueue.getDelayed();
      
      const allJobData = [...activeJobs, ...waitingJobs, ...delayedJobs].map(j => j.data);
      let requeued = 0;
      
      for (const post of pendingPosts) {
        const isQueued = allJobData.some(d => d.postId === post.id);
        if (!isQueued) {
          const accountIds = JSON.parse(post.accountIds || '[]');
          const mediaUrls = JSON.parse(post.mediaUrls || '[]');
          for (const accountId of accountIds) {
            await automationQueue.add('postJob', {
              postId: post.id,
              accountId: accountId,
              content: post.content,
              mediaUrls: mediaUrls,
            }, {
              attempts: 3,
              backoff: { type: 'exponential', delay: 60000 },
              removeOnComplete: true,
              removeOnFail: false
            });
            requeued++;
          }
        }
      }
      if (requeued > 0) {
        console.log(`[Worker Process] Re-queued ${requeued} stuck pending posts.`);
      }
    }
  } catch (err) {
    console.error('[Worker Process] Automated recovery failed:', err);
  }
}, 15 * 60 * 1000); // Run every 15 minutes

import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

const prisma = new PrismaClient();
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const automationQueue = new Queue('automationQueue', { connection });

async function fixQueue() {
  console.log('Fixing queue and re-syncing stuck jobs...');
  
  // 1. Re-queue pending jobs
  const pendingPosts = await prisma.post.findMany({
    where: { status: 'pending' },
  });
  
  let queuedCount = 0;
  for (const post of pendingPosts) {
    try {
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
        queuedCount++;
      }
    } catch (err) {
      console.error(`Failed to re-queue post ${post.id}`, err);
    }
  }
  console.log(`Successfully re-queued ${queuedCount} jobs from pending posts.`);

  // 2. Mark old pending_verify as failed (so user can retry them if they want from UI, or they won't block)
  // Or just re-queue them? Let's just mark as failed if older than 1 hour.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const updatedVerify = await prisma.post.updateMany({
    where: { 
      status: 'pending_verify',
      createdAt: { lt: oneHourAgo }
    },
    data: { status: 'failed' }
  });
  console.log(`Marked ${updatedVerify.count} old pending_verify posts as failed.`);

  // 3. Mark stale scheduled as failed or skipped (from last month)
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const updatedScheduled = await prisma.post.updateMany({
    where: { 
      status: 'scheduled',
      scheduleAt: { lt: oneWeekAgo }
    },
    data: { status: 'failed' }
  });
  console.log(`Marked ${updatedScheduled.count} stale scheduled posts as failed.`);

  process.exit(0);
}

fixQueue().catch(console.error);

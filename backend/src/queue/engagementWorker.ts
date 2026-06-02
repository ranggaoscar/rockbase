/**
 * Engagement Worker — BullMQ worker for engagement jobs.
 *
 * Processes engagement actions from the engagementQueue.
 * Respects session pool limits and active hours.
 */
import { Worker, Job } from 'bullmq';
import { targetedEngagementService } from '../services/TargetedEngagementService';
import { HumanBehavior } from '../services/HumanBehavior';

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export interface EngagementJobData {
  accountId: string;
  actionType: 'like' | 'follow' | 'comment' | 'follow_and_like' | 'hashtag';
  target: string; // URL, username, or hashtag
  campaignId?: string;
  customComment?: string;
}

let engagementWorker: Worker<EngagementJobData> | null = null;

try {
  engagementWorker = new Worker<EngagementJobData>(
    'engagementQueue',
    async (job: Job<EngagementJobData>) => {
      const { accountId, actionType, target, customComment } = job.data;
      console.log(`[EngagementWorker] Processing job ${job.id} | ${actionType} | account ${accountId} | target: ${target}`);

      // Wait for active hours
      await HumanBehavior.waitForActiveHours();

      let result;

      switch (actionType) {
        case 'like':
          result = await targetedEngagementService.likePost(accountId, target);
          break;

        case 'follow':
          result = await targetedEngagementService.followUser(accountId, target);
          break;

        case 'comment':
          result = await targetedEngagementService.commentOnPost(accountId, target, customComment);
          break;

        case 'follow_and_like':
          result = await targetedEngagementService.followAndLike(accountId, target);
          break;

        case 'hashtag':
          const results = await targetedEngagementService.engageByHashtag(accountId, target, {
            like: true,
            comment: Math.random() < 0.3, // 30% chance to comment
          });
          result = {
            accountId,
            actionType: 'hashtag',
            target,
            status: results.some(r => r.status === 'completed') ? 'completed' : 'failed',
            details: `Engaged with ${results.filter(r => r.status === 'completed').length} posts`,
            executedAt: new Date().toISOString(),
          };
          break;

        default:
          throw new Error(`Unknown action type: ${actionType}`);
      }

      if (result.status === 'failed') {
        throw new Error(result.error || 'Action failed');
      }

      console.log(`[EngagementWorker] ✅ Job ${job.id} completed: ${result.details}`);
      return result;
    },
    {
      connection,
      concurrency: 1, // Process one at a time to respect session pool
      limiter: {
        max: 1,
        duration: 60000, // Max 1 job per minute to prevent spam
      },
    }
  );

  engagementWorker.on('failed', (job, err) => {
    console.error(`[EngagementWorker] Job ${job?.id} failed: ${err.message}`);
  });

  engagementWorker.on('completed', (job) => {
    console.log(`[EngagementWorker] Job ${job.id} completed successfully`);
  });

  console.log('[EngagementWorker] Worker initialized and listening on engagementQueue');
} catch (err) {
  console.warn('[EngagementWorker] Redis not available — engagement worker disabled');
}

export { engagementWorker };

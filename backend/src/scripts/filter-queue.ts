import dotenv from 'dotenv';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

async function main() {
  const prisma = new PrismaClient();
  const queue = new Queue('automationQueue', { connection });

  try {
    console.log('Fetching social accounts from database...');
    const accounts = await prisma.socialAccount.findMany({
      select: {
        id: true,
        platform: true,
        username: true,
      },
    });

    const accountPlatformMap = new Map<string, string>();
    const accountUsernameMap = new Map<string, string>();
    for (const acc of accounts) {
      accountPlatformMap.set(acc.id, acc.platform.toLowerCase());
      accountUsernameMap.set(acc.id, acc.username);
    }

    console.log(`Loaded ${accounts.length} social accounts.`);

    const states = ['wait', 'delayed', 'paused', 'failed', 'active'] as const;
    console.log(`Fetching jobs from states: ${states.join(', ')}...`);
    
    const jobs = await queue.getJobs(states as any, 0, 10000, true);
    console.log(`Found ${jobs.length} total jobs in the specified states.`);

    let instagramDeleted = 0;
    let tiktokKept = 0;
    let unknownPlatformDeleted = 0;
    let missingAccountDeleted = 0;

    for (const job of jobs) {
      const accountId = job.data?.accountId;
      if (!accountId) {
        console.log(`[Job ${job.id}] Missing accountId. Deleting to be safe.`);
        await job.remove();
        missingAccountDeleted++;
        continue;
      }

      const platform = accountPlatformMap.get(accountId);
      const username = accountUsernameMap.get(accountId) || 'Unknown';

      if (!platform) {
        console.log(`[Job ${job.id}] Account ${accountId} (${username}) not found in DB. Deleting job.`);
        await job.remove();
        unknownPlatformDeleted++;
        continue;
      }

      if (platform === 'instagram') {
        console.log(`[Job ${job.id}] Deleting Instagram job for @${username} (Account ID: ${accountId})`);
        await job.remove();
        instagramDeleted++;
      } else if (platform === 'tiktok') {
        console.log(`[Job ${job.id}] Keeping TikTok job for @${username} (Account ID: ${accountId})`);
        tiktokKept++;
      } else {
        console.log(`[Job ${job.id}] Deleting other platform (${platform}) job for @${username} (Account ID: ${accountId})`);
        await job.remove();
        instagramDeleted++; // Count other non-tiktok as deleted too under broad category
      }
    }

    console.log('\n--- FILTER QUEUE RESULTS ---');
    console.log(`Instagram/Non-TikTok Jobs Deleted: ${instagramDeleted}`);
    console.log(`TikTok Jobs Kept:                  ${tiktokKept}`);
    console.log(`Missing Account Jobs Deleted:       ${missingAccountDeleted}`);
    console.log(`Unknown Platform Jobs Deleted:      ${unknownPlatformDeleted}`);
    console.log('-----------------------------');

  } catch (error: any) {
    console.error('Error during filter-queue operation:', error);
  } finally {
    await queue.close();
    await prisma.$disconnect();
    console.log('Disconnected.');
  }
}

main();

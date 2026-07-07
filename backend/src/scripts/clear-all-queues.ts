import dotenv from 'dotenv';
import { Queue } from 'bullmq';

dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

async function clearQueue(queueName: string) {
  console.log(`[QueueCleanup] Initializing queue: ${queueName}`);
  const queue = new Queue(queueName, { connection });

  try {
    const countsBefore = await queue.getJobCounts();
    console.log(`[QueueCleanup] [${queueName}] Job counts before cleanup:`, countsBefore);

    console.log(`[QueueCleanup] [${queueName}] Draining queue (including delayed)...`);
    await queue.drain(true);

    console.log(`[QueueCleanup] [${queueName}] Obliterating queue...`);
    await queue.obliterate({ force: true });
    console.log(`[QueueCleanup] [${queueName}] Obliteration complete.`);

    const countsAfter = await queue.getJobCounts();
    console.log(`[QueueCleanup] [${queueName}] Job counts after cleanup:`, countsAfter);
  } catch (err: any) {
    console.error(`[QueueCleanup] [${queueName}] Failed to clear:`, err.message);
  } finally {
    await queue.close();
  }
}

async function main() {
  console.log('==================================================');
  console.log('   ROCK BASE TOTAL QUEUE PURGE SYSTEM');
  console.log('==================================================');
  
  await clearQueue('automationQueue');
  await clearQueue('engagementQueue');
  await clearQueue('healthcheck');

  console.log('==================================================');
  console.log('   All selected queues successfully wiped clean!');
  console.log('==================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('[QueueCleanup] Fatal error:', err);
  process.exit(1);
});

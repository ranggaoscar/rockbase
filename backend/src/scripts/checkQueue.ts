import { Queue } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const automationQueue = new Queue('automationQueue', { connection });

async function checkQueue() {
  console.log('Checking automationQueue...');
  const counts = await automationQueue.getJobCounts();
  console.log('Queue counts:', counts);

  const active = await automationQueue.getActive();
  console.log(`Active jobs: ${active.length}`);
  
  const delayed = await automationQueue.getDelayed();
  console.log(`Delayed jobs: ${delayed.length}`);
  
  const waiting = await automationQueue.getWaiting();
  console.log(`Waiting jobs: ${waiting.length}`);
  
  const failed = await automationQueue.getFailed();
  console.log(`Failed jobs: ${failed.length}`);

  process.exit(0);
}

checkQueue().catch(console.error);

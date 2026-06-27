import dotenv from 'dotenv';
import { Queue } from 'bullmq';

dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

async function main() {
  const queue = new Queue('automationQueue', { connection });
  
  try {
    const counts = await queue.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed', 'paused');
    console.log('BullMQ Job Counts for automationQueue:', counts);

    const jobs = await queue.getJobs(['wait', 'active', 'delayed', 'failed'], 0, 10, true);
    console.log(`\nRetrieved ${jobs.length} jobs (showing up to 10):`);
    for (const job of jobs) {
      console.log(`- Job ID: ${job.id}`);
      console.log(`  Name: ${job.name}`);
      console.log(`  State: ${await job.getState()}`);
      console.log(`  Data:`, JSON.stringify(job.data));
      console.log(`  Failed Reason: ${job.failedReason}`);
      console.log(`  Attempts Made: ${job.attemptsMade}`);
    }
  } catch (error: any) {
    console.error('Error connecting to Redis or getting queue status:', error.message);
  } finally {
    await queue.close();
  }
}

main();

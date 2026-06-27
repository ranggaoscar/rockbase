import { Queue } from 'bullmq';

async function main() {
  const queue = new Queue('automationQueue', {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
  });

  const delayedJobs = await queue.getDelayed(0, 5);
  console.log('Delayed jobs:', delayedJobs.length);
  for (const job of delayedJobs) {
    console.log('Job ID:', job.id);
    console.log('Job delay:', job.delay);
    console.log('Job timestamp:', job.timestamp);
    console.log('Job isDelayed:', await job.isDelayed());
    console.log('Job state:', await job.getState());
  }

  process.exit(0);
}

main().catch(console.error);

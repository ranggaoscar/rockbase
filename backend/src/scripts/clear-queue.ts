import { Queue } from 'bullmq';

async function main() {
  const queue = new Queue('automationQueue', {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
  });

  console.log('Draining queue...');
  await queue.drain(true); // true = drain delayed as well
  
  console.log('Obliterating queue to remove active/failed/completed...');
  try {
    await queue.obliterate({ force: true });
  } catch (e: any) {
    console.log('Obliterate error (often means queue is already empty or busy):', e.message);
  }

  const counts = await queue.getJobCounts();
  console.log('Queue counts after reset:', counts);

  process.exit(0);
}

main().catch(console.error);

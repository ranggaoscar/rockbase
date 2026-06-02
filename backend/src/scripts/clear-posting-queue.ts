import dotenv from 'dotenv';
import { Queue } from 'bullmq';

dotenv.config();

const QUEUE_NAME = 'automationQueue';
const CLEAN_LIMIT = 10000;
const TARGET_STATES = ['wait', 'delayed', 'failed'] as const;
const COMPLETED_STATE = 'completed' as const;

const args = new Set(process.argv.slice(2));
const confirmed = args.has('--confirm');
const includeCompleted = args.has('--include-completed');

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

async function cleanState(queue: Queue, state: string): Promise<number> {
  let total = 0;

  while (true) {
    const removedJobIds = await queue.clean(0, CLEAN_LIMIT, state as any);
    total += removedJobIds.length;

    if (removedJobIds.length < CLEAN_LIMIT) {
      break;
    }
  }

  return total;
}

async function main() {
  const queue = new Queue(QUEUE_NAME, { connection });
  const statesToClean = includeCompleted ? [...TARGET_STATES, COMPLETED_STATE] : [...TARGET_STATES];

  console.log(`[PostingQueueCleanup] Queue: ${QUEUE_NAME}`);
  console.log(`[PostingQueueCleanup] Redis: ${connection.host}:${connection.port}`);
  console.log(`[PostingQueueCleanup] Target states: ${statesToClean.join(', ')}`);
  console.log('[PostingQueueCleanup] This only removes BullMQ jobs. It does not modify posts, accounts, sessions, cookies, or media files.');

  if (includeCompleted) {
    console.warn('[PostingQueueCleanup] --include-completed provided. Completed jobs will be removed.');
  } else {
    console.log('[PostingQueueCleanup] Completed jobs are excluded.');
  }

  const beforeCounts = await queue.getJobCounts(...statesToClean);
  console.log('[PostingQueueCleanup] Counts before:', beforeCounts);

  if (!confirmed) {
    console.log('[PostingQueueCleanup] Dry run only. Re-run with --confirm to remove these jobs.');
    await queue.close();
    return;
  }

  const removedByState: Record<string, number> = {};
  for (const state of statesToClean) {
    removedByState[state] = await cleanState(queue, state);
    console.log(`[PostingQueueCleanup] Removed ${removedByState[state]} ${state} job(s).`);
  }

  const afterCounts = await queue.getJobCounts(...statesToClean);
  console.log('[PostingQueueCleanup] Counts after:', afterCounts);
  console.log('[PostingQueueCleanup] Cleanup complete.');

  await queue.close();
}

main().catch((error) => {
  console.error('[PostingQueueCleanup] Cleanup failed:', error);
  process.exitCode = 1;
});

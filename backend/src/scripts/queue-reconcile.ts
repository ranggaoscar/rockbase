import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { reconcileQueueReadOnly } from '../services/QueueReconciliationService';

async function main() {
  const prisma = new PrismaClient();
  const connection = new IORedis({ host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || 6379), maxRetriesPerRequest: null });
  const queue = new Queue('automationQueue', { connection });
  try {
    console.log(JSON.stringify(await reconcileQueueReadOnly(prisma, queue), null, 2));
  } finally {
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error('[QueueReconcile] Failed:', error.message); process.exitCode = 1; });
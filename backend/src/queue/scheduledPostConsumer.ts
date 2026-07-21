import { Worker, Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { DurableIdempotencyService } from '../services/DurableIdempotencyService';
import {
  ScheduledPostConsumerService,
  ScheduledPostQueueData,
} from '../services/ScheduledPostConsumerService';

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};
const prisma = new PrismaClient();
const scheduledQueue = new Queue<ScheduledPostQueueData>('scheduledPosts', { connection });
const service = new ScheduledPostConsumerService(
  prisma,
  scheduledQueue,
  new DurableIdempotencyService(prisma),
);

export const scheduledPostConsumer = new Worker<ScheduledPostQueueData>(
  'scheduledPosts',
  (job) => service.consume(job.data),
  { connection, concurrency: 1 },
);

scheduledPostConsumer.on('error', (error) => console.error('[ScheduledPost] Consumer error:', error));

export { service as scheduledPostConsumerService };

import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { getRockBaseMode } from '../middleware/runtimeMode';
import { androidScheduler } from '../services/AndroidScheduler';
import { androidMaxConcurrent } from '../services/AndroidDeviceService';
import { logger } from '../services/logger';

const connection = { host: process.env.REDIS_HOST || '127.0.0.1', port: parseInt(process.env.REDIS_PORT || '6379', 10) };
export const androidQueue = new Queue<{ jobId: string }>('androidDeviceQueue', { connection });
const prisma = new PrismaClient();

export async function enqueueAndroidJob(jobId: string, delay = 0) {
  return androidQueue.add('android-smoke', { jobId }, {
    // DB job identity is durable; queue deliveries may repeat after crashes and are checked by status + lease.
    jobId: `android-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    delay, removeOnComplete: 100, removeOnFail: 100, attempts: 2, backoff: { type: 'fixed', delay: 5000 },
  });
}

let worker: Worker<{ jobId: string }> | null = null;
let sweep: NodeJS.Timeout | null = null;
export function startAndroidQueueWorker() {
  if (getRockBaseMode() !== 'local' || process.platform !== 'win32' || worker) return;
  worker = new Worker<{ jobId: string }>('androidDeviceQueue', async (job) => {
    const outcome = await androidScheduler.run(job.data.jobId);
    if (outcome.status === 'WAITING') await enqueueAndroidJob(job.data.jobId, 5000);
    return outcome;
  }, { connection, concurrency: Math.max(2, androidMaxConcurrent() + 1), lockDuration: 5 * 60_000, maxStalledCount: 1 });
  worker.on('failed', (job, error) => logger.error('Android queue delivery failed', { jobId: job?.data.jobId, error: error.message }));
  worker.on('error', (error) => logger.error('Android queue error', { error: error.message }));
  let sweeping = false;
  sweep = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void (async () => {
      const recovered = await androidScheduler.reconcile();
      const shutdowns = await androidScheduler.sweepIdle();
      if (recovered || shutdowns) logger.info('Android scheduler sweep', { recovered, shutdowns });
      // Re-enqueue orphan QUEUED records. Duplicate deliveries are safe: status and device lease are checked.
      const pending = await prisma.androidJob.findMany({ where: { status: 'QUEUED', type: 'ANDROID_SMOKE' }, take: 100, orderBy: { createdAt: 'asc' }, select: { id: true } });
      const waiting = await androidQueue.getJobs(['waiting', 'delayed', 'active']);
      const known = new Set(waiting.map(item => item.data.jobId));
      for (const item of pending) if (!known.has(item.id)) await enqueueAndroidJob(item.id);
    })().catch((error) => logger.error('Android scheduler sweep failed', { error: String(error) }))
      .finally(() => { sweeping = false; });
  }, 30_000);
  sweep.unref?.();
  void androidScheduler.reconcile().catch((error) => logger.error('Android startup reconciliation failed', { error: String(error) }));
}

export async function closeAndroidQueueWorker() {
  if (sweep) clearInterval(sweep);
  sweep = null;
  if (worker) await worker.close();
  worker = null;
  await androidQueue.close();
}

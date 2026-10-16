import { installConsoleRedaction } from './utils/sensitiveData';
installConsoleRedaction();
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { AUTOMATION_DISABLED_MESSAGE, isAutomationEnabled } from './middleware/automation';
import { assertSeparateWorkerMode } from './utils/workerMode';
import { getRockBaseMode } from './middleware/runtimeMode';
import { assertEncryptionConfiguration } from './utils/encryption';
import { assertServerModeDefaultCredentialGuard } from './utils/serverDefaultCredentialGuard';
import { executionReliabilityReconciler } from './services/ExecutionReliabilityReconciler';
import { reconcileQueueReadOnly } from './services/QueueReconciliationService';
dotenv.config();

assertSeparateWorkerMode();
assertEncryptionConfiguration();

if (!isAutomationEnabled()) {
  console.error('[Worker Process] ' + AUTOMATION_DISABLED_MESSAGE);
  process.exit(1);
}

const startWorkerSystem = (): void => {
  console.log('================================================');
  console.log('         ROCK BASE QUEUE WORKER SYSTEM          ');
  console.log('================================================');
  console.log(`[Worker Process] Starting at: ${new Date().toISOString()}`);

// Load workers
require('./queue/postingWorker');
require('./queue/scheduledPostConsumer');
require('./queue/analyticsWorker');
require('./queue/engagementWorker');
require('./queue/androidDeviceWorker').startAndroidQueueWorker();

const prisma = new PrismaClient();
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

let automationQueue: Queue | null = null;
try {
  automationQueue = new Queue('automationQueue', { connection });
} catch (err: any) {
  console.warn('[Worker Process] Redis not available — queue operations disabled:', err.message);
}

console.log('[Worker Process] All queue workers successfully initialized.');
console.log('[Worker Process] Listening for incoming jobs on Redis...');

// ── Automated Queue Recovery ──
// Runs every 15 minutes but with lighter checks to reduce SQLite contention
const RECOVERY_INTERVAL_MS = 15 * 60 * 1000;
let recoveryRunning = false;

setInterval(async () => {
  if (recoveryRunning) {
    console.log('[Worker Process] Recovery check skipped — previous check still running');
    return;
  }
  recoveryRunning = true;

  try {
    console.log('[Worker Process] Running automated queue recovery check...');

    // 1. One owner for durable execution recovery: pending verification and
    // orphan scheduled claims. Neither path creates a new publish attempt.
    const reliability = await executionReliabilityReconciler.reconcile();
    if (reliability.verified.confirmed || reliability.verified.unknown || reliability.recoveredScheduledClaims) {
      console.log(`[Worker Process] Reliability reconciliation: confirmed=${reliability.verified.confirmed}, unknown=${reliability.verified.unknown}, recoveredScheduledClaims=${reliability.recoveredScheduledClaims}.`);
    }

    // 2. Re-queue pending posts that aren't in any queue
    if (!automationQueue) {
      console.log('[Worker Process] Queue not available — skipping re-queue check');
      return;
    }

    const reconciliation = await reconcileQueueReadOnly(prisma as any, automationQueue as any);
    if (reconciliation.issues.length) {
      console.warn('[Worker Process] Queue reconciliation findings:', reconciliation.issues);
    }

    const pendingPosts = await prisma.post.findMany({ 
      where: { status: 'pending' },
      select: { id: true, accountIds: true, content: true, mediaUrls: true }
    });

    if (pendingPosts.length === 0) {
      console.log('[Worker Process] No pending posts to recover.');
      return;
    }

    const activeJobs = await automationQueue.getActive();
    const waitingJobs = await automationQueue.getWaiting();
    const delayedJobs = await automationQueue.getDelayed();

    const allJobData = [...activeJobs, ...waitingJobs, ...delayedJobs].map(j => j.data);
    let requeued = 0;

    for (const post of pendingPosts) {
      const isQueued = allJobData.some(d => d.postId === post.id);
      if (!isQueued) {
        const accountIds = JSON.parse(post.accountIds || '[]');
        const mediaUrls = JSON.parse(post.mediaUrls || '[]');
        for (const accountId of accountIds) {
          await automationQueue.add('postJob', {
            postId: post.id,
            accountId: accountId,
            content: post.content,
            mediaUrls: mediaUrls,
          }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 60000 },
            removeOnComplete: true,
            removeOnFail: false
          });
          requeued++;
        }
      }
    }

    if (requeued > 0) {
      console.log(`[Worker Process] Re-queued ${requeued} stuck pending posts.`);
    } else {
      console.log('[Worker Process] No stuck posts to re-queue.');
    }
  } catch (err) {
    console.error('[Worker Process] Automated recovery failed:', err);
  } finally {
    recoveryRunning = false;
  }
}, RECOVERY_INTERVAL_MS);
};

// Server Mode must refuse to start while any dashboard account still
// accepts a previously shipped default password (fail-closed preflight).
if (getRockBaseMode() === 'server') {
  assertServerModeDefaultCredentialGuard()
    .then(() => {
      if (process.exitCode === undefined || process.exitCode === 0) startWorkerSystem();
    })
    .catch((error) => {
      console.error('[Worker Process] Default-credential preflight crashed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
} else {
  startWorkerSystem();
}

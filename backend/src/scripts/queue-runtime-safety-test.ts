import { getWorkerMode, getWorkerStartupPlan, assertSeparateWorkerMode } from '../utils/workerMode';
import { reconcileQueueReadOnly } from '../services/QueueReconciliationService';

async function main() {
  if (getWorkerMode({ RUN_WORKERS_SEPARATELY: 'false' }) !== 'internal') throw new Error('internal mode failed');
  if (getWorkerMode({ RUN_WORKERS_SEPARATELY: 'true' }) !== 'separate') throw new Error('separate mode failed');
  if (getWorkerStartupPlan(false, 'internal') !== 'disabled') throw new Error('disabled internal plan failed');
  if (getWorkerStartupPlan(false, 'separate') !== 'disabled') throw new Error('disabled separate plan failed');
  if (getWorkerStartupPlan(true, 'internal') !== 'internal') throw new Error('enabled internal plan failed');
  if (getWorkerStartupPlan(true, 'separate') !== 'separate') throw new Error('enabled separate plan failed');
  try { getWorkerMode({}); throw new Error('invalid mode accepted'); } catch (error) { if ((error as Error).message === 'invalid mode accepted') throw error; }
  try { assertSeparateWorkerMode({ RUN_WORKERS_SEPARATELY: 'false' }); throw new Error('wrong worker mode accepted'); } catch (error) { if ((error as Error).message === 'wrong worker mode accepted') throw error; }

  const report = await reconcileQueueReadOnly(
    { post: { findMany: async () => [
      { id: 'missing', status: 'pending' }, { id: 'stranded', status: 'running' }, { id: 'verify', status: 'pending_verify' }, { id: 'failed', status: 'pending' },
    ] } },
    { getWaiting: async () => [], getDelayed: async () => [], getActive: async () => [{ id: 'stale', data: { postId: 'orphan' }, processedOn: 0 }], getFailed: async () => [{ id: 'failed-job', data: { postId: 'failed' } }] },
    1_000_000, 1,
  );
  const categories = report.issues.map((issue) => issue.category);
  for (const category of ['MISSING_QUEUE_JOB', 'STRANDED_EXECUTION', 'NEEDS_VERIFICATION', 'ORPHAN_QUEUE_JOB', 'FAILED_WITH_RECORD', 'STALE_ACTIVE_JOB']) if (!categories.includes(category as any)) throw new Error('missing ' + category);
  console.log('[QueueRuntimeSafetyTest] passed');
}
main();
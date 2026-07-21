export type QueueIssue =
  | 'MISSING_QUEUE_JOB' | 'ORPHAN_QUEUE_JOB' | 'STRANDED_EXECUTION'
  | 'FAILED_WITH_RECORD' | 'STALE_ACTIVE_JOB' | 'NEEDS_VERIFICATION';

export interface QueueReconciliationReport {
  queue: string;
  checkedAt: string;
  issues: Array<{ category: QueueIssue; postId?: string; jobId?: string }>;
}

export async function reconcileQueueReadOnly(
  database: { post: { findMany(args: unknown): Promise<Array<{ id: string; status: string }>> } },
  queue: { getWaiting(): Promise<any[]>; getDelayed(): Promise<any[]>; getActive(): Promise<any[]>; getFailed(): Promise<any[]> },
  now = Date.now(),
  staleMs = Number(process.env.QUEUE_STALE_ACTIVE_MS || 15 * 60 * 1000),
): Promise<QueueReconciliationReport> {
  const records = await database.post.findMany({ select: { id: true, status: true } });
  const [waiting, delayed, active, failed] = await Promise.all([queue.getWaiting(), queue.getDelayed(), queue.getActive(), queue.getFailed()]);
  const jobs = [...waiting, ...delayed, ...active, ...failed];
  const recordIds = new Set(records.map((record) => record.id));
  const queuedIds = new Set(jobs.map((job) => String(job.data?.postId || '')).filter(Boolean));
  const issues: QueueReconciliationReport['issues'] = [];

  for (const record of records) {
    if (record.status === 'pending' && !queuedIds.has(record.id)) issues.push({ category: 'MISSING_QUEUE_JOB', postId: record.id });
    if ((record.status === 'running' || record.status === 'executing') && !active.some((job) => job.data?.postId === record.id)) issues.push({ category: 'STRANDED_EXECUTION', postId: record.id });
    if (record.status === 'pending_verify' || record.status === 'unknown_result') issues.push({ category: 'NEEDS_VERIFICATION', postId: record.id });
  }
  for (const job of jobs) {
    const postId = String(job.data?.postId || '');
    if (postId && !recordIds.has(postId)) issues.push({ category: 'ORPHAN_QUEUE_JOB', jobId: String(job.id), postId });
  }
  for (const job of failed) {
    const postId = String(job.data?.postId || '');
    if (postId && recordIds.has(postId)) issues.push({ category: 'FAILED_WITH_RECORD', jobId: String(job.id), postId });
  }
  for (const job of active) {
    const started = Number(job.processedOn ?? job.timestamp ?? now);
    if (now - started > staleMs) issues.push({ category: 'STALE_ACTIVE_JOB', jobId: String(job.id), postId: String(job.data?.postId || '') || undefined });
  }
  return { queue: 'automationQueue', checkedAt: new Date(now).toISOString(), issues };
}
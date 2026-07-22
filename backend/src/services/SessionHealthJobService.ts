import { PrismaClient } from '@prisma/client';
import { sessionHealthService } from './SessionHealthService';
const prisma = new PrismaClient();
const concurrency = Math.max(1, Math.min(3, Number(process.env.SESSION_HEALTH_CHECK_CONCURRENCY || 3)));
export class SessionHealthJobService {
  private active = new Set<string>();
  async start(accountIds: string[]) {
    const ids = [...new Set(accountIds.filter(Boolean))];
    const accounts = await prisma.socialAccount.findMany({ where: { id: { in: ids } }, select: { id: true, workspaceId: true } });
    if (!accounts.length) throw new Error('No selected accounts were found');
    const id = 'session-health-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await prisma.activityLog.create({ data: { workspaceId: accounts[0].workspaceId, type: 'session', entityType: 'session_health_job', entityId: id, action: 'bulk_check', status: 'queued', message: 'Bulk health check queued', metadata: { total: accounts.length, accountIds: accounts.map(a => a.id) } } });
    void this.run(id, accounts.map(a => a.id));
    return this.get(id);
  }
  async latest() {
    const job = await prisma.activityLog.findFirst({ where: { entityType: 'session_health_job' }, orderBy: { createdAt: 'desc' } });
    return job ? this.get(job.entityId) : null;
  }
  async get(id: string) {
    const job = await prisma.activityLog.findFirst({ where: { entityId: id, entityType: 'session_health_job' } });
    if (!job) throw new Error('Session health job not found');
    const rows = await prisma.activityLog.findMany({ where: { entityId: id, entityType: 'session_health_job_result' }, orderBy: { createdAt: 'asc' } });
    const results = rows.map(row => row.metadata as any);
    const total = Number((job.metadata as any)?.total || 0);
    const count = (values: string[]) => results.filter(result => values.includes(result.health)).length;
    const completed = results.length;
    return { id, state: job.status, total, queued: Math.max(0, total - completed - (job.status === 'running' ? Math.min(concurrency, total - completed) : 0)), checking: job.status === 'running' ? Math.min(concurrency, Math.max(0, total - completed)) : 0, completed, healthy: count(['HEALTHY']), needsLogin: count(['NEEDS_RELOGIN','EXPIRED']), challenge: count(['CHECKPOINT']), error: count(['UNKNOWN','PAUSED']), createdAt: job.createdAt, results };
  }
  private async run(id: string, ids: string[]) {
    await prisma.activityLog.updateMany({ where: { entityId: id, entityType: 'session_health_job' }, data: { status: 'running' } });
    let cursor = 0;
    const worker = async () => { while (cursor < ids.length) {
      const accountId = ids[cursor++]; const account = await prisma.socialAccount.findUnique({ where: { id: accountId } }); if (!account) continue;
      this.active.add(accountId); let result: any;
      try { result = await sessionHealthService.checkAccount(accountId); } catch (error: any) { result = { accountId, username: account.username, health: 'UNKNOWN', reason: error.message || 'Check failed', checkedAt: new Date().toISOString() }; } finally { this.active.delete(accountId); }
      await prisma.activityLog.create({ data: { workspaceId: account.workspaceId, type: 'session', entityType: 'session_health_job_result', entityId: id, accountId, action: 'check_result', status: result.health === 'HEALTHY' ? 'success' : 'failed', message: result.reason, metadata: result } });
    }};
    try { await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker)); const progress = await this.get(id); await prisma.activityLog.updateMany({ where: { entityId: id, entityType: 'session_health_job' }, data: { status: progress.error ? 'completed_with_errors' : 'completed' } }); } catch (error: any) { await prisma.activityLog.updateMany({ where: { entityId: id, entityType: 'session_health_job' }, data: { status: 'failed', message: error.message || 'Bulk check failed' } }); }
  }
}
export const sessionHealthJobService = new SessionHealthJobService();

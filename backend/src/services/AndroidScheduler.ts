import { PrismaClient } from '@prisma/client';
import { AndroidDeviceLeaseService } from './AndroidDeviceLeaseService';
import { androidDevices, androidMaxConcurrent } from './AndroidDeviceService';
import { androidRuntime } from './AndroidRuntimeService';
import { logActivity } from './ActivityLogService';

export const androidIdleGraceMinutes = () => {
  const value = Number(process.env.ANDROID_IDLE_GRACE_MINUTES ?? 30);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1440) throw new Error('ANDROID_IDLE_GRACE_MINUTES must be 0–1440');
  return value;
};

export type AndroidOutcome = { status: 'COMPLETED' | 'WAITING' | 'SKIPPED' | 'FAILED'; reason?: string; result?: Record<string, unknown> };

type DeviceController = Pick<typeof androidDevices, 'start' | 'stop' | 'refresh'>;
type Runtime = Pick<typeof androidRuntime, 'resolveSerial' | 'health' | 'screenshot' | 'connected'>;

export class AndroidScheduler {
  private leases: AndroidDeviceLeaseService;
  constructor(private readonly prisma: PrismaClient, private readonly devices: DeviceController = androidDevices,
    private readonly runtime: Runtime = androidRuntime, leases?: AndroidDeviceLeaseService) {
    this.leases = leases ?? new AndroidDeviceLeaseService(prisma);
  }

  async submit(accountId: string) {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: accountId }, include: { homeDevice: true } });
    if (!account) throw new Error('Account not found');
    if (account.executionEngine !== 'android' || !account.homeDeviceId || !account.homeDevice) throw new Error('Android account needs a valid home device');
    if (account.platform !== 'Instagram') throw new Error('Only Instagram Android accounts are supported');
    if (!account.homeDevice.enabled) throw new Error('Home device disabled');
    if (account.androidHealth !== 'HEALTHY') throw new Error(`Account ${account.androidHealth}: ${account.androidHealthReason || 'operator review required'}`);
    const job = await this.prisma.androidJob.create({ data: { accountId, deviceId: account.homeDeviceId } });
    await this.prisma.androidDevice.update({ where: { id: account.homeDeviceId }, data: { idleSince: null } });
    return job;
  }

  async run(jobId: string): Promise<AndroidOutcome> {
    const job = await this.prisma.androidJob.findUnique({ where: { id: jobId }, include: { account: true, device: true } });
    if (!job) throw new Error('Android job not found');
    if (job.status === 'COMPLETED' || job.status === 'INTERRUPTED' || job.status === 'SKIPPED' || job.status === 'FAILED') {
      return { status: 'SKIPPED', reason: `Job already ${job.status}` };
    }
    const account = job.account;
    if (account.executionEngine !== 'android' || !account.homeDeviceId || account.homeDeviceId !== job.deviceId || account.androidHealth !== 'HEALTHY') {
      const reason = account.androidHealth !== 'HEALTHY' ? `Account ${account.androidHealth}: ${account.androidHealthReason || 'operator review required'}` : 'Android account requires its original valid home device';
      await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'SKIPPED', reason, finishedAt: new Date() } });
      return { status: 'SKIPPED', reason };
    }
    if (!job.device.enabled || job.device.status === 'ATTENTION' || job.device.status === 'ERROR') {
      const reason = !job.device.enabled ? 'Home device disabled' : `Device ${job.device.status}: ${job.device.lastError || 'operator review required'}`;
      await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'SKIPPED', reason, finishedAt: new Date() } });
      return { status: 'SKIPPED', reason };
    }
    const lease = await this.leases.acquire(job.deviceId, jobId);
    if (!lease) return this.wait(jobId, 'Device leased or needs operator attention');
    const started = Date.now();
    let busy = false;
    try {
      let serial = await this.runtime.resolveSerial(job.device.avdName);
      if (!serial) {
        // Reconcile all persisted statuses after a crash before counting running slots.
        await androidDevices.list();
        // start() atomically checks the global BOOTING/READY/BUSY budget before launching.
        try {
          const device = await this.devices.start(job.deviceId, lease.ownerId);
          serial = device.adbSerial;
          await this.prisma.androidDevice.update({ where: { id: job.deviceId }, data: { lastBootDurationMs: Date.now() - started } });
          this.activity(jobId, account.workspaceId, account.id, 'boot', 'completed', { bootMs: Date.now() - started });
        } catch (error: any) {
          if (/concurrent limit|boot slots|not offline|database is locked|P2034/i.test(error?.message || '')) {
            return this.wait(jobId, `Waiting for concurrency slot (${androidMaxConcurrent()} max)`);
          }
          throw error;
        }
      } else {
        await this.devices.refresh(job.deviceId);
      }
      if (!serial || !await this.runtime.health(serial)) throw new Error('ADB unavailable or Android boot not complete');
      await lease.assertOwner();
      const claimed = await this.prisma.androidDevice.updateMany({ where: { id: job.deviceId, leaseOwner: lease.ownerId, status: 'READY' },
        data: { status: 'BUSY', idleSince: null } });
      if (!claimed.count) throw new Error('Device no longer READY or lease lost');
      busy = true;
      await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 }, reason: null } });
      const image = await this.runtime.screenshot(serial);
      await lease.assertOwner();
      const result = { adbSerial: serial, screenshotBytes: image.length, executionMs: Date.now() - started };
      await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'COMPLETED', result, finishedAt: new Date() } });
      this.activity(jobId, account.workspaceId, account.id, 'smoke', 'completed', result);
      return { status: 'COMPLETED', result };
    } catch (error: any) {
      const reason = error?.message || String(error);
      await this.prisma.androidJob.updateMany({ where: { id: jobId, status: { not: 'COMPLETED' } },
        data: { status: 'FAILED', reason, finishedAt: new Date() } });
      await this.prisma.androidDevice.updateMany({ where: { id: job.deviceId, leaseOwner: lease.ownerId },
        data: { status: busy ? 'ATTENTION' : 'ERROR', lastError: reason } });
      this.activity(jobId, account.workspaceId, account.id, 'smoke', 'failed', { reason });
      return { status: 'FAILED', reason };
    } finally {
      if (busy) {
        const pending = await this.prisma.androidJob.count({ where: { deviceId: job.deviceId, status: 'QUEUED' } });
        await this.prisma.androidDevice.updateMany({ where: { id: job.deviceId, leaseOwner: lease.ownerId, status: 'BUSY' },
          data: { status: 'READY', idleSince: pending ? null : new Date() } });
      }
      await lease.release();
    }
  }

  private async wait(jobId: string, reason: string): Promise<AndroidOutcome> {
    await this.prisma.androidJob.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { reason } });
    return { status: 'WAITING', reason };
  }

  async sweepIdle() {
    const cutoff = new Date(Date.now() - androidIdleGraceMinutes() * 60_000);
    const candidates = await this.prisma.androidDevice.findMany({ where: { status: 'READY', idleSince: { lte: cutoff } } });
    let shutdowns = 0;
    for (const device of candidates) {
      const lease = await this.leases.acquire(device.id, `idle:${device.id}`);
      if (!lease) continue;
      try {
        const pending = await this.prisma.androidJob.count({ where: { deviceId: device.id, status: 'QUEUED' } });
        const current = await this.prisma.androidDevice.findUnique({ where: { id: device.id } });
        if (pending || !current?.idleSince || current.idleSince > cutoff || current.status !== 'READY') continue;
        await this.devices.stop(device.id, lease.ownerId, 'idle_grace');
        shutdowns++;
        this.activity(`idle:${device.id}`, 'workspace-default', '', 'shutdown', 'completed', { idleMs: Date.now() - current.idleSince.getTime(), reason: 'idle_grace' });
      } finally { await lease.release(); }
    }
    return shutdowns;
  }

  async reconcile() { return this.leases.recoverStale(); }

  private activity(jobId: string, workspaceId: string, accountId: string, action: string, status: string, metadata: unknown) {
    logActivity({ workspaceId, type: 'android', entityType: 'android_job', entityId: jobId,
      accountId: accountId || undefined, action, status, message: `Android ${action} ${status}`, metadata });
  }
}

export const androidScheduler = new AndroidScheduler(new PrismaClient());

import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { logActivity } from './ActivityLogService';

export class AndroidDeviceLease {
  private timer?: NodeJS.Timeout;
  private released = false;
  lost = false;

  constructor(
    private readonly prisma: PrismaClient,
    readonly deviceId: string,
    readonly jobId: string,
    readonly ownerId: string,
    private readonly ttlMs: number,
    heartbeatMs: number,
  ) {
    if (heartbeatMs > 0) {
      this.timer = setInterval(() => { void this.extend().catch(() => { this.lost = true; }); }, heartbeatMs);
      this.timer.unref?.();
    }
  }

  async extend() {
    if (this.released || this.lost) return false;
    const result = await this.prisma.androidDevice.updateMany({
      where: { id: this.deviceId, leaseOwner: this.ownerId, leaseJobId: this.jobId, leaseExpiresAt: { gt: new Date() } },
      data: { leaseHeartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + this.ttlMs) },
    });
    if (!result.count) this.lost = true;
    return !this.lost;
  }

  async assertOwner() {
    if (!await this.extend()) throw new Error('ANDROID_DEVICE_LEASE_LOST');
  }

  async release() {
    if (this.released) return false;
    this.released = true;
    if (this.timer) clearInterval(this.timer);
    const result = await this.prisma.androidDevice.updateMany({
      where: { id: this.deviceId, leaseOwner: this.ownerId, leaseJobId: this.jobId },
      data: { leaseOwner: null, leaseJobId: null, leaseExpiresAt: null, leaseHeartbeatAt: null },
    });
    return result.count === 1;
  }
}

export class AndroidDeviceLeaseService {
  constructor(private readonly prisma: PrismaClient, private readonly ttlMs = 5 * 60_000, private readonly heartbeatMs = 30_000) {}

  async acquire(deviceId: string, jobId: string): Promise<AndroidDeviceLease | null> {
    const ownerId = randomUUID();
    const now = new Date();
    const result = await this.prisma.androidDevice.updateMany({
      where: {
        id: deviceId, enabled: true,
        status: { notIn: ['ATTENTION', 'ERROR'] },
        leaseOwner: null,
      },
      data: { leaseOwner: ownerId, leaseJobId: jobId, leaseExpiresAt: new Date(now.getTime() + this.ttlMs), leaseHeartbeatAt: now },
    });
    if (!result.count) return null;
    return new AndroidDeviceLease(this.prisma, deviceId, jobId, ownerId, this.ttlMs, this.heartbeatMs);
  }

  async recoverStale() {
    const expired = await this.prisma.androidDevice.findMany({
      where: { leaseOwner: { not: null }, leaseExpiresAt: { lte: new Date() } },
      select: { id: true, leaseOwner: true, leaseJobId: true },
    });
    let recovered = 0;
    for (const device of expired) {
      const claimed = await this.prisma.androidDevice.updateMany({
        where: { id: device.id, leaseOwner: device.leaseOwner, leaseExpiresAt: { lte: new Date() } },
        data: { leaseOwner: null, leaseJobId: null, leaseExpiresAt: null, leaseHeartbeatAt: null,
          status: 'ATTENTION', lastError: `Stale lease recovered for job ${device.leaseJobId || 'unknown'}; review device before reuse` },
      });
      if (!claimed.count) continue;
      recovered++;
      logActivity({ type: 'android', entityType: 'android_device', entityId: device.id,
        action: 'stale_lease_recovered', status: 'attention',
        message: `Recovered expired Android lease; operator review required`,
        metadata: { jobId: device.leaseJobId, ownerId: device.leaseOwner } });
      if (device.leaseJobId) await this.prisma.androidJob.updateMany({
        where: { id: device.leaseJobId, status: { in: ['RUNNING', 'QUEUED'] } },
        data: { status: 'INTERRUPTED', reason: 'Worker stopped and device lease expired; operator review required', finishedAt: new Date() },
      });
    }
    return recovered;
  }
}

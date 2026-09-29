import { PrismaClient } from '@prisma/client';
import { AndroidDeviceLeaseService } from '../AndroidDeviceLeaseService';
import { AndroidRuntimeService, androidRuntime } from '../AndroidRuntimeService';
import { androidMedia } from '../AndroidMediaService';
import { InstagramAndroidWorker } from './InstagramAndroidWorker';
import { InstagramUiAdapter } from './InstagramUiAdapter';

/** The narrow ADB/runtime surface recovery needs; production passes the shared androidRuntime. */
export type RecoveryRuntime = Pick<AndroidRuntimeService, 'resolveSerial' | 'health'>;
/** The narrow media-staging surface recovery hands to the worker; production passes androidMedia. */
export type RecoveryMedia = Pick<typeof androidMedia, 'stage' | 'cleanup'>;

/** Explicit operator recovery only: never queued automatically and never grants publish approval. */
export class InstagramPreparationRecovery {
  constructor(private readonly prisma: PrismaClient,
    private readonly adapterFactory: (serial: string) => InstagramUiAdapter,
    private readonly runtime: RecoveryRuntime = androidRuntime,
    private readonly media: RecoveryMedia = androidMedia) {}

  async recover(jobId: string, idempotencyKey: string, mode: 'reprepare' | 'revalidate') {
    const job = await this.prisma.androidJob.findUniqueOrThrow({ where: { id: jobId }, include: { account: true, device: true } });
    if (job.idempotencyKey !== idempotencyKey || job.type !== 'ANDROID_IMAGE_POST' || job.publishBoundaryAt
      || Number((job.result as any)?.shareInvocationCount || 0) !== 0
      || !['PREPARATION_EXPIRED', 'READY_FOR_REAL_POST'].includes(job.status)) throw new Error('RECOVERY_PRECONDITION_FAILED');
    if (job.account.executionEngine !== 'android' || job.account.homeDeviceId !== job.deviceId) throw new Error('RECOVERY_ACCOUNT_MISMATCH');
    const serial = await this.runtime.resolveSerial(job.device.avdName);
    if (!serial || !await this.runtime.health(serial)) throw new Error('RECOVERY_DEVICE_OFFLINE');
    const lease = await new AndroidDeviceLeaseService(this.prisma).acquire(job.deviceId, job.id);
    if (!lease) throw new Error('RECOVERY_DEVICE_LEASE_UNAVAILABLE');
    let ready = false;
    try {
      const claimed = await this.prisma.androidDevice.updateMany({ where: { id: job.deviceId, status: 'READY', leaseOwner: lease.ownerId }, data: { status: 'BUSY', idleSince: null } });
      if (!claimed.count) throw new Error('RECOVERY_DEVICE_NOT_READY');
      const adapter = this.adapterFactory(serial);
      // Read identity only on the known authenticated profile/feed surfaces. If composer survives,
      // its lack of username means revalidation must fail closed rather than navigate away from it.
      await adapter.ensureInstagramForeground();
      if (await adapter.detectSecurityState() !== 'OK') throw new Error('RECOVERY_SESSION_NOT_VERIFIED');
      const detected = await adapter.readActiveUsername();
      if (!detected || detected.replace(/^@/, '').toLowerCase() !== job.account.username.replace(/^@/, '').toLowerCase()) throw new Error('RECOVERY_IDENTITY_MISMATCH');
      await lease.assertOwner();
      if (mode === 'revalidate') {
        const state = await adapter.verifyPreparedState({ caption: job.caption || '' });
        if (!state.ok) throw new Error('RECOVERY_PREPARED_UI_NOT_VERIFIED');
        const at = new Date();
        const minutes = Number(process.env.ANDROID_PREPARED_HOLD_MINUTES || 30);
        const result = { ...(job.result as any), preparedAt: at.toISOString(), liveRevalidatedAt: at.toISOString(),
          hold: { until: new Date(at.getTime() + minutes * 60000).toISOString(), minutes }, shareInvocationCount: 0, publishApproved: false };
        const updated = await this.prisma.androidJob.updateMany({ where: { id: job.id, status: job.status, publishBoundaryAt: null }, data: { status: 'READY_FOR_REAL_POST', verificationResult: 'PREPARED', result } });
        if (!updated.count) throw new Error('RECOVERY_STATE_CHANGED');
        ready = true;
        return { status: 'READY_FOR_REAL_POST', result };
      }
      if (job.status !== 'PREPARATION_EXPIRED') throw new Error('RECOVERY_REPREPARE_REQUIRES_EXPIRED');
      const updated = await this.prisma.androidJob.updateMany({ where: { id: job.id, status: 'PREPARATION_EXPIRED', publishBoundaryAt: null }, data: { status: 'RUNNING', reason: 'Explicit operator preparation-only recovery', finishedAt: null } });
      if (!updated.count) throw new Error('RECOVERY_STATE_CHANGED');
      const outcome = await new InstagramAndroidWorker(this.prisma, adapter, serial, this.media).run(job.id, true);
      ready = outcome.status === 'READY_FOR_REAL_POST';
      return outcome;
    } finally {
      await this.prisma.androidDevice.updateMany({ where: { id: job.deviceId, status: 'BUSY', leaseOwner: lease.ownerId }, data: { status: 'READY', idleSince: ready ? null : new Date() } });
      await lease.release();
    }
  }
}

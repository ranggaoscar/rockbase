import { PrismaClient } from '@prisma/client';
import { AndroidDeviceLeaseService } from './AndroidDeviceLeaseService';
import { androidDevices, androidMaxConcurrent } from './AndroidDeviceService';
import { androidRuntime } from './AndroidRuntimeService';
import { AndroidPreparedStateService, isSafeToExpire, preparedHoldUntil } from './AndroidPreparedStateService';
import { logActivity } from './ActivityLogService';
import { AdbInstagramUiAdapter } from './instagram/AdbInstagramUiAdapter';
import { InstagramAndroidWorker, InstagramJobOutcome } from './instagram/InstagramAndroidWorker';

export const androidIdleGraceMinutes = () => {
  const value = Number(process.env.ANDROID_IDLE_GRACE_MINUTES ?? 30);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1440) throw new Error('ANDROID_IDLE_GRACE_MINUTES must be 0–1440');
  return value;
};

export type AndroidOutcome = { status: 'COMPLETED' | 'WAITING' | 'SKIPPED' | 'FAILED' | 'AMBIGUOUS' | 'NEEDS_ATTENTION' | 'READY_FOR_REAL_POST'; reason?: string; result?: Record<string, unknown> };

export interface InstagramRunner { run(jobId: string): Promise<InstagramJobOutcome>; }
export type InstagramRunnerFactory = (serial: string) => InstagramRunner;

/**
 * Read-only confirmation that a prepared Share screen still exists on the device. Implementations
 * must NEVER navigate, tap or rebuild the post — they only look at what is on screen.
 */
export interface PreparedScreenValidator {
  verifyPreparedState(expected: { caption: string }): Promise<{ ok: boolean; detail: string }>;
}
export type PreparedValidatorFactory = (serial: string) => PreparedScreenValidator;

type DeviceController = Pick<typeof androidDevices, 'start' | 'stop' | 'refresh'>;
type Runtime = Pick<typeof androidRuntime, 'resolveSerial' | 'health' | 'screenshot' | 'connected'>;

export class AndroidScheduler {
  private leases: AndroidDeviceLeaseService;
  private readonly preparedStates: AndroidPreparedStateService;
  constructor(private readonly prisma: PrismaClient, private readonly devices: DeviceController = androidDevices,
    private readonly runtime: Runtime = androidRuntime, leases?: AndroidDeviceLeaseService,
    private readonly instagramFactory: InstagramRunnerFactory = (serial) => new InstagramAndroidWorker(prisma, new AdbInstagramUiAdapter(serial), serial),
    preparedStates?: AndroidPreparedStateService,
    // Optional DI: pass null to disable on-device validation (e.g. hermetic tests).
    private readonly preparedValidatorFactory: PreparedValidatorFactory | null = (serial) => new AdbInstagramUiAdapter(serial)) {
    this.leases = leases ?? new AndroidDeviceLeaseService(prisma);
    this.preparedStates = preparedStates ?? new AndroidPreparedStateService(prisma);
  }

  async submit(accountId: string) {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: accountId }, include: { homeDevice: true } });
    if (!account) throw new Error('Account not found');
    if (account.executionEngine !== 'android' || !account.homeDeviceId || !account.homeDevice) throw new Error('Android account needs a valid home device');
    if (account.platform !== 'Instagram') throw new Error('Only Instagram Android accounts are supported');
    if (!account.homeDevice.enabled) throw new Error('Home device disabled');
    // submit() creates a social smoke row. Infrastructure proof must not flip account health to pass this gate.
    if (account.androidHealth !== 'HEALTHY') throw new Error(`Account ${account.androidHealth}: ${account.androidHealthReason || 'operator review required'}`);
    const job = await this.prisma.androidJob.create({ data: { accountId, deviceId: account.homeDeviceId } });
    await this.prisma.androidDevice.update({ where: { id: account.homeDeviceId }, data: { idleSince: null } });
    return job;
  }

  async run(jobId: string): Promise<AndroidOutcome> {
    const job = await this.prisma.androidJob.findUnique({ where: { id: jobId }, include: { account: true, device: true } });
    if (!job) throw new Error('Android job not found');
    if (job.type !== 'ANDROID_SMOKE' && job.type !== 'ANDROID_IMAGE_POST') {
      return { status: 'SKIPPED', reason: 'Unsupported Android job type' };
    }
    if (job.status === 'COMPLETED' || job.status === 'INTERRUPTED' || job.status === 'SKIPPED' || job.status === 'FAILED') {
      return { status: 'SKIPPED', reason: `Job already ${job.status}` };
    }
    if (job.type === 'ANDROID_IMAGE_POST') {
      // Drafts are operator work-in-progress: they must never traverse the ADB path before approval,
      // and a job that crossed the publish boundary is never re-attempted automatically.
      if (job.status === 'NEEDS_ATTENTION' || job.status === 'AMBIGUOUS' || job.status === 'PUBLISHING'
        || job.status === 'READY_FOR_REAL_POST') {
        return { status: 'SKIPPED', reason: `Job already ${job.status}` };
      }
      if (job.publishBoundaryAt) return { status: 'AMBIGUOUS', reason: 'Publish boundary already crossed; manual verification required' };
      if (job.status !== 'QUEUED' || !job.approvedAt) {
        return { status: 'SKIPPED', reason: 'Image post awaits a verified Instagram identity and operator approval' };
      }
    }
    const account = job.account;
    const social = job.type === 'ANDROID_IMAGE_POST';
    if (account.executionEngine !== 'android' || !account.homeDeviceId || account.homeDeviceId !== job.deviceId || (social && account.androidHealth !== 'HEALTHY')) {
      const reason = social && account.androidHealth !== 'HEALTHY' ? `Account ${account.androidHealth}: ${account.androidHealthReason || 'operator review required'}` : 'Android account requires its original valid home device';
      await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'SKIPPED', reason, finishedAt: new Date() } });
      return { status: 'SKIPPED', reason };
    }
    if (!job.device.enabled || job.device.status === 'ATTENTION' || job.device.status === 'ERROR') {
      const reason = !job.device.enabled ? 'Home device disabled' : `Device ${job.device.status}: ${job.device.lastError || 'operator review required'}`;
      await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'SKIPPED', reason, finishedAt: new Date() } });
      return { status: 'SKIPPED', reason };
    }
    if (job.type === 'ANDROID_IMAGE_POST') {
      // A prepared post reserves its device for a bounded window: another job must not navigate away
      // from the screen that is waiting for a publish decision. The job waits instead of failing.
      const hold = await this.preparedHold(job.deviceId);
      if (hold) return this.wait(jobId, `Device is holding a prepared post until ${hold.until.toISOString()}; publish approval or hold expiry required`);
    }
    const lease = await this.leases.acquire(job.deviceId, jobId);
    if (!lease) return this.wait(jobId, 'Device leased or needs operator attention');
    const started = Date.now();
    let busy = false;
    let prepared = false;
    try {
      let serial = await this.runtime.resolveSerial(job.device.avdName);
      if (!serial) {
        // The AVD is not running, so any prepared screen it hosted is gone. Expire the hold before the
        // boot so a stale prepared state never outlives the runtime that carried it.
        await this.preparedStates.expireForDevice(job.deviceId, 'runtime_lost');
        // Reconcile all persisted statuses after a crash before counting running slots.
        await androidDevices.list();
        // start() atomically checks the global BOOTING/READY/BUSY budget before launching.
        try {
          const device = await this.devices.start(job.deviceId, lease.ownerId);
          serial = device.adbSerial;
          await this.prisma.androidDevice.update({ where: { id: job.deviceId }, data: { lastBootDurationMs: Date.now() - started } });
          this.activity(jobId, account.workspaceId, account.id, 'boot', 'completed', { bootMs: Date.now() - started });
        } catch (error: any) {
          // "already running" covers a transient resolveSerial miss: the AVD is up, so wait instead of failing the job.
          if (/concurrent limit|boot slots|not offline|already running|database is locked|P2034/i.test(error?.message || '')) {
            return this.wait(jobId, `Waiting for concurrency slot (${androidMaxConcurrent()} max)`);
          }
          throw error;
        }
      } else {
        await this.devices.refresh(job.deviceId);
      }
      if (!serial || !await this.runtime.health(serial)) throw new Error('ADB unavailable or Android boot not complete');
      // Refresh rechecks enrolled host/guest identity. A missing app is recorded, but it is not a
      // device defect: Instagram work is refused by account health, not by blocking the device.
      const executionDevice = await this.devices.refresh(job.deviceId);
      if (executionDevice.status !== 'READY') {
        const reason = executionDevice.lastError || 'DEVICE_IDENTITY_NOT_READY';
        await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'NEEDS_ATTENTION', reason } });
        return { status: 'NEEDS_ATTENTION', reason };
      }
      if (job.type === 'ANDROID_IMAGE_POST' && executionDevice.lastError && /missing/i.test(executionDevice.lastError)) {
        const reason = executionDevice.lastError;
        await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'NEEDS_ATTENTION', reason } });
        return { status: 'NEEDS_ATTENTION', reason };
      }
      await lease.assertOwner();
      const claimed = await this.prisma.androidDevice.updateMany({ where: { id: job.deviceId, leaseOwner: lease.ownerId, status: 'READY' },
        data: { status: 'BUSY', idleSince: null } });
      if (!claimed.count) throw new Error('Device no longer READY or lease lost');
      busy = true;
      if (job.type === 'ANDROID_IMAGE_POST') {
        // The Instagram worker owns its statuses (READY_TO_PUBLISH / PUBLISHING / final) and the
        // Share boundary; the scheduler only guarantees exclusive lease + a claimed BUSY device.
        const outcome = await this.instagramFactory(serial).run(jobId);
        prepared = outcome.status === 'READY_FOR_REAL_POST';
        this.activity(jobId, account.workspaceId, account.id, 'image-post', outcome.status.toLowerCase(), { reason: outcome.reason ?? null });
        return { status: outcome.status, reason: outcome.reason, result: outcome.result };
      }
      await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 }, reason: null } });
      const image = await this.runtime.screenshot(serial);
      await lease.assertOwner();
      const result = { adbSerial: serial, screenshotBytes: image.length, executionMs: Date.now() - started };
      await this.prisma.androidJob.update({ where: { id: jobId }, data: { status: 'COMPLETED', result, finishedAt: new Date() } });
      this.activity(jobId, account.workspaceId, account.id, 'smoke', 'completed', result);
      return { status: 'COMPLETED', result };
    } catch (error: any) {
      const reason = error?.message || String(error);
      const current = await this.prisma.androidJob.findUnique({ where: { id: jobId }, select: { publishBoundaryAt: true } });
      const afterBoundary = job.type === 'ANDROID_IMAGE_POST' && Boolean(current?.publishBoundaryAt);
      await this.prisma.androidJob.updateMany({ where: { id: jobId, status: { notIn: ['COMPLETED', 'AMBIGUOUS'] } },
        data: { status: afterBoundary ? 'AMBIGUOUS' : 'FAILED', reason, finishedAt: new Date() } });
      await this.prisma.androidDevice.updateMany({ where: { id: job.deviceId, leaseOwner: lease.ownerId },
        data: { status: busy ? 'ATTENTION' : 'ERROR', lastError: reason } });
      this.activity(jobId, account.workspaceId, account.id, 'smoke', 'failed', { reason });
      return { status: 'FAILED', reason };
    } finally {
      if (busy) {
        const pending = await this.prisma.androidJob.count({ where: { deviceId: job.deviceId, status: 'QUEUED' } });
        await this.prisma.androidDevice.updateMany({ where: { id: job.deviceId, leaseOwner: lease.ownerId, status: 'BUSY' },
          // A prepared post keeps the device booted for its hold window instead of starting the
          // idle countdown immediately; sweepPreparedHolds() starts that countdown when it expires.
          data: { status: 'READY', idleSince: pending || prepared ? null : new Date() } });
      }
      await lease.release();
    }
  }

  /** Whether this device is currently reserving a prepared post, and until when. */
  private async preparedHold(deviceId: string): Promise<{ until: Date } | null> {
    const jobs = await this.prisma.androidJob.findMany({
      where: { deviceId, status: 'READY_FOR_REAL_POST' }, select: { result: true },
    });
    for (const job of jobs) {
      const until = preparedHoldUntil(job.result);
      if (until && until.getTime() > Date.now()) return { until };
    }
    return null;
  }

  /**
   * Release expired prepared holds so the normal idle grace can reclaim the device. Bounded by
   * construction: a prepared post never reserves a device forever.
   */
  async sweepPreparedHolds(): Promise<number> {
    // Expire first, release second. The prepared screen is gone whether the device is READY, offline,
    // already counting down, or idle from a crashed RockBase process — the job must stop advertising
    // the hold in every one of those cases, not just the happy path.
    const released = await this.preparedStates.expireClosedHolds('hold_expired');
    for (const job of released.jobs) {
      const device = await this.prisma.androidDevice.findUnique({ where: { id: job.deviceId } });
      if (device && device.status === 'READY' && !device.idleSince) {
        // Queued work does not keep the reservation alive: once the window closes the prepared screen
        // is abandoned on purpose, otherwise a re-queued job could reserve a device indefinitely.
        await this.prisma.androidDevice.update({ where: { id: job.deviceId }, data: { idleSince: new Date() } });
      }
      this.activity(job.id, 'workspace-default', '', 'prepared-hold', 'released', {
        note: 'prepared screen expired; the normal idle grace now applies',
      });
    }
    return released.expired;
  }

  /**
   * Confirm that every trusted prepared screen still exists on its device. A prepared post can be
   * destroyed without any lifecycle transition we control: the Instagram process restarts, the
   * composer is reclaimed, the app is updated or uninstalled, the emulator is cold-booted. The only
   * trustworthy answer comes from the device itself, read under the lease and never navigated.
   *
   * The validator verdict decides: anything it cannot confirm (not ok, thrown, no runtime) expires
   * the job — fail closed rather than keep advertising a hold that no longer exists. Devices that are
   * BUSY or leased by an in-flight run are skipped so an active run is never scanned mid-navigation.
   * Validator failures are recorded with their own reason so an operator can tell them apart.
   */
  async sweepPreparedTrust(): Promise<number> {
    if (!this.preparedValidatorFactory) return 0;
    const jobs = await this.prisma.androidJob.findMany({
      where: { status: 'READY_FOR_REAL_POST' },
      select: { id: true, deviceId: true, caption: true, result: true, publishBoundaryAt: true },
    });
    const byDevice = new Map<string, typeof jobs>();
    for (const job of jobs) {
      const list = byDevice.get(job.deviceId) ?? [];
      list.push(job);
      byDevice.set(job.deviceId, list);
    }
    let expired = 0;
    for (const [deviceId, deviceJobs] of byDevice) {
      // Never scan the device an active run owns, is booting, or is otherwise mid-transition.
      const device = await this.prisma.androidDevice.findUnique({ where: { id: deviceId } });
      if (!device || device.status === 'BUSY' || device.status === 'BOOTING' || device.leaseOwner) continue;
      // A publish intent is never expired by a screen read — the same fail-closed gate as the sweep.
      const eligible = deviceJobs.filter((job) => isSafeToExpire(job));
      if (!eligible.length) continue;
      if (device.status !== 'READY') {
        expired += (await this.preparedStates.expireForDevice(deviceId, 'runtime_lost')).expired;
        continue;
      }
      let serial: string | null = null;
      let healthy = false;
      try { serial = await this.runtime.resolveSerial(device.avdName); } catch { serial = null; }
      if (serial) { try { healthy = await this.runtime.health(serial); } catch { healthy = false; } }
      if (!serial || !healthy) {
        // The runtime that hosted the prepared screen is gone: the screen is gone with it.
        expired += (await this.preparedStates.expireForDevice(deviceId, 'runtime_lost')).expired;
        continue;
      }
      const lease = await this.leases.acquire(deviceId, `prepared-trust:${deviceId}`);
      if (!lease) continue; // an active run claimed the device between the read and the lease
      try {
        const validator = this.preparedValidatorFactory(serial);
        for (const job of eligible) {
          const current = await this.prisma.androidJob.findUnique({ where: { id: job.id }, select: { status: true, publishBoundaryAt: true } });
          if (!current || current.status !== 'READY_FOR_REAL_POST' || current.publishBoundaryAt) continue;
          let ok = false;
          let detail = '';
          try {
            const verdict = await validator.verifyPreparedState({ caption: job.caption ?? '' });
            ok = verdict.ok;
            detail = verdict.detail || '';
          } catch (error: any) {
            ok = false; // read failures fail closed: an unreadable screen is not a trusted screen
            detail = error?.message || String(error);
          }
          if (ok) continue;
          const out = await this.preparedStates.expireJobs([job.id], 'validator_failed');
          expired += out.expired;
          this.activity(job.id, 'workspace-default', '', 'prepared-trust', 'invalid', { detail });
        }
      } finally {
        await lease.release();
      }
    }
    return expired;
  }

  private async wait(jobId: string, reason: string): Promise<AndroidOutcome> {
    await this.prisma.androidJob.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { reason } });
    return { status: 'WAITING', reason };
  }

  async sweepIdle() {
    await this.sweepPreparedHolds();
    await this.sweepPreparedTrust();
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

  async reconcile() {
    const recovered = await this.leases.recoverStale();
    // Startup reconciliation also expires stale prepared holds so a restart never leaves a
    // READY_FOR_REAL_POST pointing at a screen the fresh runtime cannot host.
    await this.sweepPreparedHolds();
    await this.sweepPreparedTrust();
    return recovered;
  }

  private activity(jobId: string, workspaceId: string, accountId: string, action: string, status: string, metadata: unknown) {
    logActivity({ workspaceId, type: 'android', entityType: 'android_job', entityId: jobId,
      accountId: accountId || undefined, action, status, message: `Android ${action} ${status}`, metadata });
  }
}

export const androidScheduler = new AndroidScheduler(new PrismaClient());

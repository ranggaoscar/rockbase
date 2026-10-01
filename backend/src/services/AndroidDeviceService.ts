import { PrismaClient } from '@prisma/client';
import { androidRuntime } from './AndroidRuntimeService';
import { AndroidPreparedStateService } from './AndroidPreparedStateService';
import { androidIdentity, INSTAGRAM_PACKAGE } from './AndroidIdentityService';
import { logActivity } from './ActivityLogService';

const prisma = new PrismaClient();
// A prepared screen lives only on a booted, READY device; every lifecycle transition below that
// destroys it (or makes it unverifiable) expires the hold through this service.
const preparedStates = new AndroidPreparedStateService(prisma);
export const androidMaxConcurrent = () => {
  const value = Number(process.env.ANDROID_MAX_CONCURRENT ?? 3);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('ANDROID_MAX_CONCURRENT must be a positive integer');
  return value;
};

/** The registry identity fields a device carries (all nullable until first enrollment). */
interface DeviceIdentityRow {
  id: string;
  avdName: string;
  persistentMarker: string | null;
  avdIniPath: string | null;
  avdAbsolutePath: string | null;
  userdataPath: string | null;
  systemImage: string | null;
}

/**
 * Read-only verdict for a device: pinned host identity, guest marker, expected app.
 *
 * Never installs an app, never navigates, never regenerates a marker and never throws — a health
 * check must turn a defect into operator-visible ATTENTION, not into a runtime ERROR or a kill.
 */
export interface DeviceFitness {
  defect: boolean;
  kind: 'identity' | 'app' | null;
  reason: string | null;
  /** App/account readiness only. Never a device-infrastructure defect. */
  appReason: string | null;
  /** True only when the device is booted and its guest marker proved identical to the registry. */
  guestVerified: boolean;
}

/** App packages RockBase expects on a device that serves an Instagram Android account. */
async function expectedPackages(deviceId: string): Promise<string[]> {
  const accounts = await prisma.socialAccount.count({
    where: { homeDeviceId: deviceId, executionEngine: 'android', platform: 'Instagram' },
  });
  return accounts ? [INSTAGRAM_PACKAGE] : [];
}

async function deviceFitness(device: DeviceIdentityRow, serial: string | null, booted: boolean): Promise<DeviceFitness> {
  let registry;
  try {
    registry = androidIdentity.check(device);
  } catch (error: any) {
    return { defect: true, kind: 'identity', reason: `Device identity could not be verified: ${error?.message || String(error)}`, appReason: null, guestVerified: false };
  }
  if (!registry.ok) {
    return { defect: true, kind: 'identity', reason: `Device identity mismatch: ${registry.detail}`, appReason: null, guestVerified: false };
  }
  let guestVerified = false;
  let appReason: string | null = null;
  if (booted && serial) {
    // Only an enrolled, host-verified device has a marker to compare: otherwise there is nothing yet.
    if (registry.state === 'VERIFIED') {
      const guest = await androidIdentity.verifyGuest(serial, device.persistentMarker);
      if (!guest.ok) {
        return { defect: true, kind: 'identity', reason: `Device identity marker ${guest.state.toLowerCase()}: ${guest.detail}`, appReason: null, guestVerified: false };
      }
      guestVerified = true;
    }
    // A missing expected app is account readiness, not device health. It must not force ATTENTION.
    for (const packageName of await expectedPackages(device.id)) {
      const installed = await androidIdentity.appInstalled(serial, packageName).catch(() => null);
      if (installed === false) {
        appReason = `Android app ${packageName} is missing on this device; install it with the operator (RockBase never reinstalls it)`;
      }
    }
  }
  return { defect: false, kind: appReason ? 'app' : null, reason: null, appReason, guestVerified };
}

/**
 * Flag the accounts whose expected app is missing on their home device. Fail-closed and one-way: this
 * only ever downgrades HEALTHY to NEEDS_ATTENTION, never marks an account healthy again.
 */
async function flagAccountsForMissingApp(deviceId: string, reason: string): Promise<number> {
  const affected = await prisma.socialAccount.updateMany({
    where: { homeDeviceId: deviceId, executionEngine: 'android', platform: 'Instagram', androidHealth: 'HEALTHY' },
    data: { androidHealth: 'NEEDS_ATTENTION', androidHealthReason: reason },
  });
  if (affected.count) {
    logActivity({ type: 'android', entityType: 'android_device', entityId: deviceId, action: 'app-missing',
      status: 'attention', message: reason, metadata: { accounts: affected.count }, });
  }
  return affected.count;
}

const locks = new Set<string>();
const bootReservations = new Set<string>();

async function exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
  if (locks.has(id)) throw new Error('Device operation already in progress');
  locks.add(id);
  try { return await work(); } finally { locks.delete(id); }
}

export const androidDevices = {
  async list() {
    const devices = await prisma.androidDevice.findMany({ include: { _count: { select: { accounts: true } } }, orderBy: { name: 'asc' } });
    const untrusted: string[] = [];
    // Reconcile persisted state after an emulator or RockBase process was shut down elsewhere.
    for (const device of devices) {
      if (locks.has(device.id) || (device.status === 'BOOTING' && device.leaseOwner && device.leaseExpiresAt && device.leaseExpiresAt > new Date())) continue;
      try {
        const serial = await androidRuntime.resolveSerial(device.avdName);
        const ready = serial ? await androidRuntime.health(serial) : false;
        // Identity and expected-app defects outrank the cached status and are never ERROR: they need an
        // operator, not an automatic kill, and a BUSY device is left alone mid-run.
        const fitness = await deviceFitness(device, serial, Boolean(serial && ready));
        const status = fitness.defect && device.status !== 'BUSY' ? 'ATTENTION'
          : ['ATTENTION', 'ERROR'].includes(device.status) ? device.status
          : !serial ? 'OFFLINE' : ready ? (device.status === 'BUSY' ? 'BUSY' : 'READY') : 'BOOTING';
        const lastError = fitness.defect ? fitness.reason : fitness.appReason || device.lastError;
        if (device.status !== status || device.adbSerial !== serial || (fitness.defect && device.lastError !== lastError) || (fitness.appReason && device.lastError !== fitness.appReason)) {
          await prisma.androidDevice.update({ where: { id: device.id }, data: { status, adbSerial: serial, lastError, lastHealthcheckAt: new Date() } });
          device.status = status;
          device.adbSerial = serial;
          device.lastError = lastError;
        }
        if (fitness.appReason) await flagAccountsForMissingApp(device.id, fitness.appReason);
        if (status !== 'READY') untrusted.push(device.id);
      } catch (error: any) {
        device.status = 'ERROR';
        device.lastError = `ADB unavailable: ${error.message || String(error)}`;
        await prisma.androidDevice.update({ where: { id: device.id }, data: { status: 'ERROR', lastError: device.lastError } });
        untrusted.push(device.id);
      }
    }
    // A device that is not READY cannot be holding a live prepared screen: expire those holds so a
    // stale READY_FOR_REAL_POST never survives an offline runtime or a crashed RockBase process.
    if (untrusted.length) await preparedStates.expireForDevices(untrusted, 'runtime_lost');
    return devices;
  },

  async register(input: { name: string; avdName: string; ramMb?: number; cpuCores?: number }) {
    const name = String(input.name ?? '').trim();
    const avdName = String(input.avdName ?? '').trim();
    if (!name || name.length > 80 || !/^[\w.-]{1,80}$/.test(avdName)) throw new Error('Valid name and AVD name are required');
    const ramMb = input.ramMb ?? 2048;
    const cpuCores = input.cpuCores ?? 2;
    if (!Number.isSafeInteger(ramMb) || ramMb < 1024 || ramMb > 16384 || !Number.isSafeInteger(cpuCores) || cpuCores < 1 || cpuCores > 8) {
      throw new Error('RAM must be 1024–16384 MB and CPU cores 1–8');
    }
    if (!(await androidRuntime.listAvds()).includes(avdName)) throw new Error(`AVD ${avdName} not installed`);
    return prisma.androidDevice.create({ data: { name, avdName, ramMb, cpuCores } });
  },

  async refresh(id: string, clearAttention = false) {
    return exclusive(id, async () => {
      const device = await prisma.androidDevice.findUniqueOrThrow({ where: { id } });
      const serial = await androidRuntime.resolveSerial(device.avdName);
      const ready = serial ? await androidRuntime.health(serial) : false;
      // Identity and expected-app defects are real device state, so an explicit operator force cannot
      // clear them: force only clears a transient attention/error once the device is healthy again.
      const fitness = await deviceFitness(device, serial, Boolean(serial && ready));
      const forced = clearAttention && !fitness.defect;
      const status = fitness.defect && device.status !== 'BUSY' ? 'ATTENTION'
        : !forced && ['ATTENTION', 'ERROR'].includes(device.status) ? device.status
        : !serial ? 'OFFLINE' : !ready ? 'BOOTING' : device.status === 'BUSY' ? 'BUSY' : 'READY';
      const lastError = fitness.defect ? fitness.reason : fitness.appReason || (forced && ready ? null : device.lastError);
      if (fitness.appReason) await flagAccountsForMissingApp(id, fitness.appReason);
      const updated = await prisma.androidDevice.update({ where: { id }, data: { adbSerial: serial, status,
        lastError,
        identityError: fitness.defect && fitness.kind === 'identity' ? fitness.reason : null,
        identityVerifiedAt: fitness.guestVerified ? new Date() : device.identityVerifiedAt,
        lastHealthcheckAt: new Date() } });
      // A health check that finds the device offline/booting means the prepared screen is unverifiable.
      if (status !== 'READY') await preparedStates.expireForDevice(id, 'device_refreshed');
      return updated;
    });
  },

  async start(id: string, ownerId?: string) {
    return exclusive(id, async () => {
      const device = await prisma.androidDevice.findUniqueOrThrow({ where: { id } });
      if (!device.enabled) throw new Error('Device is disabled');
      if (device.leaseOwner && device.leaseExpiresAt && device.leaseExpiresAt > new Date() && device.leaseOwner !== ownerId) throw new Error('Device is leased by another job');
      const existing = await androidRuntime.resolveSerial(device.avdName);
      if (existing) throw new Error(`AVD already running as ${existing}; run Health Check`);
      // Identity decision before boot, with NO side effects: the host pin and the marker are only ever
      // committed after a boot actually happened and the guest proved the marker (see below). A start
      // that is refused or fails therefore never leaves a half-enrolled device behind.
      const decision = await androidIdentity.prepareBoot(device);
      if (!decision.ok || !decision.marker) {
        const reason = decision.reason || decision.verdict.detail;
        await prisma.androidDevice.update({ where: { id }, data: { status: 'ATTENTION', lastError: reason, identityError: reason } });
        logActivity({ type: 'android', entityType: 'android_device', entityId: id, action: 'identity-refused',
          status: 'attention', message: reason, metadata: { avd: device.avdName, state: decision.verdict.state } });
        return prisma.androidDevice.findUniqueOrThrow({ where: { id } });
      }
      // The AVD is not running, so any previously prepared screen is already gone: expire before boot.
      await preparedStates.expireForDevice(id, 'device_started');
      // Reservations are taken before the first await, including boots not yet visible to ADB.
      if (bootReservations.size >= androidMaxConcurrent()) throw new Error('Android boot slots are full');
      bootReservations.add(id);
      let bootAttempted = false;
      try {
        const running = await androidRuntime.connected();
        await prisma.$transaction(async (tx) => {
          const active = await tx.androidDevice.count({ where: { status: { in: ['BOOTING', 'READY', 'BUSY', 'ATTENTION'] } } });
          const represented = await tx.androidDevice.count({ where: { id: { in: [...bootReservations] }, status: { in: ['BOOTING', 'READY', 'BUSY', 'ATTENTION'] } } });
          if (Math.max(running.length, active) + bootReservations.size - represented > androidMaxConcurrent()) {
            throw new Error(`Android concurrent limit reached (${androidMaxConcurrent()})`);
          }
          // ATTENTION is an accepted starting point: a device left in ATTENTION (typically a missing
          // expected app) may still be booted and checked — the defect is re-detected after the boot.
          // This claim is also what protects enrollment: a stale row that is not claimable never boots,
          // so it never pins an identity either.
          const claimed = await tx.androidDevice.updateMany({ where: { id, status: { in: ['OFFLINE', 'ERROR', 'ATTENTION'] } }, data: { status: 'BOOTING', adbSerial: null, lastError: null } });
          if (claimed.count !== 1) throw new Error('Device is not startable');
        });
        bootAttempted = true;
        const serial = await androidRuntime.start(device.avdName, device.ramMb, device.cpuCores);
        // Guest after boot. On the enrolling boot the candidate marker is written and proven on the
        // device FIRST; only then is the identity committed to the registry. A device that has ever
        // verified is read-only here: a missing or different marker is a defect, never a regeneration.
        const guest = await androidIdentity.verifyGuest(serial, decision.marker,
          { bootstrap: decision.bootstrap, recovery: decision.recovery });
        if (!guest.ok) {
          const reason = `Device identity marker ${guest.state.toLowerCase()}: ${guest.detail}`;
          await prisma.androidDevice.update({ where: { id }, data: { status: 'ATTENTION', adbSerial: serial,
            lastBootAt: new Date(), lastHealthcheckAt: new Date(), lastError: reason, identityError: reason } });
          logActivity({ type: 'android', entityType: 'android_device', entityId: id, action: 'identity-marker',
            status: 'attention', message: reason, metadata: { avd: device.avdName, serial, state: guest.state } });
          return prisma.androidDevice.findUniqueOrThrow({ where: { id } });
        }
        if (decision.bootstrap && decision.identity) {
          await androidIdentity.commitEnrollment(prisma, id, decision.identity, decision.marker);
        }
        // A missing expected app is an operator task on the account, not a device defect.
        // The device stays READY so generic infrastructure jobs can boot and check identity.
        let appReason: string | null = null;
        for (const packageName of await expectedPackages(id)) {
          const installed = await androidIdentity.appInstalled(serial, packageName).catch(() => null);
          if (installed === false) appReason = `Android app ${packageName} is missing on this device; install it with the operator (RockBase never reinstalls it)`;
        }
        if (appReason) await flagAccountsForMissingApp(id, appReason);
        return prisma.androidDevice.update({ where: { id }, data: { status: 'READY',
          adbSerial: serial, lastBootAt: new Date(), lastHealthcheckAt: new Date(),
          identityVerifiedAt: new Date(), identityError: null, lastError: appReason } });
      } catch (error) {
        if (bootAttempted) {
          const serial = await androidRuntime.resolveSerial(device.avdName).catch(() => null);
          if (serial) await androidRuntime.stop(serial).catch(() => undefined);
          await prisma.androidDevice.update({ where: { id }, data: { status: 'ERROR', adbSerial: null } });
        }
        throw error;
      } finally {
        bootReservations.delete(id);
      }
    });
  },

  async stop(id: string, ownerId?: string, reason = 'operator') {
    return exclusive(id, async () => {
      const device = await prisma.androidDevice.findUniqueOrThrow({ where: { id } });
      if (device.status === 'BUSY') throw new Error('Device is busy; cannot stop an active job');
      if (device.leaseOwner && device.leaseExpiresAt && device.leaseExpiresAt > new Date() && device.leaseOwner !== ownerId) throw new Error('Device is leased by another job');
      const serial = await androidRuntime.resolveSerial(device.avdName);
      // Shutting the AVD down destroys whatever was on screen: no prepared hold may survive it.
      await preparedStates.expireForDevice(id, 'device_shutdown');
      if (serial) await androidRuntime.stop(serial);
      return prisma.androidDevice.update({ where: { id }, data: { status: 'OFFLINE', adbSerial: null, idleSince: null, lastShutdownReason: reason, lastHealthcheckAt: new Date() } });
    });
  },

  async restart(id: string) {
    await this.stop(id);
    return this.start(id);
  },

  async screenshot(id: string) {
    const device = await prisma.androidDevice.findUniqueOrThrow({ where: { id } });
    const serial = await androidRuntime.resolveSerial(device.avdName);
    if (!serial || !(await androidRuntime.health(serial))) throw new Error('Device is not booted and responsive');
    return androidRuntime.screenshot(serial);
  },
};

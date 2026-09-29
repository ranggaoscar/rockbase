import { PrismaClient } from '@prisma/client';
import { androidRuntime } from './AndroidRuntimeService';
import { AndroidPreparedStateService } from './AndroidPreparedStateService';

const prisma = new PrismaClient();
// A prepared screen lives only on a booted, READY device; every lifecycle transition below that
// destroys it (or makes it unverifiable) expires the hold through this service.
const preparedStates = new AndroidPreparedStateService(prisma);
export const androidMaxConcurrent = () => {
  const value = Number(process.env.ANDROID_MAX_CONCURRENT ?? 3);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('ANDROID_MAX_CONCURRENT must be a positive integer');
  return value;
};

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
        const status = ['ATTENTION', 'ERROR'].includes(device.status) ? device.status
          : !serial ? 'OFFLINE' : ready ? (device.status === 'BUSY' ? 'BUSY' : 'READY') : 'BOOTING';
        if (device.status !== status || device.adbSerial !== serial) {
          await prisma.androidDevice.update({ where: { id: device.id }, data: { status, adbSerial: serial, lastHealthcheckAt: new Date() } });
          device.status = status;
          device.adbSerial = serial;
        }
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
      const status = !clearAttention && ['ATTENTION', 'ERROR'].includes(device.status) ? device.status
        : !serial ? 'OFFLINE' : ready ? (device.status === 'BUSY' ? 'BUSY' : 'READY') : 'BOOTING';
      const updated = await prisma.androidDevice.update({ where: { id }, data: { adbSerial: serial, status,
        lastError: clearAttention && ready ? null : device.lastError, lastHealthcheckAt: new Date() } });
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
          const claimed = await tx.androidDevice.updateMany({ where: { id, status: { in: ['OFFLINE', 'ERROR'] } }, data: { status: 'BOOTING', adbSerial: null, lastError: null } });
          if (claimed.count !== 1) throw new Error('Device is not offline');
        });
        bootAttempted = true;
        const serial = await androidRuntime.start(device.avdName, device.ramMb, device.cpuCores);
        return prisma.androidDevice.update({ where: { id }, data: { status: 'READY', adbSerial: serial, lastBootAt: new Date(), lastHealthcheckAt: new Date() } });
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

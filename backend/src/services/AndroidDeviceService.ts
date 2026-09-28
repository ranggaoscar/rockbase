import { PrismaClient } from '@prisma/client';
import { androidRuntime } from './AndroidRuntimeService';

const prisma = new PrismaClient();
export const androidMaxConcurrent = () => {
  const value = Number(process.env.ANDROID_MAX_CONCURRENT ?? 3);
  if (!Number.isSafeInteger(value) || value < 1 || value > 25) throw new Error('ANDROID_MAX_CONCURRENT must be an integer between 1 and 25');
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
    // Reconcile persisted state after an emulator or RockBase process was shut down elsewhere.
    for (const device of devices) {
      if (locks.has(device.id)) continue;
      const serial = await androidRuntime.resolveSerial(device.avdName);
      const ready = serial ? await androidRuntime.health(serial) : false;
      const status = !serial ? 'OFFLINE' : ready ? (device.status === 'BUSY' ? 'BUSY' : 'READY') : 'BOOTING';
      if (device.status !== status || device.adbSerial !== serial) {
        await prisma.androidDevice.update({ where: { id: device.id }, data: { status, adbSerial: serial, lastHealthcheckAt: new Date() } });
        device.status = status;
        device.adbSerial = serial;
      }
    }
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

  async refresh(id: string) {
    return exclusive(id, async () => {
      const device = await prisma.androidDevice.findUniqueOrThrow({ where: { id } });
      const serial = await androidRuntime.resolveSerial(device.avdName);
      const ready = serial ? await androidRuntime.health(serial) : false;
      const status = !serial ? 'OFFLINE' : ready ? (device.status === 'BUSY' ? 'BUSY' : 'READY') : 'BOOTING';
      return prisma.androidDevice.update({ where: { id }, data: { adbSerial: serial, status, lastHealthcheckAt: new Date() } });
    });
  },

  async start(id: string) {
    return exclusive(id, async () => {
      const device = await prisma.androidDevice.findUniqueOrThrow({ where: { id } });
      if (!device.enabled) throw new Error('Device is disabled');
      const existing = await androidRuntime.resolveSerial(device.avdName);
      if (existing) throw new Error(`AVD already running as ${existing}; run Health Check`);
      // Reservations are taken before the first await, including boots not yet visible to ADB.
      if (bootReservations.size >= androidMaxConcurrent()) throw new Error('Android boot slots are full');
      bootReservations.add(id);
      let bootAttempted = false;
      try {
        const running = await androidRuntime.connected();
        const booting = await prisma.androidDevice.count({ where: { status: 'BOOTING' } });
        if (Math.max(running.length, booting) + bootReservations.size > androidMaxConcurrent()) {
          throw new Error(`Android concurrent limit reached (${androidMaxConcurrent()})`);
        }
        await prisma.androidDevice.update({ where: { id }, data: { status: 'BOOTING', adbSerial: null } });
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

  async stop(id: string) {
    return exclusive(id, async () => {
      const device = await prisma.androidDevice.findUniqueOrThrow({ where: { id } });
      if (device.status === 'BUSY') throw new Error('Device is busy; cannot stop an active job');
      const serial = await androidRuntime.resolveSerial(device.avdName);
      if (serial) await androidRuntime.stop(serial);
      return prisma.androidDevice.update({ where: { id }, data: { status: 'OFFLINE', adbSerial: null, lastHealthcheckAt: new Date() } });
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

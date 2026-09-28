import assert from 'assert/strict';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import androidJobRoutes from '../routes/androidJobRoutes';
import androidDeviceRoutes from '../routes/androidDeviceRoutes';
import { startAndroidQueueWorker, closeAndroidQueueWorker } from '../queue/androidDeviceWorker';
import { androidDevices } from '../services/AndroidDeviceService';
import { androidRuntime } from '../services/AndroidRuntimeService';
import { androidScheduler } from '../services/AndroidScheduler';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch') || process.env.REDIS_PORT !== '16379') throw new Error('Local Mode + scratch DB + isolated Redis 16379 required');
  const avdName = process.env.ROCKBASE_AVD_NAME;
  if (!avdName || await androidRuntime.resolveSerial(avdName)) throw new Error('AVD must be offline');
  const prisma = new PrismaClient();
  const workspace = await prisma.workspace.create({ data: { name: 'Android queue smoke workspace' } });
  const device = await androidDevices.register({ name: 'RockDroid-Queue-Smoke', avdName, ramMb: 2048, cpuCores: 2 });
  const account = await prisma.socialAccount.create({ data: { workspaceId: workspace.id, username: 'synthetic-queue-no-login', platform: 'Instagram', executionEngine: 'android', homeDeviceId: device.id } });
  const app = express(); app.use(express.json()); app.use(authenticateToken);
  app.use('/api/android/jobs', androidJobRoutes); app.use('/api/android/devices', androidDeviceRoutes);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
    const base = `http://127.0.0.1:${address.port}/api/android`;
    startAndroidQueueWorker();
    const submit = async () => {
      const response = await fetch(`${base}/jobs/smoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: account.id }) });
      const body = await response.text();
      assert.equal(response.status, 202, body.slice(0, 200));
      return JSON.parse(body);
    };
    const wait = async (jobId: string) => {
      for (let i = 0; i < 120; i++) {
        const response = await fetch(`${base}/jobs/${jobId}`);
        const job = (await response.json() as any).job;
        if (['COMPLETED', 'FAILED', 'SKIPPED', 'INTERRUPTED'].includes(job.status)) return job;
        await delay(1000);
      }
      throw new Error(`Job ${jobId} did not finish`);
    };
    const first = await submit();
    const firstResult = await wait(first.job.id);
    assert.equal(firstResult.status, 'COMPLETED', firstResult.reason);
    const bootAt = (await prisma.androidDevice.findUniqueOrThrow({ where: { id: device.id } })).lastBootAt?.getTime();
    const second = await submit();
    const secondResult = await wait(second.job.id);
    assert.equal(secondResult.status, 'COMPLETED', secondResult.reason);
    assert.equal((await prisma.androidDevice.findUniqueOrThrow({ where: { id: device.id } })).lastBootAt?.getTime(), bootAt);
    await prisma.androidDevice.update({ where: { id: device.id }, data: { idleSince: new Date(Date.now() - 31 * 60_000) } });
    assert.equal(await androidScheduler.sweepIdle(), 1);
    const overview = await fetch(`${base}/devices`);
    const state = await overview.json() as any;
    assert.equal(state.devices.find((item: any) => item.id === device.id)?.status, 'OFFLINE');
    console.log(JSON.stringify({ status: 'PASS', jobs: [firstResult.status, secondResult.status], queueApi: true, reused: true, stopped: true,
      screenshotBytes: firstResult.result?.screenshotBytes, running: state.running }));
  } finally {
    const serial = await androidRuntime.resolveSerial(avdName).catch(() => null);
    if (serial) await androidRuntime.stop(serial);
    await closeAndroidQueueWorker();
    server.close();
    await prisma.androidJob.deleteMany({ where: { deviceId: device.id } });
    await prisma.socialAccount.delete({ where: { id: account.id } });
    await prisma.androidDevice.delete({ where: { id: device.id } });
    await delay(200); await prisma.activityLog.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });

import assert from 'assert';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import androidRoutes from '../routes/androidDeviceRoutes';
import { androidRuntime } from '../services/AndroidRuntimeService';

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) throw new Error('Use Local Mode + scratch database');
  const avdName = process.env.ROCKBASE_AVD_NAME;
  if (!avdName || !(await androidRuntime.listAvds()).includes(avdName) || await androidRuntime.resolveSerial(avdName)) throw new Error('AVD must exist and be offline before test');
  const prisma = new PrismaClient();
  const app = express();
  app.use(express.json()); app.use(authenticateToken); app.use('/api/android/devices', androidRoutes);
  const server = app.listen(0, '127.0.0.1');
  let deviceId: string | null = null;
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Listener failed');
    const base = `http://127.0.0.1:${address.port}/api/android/devices`;
    const create = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'RockDroid-Smoke', avdName, ramMb: 2048, cpuCores: 2 }) });
    if (create.status !== 201) throw new Error(`Registration: ${create.status} ${await create.text()}`);
    deviceId = (await create.json() as any).device.id;
    const started = await fetch(`${base}/${deviceId}/start`, { method: 'POST' });
    if (!started.ok) throw new Error(`Start: ${started.status} ${await started.text()}`);
    assert.strictEqual((await started.json() as any).device.status, 'READY');
    const health = await fetch(`${base}/${deviceId}/health`, { method: 'POST' });
    assert.strictEqual((await health.json() as any).device.status, 'READY');
    const screenshot = await fetch(`${base}/${deviceId}/screenshot`);
    const image = Buffer.from(await screenshot.arrayBuffer());
    assert.strictEqual(screenshot.status, 200);
    assert.strictEqual(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const stopped = await fetch(`${base}/${deviceId}/stop`, { method: 'POST' });
    assert.strictEqual((await stopped.json() as any).device.status, 'OFFLINE');
    console.log(JSON.stringify({ status: 'PASS', avdName, screenshotBytes: image.length, endpoints: ['register', 'start', 'health', 'screenshot', 'stop'] }));
  } finally {
    if (deviceId) {
      const serial = await androidRuntime.resolveSerial(avdName).catch(() => null);
      if (serial) await androidRuntime.stop(serial);
      await prisma.androidDevice.delete({ where: { id: deviceId } });
    }
    server.close(); await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });

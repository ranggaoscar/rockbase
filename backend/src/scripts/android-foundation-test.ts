import assert from 'assert';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import androidRoutes from '../routes/androidDeviceRoutes';
import { androidRuntime } from '../services/AndroidRuntimeService';
import { androidMaxConcurrent } from '../services/AndroidDeviceService';
import { resolveExecutionEngine, requireChromiumEngine } from '../services/ExecutionEngine';
import { authenticateToken } from '../middleware/auth';

async function main() {
  assert.strictEqual(process.env.ROCKBASE_MODE, 'local');
  assert.ok(process.env.DATABASE_URL?.includes('scratch'), 'Use a scratch database, never live data');
  assert.strictEqual(androidMaxConcurrent(), 3);
  assert.strictEqual(resolveExecutionEngine({}), 'chromium');
  requireChromiumEngine({ executionEngine: 'chromium' });
  assert.throws(() => requireChromiumEngine({ executionEngine: 'android' }), /NOT_IMPLEMENTED/);

  const prisma = new PrismaClient();
  const avds = androidRuntime.listAvds;
  const resolve = androidRuntime.resolveSerial;
  androidRuntime.listAvds = async () => ['test-avd'];
  androidRuntime.resolveSerial = async () => null;
  const app = express();
  app.use(express.json());
  app.use(authenticateToken);
  app.use('/api/android/devices', androidRoutes);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No HTTP listener');
    const base = `http://127.0.0.1:${address.port}/api/android/devices`;
    const create = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'test-device', avdName: 'test-avd' }) });
    assert.strictEqual(create.status, 201);
    const device = (await create.json() as any).device;
    assert.strictEqual(device.status, 'OFFLINE');
    assert.strictEqual(device.ramMb, 2048);
    const list = await fetch(base);
    assert.strictEqual(list.status, 200);
    assert.strictEqual((await list.json() as any).devices.length, 1);
    const health = await fetch(`${base}/${device.id}/health`, { method: 'POST' });
    assert.strictEqual(health.status, 200);
    assert.strictEqual((await health.json() as any).device.status, 'OFFLINE');
    const invalid = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'invalid', avdName: 'missing' }) });
    assert.strictEqual(invalid.status, 409);
    const account = await prisma.socialAccount.create({ data: { username: 'test-local-only', platform: 'Instagram', workspace: { create: { name: 'test-workspace' } } } });
    assert.strictEqual(account.executionEngine, 'chromium');
    assert.strictEqual(account.homeDeviceId, null);
    console.log('PASS: default Chromium, registry API, health state, invalid AVD, concurrency default');
  } finally {
    server.close();
    androidRuntime.listAvds = avds;
    androidRuntime.resolveSerial = resolve;
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });

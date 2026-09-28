/**
 * Phase 3B — identity verification endpoint wiring test (real AVD, no Instagram install needed).
 *
 * Mounts the real account route and checks the fail-closed wiring of
 * POST /api/accounts/:id/android/verify-identity:
 *   - offline home device → 409 asking the operator to start it
 *   - online device without the official Instagram app → 409 "not installed"
 * The authenticated happy path requires the real app + manual login and is exercised by the
 * operator run (see working/android-instagram-ui-notes.md).
 */
import assert from 'assert/strict';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import accountRoutes from '../routes/accountRoutes';
import { androidRuntime } from '../services/AndroidRuntimeService';

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) throw new Error('Scratch DB + Local Mode required');
  const prisma = new PrismaClient();
  await prisma.workspace.upsert({ where: { id: 'workspace-default' }, update: {}, create: { id: 'workspace-default', name: 'Default' } });
  const avd = process.env.ROCKBASE_AVD_NAME || 'Medium_Phone_API_36.1';
  const online = Boolean(await androidRuntime.resolveSerial(avd));
  // Scratch DB only: clear leftover test devices that reuse these AVD names (unique column).
  const staleDevices = await prisma.androidDevice.findMany({ where: { avdName: { in: [avd, 'No-Such-AVD'] } }, select: { id: true } });
  const staleIds = staleDevices.map((item) => item.id);
  await prisma.androidJob.deleteMany({ where: { deviceId: { in: staleIds } } });
  await prisma.socialAccount.deleteMany({ where: { homeDeviceId: { in: staleIds } } });
  await prisma.androidDevice.deleteMany({ where: { id: { in: staleIds } } });
  const device = await prisma.androidDevice.create({ data: { name: `Identity-Test-${Date.now()}`, avdName: online ? avd : 'No-Such-AVD', status: 'READY' } });
  const account = await prisma.socialAccount.create({ data: { workspaceId: 'workspace-default', platform: 'Instagram',
    username: 'identity.wiring.test', executionEngine: 'android', homeDeviceId: device.id,
    androidHealth: 'NEEDS_ATTENTION', androidHealthReason: 'test fixture' } });
  const app = express(); app.use(express.json()); app.use(authenticateToken); app.use('/api/accounts', accountRoutes);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('Listener failed');
    const url = `http://127.0.0.1:${addr.port}/api/accounts/${account.id}/android/verify-identity`;
    const verify = () => fetch(url, { method: 'POST' });

    // 1. Non-Android account → 400.
    const chromium = await prisma.socialAccount.create({ data: { workspaceId: 'workspace-default', platform: 'Instagram', username: 'chromium.identity.test', executionEngine: 'chromium' } });
    const wrong = await fetch(`http://127.0.0.1:${addr.port}/api/accounts/${chromium.id}/android/verify-identity`, { method: 'POST' });
    assert.equal(wrong.status, 400);

    // 2. Android account whose home device is offline → 409 with operator instruction.
    await prisma.androidDevice.update({ where: { id: device.id }, data: { avdName: 'Definitely-Offline-AVD' } });
    const offline = await verify();
    assert.equal(offline.status, 409);
    assert.match(((await offline.json()) as any).error, /Start the home device/);

    if (online) {
      // 3. Device online but Instagram not installed → 409 "not installed" (no guessed UI work).
      await prisma.androidDevice.update({ where: { id: device.id }, data: { avdName: avd } });
      const notInstalled = await verify();
      assert.equal(notInstalled.status, 409);
      assert.match(((await notInstalled.json()) as any).error, /not installed/);
    }
    console.log(JSON.stringify({ status: 'PASS', onlineDevicePath: online, checks: online ? 3 : 2 }));
  } finally {
    server.close();
    await prisma.socialAccount.deleteMany({ where: { id: { in: [account.id] } } });
    await prisma.socialAccount.deleteMany({ where: { username: 'chromium.identity.test' } });
    await prisma.androidDevice.delete({ where: { id: device.id } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

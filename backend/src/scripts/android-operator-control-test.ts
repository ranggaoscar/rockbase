import assert from 'assert/strict';
import { execFileSync } from 'child_process';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';
import deviceRoutes from '../routes/androidDeviceRoutes';
import { androidDevices } from '../services/AndroidDeviceService';
import { androidRuntime } from '../services/AndroidRuntimeService';
import { AndroidDeviceLeaseService } from '../services/AndroidDeviceLeaseService';

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) throw new Error('Scratch DB + Local Mode required');
  const avd = 'Medium_Phone_API_36.1';
  if (await androidRuntime.resolveSerial(avd)) throw new Error('Test AVD must be offline');
  const prisma = new PrismaClient();
  const device = await androidDevices.register({ name: 'RockBase-Operator-Test', avdName: avd });
  const app = express(); app.use(express.json()); app.use(authenticateToken); app.use('/api/android/devices', deviceRoutes);
  const server = app.listen(0, '127.0.0.1');
  let bootMs = 0;
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('Listener failed');
    const base = `http://127.0.0.1:${addr.port}/api/android/devices/${device.id}`;
    const control = (payload: object) => fetch(base + '/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal((await control({ action: 'home' })).status, 409);
    const bootStarted = Date.now();
    await androidDevices.start(device.id);
    bootMs = Date.now() - bootStarted;
    assert.equal((await control({ action: 'wake' })).status, 200);
    assert.equal((await control({ action: 'home' })).status, 200);
    const screenshot = await fetch(base + '/screenshot');
    assert.equal(screenshot.status, 200);
    const image = Buffer.from(await screenshot.arrayBuffer());
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
    assert.equal((await control({ action: 'tap', x: 100000, y: 2 })).status, 409);
    assert.equal((await control({ action: 'tap', x: 500, y: 1000 })).status, 200);
    const lease = await new AndroidDeviceLeaseService(prisma).acquire(device.id, 'synthetic-job');
    assert.ok(lease);
    assert.equal((await control({ action: 'back' })).status, 409);
    await lease!.release();
    assert.equal((await control({ action: 'back' })).status, 200);
    const installed = await androidRuntime.packageInstalled((await prisma.androidDevice.findUniqueOrThrow({ where: { id: device.id } })).adbSerial!, 'com.instagram.android');
    if (!installed) {
      const unavailable = await control({ action: 'open-instagram' });
      assert.equal(unavailable.status, 409);
      assert.match((await unavailable.json() as any).error, /not installed/);
    }
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "@(Get-Process | Where-Object ProcessName -Match 'qemu|emulator' | Select-Object ProcessName,WorkingSet64) | ConvertTo-Json -Compress"], { encoding: 'utf8' }).trim();
    const parsed = JSON.parse(raw) as Array<{ WorkingSet64: number }> | { WorkingSet64: number };
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    const ramMiB = Number((processes.reduce((sum, item) => sum + item.WorkingSet64, 0) / 1048576).toFixed(1));
    console.log(JSON.stringify({ status: 'PASS', bootMs, observedWorkingSetMiB: ramMiB, screenshotBytes: image.length, instagramInstalled: installed, leaseBlocked: true, outOfBoundsBlocked: true }));
  } finally {
    const serial = await androidRuntime.resolveSerial(avd).catch(() => null);
    if (serial) await androidRuntime.stop(serial);
    server.close();
    await prisma.androidDevice.delete({ where: { id: device.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });

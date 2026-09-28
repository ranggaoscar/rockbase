import assert from 'assert/strict';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { androidRuntime } from '../services/AndroidRuntimeService';
import { androidDevices } from '../services/AndroidDeviceService';
import { AndroidScheduler } from '../services/AndroidScheduler';

async function main() {
  if (!process.env.DATABASE_URL?.includes('scratch')) throw new Error('Refusing live database');
  const avdName = process.env.ROCKBASE_AVD_NAME;
  if (!avdName || !(await androidRuntime.listAvds()).includes(avdName) || await androidRuntime.resolveSerial(avdName)) throw new Error('Expected an installed, offline, operator-approved AVD');
  process.env.ANDROID_MAX_CONCURRENT = '3';
  process.env.ANDROID_IDLE_GRACE_MINUTES = '0';
  const prisma = new PrismaClient();
  const scheduler = new AndroidScheduler(prisma);
  const workspace = await prisma.workspace.create({ data: { name: 'Android smoke isolated workspace' } });
  const device = await androidDevices.register({ name: 'RockDroid-Phase2-Smoke', avdName, ramMb: 2048, cpuCores: 2 });
  const account = await prisma.socialAccount.create({ data: { workspaceId: workspace.id, platform: 'Instagram', username: 'rockbase-synthetic-no-login', executionEngine: 'android', homeDeviceId: device.id } });
  let booted = false;
  try {
    const first = await scheduler.submit(account.id);
    const started = Date.now();
    const firstResult = await scheduler.run(first.id);
    assert.equal(firstResult.status, 'COMPLETED', firstResult.reason);
    booted = true;
    const firstBootMs = Date.now() - started;
    const bootAt = (await prisma.androidDevice.findUniqueOrThrow({ where: { id: device.id } })).lastBootAt?.getTime();
    const second = await scheduler.submit(account.id);
    const secondStarted = Date.now();
    const secondResult = await scheduler.run(second.id);
    const reuseActionMs = Date.now() - secondStarted;
    assert.equal(secondResult.status, 'COMPLETED', secondResult.reason);
    const reused = bootAt === (await prisma.androidDevice.findUniqueOrThrow({ where: { id: device.id } })).lastBootAt?.getTime();
    assert.equal(reused, true);
    await new Promise(resolve => setTimeout(resolve, 8000));
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-Process | Where-Object ProcessName -Match 'qemu|emulator' | Select-Object ProcessName,Id,WorkingSet64 | ConvertTo-Json -Compress"], { encoding: 'utf8' }).trim();
    const processes = JSON.parse(raw) as Array<{ ProcessName: string; WorkingSet64: number }>;
    const ramMiB = Number((processes.reduce((sum, item) => sum + item.WorkingSet64, 0) / 1048576).toFixed(1));
    const shutdownStarted = Date.now();
    assert.equal(await scheduler.sweepIdle(), 1);
    const shutdownMs = Date.now() - shutdownStarted;
    booted = false;
    const saved = await prisma.androidJob.findMany({ where: { id: { in: [first.id, second.id] } }, select: { status: true, result: true } });
    assert.ok(saved.every(item => item.status === 'COMPLETED'));
    console.log(JSON.stringify({ status: 'PASS', avdName, firstBootAndActionMs: firstBootMs, reused,
      reuseActionMs, settledRamMiB: ramMiB,
      screenshotBytes: firstResult.result?.screenshotBytes, shutdownMs, deviceAfter: (await prisma.androidDevice.findUniqueOrThrow({ where: { id: device.id } })).status }));
  } finally {
    if (booted) {
      const serial = await androidRuntime.resolveSerial(avdName).catch(() => null);
      if (serial) await androidRuntime.stop(serial);
    }
    await prisma.androidJob.deleteMany({ where: { deviceId: device.id } });
    await prisma.socialAccount.delete({ where: { id: account.id } });
    await prisma.androidDevice.delete({ where: { id: device.id } });
    await new Promise(resolve => setTimeout(resolve, 200));
    await prisma.activityLog.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });

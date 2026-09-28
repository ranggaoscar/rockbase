import assert from 'assert/strict';
import { PrismaClient, SocialAccount, AndroidDevice } from '@prisma/client';
import { androidRuntime } from '../services/AndroidRuntimeService';
import { androidDevices } from '../services/AndroidDeviceService';
import { AndroidDeviceLeaseService } from '../services/AndroidDeviceLeaseService';
import { AndroidScheduler } from '../services/AndroidScheduler';

async function main() {
  assert.ok(process.env.DATABASE_URL?.includes('scratch'), 'Refuse real database');
  process.env.ANDROID_MAX_CONCURRENT = '1';
  process.env.ANDROID_IDLE_GRACE_MINUTES = '0';
  const prisma = new PrismaClient();
  const original = { connected: androidRuntime.connected, resolveSerial: androidRuntime.resolveSerial,
    health: androidRuntime.health, start: androidRuntime.start, stop: androidRuntime.stop,
    screenshot: androidRuntime.screenshot, listAvds: androidRuntime.listAvds };
  const running = new Map<string, string>();
  let boots = 0, stops = 0, bootFail = false, adbFail = false;
  androidRuntime.connected = async () => [...running.values()];
  androidRuntime.resolveSerial = async (avd: string) => running.get(avd) || null;
  androidRuntime.health = async (_serial: string) => !adbFail;
  androidRuntime.listAvds = async () => ['avd-one', 'avd-two', 'avd-three', 'avd-four'];
  androidRuntime.start = async (avd: string) => { if (bootFail) throw new Error('simulated boot failure'); boots++; const serial = `emulator-${5554 + boots * 2}`; running.set(avd, serial); return serial; };
  androidRuntime.stop = async (serial: string) => { for (const [avd, value] of running) if (value === serial) running.delete(avd); stops++; };
  androidRuntime.screenshot = async () => Buffer.from('fake-png-data');
  let workspaceId: string | null = null;
  const devices: AndroidDevice[] = [];
  try {
    const workspace = await prisma.workspace.create({ data: { name: 'Phase 2 test workspace' } });
    workspaceId = workspace.id;
    const accounts: SocialAccount[] = [];
    for (const [index, avd] of ['avd-one', 'avd-two', 'avd-three', 'avd-four'].entries()) {
      const device = await prisma.androidDevice.create({ data: { name: `test-device-${index}`, avdName: avd } });
      const account = await prisma.socialAccount.create({ data: { workspaceId: workspace.id, platform: 'Instagram', username: `test-android-${index}`, executionEngine: 'android', homeDeviceId: device.id } });
      devices.push(device); accounts.push(account);
    }
    const scheduler = new AndroidScheduler(prisma);
    const leaseService = new AndroidDeviceLeaseService(prisma, 1000, 0);
    const invalid = await prisma.socialAccount.create({ data: { workspaceId: workspace.id, platform: 'Instagram', username: 'invalid-android', executionEngine: 'android' } });
    await assert.rejects(() => scheduler.submit(invalid.id), /valid home device/);
    const chromium = await prisma.socialAccount.create({ data: { workspaceId: workspace.id, platform: 'Instagram', username: 'existing-chromium' } });
    assert.equal(chromium.executionEngine, 'chromium');
    await assert.rejects(() => scheduler.submit(chromium.id), /valid home device/);

    const first = await scheduler.submit(accounts[0].id);
    const externalLease = await leaseService.acquire(devices[0].id, 'other-job');
    assert.ok(externalLease);
    assert.equal((await scheduler.run(first.id)).status, 'WAITING');
    await externalLease.release();
    assert.equal((await scheduler.run(first.id)).status, 'COMPLETED');
    const second = await scheduler.submit(accounts[0].id);
    assert.equal((await scheduler.run(second.id)).status, 'COMPLETED');
    assert.equal(boots, 1, 'same-device job reuses running emulator');
    const other = await scheduler.submit(accounts[1].id);
    assert.equal((await scheduler.run(other.id)).status, 'WAITING', 'second device waits with maxConcurrent=1');
    await prisma.androidDevice.update({ where: { id: devices[0].id }, data: { idleSince: new Date(Date.now() - 5000) } });
    assert.equal(await scheduler.sweepIdle(), 1);
    assert.equal((await scheduler.run(other.id)).status, 'COMPLETED');
    assert.equal(boots, 2);
    assert.equal(stops, 1);

    // New same-device QUEUED job cancels idle shutdown, then reuses the existing boot.
    await prisma.androidDevice.update({ where: { id: devices[1].id }, data: { idleSince: new Date(Date.now() - 5000) } });
    const queued = await scheduler.submit(accounts[1].id);
    assert.equal(await scheduler.sweepIdle(), 0);
    assert.equal((await scheduler.run(queued.id)).status, 'COMPLETED');
    assert.equal(boots, 2);

    const interruptedJob = await prisma.androidJob.create({ data: { accountId: accounts[1].id, deviceId: devices[1].id, status: 'RUNNING' } });
    const stale = await leaseService.acquire(devices[1].id, interruptedJob.id);
    assert.ok(stale);
    await prisma.androidDevice.update({ where: { id: devices[1].id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await scheduler.reconcile(), 1);
    assert.equal((await prisma.androidDevice.findUniqueOrThrow({ where: { id: devices[1].id } })).status, 'ATTENTION');
    assert.equal((await prisma.androidJob.findUniqueOrThrow({ where: { id: interruptedJob.id } })).status, 'INTERRUPTED');
    assert.equal(await stale.release(), false, 'old owner cannot release recovered lease');
    await androidDevices.stop(devices[1].id);
    await assert.rejects(() => scheduler.submit('not-an-account'), /Account not found/);

    await prisma.androidDevice.update({ where: { id: devices[2].id }, data: { enabled: false } });
    await assert.rejects(() => scheduler.submit(accounts[2].id), /disabled/);
    await prisma.androidDevice.update({ where: { id: devices[2].id }, data: { enabled: true } });
    bootFail = true;
    const failJob = await scheduler.submit(accounts[2].id);
    assert.equal((await scheduler.run(failJob.id)).status, 'FAILED');
    assert.match((await prisma.androidJob.findUniqueOrThrow({ where: { id: failJob.id } })).reason || '', /boot failure/);
    bootFail = false;
    await prisma.androidDevice.update({ where: { id: devices[2].id }, data: { status: 'OFFLINE' } });
    adbFail = true;
    const adbJob = await scheduler.submit(accounts[2].id);
    assert.equal((await scheduler.run(adbJob.id)).status, 'FAILED');
    adbFail = false;
    await prisma.socialAccount.update({ where: { id: accounts[3].id }, data: { androidHealth: 'NEEDS_ATTENTION', androidHealthReason: 'operator review' } });
    await assert.rejects(() => scheduler.submit(accounts[3].id), /NEEDS_ATTENTION/);
    // Four distinct devices contend for three running slots.
    running.clear();
    process.env.ANDROID_MAX_CONCURRENT = '3';
    await prisma.androidDevice.updateMany({ data: { status: 'OFFLINE', adbSerial: null, leaseOwner: null, leaseJobId: null,
      leaseExpiresAt: null, leaseHeartbeatAt: null, idleSince: null, lastError: null } });
    await prisma.socialAccount.update({ where: { id: accounts[3].id }, data: { androidHealth: 'HEALTHY', androidHealthReason: null } });
    for (const account of accounts.slice(0, 3)) {
      const job = await scheduler.submit(account.id);
      assert.equal((await scheduler.run(job.id)).status, 'COMPLETED');
    }
    assert.equal(running.size, 3);
    const fourth = await scheduler.submit(accounts[3].id);
    assert.equal((await scheduler.run(fourth.id)).status, 'WAITING');
    assert.equal(running.size, 3);
    await prisma.androidDevice.update({ where: { id: devices[0].id }, data: { idleSince: new Date(Date.now() - 5000) } });
    assert.ok(await scheduler.sweepIdle() >= 1);
    assert.equal((await scheduler.run(fourth.id)).status, 'COMPLETED');
    assert.ok(running.size <= 3);
    console.log('PASS Phase2: lease exclusion/recovery, binding, max=1 and 4-for-3 waits, boot/reuse, grace shutdown/cancel, boot+ADB failure, disabled/attention, Chromium');
  } finally {
    Object.assign(androidRuntime, original);
    if (workspaceId) {
      await new Promise(resolve => setTimeout(resolve, 200));
      await prisma.androidJob.deleteMany({ where: { account: { workspaceId } } });
      await prisma.socialAccount.deleteMany({ where: { workspaceId } });
      await prisma.androidDevice.deleteMany({ where: { id: { in: devices.map(device => device.id) } } });
      await prisma.activityLog.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
    }
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 });

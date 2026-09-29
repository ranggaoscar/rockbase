/**
 * Android prepared-state lifecycle tests (Phase 3D).
 *
 * Covers the READY_FOR_REAL_POST -> PREPARATION_EXPIRED lifecycle owned by
 * AndroidPreparedStateService, plus its wiring into AndroidDeviceService (start / stop / refresh /
 * list) and AndroidScheduler (hold sweep + runtime loss). Everything is hermetic: the ADB runtime is
 * mocked, so no emulator, no Instagram and no network are touched. The Prisma client talks only to a
 * scratch SQLite database.
 *
 * Scratch DB must be migrated first:  npx prisma migrate deploy
 * Run: DATABASE_URL=file:<scratch>/rockbase-prepared-lifecycle.db ROCKBASE_MODE=local \
 *      npx ts-node --files src/scripts/android-prepared-lifecycle-test.ts
 */
import assert from 'assert/strict';
import { PrismaClient } from '@prisma/client';
import { androidRuntime } from '../services/AndroidRuntimeService';
import { androidDevices } from '../services/AndroidDeviceService';
import { AndroidDeviceLeaseService } from '../services/AndroidDeviceLeaseService';
import { AndroidScheduler } from '../services/AndroidScheduler';
import {
  AndroidPreparedStateService, PREPARATION_EXPIRED, READY_FOR_REAL_POST,
  isHoldClosed, isSafeToExpire, preparedHoldUntil,
} from '../services/AndroidPreparedStateService';

const AVD = 'prepared-lifecycle-avd';
const prisma = new PrismaClient();
const service = new AndroidPreparedStateService(prisma);

// ── mocked ADB runtime: `running` maps avdName -> serial, which is the whole "is the AVD up" state ──
const running = new Map<string, string>();
let adbDown = false;
const originalRuntime = {
  connected: androidRuntime.connected, resolveSerial: androidRuntime.resolveSerial,
  health: androidRuntime.health, start: androidRuntime.start, stop: androidRuntime.stop,
  screenshot: androidRuntime.screenshot, listAvds: androidRuntime.listAvds,
};
const installRuntime = () => {
  androidRuntime.connected = async () => [...running.values()];
  androidRuntime.resolveSerial = async (avd: string) => running.get(avd) ?? null;
  androidRuntime.health = async () => !adbDown;
  androidRuntime.listAvds = async () => [AVD];
  androidRuntime.start = async (avd: string) => { const serial = `emulator-${5554 + running.size * 2}`; running.set(avd, serial); return serial; };
  androidRuntime.stop = async (serial: string) => { for (const [avd, value] of running) if (value === serial) running.delete(avd); };
  androidRuntime.screenshot = async () => Buffer.from('fake-png');
};

let deviceId = '';
let nameSeq = 0;
async function reset() {
  await prisma.androidJob.deleteMany({});
  await prisma.socialAccount.deleteMany({});
  await prisma.androidDevice.deleteMany({});
  await prisma.activityLog.deleteMany({});
  await prisma.workspace.upsert({ where: { id: 'workspace-default' }, update: {}, create: { id: 'workspace-default', name: 'Default' } });
  const device = await prisma.androidDevice.create({ data: { name: `prep-lifecycle-${++nameSeq}-${Date.now()}`, avdName: AVD, status: 'READY' } });
  deviceId = device.id;
  running.clear();
  running.set(AVD, 'emulator-5554'); // device booted by default
  adbDown = false;
}

async function account(health = 'HEALTHY') {
  const suffix = `${nameSeq}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.socialAccount.create({ data: {
    workspaceId: 'workspace-default', platform: 'Instagram', username: `prep-${suffix}`,
    executionEngine: 'android', homeDeviceId: deviceId, androidHealth: health,
    androidVerifiedUsername: `prep-${suffix}`, androidLastVerifiedAt: new Date(),
  } });
}

const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 30 * 60_000);

async function preparedJob(accountId: string, opts: { until?: Date | null; result?: Record<string, unknown>; extra?: Record<string, unknown> } = {}) {
  const until = opts.until === undefined ? future() : opts.until;
  const result = opts.result ?? {
    preparedAt: new Date().toISOString(), detectedUsername: 'prep-test', selectedImageCount: 1,
    captionVerified: true, shareInvocationCount: 0, publishApproved: false,
    hold: until ? { until: until.toISOString(), minutes: 30 } : undefined,
  };
  return prisma.androidJob.create({ data: {
    accountId, deviceId, type: 'ANDROID_IMAGE_POST', status: READY_FOR_REAL_POST,
    verificationResult: 'PREPARED', finishedAt: new Date(), caption: 'prepared lifecycle test',
    mediaPath: 'scratch.png', mediaSha256: 'sha', idempotencyKey: `android-image:prep-${Math.random().toString(36).slice(2, 12)}`,
    result: result as any, ...(opts.extra ?? {}),
  } });
}

const statusOf = async (id: string) => (await prisma.androidJob.findUniqueOrThrow({ where: { id } })).status;

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) {
    throw new Error('Scratch DB + Local Mode required');
  }
  if (process.env.ANDROID_PUBLISH_APPROVED === 'true') {
    throw new Error('The prepared lifecycle never presses Share: ANDROID_PUBLISH_APPROVED must stay unset');
  }
  process.env.ANDROID_MAX_CONCURRENT = '3';
  process.env.ANDROID_IDLE_GRACE_MINUTES = '30';
  await prisma.androidJob.count(); // fail fast when the DB is not migrated
  installRuntime();
  const scheduler = new AndroidScheduler(prisma);

  // ── 0. Pure helpers: boundary/share gate + hold-window reading ──
  assert.equal(isSafeToExpire({ publishBoundaryAt: null, result: { shareInvocationCount: 0 } }), true);
  assert.equal(isSafeToExpire({ publishBoundaryAt: null, result: {} }), true, 'a missing Share count means zero');
  assert.equal(isSafeToExpire({ publishBoundaryAt: null, result: { shareInvocationCount: 1 } }), false, 'a Share invocation is never expired');
  assert.equal(isSafeToExpire({ publishBoundaryAt: new Date(), result: { shareInvocationCount: 0 } }), false, 'a crossed boundary is never expired');
  assert.equal(isSafeToExpire({ publishBoundaryAt: null, result: { shareInvocationCount: 'unknown' } }), false, 'an unreadable Share count fails closed');
  assert.equal(isHoldClosed({}, new Date()), true, 'a prepared job with no hold window is unbounded and stale');
  assert.equal(isHoldClosed({ hold: { until: future().toISOString() } }), false);
  assert.equal(isHoldClosed({ hold: { until: past().toISOString() } }), true);
  assert.equal(preparedHoldUntil({ hold: { until: 'not-a-date' } }), null);
  console.log('PASS helpers: boundary/share gate fails closed, missing hold is stale, windows parse');

  // ── 1. A closed hold expires atomically, preserving the worker payload and idempotency key ──
  await reset();
  const acc1 = await account();
  const job1 = await preparedJob(acc1.id, { until: past() });
  const before = await prisma.androidJob.findUniqueOrThrow({ where: { id: job1.id } });
  const outcome = await service.expireClosedHolds();
  assert.equal(outcome.expired, 1, 'exactly one closed hold is expired');
  assert.deepEqual(outcome.jobs, [{ id: job1.id, deviceId }]);
  const after = await prisma.androidJob.findUniqueOrThrow({ where: { id: job1.id } });
  assert.equal(after.status, PREPARATION_EXPIRED);
  assert.equal(after.publishBoundaryAt, null, 'no publish boundary is invented');
  assert.equal(after.idempotencyKey, before.idempotencyKey, 'the idempotency key is untouched');
  const r = after.result as any;
  assert.equal(r.shareInvocationCount, 0, 'the Share count stays zero');
  assert.equal(r.preparedAt, (before.result as any).preparedAt, 'preparedAt is preserved');
  assert.equal(r.hold.until, (before.result as any).hold.until, 'the original hold window is preserved');
  assert.equal(r.preparationExpiredReason, 'hold_expired');
  assert.ok(r.preparationExpiredAt, 'the expiry moment is recorded');
  console.log('PASS expiry: READY_FOR_REAL_POST -> PREPARATION_EXPIRED, boundary untouched, payload + key preserved');

  // ── 2. Idempotency preservation: repeating the transition is a no-op ──
  assert.equal((await service.expireClosedHolds()).expired, 0, 'a second sweep finds nothing to expire');
  assert.equal((await service.expireJobs([job1.id], 'device_shutdown')).expired, 0, 'an already expired job never re-transitions');
  assert.equal((await service.expireForDevice(deviceId, 'runtime_lost')).expired, 0);
  const after2 = await prisma.androidJob.findUniqueOrThrow({ where: { id: job1.id } });
  assert.equal(after2.status, PREPARATION_EXPIRED);
  assert.deepEqual(after2.result, after.result, 'the result is not rewritten by repeat calls');
  assert.equal(after2.updatedAt.getTime(), after.updatedAt.getTime(), 'a no-op leaves updatedAt alone');
  console.log('PASS idempotency: repeated expiry is a no-op, result and status are stable');

  // ── 3. Share count and boundary safety: a publish intent is never expired ──
  await reset();
  const acc3 = await account();
  const shareJob = await preparedJob(acc3.id, { until: past(), result: {
    preparedAt: new Date().toISOString(), shareInvocationCount: 1, hold: { until: past().toISOString(), minutes: 30 },
  } });
  const boundaryJob = await preparedJob(acc3.id, { until: past(), extra: { publishBoundaryAt: new Date() }, result: {
    preparedAt: new Date().toISOString(), shareInvocationCount: 0, hold: { until: past().toISOString(), minutes: 30 },
  } });
  assert.equal((await service.expireClosedHolds()).expired, 0, 'neither a Share invocation nor a crossed boundary may expire');
  assert.equal((await service.expireForDevice(deviceId, 'device_shutdown')).expired, 0, 'device lifecycle triggers respect the same gate');
  assert.equal(await statusOf(shareJob.id), READY_FOR_REAL_POST);
  assert.equal(await statusOf(boundaryJob.id), READY_FOR_REAL_POST);
  assert.equal(await prisma.androidJob.count({ where: { status: PREPARATION_EXPIRED } }), 0);
  console.log('PASS safety: share=1 or crossed boundary is left untouched (fails closed)');

  // ── 4. Sweep expires the hold even while the device is offline ──
  await reset();
  const acc4 = await account();
  const job4 = await preparedJob(acc4.id, { until: past() });
  running.clear(); // the runtime is gone: the device is offline
  await prisma.androidDevice.update({ where: { id: deviceId }, data: { status: 'OFFLINE', adbSerial: null } });
  assert.equal(await scheduler.sweepPreparedHolds(), 1, 'an expired hold is released even when offline');
  assert.equal(await statusOf(job4.id), PREPARATION_EXPIRED);
  const dev4 = await prisma.androidDevice.findUniqueOrThrow({ where: { id: deviceId } });
  assert.equal(dev4.status, 'OFFLINE');
  assert.equal(dev4.idleSince, null, 'an offline device is not given an idle countdown it cannot honour');
  console.log('PASS sweep offline: the hold expires even when the device is offline');

  // ── 5. Sweep expires the hold even when idleSince is already set ──
  await reset();
  const acc5 = await account();
  const job5 = await preparedJob(acc5.id, { until: past() });
  const idleAt = new Date(Date.now() - 5 * 60_000);
  await prisma.androidDevice.update({ where: { id: deviceId }, data: { idleSince: idleAt } });
  assert.equal(await scheduler.sweepPreparedHolds(), 1, 'a stale idle mark does not block expiry');
  assert.equal(await statusOf(job5.id), PREPARATION_EXPIRED);
  const dev5 = await prisma.androidDevice.findUniqueOrThrow({ where: { id: deviceId } });
  assert.equal(dev5.idleSince?.getTime(), idleAt.getTime(), 'the existing idle countdown is preserved, not reset');
  console.log('PASS sweep idle: an already-idling device still expires its prepared hold');

  // ── 6. Sweep preserves a live hold, then the classic READY path (count 1 + idleSince) ──
  await reset();
  const acc6 = await account();
  const job6 = await preparedJob(acc6.id, { until: future() });
  assert.equal(await scheduler.sweepPreparedHolds(), 0, 'a live hold is never expired');
  assert.equal(await statusOf(job6.id), READY_FOR_REAL_POST);
  await prisma.androidJob.update({ where: { id: job6.id }, data: {
    result: { ...(job6.result as any), hold: { until: past().toISOString(), minutes: 30 } } as any } });
  assert.equal(await scheduler.sweepPreparedHolds(), 1, 'the same semantics as before: one released hold is counted');
  assert.equal(await statusOf(job6.id), PREPARATION_EXPIRED);
  assert.ok((await prisma.androidDevice.findUniqueOrThrow({ where: { id: deviceId } })).idleSince,
    'a READY device starts the ordinary idle countdown after its hold expires');
  console.log('PASS sweep live: live holds survive, expired holds release and start the idle grace');

  // ── 7. Device shutdown is allowed while holding a prepared post, and expires it ──
  await reset();
  const acc7 = await account();
  const job7 = await preparedJob(acc7.id, { until: future() });
  await androidDevices.stop(deviceId, undefined, 'operator');
  assert.equal(await statusOf(job7.id), PREPARATION_EXPIRED, 'a shutdown destroys the prepared screen');
  const dev7 = await prisma.androidDevice.findUniqueOrThrow({ where: { id: deviceId } });
  assert.equal(dev7.status, 'OFFLINE');
  assert.equal(dev7.lastShutdownReason, 'operator');
  console.log('PASS shutdown: stop is allowed on a prepared device and expires the hold');

  // ── 8. Device boot invalidates prepared trust ──
  await reset();
  const acc8 = await account();
  const job8 = await preparedJob(acc8.id, { until: future() });
  running.clear();
  await prisma.androidDevice.update({ where: { id: deviceId }, data: { status: 'OFFLINE', adbSerial: null } });
  const booted = await androidDevices.start(deviceId);
  assert.equal(booted.status, 'READY');
  assert.equal(await statusOf(job8.id), PREPARATION_EXPIRED, 'a fresh boot cannot carry an old prepared screen');
  console.log('PASS start: a boot expires the prepared hold before the device is reused');

  // ── 9. Device refresh invalidates only when the device is not READY (conservative) ──
  await reset();
  const acc9 = await account();
  const job9 = await preparedJob(acc9.id, { until: future() });
  running.clear(); // runtime lost
  await androidDevices.refresh(deviceId);
  assert.equal((await prisma.androidDevice.findUniqueOrThrow({ where: { id: deviceId } })).status, 'OFFLINE');
  assert.equal(await statusOf(job9.id), PREPARATION_EXPIRED, 'an offline refresh invalidates the hold');
  // Positive control: a refresh that still finds the device READY keeps the trusted prepared screen.
  await reset();
  const acc9b = await account();
  const job9b = await preparedJob(acc9b.id, { until: future() });
  await androidDevices.refresh(deviceId);
  assert.equal((await prisma.androidDevice.findUniqueOrThrow({ where: { id: deviceId } })).status, 'READY');
  assert.equal(await statusOf(job9b.id), READY_FOR_REAL_POST, 'a healthy refresh does not touch a valid prepared screen');
  console.log('PASS refresh: offline invalidates, a healthy READY refresh is left alone');

  // ── 10. Device list (cold reconciliation) invalidates prepared trust on runtime loss ──
  await reset();
  const acc10 = await account();
  const job10 = await preparedJob(acc10.id, { until: future() });
  running.clear();
  const devices = await androidDevices.list();
  assert.equal(devices.find((device) => device.id === deviceId)?.status, 'OFFLINE');
  assert.equal(await statusOf(job10.id), PREPARATION_EXPIRED, 'a list reconciliation drops the hold of an offline device');
  console.log('PASS list: reconciliation invalidates a prepared hold on runtime loss');

  // ── 11. Scheduler runtime-loss path expires a sibling hold before dispatching ──
  await reset();
  const acc11 = await account();
  const sibling = await preparedJob(acc11.id, { until: future() });
  running.clear();
  await prisma.androidDevice.update({ where: { id: deviceId }, data: { status: 'OFFLINE', adbSerial: null } });
  const smoke = await prisma.androidJob.create({ data: { accountId: acc11.id, deviceId, type: 'ANDROID_SMOKE', status: 'QUEUED' } });
  const smokeOutcome = await scheduler.run(smoke.id);
  assert.equal(smokeOutcome.status, 'COMPLETED', 'the smoke job boots and completes normally');
  assert.equal(await statusOf(sibling.id), PREPARATION_EXPIRED, 'the sibling prepared hold is expired before the boot');
  console.log('PASS runtime loss: dispatching on a lost runtime expires the sibling prepared hold');

  // ── 12. Validator trust sweep: an app reset / lost composer expires a LIVE hold, without navigation ──
  await reset();
  const acc12 = await account();
  const job12 = await preparedJob(acc12.id, { until: future() }); // a live hold window is not proof of a live screen
  const calls: string[] = [];
  const failingValidator = (serial: string) => ({
    async verifyPreparedState(input: { caption: string }): Promise<{ ok: boolean; detail: string }> {
      calls.push(`${serial}:${input.caption}`);
      return { ok: false, detail: 'the "New post" screen title is not present (the Instagram process was reset)' };
    },
  });
  const trust1 = new AndroidScheduler(prisma, androidDevices, androidRuntime, undefined, undefined, undefined, failingValidator);
  assert.equal(await trust1.sweepPreparedTrust(), 1, 'an unverifiable prepared screen is expired');
  assert.equal(calls.length, 1, 'the validator reads the device exactly once and never navigates');
  assert.equal(await statusOf(job12.id), PREPARATION_EXPIRED);
  const r12 = (await prisma.androidJob.findUniqueOrThrow({ where: { id: job12.id } })).result as any;
  assert.equal(r12.preparationExpiredReason, 'validator_failed', 'a validator failure is distinguishable from a hold expiry');
  assert.equal(r12.hold.until, (job12.result as any).hold.until, 'the original hold metadata is preserved');
  assert.equal(r12.preparationExpiredAt !== undefined, true);
  console.log('PASS trust sweep: an app-reset / lost composer expires a live hold (reason validator_failed)');

  // ── 13. A confirmed prepared screen keeps its hold ──
  await reset();
  const acc13 = await account();
  const job13 = await preparedJob(acc13.id, { until: future() });
  const okValidator = () => ({ async verifyPreparedState(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'final Share screen prepared with exactly one image and the approved caption' };
  } });
  const trust2 = new AndroidScheduler(prisma, androidDevices, androidRuntime, undefined, undefined, undefined, okValidator);
  assert.equal(await trust2.sweepPreparedTrust(), 0, 'a confirmed screen is never expired');
  assert.equal(await statusOf(job13.id), READY_FOR_REAL_POST);
  console.log('PASS trust sweep: a confirmed prepared screen keeps its hold');

  // ── 14. An unreadable device read fails closed ──
  await reset();
  const acc14 = await account();
  const job14 = await preparedJob(acc14.id, { until: future() });
  const throwingValidator = () => ({ async verifyPreparedState(): Promise<{ ok: boolean; detail: string }> {
    throw new Error('dumpsys Unable to find package com.instagram.android');
  } });
  const trust3 = new AndroidScheduler(prisma, androidDevices, androidRuntime, undefined, undefined, undefined, throwingValidator);
  assert.equal(await trust3.sweepPreparedTrust(), 1, 'an unreadable screen fails closed');
  assert.equal(await statusOf(job14.id), PREPARATION_EXPIRED);
  console.log('PASS trust sweep: a thrown device read fails closed to PREPARATION_EXPIRED');

  // ── 15. BUSY and leased devices are skipped: an active run is never scanned ──
  await reset();
  const acc15 = await account();
  const job15 = await preparedJob(acc15.id, { until: future() });
  const neverValidator = () => ({ async verifyPreparedState(): Promise<{ ok: boolean; detail: string }> {
    throw new Error('the validator must not run against a BUSY or leased device');
  } });
  const trust4 = new AndroidScheduler(prisma, androidDevices, androidRuntime, undefined, undefined, undefined, neverValidator);
  await prisma.androidDevice.update({ where: { id: deviceId }, data: { status: 'BUSY' } });
  assert.equal(await trust4.sweepPreparedTrust(), 0, 'a BUSY device (own run) is never scanned');
  await prisma.androidDevice.update({ where: { id: deviceId }, data: { status: 'READY' } });
  const activeLease = await new AndroidDeviceLeaseService(prisma).acquire(deviceId, 'active-run');
  assert.ok(activeLease);
  assert.equal(await trust4.sweepPreparedTrust(), 0, 'a leased device is never scanned');
  await activeLease!.release();
  assert.equal(await statusOf(job15.id), READY_FOR_REAL_POST);
  console.log('PASS trust sweep: BUSY and leased devices are skipped');

  // ── 16. The validator is not consulted for a publish intent (share / boundary safety) ──
  await reset();
  const acc16 = await account();
  const shareJob16 = await preparedJob(acc16.id, { until: future(), result: {
    preparedAt: new Date().toISOString(), shareInvocationCount: 1, hold: { until: future().toISOString(), minutes: 30 },
  } });
  let invoked = 0;
  const countingValidator = () => ({ async verifyPreparedState(): Promise<{ ok: boolean; detail: string }> {
    invoked++;
    return { ok: false, detail: 'should not be reached' };
  } });
  const trust5 = new AndroidScheduler(prisma, androidDevices, androidRuntime, undefined, undefined, undefined, countingValidator);
  assert.equal(await trust5.sweepPreparedTrust(), 0, 'a Share intent is never expired by a screen read');
  assert.equal(invoked, 0, 'the validator is not even consulted for a publish intent');
  assert.equal(await statusOf(shareJob16.id), READY_FOR_REAL_POST);
  console.log('PASS trust sweep: share=1 is skipped before any device read');

  // ── 17. Validation is optional DI: null disables it without touching the hold ──
  await reset();
  const acc17 = await account();
  const job17 = await preparedJob(acc17.id, { until: future() });
  const disabled = new AndroidScheduler(prisma, androidDevices, androidRuntime, undefined, undefined, undefined, null);
  assert.equal(await disabled.sweepPreparedTrust(), 0, 'validation can be disabled by configuration');
  assert.equal(await statusOf(job17.id), READY_FOR_REAL_POST);
  console.log('PASS trust sweep: validation is optional and can be disabled');

  // ── 18. Startup reconcile expires a stale READY_FOR_REAL_POST whose app no longer exists ──
  await reset();
  const acc18 = await account();
  const stale = await preparedJob(acc18.id, { until: future() }); // hold still live, but the app is gone
  const missingApp = () => ({ async verifyPreparedState(): Promise<{ ok: boolean; detail: string }> {
    throw new Error('pm path com.instagram.android is empty: the package is not installed');
  } });
  const startup = new AndroidScheduler(prisma, androidDevices, androidRuntime, undefined, undefined, undefined, missingApp);
  assert.equal(await startup.reconcile(), 0, 'reconcile still returns the recovered-lease count');
  assert.equal(await statusOf(stale.id), PREPARATION_EXPIRED, 'startup reconciliation expires the stale prepared job safely');
  console.log('PASS startup: reconcile expires a stale READY_FOR_REAL_POST whose app no longer exists');

  console.log('PASS Phase3D: prepared lifecycle expires atomically on hold expiry / offline / shutdown / start / refresh / list / runtime loss / failed trust validation, preserving idempotency, Share safety and never navigating the device');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    Object.assign(androidRuntime, originalRuntime);
    await prisma.$disconnect();
  });

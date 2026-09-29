/**
 * Android Instagram preparation recovery safety tests (Phase 3D).
 *
 * Covers InstagramPreparationRecovery — the EXPLICIT OPERATOR recovery of an already-prepared,
 * never-published post. Recovery is never automatic and never grants publish approval. Everything
 * here is hermetic: the ADB runtime, the Instagram UI adapter and media staging are injected fakes,
 * so no emulator, no Instagram and no network are touched. Prisma talks only to a scratch SQLite DB.
 *
 * Safety contract under test:
 *  - refused before ANY device work: wrong idempotency key, an already-crossed publish boundary, a
 *    non-zero Share invocation count, a non image-post job, a job status that is not recoverable,
 *    an account whose engine/home device does not match, an offline runtime, and a device whose
 *    lease is taken → each fails closed and leaves the job untouched;
 *  - reprepare REUSES the same job row: no second job, the idempotency key and the job count are
 *    unchanged, the worker runs in preparation-only mode (Share never pressed, shareInvocationCount
 *    stays 0) and a legacy prepared result (no counter) counts as attempt 1 so the new attempt is 2;
 *  - reprepare is refused for anything that is not PREPARATION_EXPIRED;
 *  - revalidate re-verifies the live prepared screen and re-marks READY_FOR_REAL_POST with Share 0;
 *  - revalidate FAILS CLOSED when the active identity cannot be read — which is exactly the real
 *    caption/composer surface: on that screen `readActiveUsername` would navigate away from the
 *    composer, so the recovery must not trust the earlier proof. A positive revalidate is exercised
 *    only with a mocked identity and that limitation is asserted explicitly below;
 *  - a failed reprepare (approved media missing, or the app not on the expected screen) preserves
 *    the job row and releases the device lease cleanly, with Share still never pressed.
 *
 * Deliberately NOT covered here (owned elsewhere): the orchestration health contract over the real
 * runtime endpoint. This suite never asserts the health contract from extracted source.
 *
 * Scratch DB must be migrated first:  npx prisma migrate deploy
 * Run: DATABASE_URL=file:<scratch>/rockbase-preparation-recovery.db ROCKBASE_MODE=local \
 *      npx ts-node --files src/scripts/android-preparation-recovery-test.ts
 */
import assert from 'assert/strict';
import { createHash } from 'crypto';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  InstagramPreparationRecovery, RecoveryMedia, RecoveryRuntime,
} from '../services/instagram/InstagramPreparationRecovery';
import {
  InstagramImageSelection, InstagramPreparedState, InstagramPublishVerification, InstagramSecurityState,
  InstagramScreenExpectationError, InstagramUiAdapter,
} from '../services/instagram/InstagramUiAdapter';

const TMP = process.env.TMPDIR || os.tmpdir();
const CAPTION = 'Preparation recovery safety test caption.';
const USERNAME = 'rockbase.recovery';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SERIAL = 'emulator-5554';

let mediaPath = '';
let mediaSha = '';
let deviceId = '';

/** Fully scripted Instagram UI adapter: every call is recorded and every outcome is programmable. */
class FakeAdapter implements InstagramUiAdapter {
  steps: string[] = [];
  security: InstagramSecurityState = 'OK';
  username: string | null = USERNAME;
  prepared: InstagramPreparedState = {
    ok: true, detail: 'final Share screen prepared',
    shareSelector: 'com.instagram.android:id/share_footer_button (content-desc "Share")',
    captionText: CAPTION, selectedImageCount: 1,
  };
  /** Foreground failure injected on the Nth ensureInstagramForeground call (1-based); null disables. */
  foregroundFailOn: number | null = null;
  foregroundError: Error | null = null;
  foregroundCalls = 0;
  sharePresses = 0;
  evidence = 0;

  async ensureInstagramForeground() {
    this.foregroundCalls++;
    this.steps.push('ensure');
    if (this.foregroundFailOn !== null && this.foregroundCalls === this.foregroundFailOn) {
      throw this.foregroundError ?? new InstagramScreenExpectationError('Instagram did not come to the foreground');
    }
  }
  async detectSecurityState(): Promise<InstagramSecurityState> { this.steps.push(`security:${this.security}`); return this.security; }
  async readActiveUsername(): Promise<string | null> { this.steps.push('username'); return this.username; }
  async openCreatePost(): Promise<void> { this.steps.push('open'); }
  async selectStagedImage(_remote: string): Promise<InstagramImageSelection> {
    this.steps.push('select');
    return { selectedTile: 'Selected Photo thumbnail', selectedImageCount: 1 };
  }
  async enterCaption(_caption: string): Promise<void> { this.steps.push('caption'); }
  async reachPublishBoundary(): Promise<void> { this.steps.push('boundary'); }
  async verifyPreparedState(_expected: { caption: string }): Promise<InstagramPreparedState> { this.steps.push('verify-prepared'); return this.prepared; }
  async pressShare(): Promise<void> {
    this.steps.push('share');
    this.sharePresses++;
    throw new Error('Share must never be pressed by preparation-only recovery');
  }
  async verifyPublished(_at: Date): Promise<InstagramPublishVerification> { this.steps.push('verify-published'); return { published: null, detail: 'not exercised' }; }
  async captureEvidence(tag: string): Promise<string> {
    this.evidence++;
    return path.join(TMP, `recovery-evidence-${tag.replace(/[^a-z0-9-]+/gi, '-')}.png`);
  }
}

/** Injected runtime: reports the AVD as up/down without touching adb. */
function fakeRuntime(serial: string | null = SERIAL, healthy = true): RecoveryRuntime & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolveSerial: async (avd: string) => { calls.push(`resolveSerial:${avd}`); return serial; },
    health: async (value: string) => { calls.push(`health:${value}`); return healthy; },
  };
}

/** Injected media stager: records what the worker staged/cleaned without touching a device. */
function fakeMedia() {
  const staged: string[] = [];
  const cleaned: string[] = [];
  return {
    staged, cleaned,
    stage: async (_serial: string, jobId: string, _mediaPath: string) => {
      staged.push(jobId);
      return { remote: `/sdcard/Pictures/RockBase/${jobId}.png`, bytes: PNG.length, sha256: mediaSha };
    },
    cleanup: async (_serial: string, _jobId: string, remote: string) => { cleaned.push(remote); },
  } as RecoveryMedia & { staged: string[]; cleaned: string[] };
}

const prisma = new PrismaClient();

async function reset() {
  await prisma.activityLog.deleteMany({});
  await prisma.androidJob.deleteMany({});
  await prisma.socialAccount.deleteMany({});
  await prisma.androidDevice.deleteMany({});
  await prisma.workspace.upsert({ where: { id: 'workspace-default' }, update: {}, create: { id: 'workspace-default', name: 'Default' } });
  const device = await prisma.androidDevice.create({ data: { name: 'Recovery-Test-Device', avdName: 'Medium_Phone_API_36.1', status: 'READY' } });
  deviceId = device.id;
}

const makeAccount = (over: Record<string, unknown> = {}) => prisma.socialAccount.create({ data: {
  workspaceId: 'workspace-default', platform: 'Instagram', username: USERNAME, executionEngine: 'android',
  homeDeviceId: deviceId, androidHealth: 'HEALTHY', androidVerifiedUsername: USERNAME, androidLastVerifiedAt: new Date(), ...over,
} });

/** A legacy expired job: prepared once (preparedAt) but its result carries NO preparationAttempt. */
const legacyResult = (over: Record<string, unknown> = {}) => ({
  preparedAt: new Date(Date.now() - 120_000).toISOString(),
  shareInvocationCount: 0,
  hold: { until: new Date(Date.now() - 60_000).toISOString(), minutes: 30 },
  preparationExpiredAt: new Date().toISOString(),
  preparationExpiredReason: 'hold_expired',
  ...over,
});

const makeJob = (accountId: string, key: string, extra: Record<string, unknown> = {}) => prisma.androidJob.create({ data: {
  accountId, deviceId, type: 'ANDROID_IMAGE_POST', status: 'PREPARATION_EXPIRED', caption: CAPTION,
  mediaPath, mediaSha256: mediaSha, idempotencyKey: key, approvedAt: new Date(), result: legacyResult() as any, ...extra,
} });

const deviceRow = (id = deviceId) => prisma.androidDevice.findUniqueOrThrow({ where: { id } });
const jobRow = (id: string) => prisma.androidJob.findUniqueOrThrow({ where: { id } });

/** The service under test, wired with injected fakes; production defaults are untouched. */
function recoveryFor(adapter: FakeAdapter, runtime = fakeRuntime(), media = fakeMedia()) {
  let seenSerial: string | null = null;
  const recovery = new InstagramPreparationRecovery(prisma, (serial) => { seenSerial = serial; return adapter; }, runtime, media);
  return { recovery, runtime, media, serialUsed: () => seenSerial };
}

async function expectRejections(fn: () => Promise<unknown>, code: string, label: string) {
  await assert.rejects(fn, (error: any) => {
    assert.match(String(error?.message), new RegExp(code), `${label} must fail with ${code}, saw: ${error?.message}`);
    return true;
  });
  console.log(`PASS ${label} → ${code}`);
}

/** No second job may ever appear: one row, same id, same idempotency key. */
async function assertSingleJob(jobId: string, key: string, status?: string) {
  assert.equal(await prisma.androidJob.count(), 1, 'recovery must never create a second job row');
  assert.equal(await prisma.androidJob.count({ where: { idempotencyKey: key } }), 1, 'the original idempotency key is unique and preserved');
  const row = await jobRow(jobId);
  assert.equal(row.idempotencyKey, key, 'the idempotency key is unchanged');
  if (status !== undefined) assert.equal(row.status, status, `job status must still be ${status}`);
  return row;
}

/** The lease must always be released, whatever happened. */
async function assertLeaseReleased(idleExpected: boolean | null = null) {
  const device = await deviceRow();
  assert.equal(device.leaseOwner, null, 'device lease must be released');
  assert.equal(device.leaseJobId, null, 'job/device lease link must be cleared');
  assert.equal(device.leaseExpiresAt, null, 'lease expiry must be cleared');
  assert.equal(device.status, 'READY', 'device must not be left BUSY after recovery returns or throws');
  if (idleExpected === true) assert.ok(device.idleSince, 'a failed recovery starts the ordinary idle countdown');
  if (idleExpected === false) assert.equal(device.idleSince, null, 'a successful recovery keeps the device reserved (no idle countdown)');
}

// ── 1. Refusals that must happen before any device work ──

async function guardTests() {
  // wrong idempotency key
  await reset();
  let account = await makeAccount();
  let adapter = new FakeAdapter();
  let job = await makeJob(account.id, 'android-image:recovery-key');
  let { recovery } = recoveryFor(adapter);
  await expectRejections(() => recovery.recover(job.id, 'android-image:wrong-key', 'reprepare'), 'RECOVERY_PRECONDITION_FAILED', 'wrong idempotency key');
  assert.equal(adapter.steps.length, 0, 'no device work for a bad key');
  await assertSingleJob(job.id, 'android-image:recovery-key', 'PREPARATION_EXPIRED');
  await assertLeaseReleased();

  // publish boundary already crossed: never recover a possibly-published post
  await reset();
  account = await makeAccount();
  adapter = new FakeAdapter();
  job = await makeJob(account.id, 'android-image:recovery-boundary', { publishBoundaryAt: new Date() });
  ({ recovery } = recoveryFor(adapter));
  await expectRejections(() => recovery.recover(job.id, 'android-image:recovery-boundary', 'reprepare'), 'RECOVERY_PRECONDITION_FAILED', 'crossed publish boundary');
  assert.equal(adapter.steps.length, 0, 'no device work when the boundary was crossed');

  // a non-zero Share invocation count is unsafe
  await reset();
  account = await makeAccount();
  adapter = new FakeAdapter();
  job = await makeJob(account.id, 'android-image:recovery-share', { result: legacyResult({ shareInvocationCount: 1 }) as any });
  ({ recovery } = recoveryFor(adapter));
  await expectRejections(() => recovery.recover(job.id, 'android-image:recovery-share', 'revalidate'), 'RECOVERY_PRECONDITION_FAILED', 'non-zero Share invocation count');
  assert.equal(adapter.steps.length, 0, 'no device work when Share may already have fired');

  // wrong job type
  await reset();
  account = await makeAccount();
  adapter = new FakeAdapter();
  job = await makeJob(account.id, 'android-image:recovery-type', { type: 'ANDROID_SMOKE' });
  ({ recovery } = recoveryFor(adapter));
  await expectRejections(() => recovery.recover(job.id, 'android-image:recovery-type', 'reprepare'), 'RECOVERY_PRECONDITION_FAILED', 'non image-post job');

  // non-recoverable status
  await reset();
  account = await makeAccount();
  adapter = new FakeAdapter();
  job = await makeJob(account.id, 'android-image:recovery-status', { status: 'COMPLETED' });
  ({ recovery } = recoveryFor(adapter));
  await expectRejections(() => recovery.recover(job.id, 'android-image:recovery-status', 'reprepare'), 'RECOVERY_PRECONDITION_FAILED', 'non-recoverable status');

  // account home device mismatch
  await reset();
  account = await makeAccount({ homeDeviceId: null });
  adapter = new FakeAdapter();
  job = await makeJob(account.id, 'android-image:recovery-homedevice');
  ({ recovery } = recoveryFor(adapter));
  await expectRejections(() => recovery.recover(job.id, 'android-image:recovery-homedevice', 'reprepare'), 'RECOVERY_ACCOUNT_MISMATCH', 'account/home-device mismatch');

  // account engine is not android
  await reset();
  account = await makeAccount({ executionEngine: 'chromium' });
  adapter = new FakeAdapter();
  job = await makeJob(account.id, 'android-image:recovery-engine');
  ({ recovery } = recoveryFor(adapter));
  await expectRejections(() => recovery.recover(job.id, 'android-image:recovery-engine', 'reprepare'), 'RECOVERY_ACCOUNT_MISMATCH', 'non-android execution engine');

  // runtime cannot resolve the AVD serial
  await reset();
  account = await makeAccount();
  adapter = new FakeAdapter();
  job = await makeJob(account.id, 'android-image:recovery-noserial');
  ({ recovery } = recoveryFor(adapter, fakeRuntime(null)));
  await expectRejections(() => recovery.recover(job.id, 'android-image:recovery-noserial', 'reprepare'), 'RECOVERY_DEVICE_OFFLINE', 'runtime cannot resolve the AVD');
  assert.equal(adapter.steps.length, 0, 'no device work when the AVD is not up');
  await assertSingleJob(job.id, 'android-image:recovery-noserial', 'PREPARATION_EXPIRED');

  // runtime reports the device unhealthy
  await reset();
  account = await makeAccount();
  adapter = new FakeAdapter();
  job = await makeJob(account.id, 'android-image:recovery-unhealthy');
  ({ recovery } = recoveryFor(adapter, fakeRuntime(SERIAL, false)));
  await expectRejections(() => recovery.recover(job.id, 'android-image:recovery-unhealthy', 'reprepare'), 'RECOVERY_DEVICE_OFFLINE', 'runtime reports the device unhealthy');
  assert.equal(adapter.steps.length, 0, 'no device work when the device is offline');
  await assertLeaseReleased();

  // device already leased by someone else
  await reset();
  account = await makeAccount();
  adapter = new FakeAdapter();
  job = await makeJob(account.id, 'android-image:recovery-leased');
  await prisma.androidDevice.update({ where: { id: deviceId }, data: { leaseOwner: 'another-owner', leaseJobId: 'another-job', leaseExpiresAt: new Date(Date.now() + 60_000) } });
  ({ recovery } = recoveryFor(adapter));
  await expectRejections(() => recovery.recover(job.id, 'android-image:recovery-leased', 'reprepare'), 'RECOVERY_DEVICE_LEASE_UNAVAILABLE', 'device lease already held');
  assert.equal(adapter.steps.length, 0, 'no device work while another owner holds the lease');
  assert.equal((await deviceRow()).leaseOwner, 'another-owner', 'the other owner keeps its lease');
  await assertSingleJob(job.id, 'android-image:recovery-leased', 'PREPARATION_EXPIRED');
}

// ── 2. Reprepare: same job, preparation-only, counter continues ──

async function reprepareTests() {
  await reset();
  const account = await makeAccount();
  const adapter = new FakeAdapter();
  const { recovery, media, serialUsed } = recoveryFor(adapter);
  const key = 'android-image:recovery-reprepare';
  const job = await makeJob(account.id, key);

  const outcome = await recovery.recover(job.id, key, 'reprepare');
  assert.equal(outcome.status, 'READY_FOR_REAL_POST', 'reprepare rebuilds the post and stops at the final Share screen');
  assert.equal(serialUsed(), SERIAL, 'the adapter was built for the resolved serial');
  assert.equal(adapter.sharePresses, 0, 'Share is never pressed by recovery');
  assert.equal(media.staged.length, 1, 'the worker staged the approved media once for this job');
  assert.equal(media.cleaned.length, 1, 'staged media is cleaned up');

  const row = await assertSingleJob(job.id, key, 'READY_FOR_REAL_POST');
  assert.equal(row.verificationResult, 'PREPARED');
  assert.equal(row.publishBoundaryAt, null, 'recovery never crosses the publish boundary');
  const result = row.result as any;
  assert.equal(result.shareInvocationCount, 0, 'shareInvocationCount stays 0');
  assert.equal(result.publishApproved, false, 'recovery never grants publish approval');
  assert.equal(result.captionVerified, true);
  assert.ok(result.hold?.until && new Date(result.hold.until).getTime() > Date.now(), 'the rebuilt screen is held for a bounded window');
  // Legacy prepared result (preparedAt, no counter) counts as attempt 1 → this reprepare is attempt 2.
  assert.equal(result.preparationAttempt, 2, 'legacy preparedAt counts as attempt 1; the reprepare is attempt 2');
  assert.ok(adapter.steps.includes('select') && adapter.steps.includes('caption'), 'the full preparation flow ran again on the same job');
  await assertLeaseReleased(false);
  console.log('PASS reprepare: same job reused, preparation-only, Share 0, legacy attempt 1 → 2, lease released');

  // reprepare is refused once the job is prepared again (only PREPARATION_EXPIRED may be reprepared)
  const again = new FakeAdapter();
  const second = recoveryFor(again);
  await expectRejections(() => second.recovery.recover(job.id, key, 'reprepare'), 'RECOVERY_REPREPARE_REQUIRES_EXPIRED', 'reprepare of a non-expired job');
  await assertSingleJob(job.id, key, 'READY_FOR_REAL_POST');
  assert.equal(again.sharePresses, 0);
}

// ── 3. Revalidate ──

async function revalidateTests() {
  await reset();
  const account = await makeAccount();
  const adapter = new FakeAdapter();
  const { recovery, media } = recoveryFor(adapter);
  const key = 'android-image:recovery-revalidate';
  const job = await makeJob(account.id, key, { status: 'READY_FOR_REAL_POST', verificationResult: 'PREPARED' });

  const outcome = await recovery.recover(job.id, key, 'revalidate');
  assert.equal(outcome.status, 'READY_FOR_REAL_POST');
  assert.ok(adapter.steps.includes('verify-prepared'), 'the live prepared screen was re-verified');
  assert.ok(adapter.steps.includes('username'), 'revalidate read the active identity live — it does NOT trust the stored proof');
  assert.equal(adapter.sharePresses, 0, 'revalidate never presses Share');
  assert.equal(media.staged.length, 0, 'revalidate does not restage media (the post is already built on screen)');

  const row = await assertSingleJob(job.id, key, 'READY_FOR_REAL_POST');
  assert.equal(row.verificationResult, 'PREPARED');
  assert.equal(row.publishBoundaryAt, null);
  const result = row.result as any;
  assert.equal(result.shareInvocationCount, 0);
  assert.equal(result.publishApproved, false);
  assert.ok(result.liveRevalidatedAt, 'the revalidation timestamp is recorded');
  const expectedMinutes = Number(process.env.ANDROID_PREPARED_HOLD_MINUTES || 30);
  assert.equal(result.hold?.minutes, expectedMinutes);
  assert.ok(new Date(result.hold?.until).getTime() > Date.now(), 'the hold window is refreshed from now');
  await assertLeaseReleased(false);
  console.log('PASS revalidate: live identity + prepared screen verified, READY_FOR_REAL_POST, Share 0, hold refreshed');

  // prepared screen that cannot be verified → refused, job untouched
  await reset();
  const account2 = await makeAccount();
  const bad = new FakeAdapter();
  bad.prepared = { ok: false, detail: 'the caption does not match the approved caption', shareSelector: null, captionText: 'wrong', selectedImageCount: 1 };
  const r2 = recoveryFor(bad);
  const key2 = 'android-image:recovery-revalidate-bad';
  const job2 = await makeJob(account2.id, key2, { status: 'READY_FOR_REAL_POST', verificationResult: 'PREPARED' });
  await expectRejections(() => r2.recovery.recover(job2.id, key2, 'revalidate'), 'RECOVERY_PREPARED_UI_NOT_VERIFIED', 'unverifiable prepared screen');
  const row2 = await assertSingleJob(job2.id, key2, 'READY_FOR_REAL_POST');
  assert.equal((row2.result as any).liveRevalidatedAt, undefined, 'a refused revalidate writes nothing');
  assert.equal(row2.publishBoundaryAt, null);
  assert.equal(bad.sharePresses, 0);
  await assertLeaseReleased(true);

  // identity mismatch → refused
  await reset();
  const account3 = await makeAccount();
  const other = new FakeAdapter();
  other.username = 'someone.else';
  const r3 = recoveryFor(other);
  const key3 = 'android-image:recovery-revalidate-mismatch';
  const job3 = await makeJob(account3.id, key3, { status: 'READY_FOR_REAL_POST' });
  await expectRejections(() => r3.recovery.recover(job3.id, key3, 'revalidate'), 'RECOVERY_IDENTITY_MISMATCH', 'identity mismatch on revalidate');
  assert.equal(other.sharePresses, 0);

  // FAIL CLOSED on the real caption/composer surface: no readable identity → refused, nothing written.
  // The positive above is only possible with a mocked identity; the actual composer has no username,
  // so a real revalidate must block instead of trusting the earlier proof.
  await reset();
  const account4 = await makeAccount();
  const composer = new FakeAdapter();
  composer.username = null; // the real caption screen exposes no active username
  const r4 = recoveryFor(composer);
  const key4 = 'android-image:recovery-revalidate-nocomposer';
  const job4 = await makeJob(account4.id, key4, { status: 'READY_FOR_REAL_POST', verificationResult: 'PREPARED' });
  await expectRejections(() => r4.recovery.recover(job4.id, key4, 'revalidate'), 'RECOVERY_IDENTITY_MISMATCH', 'revalidate on the caption/composer surface (no readable identity)');
  const row4 = await assertSingleJob(job4.id, key4, 'READY_FOR_REAL_POST');
  assert.equal((row4.result as any).liveRevalidatedAt, undefined);
  assert.equal(row4.publishBoundaryAt, null);
  await assertLeaseReleased(true);
  console.log('PASS revalidate fails closed without a live identity (real composer surface blocks revalidate)');
}

// ── 4. A failed reprepare preserves the job and releases the lease ──

async function failurePreservesJobTests() {
  // (a) approved media missing from uploads → FAILED before Share, job preserved, lease released
  await reset();
  const account = await makeAccount();
  const adapter = new FakeAdapter();
  const { recovery, media } = recoveryFor(adapter);
  const key = 'android-image:recovery-missing-media';
  const job = await makeJob(account.id, key, { mediaPath: path.join(TMP, 'rockbase-recovery-missing.png') });
  const outcome = await recovery.recover(job.id, key, 'reprepare');
  assert.equal(outcome.status, 'FAILED', 'missing approved media fails before Share');
  const row = await assertSingleJob(job.id, key, 'FAILED');
  assert.equal(row.verificationResult, 'FAILED_BEFORE_SHARE');
  assert.equal(row.publishBoundaryAt, null, 'no boundary after a pre-Share failure');
  assert.equal(adapter.sharePresses, 0, 'Share is never pressed when the media is missing');
  assert.equal(media.staged.length, 0, 'nothing is staged when the approved media is gone');
  // Recovery's own pre-flight (foreground + security + identity) runs first; the worker must stop at
  // the media check and never touch the create-post flow.
  assert.deepEqual(adapter.steps, ['ensure', 'security:OK', 'username'], 'the worker performs no create-post device action when the media is missing');
  assert.equal((row.result as any).shareInvocationCount, 0);
  await assertLeaseReleased(true);
  console.log('PASS failed reprepare (missing media): job preserved as FAILED, no Share, lease released');

  // (b) the app is not on the expected screen during the worker run → NEEDS_ATTENTION, job preserved
  await reset();
  const account2 = await makeAccount();
  const brokenApp = new FakeAdapter();
  brokenApp.foregroundFailOn = 2; // 1st ensure is recovery's pre-flight, 2nd is the worker's
  brokenApp.foregroundError = new InstagramScreenExpectationError('Instagram is not installed on the device');
  const r2 = recoveryFor(brokenApp, fakeRuntime(), fakeMedia());
  const key2 = 'android-image:recovery-app-missing';
  const job2 = await makeJob(account2.id, key2);
  const outcome2 = await r2.recovery.recover(job2.id, key2, 'reprepare');
  assert.equal(outcome2.status, 'NEEDS_ATTENTION', 'an unexpected screen stops the run for a human look');
  const row2 = await assertSingleJob(job2.id, key2, 'NEEDS_ATTENTION');
  assert.equal(row2.verificationResult, 'SCREEN_EXPECTATION_FAILED');
  assert.equal(row2.publishBoundaryAt, null);
  assert.equal(brokenApp.sharePresses, 0);
  await assertLeaseReleased(true);
  console.log('PASS failed reprepare (app not on screen): NEEDS_ATTENTION, job preserved, lease released');

  // (c) recovery's own pre-flight cannot reach Instagram → throws, job and lease preserved
  await reset();
  const account3 = await makeAccount();
  const offlineApp = new FakeAdapter();
  offlineApp.foregroundFailOn = 1;
  offlineApp.foregroundError = new InstagramScreenExpectationError('Instagram did not come to the foreground');
  const r3 = recoveryFor(offlineApp, fakeRuntime(), fakeMedia());
  const key3 = 'android-image:recovery-preflight-missing';
  const job3 = await makeJob(account3.id, key3);
  await assert.rejects(() => r3.recovery.recover(job3.id, key3, 'reprepare'), (error: any) => error instanceof InstagramScreenExpectationError);
  const row3 = await assertSingleJob(job3.id, key3, 'PREPARATION_EXPIRED');
  assert.equal(row3.publishBoundaryAt, null);
  assert.equal(offlineApp.sharePresses, 0);
  await assertLeaseReleased(true);
  console.log('PASS recovery pre-flight failure: job stays PREPARATION_EXPIRED, lease released');
}

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) {
    throw new Error('Scratch DB + Local Mode required');
  }
  if (process.env.ANDROID_PUBLISH_APPROVED === 'true') {
    throw new Error('Recovery is preparation-only: ANDROID_PUBLISH_APPROVED must stay unset');
  }
  await prisma.androidJob.count(); // fail fast when the scratch DB is not migrated

  mediaPath = path.join(TMP, 'rockbase-preparation-recovery-media.png');
  await fsp.writeFile(mediaPath, PNG);
  mediaSha = createHash('sha256').update(PNG).digest('hex');

  await guardTests();
  await reprepareTests();
  await revalidateTests();
  await failurePreservesJobTests();

  console.log('PASS Phase3D recovery: explicit and idempotent, same job reused, guards fail closed, lease always released, Share always 0');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });

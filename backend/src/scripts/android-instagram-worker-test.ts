/**
 * Phase 3B — Instagram Android worker tests.
 *
 * Exercises the publish state machine, fail-closed boundaries and idempotency semantics with a
 * scripted fake UI adapter — no real device and no real Instagram are touched. The scratch DB must
 * be migrated first:  npx prisma migrate deploy
 * Run:                DATABASE_URL=file:<scratch>/rockbase-instagram-worker.db npm run test:android-instagram
 */
import assert from 'assert/strict';
import { createHash } from 'crypto';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { AndroidScheduler, InstagramRunnerFactory } from '../services/AndroidScheduler';
import { InstagramAndroidWorker, InstagramJobOutcome } from '../services/instagram/InstagramAndroidWorker';
import {
  InstagramPublishVerification, InstagramSecurityState, InstagramUiAdapter,
} from '../services/instagram/InstagramUiAdapter';

type Step = 'ensure' | 'open' | 'select' | 'caption' | 'boundary' | 'share' | 'verify';

/** Scripted adapter: every Instagram interaction is programmable and recorded. */
class FakeAdapter implements InstagramUiAdapter {
  security: InstagramSecurityState[] = [];
  username: string | null = null;
  verification: InstagramPublishVerification = { published: true, detail: 'post visible on profile' };
  errors: Partial<Record<Step, Error>> = {};
  beforeOpen: (() => Promise<void>) | null = null;
  sharePresses = 0;
  evidenceCount = 0;
  steps: string[] = [];

  async ensureInstagramForeground() { this.steps.push('ensure'); if (this.errors.ensure) throw this.errors.ensure; }
  async detectSecurityState() { const state = this.security.shift() ?? 'OK'; this.steps.push(`security:${state}`); return state; }
  async readActiveUsername() { this.steps.push('username'); return this.username; }
  async openCreatePost() { this.steps.push('open'); if (this.beforeOpen) await this.beforeOpen(); if (this.errors.open) throw this.errors.open; }
  async selectStagedImage(_remote: string) { this.steps.push('select'); if (this.errors.select) throw this.errors.select; }
  async enterCaption(_caption: string) { this.steps.push('caption'); if (this.errors.caption) throw this.errors.caption; }
  async reachPublishBoundary() { this.steps.push('boundary'); if (this.errors.boundary) throw this.errors.boundary; }
  async pressShare() { this.steps.push('share'); this.sharePresses++; if (this.errors.share) throw this.errors.share; }
  async verifyPublished(_at: Date) { this.steps.push('verify'); if (this.errors.verify) throw this.errors.verify; return this.verification; }
  async captureEvidence(tag: string) { this.evidenceCount++; return path.join(TMP, `evidence-${tag.replace(/[^a-z0-9-]+/gi, '-')}.png`); }
}

function fakeMedia() {
  const staged: string[] = [];
  const cleaned: string[] = [];
  return {
    stage: async (_serial: string, jobId: string, _mediaPath: string) => {
      staged.push(jobId);
      return { remote: `/sdcard/Pictures/RockBase/${jobId}.png`, bytes: 70, sha256: 'fake' };
    },
    cleanup: async (_serial: string, _jobId: string, remote: string) => { cleaned.push(remote); },
    staged, cleaned,
  };
}

const TMP = process.env.TMPDIR || os.tmpdir();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const prisma = new PrismaClient();
const workerFor = (adapter: FakeAdapter, media = fakeMedia()) =>
  new InstagramAndroidWorker(prisma, adapter, 'emulator-5554', media as any);

let mediaPath = '';
let mediaSha = '';
let deviceId = '';

async function reset() {
  await prisma.activityLog.deleteMany({});
  await prisma.androidJob.deleteMany({});
  await prisma.socialAccount.deleteMany({});
  await prisma.androidDevice.deleteMany({});
  await prisma.workspace.upsert({ where: { id: 'workspace-default' }, update: {}, create: { id: 'workspace-default', name: 'Default' } });
  const device = await prisma.androidDevice.create({ data: { name: 'Worker-Test-Device', avdName: 'Medium_Phone_API_36.1', status: 'READY' } });
  deviceId = device.id;
}

async function makeAccount(username: string, health = 'HEALTHY') {
  return prisma.socialAccount.create({ data: {
    workspaceId: 'workspace-default', platform: 'Instagram', username, executionEngine: 'android',
    homeDeviceId: deviceId, androidHealth: health, androidVerifiedUsername: username, androidLastVerifiedAt: new Date(),
  } });
}

async function makeDraft(accountId: string, key: string, extra: Record<string, unknown> = {}) {
  return prisma.androidJob.create({ data: {
    accountId, deviceId, type: 'ANDROID_IMAGE_POST', status: 'QUEUED', caption: 'Phase 3B disposable test caption',
    mediaPath, mediaSha256: mediaSha, idempotencyKey: `android-image:${key}`, approvedAt: new Date(), ...extra,
  } });
}

const jobRow = (id: string) => prisma.androidJob.findUniqueOrThrow({ where: { id } });
const accountRow = (id: string) => prisma.socialAccount.findUniqueOrThrow({ where: { id } });

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) {
    throw new Error('Scratch DB + Local Mode required');
  }
  await prisma.androidJob.count(); // fail fast when the DB is not migrated

  mediaPath = path.join(TMP, 'rockbase-instagram-worker-media.png');
  await fsp.writeFile(mediaPath, PNG);
  mediaSha = createHash('sha256').update(PNG).digest('hex');

  // ── 1. Identity MATCH allows progression → exactly one Share → verified SUCCESS ──
  await reset();
  let account = await makeAccount('rockbase.test');
  let draft = await makeDraft(account.id, 'match');
  let adapter = new FakeAdapter();
  adapter.username = 'rockbase.test';
  let media = fakeMedia();
  let outcome: InstagramJobOutcome = await workerFor(adapter, media).run(draft.id);
  assert.equal(outcome.status, 'COMPLETED');
  let row = await jobRow(draft.id);
  assert.equal(row.status, 'COMPLETED');
  assert.equal(row.verificationResult, 'SUCCESS');
  assert.ok(row.publishBoundaryAt, 'publish boundary timestamp must be persisted');
  assert.ok(row.evidencePath, 'a post-result evidence artifact must be recorded');
  assert.equal(adapter.sharePresses, 1, 'exactly one Share press');
  assert.equal(media.staged.length, 1);
  assert.equal(media.cleaned.length, 1, 'staged media is cleaned up');
  let acc = await accountRow(account.id);
  assert.equal(acc.androidHealth, 'HEALTHY');
  assert.equal(acc.androidVerifiedUsername, 'rockbase.test');
  assert.ok(acc.androidLastVerifiedAt);
  console.log('PASS identity MATCH progresses to exactly one verified Share');

  // ── 2. Re-delivery after the boundary can never press Share again ──
  adapter = new FakeAdapter();
  adapter.username = 'rockbase.test';
  const redelivery = await workerFor(adapter).run(draft.id);
  assert.equal(redelivery.status, 'COMPLETED', 'a completed job is reported, not re-run');
  assert.equal(adapter.sharePresses, 0);
  const stuck = await makeDraft(account.id, 'redelivery', { status: 'PUBLISHING', publishBoundaryAt: new Date() });
  const stuckOutcome = await workerFor(adapter).run(stuck.id);
  assert.equal(stuckOutcome.status, 'AMBIGUOUS');
  assert.equal(adapter.sharePresses, 0, 'Share is never retried after the boundary');
  assert.equal((await jobRow(stuck.id)).status, 'AMBIGUOUS');
  console.log('PASS publish boundary is crossed at most once per job (re-delivery → AMBIGUOUS)');

  // ── 3. Identity mismatch blocks and marks the account NEEDS_ATTENTION ──
  await reset();
  account = await makeAccount('rockbase.test');
  draft = await makeDraft(account.id, 'mismatch');
  adapter = new FakeAdapter();
  adapter.username = 'someone.else';
  outcome = await workerFor(adapter).run(draft.id);
  assert.equal(outcome.status, 'NEEDS_ATTENTION');
  row = await jobRow(draft.id);
  assert.equal(row.verificationResult, 'ACCOUNT_MISMATCH');
  assert.equal(row.publishBoundaryAt, null);
  assert.equal(adapter.sharePresses, 0);
  acc = await accountRow(account.id);
  assert.equal(acc.androidHealth, 'NEEDS_ATTENTION');
  assert.match(acc.androidHealthReason || '', /ACCOUNT_MISMATCH/);
  console.log('PASS ACCOUNT_MISMATCH blocks the post and flags the account');

  // ── 4. Login wall → NEEDS_ATTENTION, one evidence artifact, no Share ──
  await reset();
  account = await makeAccount('rockbase.test');
  draft = await makeDraft(account.id, 'login-wall');
  adapter = new FakeAdapter();
  adapter.username = 'rockbase.test';
  adapter.security = ['LOGIN_REQUIRED'];
  outcome = await workerFor(adapter).run(draft.id);
  assert.equal(outcome.status, 'NEEDS_ATTENTION');
  row = await jobRow(draft.id);
  assert.equal(row.verificationResult, 'SECURITY_LOGIN_REQUIRED');
  assert.equal(adapter.sharePresses, 0);
  assert.ok(adapter.evidenceCount >= 1, 'one useful evidence artifact is saved');
  assert.equal((await accountRow(account.id)).androidHealth, 'NEEDS_ATTENTION');
  console.log('PASS login wall stops the run with evidence and no Share');

  // ── 5. Checkpoint mid-flow → NEEDS_ATTENTION, no Share ──
  await reset();
  account = await makeAccount('rockbase.test');
  draft = await makeDraft(account.id, 'checkpoint');
  adapter = new FakeAdapter();
  adapter.username = 'rockbase.test';
  adapter.security = ['OK', 'OK', 'CHECKPOINT'];
  outcome = await workerFor(adapter).run(draft.id);
  assert.equal(outcome.status, 'NEEDS_ATTENTION');
  row = await jobRow(draft.id);
  assert.equal(row.verificationResult, 'SECURITY_CHECKPOINT');
  assert.equal(adapter.sharePresses, 0);
  console.log('PASS checkpoint mid-flow stops the run without Share');

  // ── 6. Failure BEFORE Share is distinguishable from failure after Share ──
  await reset();
  account = await makeAccount('rockbase.test');
  draft = await makeDraft(account.id, 'pre-share-fail');
  adapter = new FakeAdapter();
  adapter.username = 'rockbase.test';
  adapter.errors.select = new Error('gallery did not open');
  outcome = await workerFor(adapter).run(draft.id);
  assert.equal(outcome.status, 'FAILED');
  row = await jobRow(draft.id);
  assert.equal(row.verificationResult, 'FAILED_BEFORE_SHARE');
  assert.equal(row.publishBoundaryAt, null);
  assert.equal(adapter.sharePresses, 0);
  console.log('PASS pre-Share failure is FAILED_BEFORE_SHARE with no boundary');

  // ── 7. Post-Share uncertainty → AMBIGUOUS, never retried, boundary recorded ──
  await reset();
  account = await makeAccount('rockbase.test');
  draft = await makeDraft(account.id, 'post-share-ambiguous');
  adapter = new FakeAdapter();
  adapter.username = 'rockbase.test';
  adapter.errors.share = new Error('tap dispatched but the screen did not react');
  adapter.verification = { published: null, detail: 'profile not reachable' };
  outcome = await workerFor(adapter).run(draft.id);
  assert.equal(outcome.status, 'AMBIGUOUS');
  row = await jobRow(draft.id);
  assert.equal(row.status, 'AMBIGUOUS');
  assert.equal(row.verificationResult, 'UNVERIFIED');
  assert.ok(row.publishBoundaryAt);
  assert.equal(adapter.sharePresses, 1, 'the one Share attempt still happened');
  console.log('PASS post-Share uncertainty → AMBIGUOUS with the boundary recorded');

  // ── 8. SUCCESS requires explicit verification: confirmed-not-published is FAILED_AFTER_SHARE ──
  await reset();
  account = await makeAccount('rockbase.test');
  draft = await makeDraft(account.id, 'post-share-failed');
  adapter = new FakeAdapter();
  adapter.username = 'rockbase.test';
  adapter.verification = { published: false, detail: 'no post found on the profile' };
  outcome = await workerFor(adapter).run(draft.id);
  assert.equal(outcome.status, 'FAILED');
  row = await jobRow(draft.id);
  assert.equal(row.verificationResult, 'FAILED_AFTER_SHARE');
  assert.ok(row.publishBoundaryAt);
  assert.equal(adapter.sharePresses, 1);
  console.log('PASS confirmed-not-published is FAILED_AFTER_SHARE (distinguishable from pre-Share)');

  // ── 9. Identity unknown fails closed ──
  await reset();
  account = await makeAccount('rockbase.test');
  draft = await makeDraft(account.id, 'identity-unknown');
  adapter = new FakeAdapter();
  adapter.username = null;
  outcome = await workerFor(adapter).run(draft.id);
  assert.equal(outcome.status, 'NEEDS_ATTENTION');
  row = await jobRow(draft.id);
  assert.equal(row.verificationResult, 'IDENTITY_UNKNOWN');
  assert.equal(adapter.sharePresses, 0);
  console.log('PASS undetectable identity fails closed with NEEDS_ATTENTION');

  // ── 10. Concurrent attempts: the atomic boundary allows exactly one Share ──
  await reset();
  account = await makeAccount('rockbase.test');
  draft = await makeDraft(account.id, 'concurrent');
  const a1 = new FakeAdapter(); a1.username = 'rockbase.test';
  const a2 = new FakeAdapter(); a2.username = 'rockbase.test';
  let arrivals = 0; let release: () => void = () => { /* replaced below */ };
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hook = async () => { arrivals += 1; if (arrivals === 2) release(); await gate; };
  a1.beforeOpen = hook; a2.beforeOpen = hook;
  const [r1, r2] = await Promise.all([workerFor(a1).run(draft.id), workerFor(a2).run(draft.id)]);
  assert.equal(a1.sharePresses + a2.sharePresses, 1, 'exactly one Share across concurrent attempts');
  assert.deepEqual([r1.status, r2.status].sort(), ['AMBIGUOUS', 'COMPLETED']);
  row = await jobRow(draft.id);
  assert.equal(row.status, 'COMPLETED');
  assert.equal(row.verificationResult, 'SUCCESS');
  console.log('PASS concurrent attempts: single Share, one COMPLETED + one AMBIGUOUS');

  // ── 11. Scheduler gating: drafts never reach the device, unhealthy accounts are skipped ──
  const gateCalls: string[] = [];
  const fakeDevices = { start: async () => { gateCalls.push('start'); throw new Error('device work must not start'); },
    stop: async () => { gateCalls.push('stop'); }, refresh: async () => { gateCalls.push('refresh'); } } as any;
  const fakeRuntime = { resolveSerial: async () => { gateCalls.push('resolveSerial'); return null; },
    health: async () => false, screenshot: async () => Buffer.alloc(0), connected: async () => [] } as any;
  const factory: InstagramRunnerFactory = () => ({ run: async () => { gateCalls.push('runner'); throw new Error('runner must not run'); } });
  const scheduler = new AndroidScheduler(prisma, fakeDevices, fakeRuntime, undefined, factory);

  await reset();
  account = await makeAccount('rockbase.test');
  const draftJob = await makeDraft(account.id, 'scheduler-draft', { status: 'DRAFT', approvedAt: null });
  const s1 = await scheduler.run(draftJob.id);
  assert.equal(s1.status, 'SKIPPED');
  assert.match(s1.reason || '', /awaits a verified Instagram identity and operator approval/);
  assert.equal(gateCalls.length, 0, 'no device work for unapproved drafts');

  const unhealthy = await makeAccount('rockbase.attention', 'NEEDS_ATTENTION');
  const gated = await makeDraft(unhealthy.id, 'scheduler-unhealthy');
  const s2 = await scheduler.run(gated.id);
  assert.equal(s2.status, 'SKIPPED');
  assert.match(s2.reason || '', /NEEDS_ATTENTION/);
  assert.equal(gateCalls.length, 0, 'no device work for unhealthy accounts');
  console.log('PASS scheduler gating: drafts and unhealthy accounts never reach the device');

  console.log('PASS Phase3B: identity match/mismatch, security stops, single-Shared boundary, before/after-Share separation, ambiguity, scheduler gating');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });

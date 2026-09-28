/**
 * Phase 3C — real Instagram adapter coverage + preparation-only pipeline tests.
 *
 * Two layers, both hermetic (no device, no real Instagram):
 *  1. AdbInstagramUiAdapter driven against REAL captured hierarchies (backend/src/scripts/fixtures/
 *     instagram-447, dumped from the signed-in test device) — every navigation step, guard and the
 *     single-image selection rule is exercised for real, and every tap is asserted against the
 *     coordinates observed on the device.
 *  2. InstagramAndroidWorker in its DEFAULT preparation-only mode: the post is built up to the final
 *     Share screen and Share is never pressed (ANDROID_PUBLISH_APPROVED must stay unset here).
 *
 * Scratch DB must be migrated first:  npx prisma migrate deploy
 * Run: DATABASE_URL=file:<scratch>/rockbase-instagram-prep.db npm run test:android-instagram-prep
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
  AdbInstagramUiAdapter, INSTAGRAM_ID, InstagramUiTransport, UiNode,
  parseLsMinutes, parseTileCreatedAt, parseUiXml,
} from '../services/instagram/AdbInstagramUiAdapter';
import {
  InstagramPublishNotApprovedError, InstagramScreenExpectationError, InstagramSecurityState,
  InstagramUiAdapter,
} from '../services/instagram/InstagramUiAdapter';

const FIXTURES = path.join(__dirname, 'fixtures', 'instagram-447');
const TMP = process.env.TMPDIR || os.tmpdir();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CAPTION = 'RockBase Android engine integration test.';
const STAGED_FILE = '/sdcard/Pictures/RockBase/phase3c-test.png';
/** The staged file's listing as printed by the device; the picker shows this same clock. */
const STAGED_LISTING = '-rw-rw---- 1 u0_a213 media_rw 25983 2026-09-28 15:45 phase3c-test.png';
/** Observed device tap targets (see working/android-instagram-ui-notes.md). */
const OBSERVED_TAPS = {
  profileTab: { x: 972, y: 2274 },
  createEntry: { x: 63, y: 136 },
  createNewPostRow: { x: 540, y: 1698 },
  galleryNext: { x: 1000, y: 136 },
  editorNext: { x: 960, y: 2256 },
  captionField: { x: 540, y: 988 },
};

const load = (name: string) => fsp.readFile(path.join(FIXTURES, name), 'utf8').then(parseUiXml);

/** Replays real captured screens in order; every tap/text/back is recorded and advances the screen. */
class FixtureTransport implements InstagramUiTransport {
  taps: { x: number; y: number }[] = [];
  texts: string[] = [];
  backs = 0;
  private index = 0;

  constructor(
    private readonly screens: string[],
    private readonly fileMinutes: number | null = parseLsMinutes(STAGED_LISTING),
  ) {}

  get current(): string { return this.screens[Math.min(this.index, this.screens.length - 1)]; }
  async launchInstagram() { /* already foregrounded */ }
  async focusedPackage() { return 'com.instagram.android'; }
  async dumpHierarchy(): Promise<UiNode[]> { return load(this.current); }
  async tap(x: number, y: number) { this.taps.push({ x, y }); this.index++; }
  async sendText(value: string) { this.texts.push(value); }
  async pressBack() { this.backs++; }
  async fileTimestampMinutes() { return this.fileMinutes; }
  async screenshot() { return PNG; }
}

const FULL_FLOW = ['home.xml', 'profile.xml', 'creation-sheet.xml', 'gallery-picker.xml',
  'editor.xml', 'caption-screen.xml', 'caption-screen-filled.xml'];

const tapIn = (taps: { x: number; y: number }[], target: { x: number; y: number }) =>
  taps.some((t) => Math.abs(t.x - target.x) <= 2 && Math.abs(t.y - target.y) <= 2);

const centerOf = (nodes: UiNode[], query: { resourceId?: string; contentDesc?: string; text?: string }) => {
  const hit = nodes.find((n) => (!query.resourceId || n.resourceId === query.resourceId)
    && (query.contentDesc === undefined || n.contentDesc === query.contentDesc)
    && (query.text === undefined || n.text === query.text));
  return hit ? hit.center : null;
};

async function adapterTests() {
  // ── timestamps: the picker's creation date and the device listing must agree ──
  const tileMinutes = parseTileCreatedAt('Unselected Photo thumbnail created on September 28, 2026 3:45 PM');
  const lsMinutes = parseLsMinutes(STAGED_LISTING);
  assert.ok(tileMinutes !== null && lsMinutes !== null);
  assert.equal(tileMinutes, lsMinutes, 'tile "created on" time and the device listing must line up');
  assert.equal(parseTileCreatedAt('Selected Photo thumbnail'), null, 'undated tiles are not candidates');
  assert.equal(parseLsMinutes('no timestamp here'), null);
  console.log('PASS timestamps: picker creation time and device listing parse to the same minute');

  // ── screen classification ──
  const classify = (transport: InstagramUiTransport) =>
    new AdbInstagramUiAdapter('emulator-5554', transport).detectSecurityState();
  const expectations: [string, InstagramSecurityState][] = [
    ['home.xml', 'OK'], ['profile.xml', 'OK'], ['gallery-picker.xml', 'OK'],
    ['editor.xml', 'OK'], ['caption-screen-filled.xml', 'OK'],
    ['signin-wall.xml', 'LOGIN_REQUIRED'], ['unknown-screen.xml', 'UNKNOWN'],
  ];
  for (const [fixture, expected] of expectations) {
    assert.equal(await classify(new FixtureTransport([fixture])), expected, `${fixture} must classify as ${expected}`);
  }
  console.log('PASS screen classification: authenticated surfaces OK, sign-in wall LOGIN_REQUIRED, anything else UNKNOWN');

  // ── identity + the full create-post walk, driven only by observed anchors ──
  const transport = new FixtureTransport(FULL_FLOW);
  const adapter = new AdbInstagramUiAdapter('emulator-5554', transport);
  assert.equal(await adapter.detectSecurityState(), 'OK');
  assert.equal(await adapter.readActiveUsername(), 'naspeny.jaya', 'profile header must be read verbatim');
  await adapter.openCreatePost();
  const selection = await adapter.selectStagedImage(STAGED_FILE);
  assert.equal(selection.selectedImageCount, 1);
  assert.match(selection.selectedTile, /created on September 28, 2026 3:45 PM/);
  await adapter.enterCaption(CAPTION);
  assert.deepEqual(transport.texts, [CAPTION], 'the approved caption is typed as-is');
  assert.equal(transport.backs, 1, 'the in-place caption editor is closed with BACK before the boundary');
  await adapter.reachPublishBoundary();
  const prepared = await adapter.verifyPreparedState({ caption: CAPTION });
  assert.equal(prepared.ok, true, prepared.detail);
  assert.equal(prepared.captionText, CAPTION);
  assert.match(prepared.shareSelector || '', /share_footer_button/);
  assert.match(prepared.shareSelector || '', /content-desc "Share"/);
  assert.equal(prepared.selectedImageCount, 1);

  // Every tap must be an observed target — and never the Share control or the multi-select toggle.
  const expectedTaps = [OBSERVED_TAPS.profileTab, OBSERVED_TAPS.createEntry, OBSERVED_TAPS.createNewPostRow,
    OBSERVED_TAPS.galleryNext, OBSERVED_TAPS.editorNext, OBSERVED_TAPS.captionField];
  assert.equal(transport.taps.length, expectedTaps.length, `unexpected extra taps: ${JSON.stringify(transport.taps)}`);
  // Centres are computed from the node bounds, so a one-pixel rounding difference from the hand
  // taps used during inspection is expected; anything larger means a different target was tapped.
  expectedTaps.forEach((target, i) => {
    const tap = transport.taps[i];
    assert.ok(Math.abs(tap.x - target.x) <= 2 && Math.abs(tap.y - target.y) <= 2,
      `tap ${i} (${tap.x},${tap.y}) must match the observed device target (${target.x},${target.y})`);
  });
  const gallery = await load('gallery-picker.xml');
  const captionScreen = await load('caption-screen.xml');
  const multiSelect = centerOf(gallery, { resourceId: 'com.instagram.android:id/multi_select_slide_button_alt' });
  const shareControl = centerOf(captionScreen, { resourceId: INSTAGRAM_ID.shareButton, contentDesc: 'Share' });
  assert.ok(multiSelect && shareControl);
  assert.ok(!tapIn(transport.taps, multiSelect), 'the multi-select toggle is never used (single image only)');
  assert.ok(!tapIn(transport.taps, shareControl), 'Share is never tapped in the preparation flow');
  console.log('PASS create-post walk: observed anchors only, single image selected, Share never tapped');

  // ── Share is refused by construction in preparation-only mode ──
  const tapsBefore = transport.taps.length;
  await assert.rejects(() => adapter.pressShare(), (error: any) => error instanceof InstagramPublishNotApprovedError);
  assert.equal(transport.taps.length, tapsBefore, 'pressShare must not dispatch any tap');
  console.log('PASS pressShare is disabled: preparation-only mode cannot press Share');

  // ── a wrong image is refused instead of posted ──
  const stale = new FixtureTransport(['gallery-picker.xml'], parseLsMinutes('-rw-rw---- 1 u0_a213 media_rw 25983 2026-09-28 15:31 other.png'));
  const staleAdapter = new AdbInstagramUiAdapter('emulator-5554', stale);
  await assert.rejects(() => staleAdapter.selectStagedImage(STAGED_FILE), (error: any) =>
    error instanceof InstagramScreenExpectationError && /not the staged image/.test(error.message));
  assert.equal(stale.taps.length, 1, 'the flow stops after the mismatching selection instead of continuing');
  console.log('PASS selection is verified: a selection that is not the staged image aborts the run');

  // ── an unreadable staged file fails closed before any tap ──
  const unreadable = new FixtureTransport(['gallery-picker.xml'], null);
  await assert.rejects(() => new AdbInstagramUiAdapter('emulator-5554', unreadable).selectStagedImage(STAGED_FILE),
    (error: any) => error instanceof InstagramScreenExpectationError && /timestamp/.test(error.message));
  assert.equal(unreadable.taps.length, 0, 'no blind tapping when the staged image cannot be identified');
  console.log('PASS unidentifiable staged image fails closed with zero taps');

  // ── the informational "Sharing posts" sheet: only its acknowledge label is tapped ──
  const sheetTransport = new FixtureTransport(['sharing-posts-sheet.xml', 'caption-screen.xml']);
  const sheetAdapter = new AdbInstagramUiAdapter('emulator-5554', sheetTransport);
  await sheetAdapter.reachPublishBoundary();
  const sheet = await load('sharing-posts-sheet.xml');
  const ack = centerOf(sheet, { resourceId: INSTAGRAM_ID.sheetText, text: 'OK' });
  const manageSettings = centerOf(sheet, { resourceId: INSTAGRAM_ID.sheetText, text: 'Manage settings' });
  assert.ok(ack && manageSettings);
  assert.deepEqual(sheetTransport.taps, [ack], 'only the acknowledge label is tapped');
  assert.ok(!tapIn(sheetTransport.taps, manageSettings), '"Manage settings" is never tapped (no account settings changes)');
  console.log('PASS informational sheet: acknowledged via its OK label, "Manage settings" untouched');
}

// ── worker + scheduler: preparation-only semantics ──

class PrepAdapter implements InstagramUiAdapter {
  steps: string[] = [];
  sharePresses = 0;
  preparedOk = true;
  preparedCaption = CAPTION;
  failure: Error | null = null;

  async ensureInstagramForeground() { this.steps.push('ensure'); }
  async detectSecurityState(): Promise<InstagramSecurityState> { return 'OK'; }
  async readActiveUsername() { this.steps.push('username'); return 'naspeny.jaya'; }
  async openCreatePost() { this.steps.push('open'); if (this.failure) throw this.failure; }
  async selectStagedImage() {
    this.steps.push('select');
    return { selectedTile: 'Selected Photo thumbnail created on September 28, 2026 3:45 PM', selectedImageCount: 1 };
  }
  async enterCaption() { this.steps.push('caption'); }
  async reachPublishBoundary() { this.steps.push('boundary'); }
  async verifyPreparedState() {
    this.steps.push('verify-prepared');
    return {
      ok: this.preparedOk, detail: this.preparedOk ? 'prepared' : 'the caption does not match the approved caption',
      shareSelector: 'com.instagram.android:id/share_footer_button (content-desc "Share", class android.widget.Button)',
      captionText: this.preparedCaption, selectedImageCount: 1,
    };
  }
  async pressShare() { this.steps.push('share'); this.sharePresses++; }
  async verifyPublished() { return { published: null, detail: 'not exercised in preparation-only mode' }; }
  async captureEvidence(tag: string) { return path.join(TMP, `prep-evidence-${tag.replace(/[^a-z0-9-]+/gi, '-')}.png`); }
}

const prisma = new PrismaClient();
let mediaPath = '';
let mediaSha = '';
let deviceId = '';

async function reset() {
  await prisma.activityLog.deleteMany({});
  await prisma.androidJob.deleteMany({});
  await prisma.socialAccount.deleteMany({});
  await prisma.androidDevice.deleteMany({});
  await prisma.workspace.upsert({ where: { id: 'workspace-default' }, update: {}, create: { id: 'workspace-default', name: 'Default' } });
  const device = await prisma.androidDevice.create({ data: { name: 'Prep-Test-Device', avdName: 'Medium_Phone_API_36.1', status: 'READY' } });
  deviceId = device.id;
}

async function makeAccount(username = 'naspeny.jaya') {
  return prisma.socialAccount.create({ data: {
    workspaceId: 'workspace-default', platform: 'Instagram', username, executionEngine: 'android',
    homeDeviceId: deviceId, androidHealth: 'UNKNOWN',
  } });
}

async function makeQueuedJob(accountId: string, extra: Record<string, unknown> = {}) {
  return prisma.androidJob.create({ data: {
    accountId, deviceId, type: 'ANDROID_IMAGE_POST', status: 'QUEUED', caption: CAPTION,
    mediaPath, mediaSha256: mediaSha, idempotencyKey: `android-image:${Math.random().toString(36).slice(2)}`,
    approvedAt: new Date(), ...extra,
  } });
}

const workerFor = (adapter: PrepAdapter) => new InstagramAndroidWorker(prisma, adapter, 'emulator-5554',
  { stage: async () => ({ remote: STAGED_FILE, bytes: PNG.length, sha256: mediaSha }),
    cleanup: async () => undefined } as any);

async function main() {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) {
    throw new Error('Scratch DB + Local Mode required');
  }
  if (process.env.ANDROID_PUBLISH_APPROVED === 'true') {
    throw new Error('This suite covers preparation-only mode: ANDROID_PUBLISH_APPROVED must stay unset');
  }
  await prisma.androidJob.count(); // fail fast when the DB is not migrated

  await adapterTests();

  mediaPath = path.join(TMP, 'rockbase-phase3c-prep-media.png');
  await fsp.writeFile(mediaPath, PNG);
  mediaSha = createHash('sha256').update(PNG).digest('hex');

  // ── 1. Preparation-only run reaches READY_FOR_REAL_POST with Share never pressed ──
  await reset();
  const account = await makeAccount();
  const job = await makeQueuedJob(account.id);
  const adapter = new PrepAdapter();
  let outcome: InstagramJobOutcome = await workerFor(adapter).run(job.id);
  assert.equal(outcome.status, 'READY_FOR_REAL_POST');
  let row = await prisma.androidJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(row.status, 'READY_FOR_REAL_POST');
  assert.equal(row.verificationResult, 'PREPARED');
  assert.equal(row.publishBoundaryAt, null, 'no publish boundary may be crossed in preparation-only mode');
  assert.equal(adapter.sharePresses, 0, 'Share invocation count must be 0');
  const result = row.result as any;
  assert.equal(result.shareInvocationCount, 0);
  assert.equal(result.publishApproved, false);
  assert.equal(result.captionVerified, true);
  assert.equal(result.caption, CAPTION);
  assert.equal(result.selectedImageCount, 1);
  assert.match(result.shareSelector, /share_footer_button/);
  assert.equal(result.detectedUsername, 'naspeny.jaya');
  assert.ok(result.hold?.until && new Date(result.hold.until).getTime() > Date.now(), 'the prepared screen is held for a bounded window');
  assert.ok(row.evidencePath, 'an evidence artifact of the prepared screen is recorded');
  console.log('PASS preparation-only: READY_FOR_REAL_POST, boundary untouched, Share invocation count 0');

  // ── 2. Live identity verification is what made the account HEALTHY ──
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
  assert.equal(acc.androidHealth, 'HEALTHY');
  assert.equal(acc.androidVerifiedUsername, 'naspeny.jaya');
  assert.ok(acc.androidLastVerifiedAt);
  console.log('PASS account health: HEALTHY only after the live on-device identity read');

  // ── 3. Duplicate delivery cannot rebuild the post or create a second publish intent ──
  const stepsBefore = adapter.steps.join(',');
  const duplicate = new PrepAdapter();
  const duplicateOutcome = await workerFor(duplicate).run(job.id);
  assert.equal(duplicateOutcome.status, 'READY_FOR_REAL_POST');
  assert.equal(duplicate.steps.length, 0, 're-delivery must not touch the device again');
  assert.equal(duplicate.sharePresses, 0);
  assert.equal(adapter.steps.join(','), stepsBefore);
  row = await prisma.androidJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(row.status, 'READY_FOR_REAL_POST');
  assert.equal(row.publishBoundaryAt, null);
  console.log('PASS duplicate delivery: the prepared post is reported as-is, no device work, no second publish intent');

  // ── 4. A prepared screen that cannot be verified is NEEDS_ATTENTION, never published ──
  await reset();
  const account2 = await makeAccount();
  const job2 = await makeQueuedJob(account2.id);
  const adapter2 = new PrepAdapter();
  adapter2.preparedOk = false;
  outcome = await workerFor(adapter2).run(job2.id);
  assert.equal(outcome.status, 'NEEDS_ATTENTION');
  row = await prisma.androidJob.findUniqueOrThrow({ where: { id: job2.id } });
  assert.equal(row.verificationResult, 'PREPARATION_INCOMPLETE');
  assert.equal(row.publishBoundaryAt, null);
  assert.equal(adapter2.sharePresses, 0);
  console.log('PASS unverifiable prepared screen → NEEDS_ATTENTION with no boundary and no Share');

  // ── 5. An unexpected screen stops the run for a human look instead of guessing ──
  await reset();
  const account3 = await makeAccount();
  const job3 = await makeQueuedJob(account3.id);
  const adapter3 = new PrepAdapter();
  adapter3.failure = new InstagramScreenExpectationError('the creation sheet did not open');
  outcome = await workerFor(adapter3).run(job3.id);
  assert.equal(outcome.status, 'NEEDS_ATTENTION');
  row = await prisma.androidJob.findUniqueOrThrow({ where: { id: job3.id } });
  assert.equal(row.verificationResult, 'SCREEN_EXPECTATION_FAILED');
  assert.equal(row.publishBoundaryAt, null);
  assert.equal(adapter3.sharePresses, 0);
  console.log('PASS unexpected screen → NEEDS_ATTENTION, no tapping onward, no Share');

  // ── 6. Scheduler: the prepared post reserves its device for a bounded window ──
  const gateCalls: string[] = [];
  const fakeDevices = { start: async () => { gateCalls.push('start'); throw new Error('device work must not start'); },
    stop: async () => { gateCalls.push('stop'); }, refresh: async () => { gateCalls.push('refresh'); } } as any;
  const fakeRuntime = { resolveSerial: async () => { gateCalls.push('resolveSerial'); return null; },
    health: async () => false, screenshot: async () => Buffer.alloc(0), connected: async () => [] } as any;
  const factory: InstagramRunnerFactory = () => ({ run: async () => { gateCalls.push('runner'); throw new Error('runner must not run'); } });
  const scheduler = new AndroidScheduler(prisma, fakeDevices, fakeRuntime, undefined, factory);

  await reset();
  const holdAccount = await makeAccount();
  // The scheduler only dispatches verified Android accounts; the hold must be what stops the run.
  await prisma.socialAccount.update({ where: { id: holdAccount.id }, data: {
    androidHealth: 'HEALTHY', androidVerifiedUsername: 'naspeny.jaya', androidLastVerifiedAt: new Date(),
  } });
  const holdUntil = new Date(Date.now() + 30 * 60_000);
  const preparedJob = await makeQueuedJob(holdAccount.id, {
    status: 'READY_FOR_REAL_POST', verificationResult: 'PREPARED', finishedAt: new Date(),
    result: { preparedAt: new Date().toISOString(), shareInvocationCount: 0, hold: { until: holdUntil.toISOString(), minutes: 30 } } as any,
  });
  const other = await makeQueuedJob(holdAccount.id);

  const skipped = await scheduler.run(preparedJob.id);
  assert.equal(skipped.status, 'SKIPPED', 'a prepared job is never re-run by the scheduler');
  const waited = await scheduler.run(other.id);
  assert.equal(waited.status, 'WAITING');
  assert.match(waited.reason || '', /holding a prepared post/);
  assert.equal(gateCalls.length, 0, 'the device is untouched while a prepared post is held');
  assert.equal((await prisma.androidDevice.findUniqueOrThrow({ where: { id: deviceId } })).idleSince, null,
    'the prepared device must not start its idle countdown during the hold');
  console.log('PASS prepared hold: another job waits, the device is never navigated away, nothing is re-run');

  // ── 7. The hold is time bounded: once expired the normal idle grace reclaims the device ──
  await prisma.androidJob.update({ where: { id: preparedJob.id }, data: { result: {
    ...(preparedJob.result as any), hold: { until: new Date(Date.now() - 60_000).toISOString(), minutes: 30 },
  } as any } });
  assert.equal(await scheduler.sweepPreparedHolds(), 1, 'an expired hold is released');
  assert.ok((await prisma.androidDevice.findUniqueOrThrow({ where: { id: deviceId } })).idleSince,
    'the released device starts the ordinary idle countdown');
  const resumed = await scheduler.run(other.id);
  assert.notEqual(resumed.status, 'WAITING', 'once the hold expires the waiting job may proceed');
  assert.ok(gateCalls.includes('resolveSerial'), 'the job now reaches the device stage');
  console.log('PASS hold expiry: bounded reservation, then the normal idle grace takes over');

  console.log('PASS Phase3C: real adapter flow, observed-only taps, single-image selection, Share never pressed, preparation-only pipeline + bounded hold');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });

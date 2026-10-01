/**
 * RockDroid identity + persistence guard tests (Phase 3E).
 *
 * Hermetic: the ADB transport is a fake (injected into the AndroidIdentityService singleton) and the
 * AVD home/SDK are temp directories, so no emulator, no Instagram and no real ADB are touched. The
 * Prisma client talks only to a scratch SQLite database.
 *
 * Scratch DB must be created and migrated first:
 *   DATABASE_URL="file:./scratch/android-identity-guard.db" npx prisma migrate deploy
 * Run:
 *   DATABASE_URL="file:./scratch/android-identity-guard.db" ROCKBASE_MODE=local \
 *     npx ts-node --files src/scripts/android-identity-guard-test.ts
 */
import assert from 'assert/strict';
import { randomUUID } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { androidRuntime } from '../services/AndroidRuntimeService';
import { androidDevices } from '../services/AndroidDeviceService';
import {
  AdbIdentityTransport, AndroidIdentityService, androidIdentity, androidAdbPath, androidAvdHome, androidSdkRoot,
  resolveAvdIdentity, verifyRegistry, GUEST_MARKER_PATH, INSTAGRAM_PACKAGE,
  type AdbRunner, type AndroidIdentityTransport,
} from '../services/AndroidIdentityService';

const AVD = 'Medium_Phone_API_36.1';
const AVD_DIRECTORY = 'Medium_Phone.avd';
const REGISTERED_AVD = 'RockDroid-Registered-AVD';
const prisma = new PrismaClient();

// ── temp AVD home: an ini whose declared path differs from the AVD name, exactly like the real one ──
const sandbox = path.join(os.tmpdir(), `rockbase-identity-${randomUUID()}`);
const avdHome = path.join(sandbox, 'avd-home');
const userHome = path.join(sandbox, 'user-home');
const avdDirectory = path.join(avdHome, AVD_DIRECTORY);

function writeAvdFixture(): void {
  mkdirSync(avdDirectory, { recursive: true });
  writeFileSync(path.join(avdHome, `${AVD}.ini`),
    `avd.ini.encoding=UTF-8\r\npath=${avdDirectory.replace(/\//g, '\\')}\r\npath.rel=avd\\${AVD_DIRECTORY}\r\ntarget=android-36.1\r\n`);
  writeFileSync(path.join(avdDirectory, 'config.ini'),
    'AvdId=Medium_Phone_API_36.1\r\nPlayStore.enabled=true\r\nabi.type=x86_64\r\nimage.sysdir.1=system-images\\android-36.1\\google_apis_playstore\\x86_64\\\r\ntag.id=google_apis_playstore\r\n');
  writeFileSync(path.join(avdDirectory, 'userdata-qemu.img'), '');
}

/** Device transport stand-in: `marker` is the on-device file, `writes` proves what was written when. */
class FakeTransport implements AndroidIdentityTransport {
  marker: string | null = null;
  writes: string[] = [];
  appPresent = true;
  readFailure: string | null = null;
  appCheckFailure: string | null = null;
  async readMarker(): Promise<string | null> {
    if (this.readFailure) throw new Error(this.readFailure);
    return this.marker;
  }
  async writeMarker(_serial: string, marker: string): Promise<void> {
    this.writes.push(marker);
    this.marker = marker;
  }
  async appInstalled(): Promise<boolean> {
    if (this.appCheckFailure) throw new Error(this.appCheckFailure);
    return this.appPresent;
  }
}

// ── mocked ADB runtime: `running` maps avdName -> serial ──
const running = new Map<string, string>();
let startCalls = 0;
const installRuntime = () => {
  androidRuntime.connected = async () => [...running.values()];
  androidRuntime.resolveSerial = async (avd: string) => running.get(avd) ?? null;
  androidRuntime.health = async () => true;
  androidRuntime.listAvds = async () => [AVD, REGISTERED_AVD];
  androidRuntime.start = async (avd: string) => {
    startCalls += 1;
    const serial = `emulator-${5554 + running.size * 2}`;
    running.set(avd, serial);
    return serial;
  };
  androidRuntime.stop = async (serial: string) => { for (const [avd, value] of running) if (value === serial) running.delete(avd); };
  androidRuntime.screenshot = async () => Buffer.from('fake-png');
};

let deviceId = '';
let accountId = '';
let nameSeq = 0;
async function resetDevice(status = 'OFFLINE'): Promise<void> {
  await prisma.androidJob.deleteMany({});
  await prisma.socialAccount.deleteMany({});
  await prisma.androidDevice.deleteMany({});
  await prisma.activityLog.deleteMany({});
  await prisma.workspace.upsert({ where: { id: 'workspace-default' }, update: {}, create: { id: 'workspace-default', name: 'Default' } });
  const device = await prisma.androidDevice.create({ data: { name: `identity-guard-${++nameSeq}-${Date.now()}`, avdName: AVD, status } });
  deviceId = device.id;
  const account = await prisma.socialAccount.create({ data: {
    workspaceId: 'workspace-default', platform: 'Instagram', username: `identity-guard-${Date.now()}-${nameSeq}`,
    executionEngine: 'android', homeDeviceId: deviceId, androidHealth: 'HEALTHY',
    androidVerifiedUsername: 'identity.guard', androidLastVerifiedAt: new Date(),
  } });
  accountId = account.id;
  running.clear();
  transport.marker = null;
  transport.writes = [];
  transport.readFailure = null;
  transport.appCheckFailure = null;
  transport.appPresent = true;
  startCalls = 0;
}

const device = async () => prisma.androidDevice.findUniqueOrThrow({ where: { id: deviceId } });
const account = async () => prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });

const transport = new FakeTransport();

async function main(): Promise<void> {
  if (process.env.ROCKBASE_MODE !== 'local' || !process.env.DATABASE_URL?.includes('scratch')) {
    throw new Error('Scratch DB + Local Mode required');
  }
  await prisma.androidDevice.count(); // fail fast when the scratch DB is not migrated
  writeAvdFixture();
  delete process.env.ANDROID_AVD_HOME;
  delete process.env.ANDROID_SDK_ROOT;
  delete process.env.ANDROID_HOME;
  process.env.ANDROID_USER_HOME = userHome;
  process.env.ANDROID_MAX_CONCURRENT = '3';
  installRuntime();
  // The DeviceService uses the module singleton, so the fake transport is injected into it.
  (androidIdentity as any).transport = transport;
  assert.ok(androidIdentity instanceof AndroidIdentityService);

  // ── 1. Env resolution: AVD_USER_HOME, then ANDROID_AVD_HOME wins; SDK like the runtime ──
  assert.equal(androidAvdHome(), path.join(userHome, 'avd'), 'ANDROID_USER_HOME/avd is the default AVD home');
  assert.equal(androidAvdHome({ ANDROID_AVD_HOME: avdHome } as any), path.resolve(avdHome), 'ANDROID_AVD_HOME wins');
  process.env.ANDROID_AVD_HOME = avdHome;
  // No ANDROID_SDK_ROOT/ANDROID_HOME: the shared resolution must fall back to %LOCALAPPDATA%/Android/Sdk.
  const localSdk = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null;
  assert.equal(androidSdkRoot(), localSdk ? path.resolve(localSdk) : null, 'SDK falls back exactly like the runtime');
  if (localSdk) assert.match(androidAdbPath(), /platform-tools[\\/]adb(\.exe)?$/, 'commands run through the SDK adb, never a bare PATH adb');
  assert.equal(typeof new AdbIdentityTransport().readMarker, 'function');
  console.log('PASS env: ANDROID_AVD_HOME / ANDROID_USER_HOME honored, SDK resolution shared with the runtime');

  // ── 2. Host pin: the AVD ini declares a directory name different from the AVD name ──
  const identity = resolveAvdIdentity(AVD);
  assert.equal(path.basename(identity.avdIniPath), `${AVD}.ini`);
  assert.equal(path.basename(identity.avdAbsolutePath), AVD_DIRECTORY, 'the declared ini path wins over the AVD name');
  assert.equal(path.basename(identity.userdataPath), 'userdata-qemu.img');
  assert.equal(identity.systemImage, 'system-images/android-36.1/google_apis_playstore/x86_64');
  assert.equal(identity.pin.avdAbsolutePath, identity.avdAbsolutePath.replace(/\\/g, '/'), 'the registry pin is forward-slash absolute');
  assert.equal(identity.datadir, identity.avdAbsolutePath, '-datadir pin');
  assert.equal(identity.data, identity.userdataPath, '-data pin');
  assert.throws(() => resolveAvdIdentity('not a valid avd name!'), /Invalid AVD name/, 'resolution refuses an unusable AVD name');
  console.log(`PASS resolve: ${AVD} -> ${identity.pin.avdAbsolutePath} (${identity.systemImage})`);

  // ── 3. Registry verdicts: unenrolled is fine, pinned-but-incomplete and any drift are not ──
  const pins = identity.pin;
  assert.deepEqual(verifyRegistry({}, identity).state, 'NOT_ENROLLED');
  assert.equal(verifyRegistry({}, identity).ok, true, 'an unenrolled row may still boot');
  const incomplete = verifyRegistry({ avdIniPath: pins.avdIniPath }, identity);
  assert.equal(incomplete.state, 'INCOMPLETE');
  assert.equal(incomplete.ok, false, 'pins without a marker fail closed');
  const enrolled = { persistentMarker: randomUUID(), ...pins };
  assert.equal(verifyRegistry(enrolled, identity).state, 'VERIFIED');
  const moved = verifyRegistry({ ...enrolled, avdAbsolutePath: 'C:/somewhere/else/Other.avd' }, identity);
  assert.equal(moved.state, 'MISMATCH');
  assert.deepEqual(moved.mismatches, ['avdAbsolutePath']);
  const swapped = verifyRegistry({ ...enrolled, userdataPath: `${pins.avdAbsolutePath}/other-userdata.img` }, identity);
  assert.deepEqual(swapped.mismatches, ['userdataPath']);
  const otherImage = verifyRegistry({ ...enrolled, systemImage: 'system-images/android-36/google_apis/x86_64' }, identity);
  assert.deepEqual(otherImage.mismatches, ['systemImage']);
  console.log('PASS registry: unenrolled ok, incomplete fails closed, path/userdata/systemImage drift detected');

  // ── 4. Guest marker: bootstrap writes once, afterwards missing/mismatch never regenerates ──
  const marker = randomUUID();
  assert.equal((await androidIdentity.verifyGuest('emulator-5554', null)).state, 'UNKNOWN');
  assert.equal((await androidIdentity.verifyGuest('emulator-5554', 'not-a-uuid')).state, 'UNKNOWN');
  const before = transport.writes.length;
  const missing = await androidIdentity.verifyGuest('emulator-5554', marker);
  assert.equal(missing.state, 'MISSING');
  assert.equal(missing.ok, false);
  assert.equal(transport.writes.length, before, 'a missing marker is never regenerated by a plain check');
  transport.marker = randomUUID();
  const mismatched = await androidIdentity.verifyGuest('emulator-5554', marker);
  assert.equal(mismatched.state, 'MISMATCH');
  assert.equal(transport.writes.length, before, 'a mismatched marker is never overwritten');
  assert.equal((await androidIdentity.verifyGuest('emulator-5554', marker, { bootstrap: true })).state, 'ENROLLED');
  assert.deepEqual(transport.writes, [marker], 'the enrolling boot writes the marker exactly once');
  assert.equal((await androidIdentity.verifyGuest('emulator-5554', marker)).state, 'VERIFIED', 'the marker persisted');
  transport.readFailure = 'adb: device offline';
  assert.equal((await androidIdentity.verifyGuest('emulator-5554', marker)).state, 'UNKNOWN', 'an unreadable marker fails closed');
  transport.marker = marker;
  console.log('PASS guest marker: bootstrap once, then MISSING/MISMATCH fail closed without regeneration');

  // ── 5. First authorized boot enrolls: host pin + marker, device becomes READY ──
  await resetDevice();
  const registered = await androidDevices.register({ name: `registered-${Date.now()}`, avdName: REGISTERED_AVD });
  assert.equal(registered.avdAbsolutePath, null, 'a new device is unenrolled until its first boot');
  assert.equal(registered.persistentMarker, null);
  await prisma.androidDevice.delete({ where: { id: registered.id } });
  const first = await androidDevices.start(deviceId);
  assert.equal(first.status, 'READY');
  const enrolledRow = await device();
  assert.equal(enrolledRow.avdAbsolutePath, identity.pin.avdAbsolutePath, 'the AVD directory is pinned');
  assert.equal(enrolledRow.avdIniPath, identity.pin.avdIniPath);
  assert.equal(enrolledRow.userdataPath, identity.pin.userdataPath);
  assert.equal(enrolledRow.systemImage, identity.pin.systemImage);
  assert.match(String(enrolledRow.persistentMarker), /^[0-9a-f-]{36}$/i, 'a marker UUID is pinned');
  assert.ok(enrolledRow.identityEnrolledAt, 'enrollment is timestamped');
  assert.deepEqual(transport.writes, [enrolledRow.persistentMarker], 'the enrolling boot created the guest marker once');
  assert.equal(transport.marker, enrolledRow.persistentMarker);
  console.log('PASS enroll: first authorized boot pins ini/dir/userdata/systemImage + marker once');

  // ── 5b. A refused start never enrolls: a stale READY row with no live emulator keeps no identity ──
  await resetDevice('READY'); // stale row, no emulator running
  await assert.rejects(() => androidDevices.start(deviceId), /not startable/);
  const stale = await device();
  assert.equal(stale.persistentMarker, null, 'a claim that never happened must not pin a marker');
  assert.equal(stale.avdAbsolutePath, null, 'a claim that never happened must not pin the AVD path');
  assert.equal(stale.identityEnrolledAt, null);
  assert.deepEqual(transport.writes, [], 'a claim that never happened must not write a guest marker');
  assert.equal(startCalls, 0, 'the emulator was never started');
  console.log('PASS refused start: no enrollment, no pin, no guest marker');

  // ── 5c. A boot that fails after the claim never enrolls either; the next boot enrolls cleanly ──
  await resetDevice('OFFLINE');
  const realStart = androidRuntime.start;
  androidRuntime.start = async () => { throw new Error('emulator exited during boot (code 1)'); };
  await assert.rejects(() => androidDevices.start(deviceId), /exited during boot/);
  const failedBoot = await device();
  assert.equal(failedBoot.status, 'ERROR');
  assert.equal(failedBoot.persistentMarker, null, 'a failed boot must not leave a half-enrolled identity');
  assert.equal(failedBoot.avdAbsolutePath, null);
  assert.deepEqual(transport.writes, [], 'a failed boot must not write a guest marker');
  androidRuntime.start = realStart;
  const enrolledAfterFailure = await androidDevices.start(deviceId);
  assert.equal(enrolledAfterFailure.status, 'READY');
  assert.match(String(enrolledAfterFailure.persistentMarker), /^[0-9a-f-]{36}$/i);
  assert.equal(enrolledAfterFailure.identityEnrolledAt !== null, true);
  assert.deepEqual(transport.writes, [enrolledAfterFailure.persistentMarker], 'the retry enrolls exactly once');
  console.log('PASS failed boot: nothing pinned, retry enrolls once');

  // ── 6. Second boot only verifies: no re-pin, no marker write ──
  const enrolledMarker = (await device()).persistentMarker;
  await androidDevices.stop(deviceId);
  assert.equal((await device()).status, 'OFFLINE');
  const second = await androidDevices.start(deviceId);
  assert.equal(second.status, 'READY');
  assert.equal(transport.writes.length, 1, 'a normal boot never rewrites the marker');
  assert.equal((await device()).persistentMarker, enrolledMarker, 'the marker is never regenerated');
  console.log('PASS reboot: marker read and matched, nothing regenerated');

  // ── 7. Cold boot loses the marker -> ATTENTION, no regeneration, no automatic kill ──
  await androidDevices.stop(deviceId);
  transport.marker = null; // -no-snapshot-load cold boot with an unsynced write
  const lost = await androidDevices.start(deviceId);
  assert.equal(lost.status, 'ATTENTION', 'a missing marker is an operator-visible ATTENTION');
  assert.match(String(lost.lastError), /missing/i);
  assert.equal(transport.writes.length, 1, 'the lost marker is never regenerated');
  assert.equal((await device()).persistentMarker, enrolledMarker);
  assert.ok(running.has(AVD), 'the emulator is not killed by an identity defect');
  assert.equal((await device()).status, 'ATTENTION');
  console.log('PASS cold boot: missing marker -> ATTENTION, no regeneration, no kill');

  // ── 8. Marker mismatch on a booted device: ATTENTION, and force-clear cannot bypass it ──
  transport.marker = randomUUID();
  const drifted = await androidDevices.refresh(deviceId, true);
  assert.equal(drifted.status, 'ATTENTION', 'force clear must not bypass an identity mismatch');
  assert.match(String(drifted.lastError), /marker mismatch/i);
  assert.equal((await device()).status, 'ATTENTION');
  transport.marker = enrolledMarker;
  console.log('PASS mismatch: ATTENTION survives an explicit force clear');

  // ── 9. Host path mismatch: refused before any boot, never ERROR, no kill ──
  await androidDevices.stop(deviceId);
  const bootsBefore = startCalls;
  running.clear();
  await prisma.androidDevice.update({ where: { id: deviceId }, data: { avdAbsolutePath: 'C:/somewhere/else/Renamed.avd' } });
  transport.marker = enrolledMarker;
  const refused = await androidDevices.start(deviceId);
  assert.equal(refused.status, 'ATTENTION');
  assert.match(String(refused.lastError), /avdAbsolutePath/);
  assert.notEqual(refused.status, 'ERROR');
  assert.equal(startCalls, bootsBefore, 'a changed AVD on disk is refused before the emulator starts');
  assert.equal(running.has(AVD), false, 'nothing was booted and nothing was killed');
  assert.equal((await device()).persistentMarker, enrolledMarker, 'the identity is not re-pinned');
  assert.deepEqual(transport.writes, [enrolledMarker], 'no marker write after a host mismatch');
  console.log('PASS host drift: refused pre-boot as ATTENTION, registry untouched');

  // ── 9b. Incomplete first enrollment (pins + marker, never verified, guest marker missing) recovers
  //        the SAME UUID; a verified device can never take that path ──
  await resetDevice('OFFLINE');
  const recoverable = randomUUID();
  await prisma.androidDevice.update({ where: { id: deviceId }, data: {
    avdIniPath: identity.pin.avdIniPath, avdAbsolutePath: identity.pin.avdAbsolutePath,
    userdataPath: identity.pin.userdataPath, systemImage: identity.pin.systemImage,
    persistentMarker: recoverable, identityEnrolledAt: new Date(), identityVerifiedAt: null,
  } });
  transport.marker = null; // the enrollment never proved the marker on the guest
  const recovered = await androidDevices.start(deviceId);
  assert.equal(recovered.status, 'READY', 'an incomplete first enrollment is recoverable');
  assert.deepEqual(transport.writes, [recoverable], 'recovery writes the pinned UUID, never a new one');
  assert.equal((await device()).persistentMarker, recoverable, 'the registry identity is unchanged');
  assert.ok((await device()).identityVerifiedAt, 'the enrollment is now verified');
  // With the enrollment verified, the same missing marker is a permanent defect.
  await androidDevices.stop(deviceId);
  transport.marker = null;
  const afterRecovery = await androidDevices.start(deviceId);
  assert.equal(afterRecovery.status, 'ATTENTION', 'a verified device never recovers a lost marker');
  assert.deepEqual(transport.writes, [recoverable], 'no further marker writes after verification');
  console.log('PASS recovery: incomplete enrollment re-applies the same UUID once, verified device does not');

  // ── 10. App missing: device stays READY, account NEEDS_ATTENTION, Instagram remains blocked ──
  await resetDevice('OFFLINE');
  transport.appPresent = false;
  const appMissing = await androidDevices.start(deviceId);
  assert.equal(appMissing.status, 'READY', 'a missing app is account readiness, not device ATTENTION');
  assert.match(String(appMissing.lastError), new RegExp(INSTAGRAM_PACKAGE.replace(/\./g, '\\.')));
  assert.equal(await androidIdentity.instagramInstalled(appMissing.adbSerial as string), false);
  assert.equal((await account()).androidHealth, 'NEEDS_ATTENTION', 'the bound account is flagged, not reinstalled');
  assert.match(String((await account()).androidHealthReason), /missing/i);
  assert.ok(running.has(AVD), 'the device stays booted so infrastructure checks remain possible');
  await androidDevices.stop(deviceId);
  assert.equal((await device()).status, 'OFFLINE');
  const rebooted = await androidDevices.start(deviceId);
  assert.equal(rebooted.status, 'READY');
  assert.match(String(rebooted.lastError), /missing/i);
  assert.equal(startCalls, 2, 'a device with a missing app is still bootable');
  transport.appCheckFailure = 'adb: device offline';
  assert.equal((await androidDevices.refresh(deviceId, true)).status, 'READY');
  transport.appCheckFailure = null;
  console.log('PASS app missing: device READY, account NEEDS_ATTENTION, boot/check still possible');

  // ── 11. list(): an identity defect is ATTENTION, never the runtime ERROR catch ──
  transport.marker = randomUUID();
  await prisma.androidDevice.update({ where: { id: deviceId }, data: { status: 'READY' } });
  transport.appPresent = true;
  const listed = (await androidDevices.list()).find((item) => item.id === deviceId);
  assert.equal(listed?.status, 'ATTENTION');
  assert.match(String(listed?.lastError), /marker mismatch/i);
  assert.equal(running.has(AVD), true, 'listing keeps the emulator running');
  console.log('PASS list: identity defect surfaces as ATTENTION, untouched runtime');

  // ── 12. Production transport: single-argv shell commands, mount wait, flush, read-back proof ──
  process.env.ANDROID_IDENTITY_MOUNT_ATTEMPTS = '3';
  process.env.ANDROID_IDENTITY_MOUNT_PAUSE_MS = '20';
  const calls: string[] = [];
  const rawCalls: string[][] = [];
  let mountReady = false;
  const transportMarker = randomUUID();
  const recorded: AdbRunner = async (_serial, args) => {
    rawCalls.push(args);
    const command = args.join(' ');
    calls.push(command);
    if (command.includes('mounted')) return mountReady ? 'mounted' : '';
    if (command.startsWith('shell cat')) return transportMarker;
    return '';
  };
  const waitingTransport = new AdbIdentityTransport(process.env, recorded);
  const write = waitingTransport.writeMarker('emulator-5554', transportMarker);
  await new Promise((resolve) => setTimeout(resolve, 30)); // the mount is not there yet
  assert.equal(calls.some((command) => command.startsWith('shell echo ')), false, 'nothing is written before the mount exists');
  mountReady = true;
  await write;
  assert.ok(calls.filter((command) => command.includes('mounted')).length >= 2, 'the mount is polled until it is writable');
  const writeCalls = rawCalls.filter((args) => args[0] === 'shell' && args[1]?.startsWith('echo '));
  assert.equal(writeCalls.length, 1, 'the marker is written once the mount exists');
  // `adb shell` re-parses joined arguments, so `sh -c <command>` would run `sh -c <first word>` and
  // leave an EMPTY file behind. Every device command must be a single, shell-parseable argv element.
  assert.equal(writeCalls[0].length, 2, 'the write is one shell command, never an unquoted sh -c');
  assert.ok(writeCalls[0][1].includes(`> ${GUEST_MARKER_PATH}`), 'the redirect is part of that command');
  assert.equal(rawCalls.some((args) => args.includes('sh')), false, 'no half-consumed sh -c anywhere');
  assert.ok(rawCalls.some((args) => args.join(' ') === 'shell sync'), 'the marker is flushed before shutdown');
  assert.ok(calls.some((command) => command.startsWith('shell cat')), 'the write is proven by reading it back');
  const stuck = new AdbIdentityTransport(process.env, async () => '');
  await assert.rejects(() => stuck.writeMarker('emulator-5554', transportMarker), /External storage was not writable/);
  const nonUuid = new AdbIdentityTransport(process.env, recorded);
  await assert.rejects(() => nonUuid.writeMarker('emulator-5554', 'not-a-uuid'), /non-UUID/);
  // A marker whose write silently does not stick must fail the enrollment instead of reporting success.
  const swallowed = new AdbIdentityTransport(process.env, async (_serial, args) => args.join(' ').includes('mounted') ? 'mounted' : '');
  await assert.rejects(() => swallowed.writeMarker('emulator-5554', transportMarker), /did not survive the write/);
  console.log('PASS transport: single-argv shell commands, mount wait, sync flush, read-back proof, lost writes refused');

  console.log(JSON.stringify({ status: 'PASS', avd: AVD, checks: 13, markerWrites: transport.writes.length }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    rmSync(sandbox, { recursive: true, force: true });
  });

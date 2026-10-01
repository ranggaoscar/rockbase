/**
 * RockDroid device identity + persistence guard (Phase 3E, production).
 *
 * An Android device in this farm is identified by *where* its AVD lives on the host and by a marker
 * inside the emulator's own userdata:
 *
 *   1. HOST PIN — the AVD ini, the absolute AVD directory, the userdata image and the system image
 *      are pinned in the registry on the FIRST authorized boot. Every later boot compares the
 *      registry against the AVD on disk; a repointed AVD, a replaced userdata image or a different
 *      system image is an operator-visible defect, never a silent boot.
 *   2. GUEST MARKER — `/sdcard/RockBase/device-identity` holds one UUID. It is written exactly once,
 *      during that same first authorized boot (bootstrap), inside the emulator's userdata. From then
 *      on a missing or different marker means the device is NOT this device: the device goes to
 *      ATTENTION and the identity is never regenerated automatically.
 *
 * Everything here is read-only against the host (file reads) plus ADB over an injectable transport,
 * so tests can replay device states without an emulator. RockBase never installs Android apps: a
 * missing expected app is an operator task, not something this service repairs.
 */
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import { logActivity } from './ActivityLogService';

const runFile = promisify(execFile);
const executable = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

/** Guest-side identity marker: one UUID per enrolled device, stored in the emulator userdata. */
export const GUEST_MARKER_PATH = '/sdcard/RockBase/device-identity';
/** Directory that holds the marker. Created only while enrolling. */
export const GUEST_MARKER_DIRECTORY = '/sdcard/RockBase';
/** The app RockBase expects on a device that serves an Instagram account. Never (re)installed here. */
export const INSTAGRAM_PACKAGE = 'com.instagram.android';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AVD_NAME_RE = /^[\w.-]{1,80}$/;
const SERIAL_RE = /^emulator-\d+$/;

/** Absolute, forward-slash form of a real host path — the shape that is pinned in the registry. */
const posix = (value: string) => path.resolve(value).replace(/\\/g, '/');
/** Forward-slash form of a value that may be relative (AVD config values such as `image.sysdir.1`). */
const slashes = (value: string) => value.trim().replace(/\\+/g, '/').replace(/\/+$/, '');

/**
 * Android SDK root, resolved exactly like AndroidRuntimeService: ANDROID_SDK_ROOT, then ANDROID_HOME,
 * then %LOCALAPPDATA%/Android/Sdk on Windows. Returns null when nothing is configured.
 */
export function androidSdkRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [env.ANDROID_SDK_ROOT, env.ANDROID_HOME,
    process.platform === 'win32' && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Android', 'Sdk') : undefined]
    .filter((value): value is string => Boolean(value && value.trim()));
  for (const sdk of candidates) {
    if (existsSync(path.join(sdk, 'platform-tools', executable('adb')))) return path.resolve(sdk);
  }
  return candidates.length ? path.resolve(candidates[0]) : null;
}

/** SDK adb, with the same fallback to a PATH lookup as the runtime service. */
export function androidAdbPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = androidSdkRoot(env);
  return root ? path.join(root, 'platform-tools', executable('adb')) : executable('adb');
}

/**
 * AVD home directory: ANDROID_AVD_HOME wins, then ANDROID_USER_HOME/avd, then ~/.android/avd.
 * Both SDK and AVD locations are explicit so a service account, a container or a test can relocate
 * the whole Android install without touching the registry.
 */
export function androidAvdHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ANDROID_AVD_HOME && env.ANDROID_AVD_HOME.trim()) return path.resolve(env.ANDROID_AVD_HOME);
  const userHome = env.ANDROID_USER_HOME && env.ANDROID_USER_HOME.trim()
    ? path.resolve(env.ANDROID_USER_HOME) : path.join(os.homedir(), '.android');
  return path.join(userHome, 'avd');
}

/** Minimal `key=value` ini reader (AVD ini + config.ini). Missing file reads as an empty document. */
function parseIniFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** The four host facts pinned in the registry. Forward-slash absolute paths plus the system image. */
export interface AvdIdentityPin {
  avdIniPath: string;
  avdAbsolutePath: string;
  userdataPath: string;
  systemImage: string | null;
}

export interface AvdIdentity {
  avdName: string;
  sdkRoot: string | null;
  adbPath: string;
  avdHome: string;
  /** Native-separator host paths, for file access and emulator CLI flags. */
  avdIniPath: string;
  avdAbsolutePath: string;
  userdataPath: string;
  systemImage: string | null;
  /** `-datadir` / `-data` pin: the emulator must boot the enrolled AVD directory and userdata image. */
  datadir: string;
  data: string;
  /** Forward-slash form of the same facts; this is what the registry stores and compares. */
  pin: AvdIdentityPin;
}

/**
 * Resolve the host identity of an AVD. `Medium_Phone_API_36.1` declares
 * `path=C:\Users\rangg\.android\avd\Medium_Phone.avd` in its ini, so the AVD directory name is NOT
 * assumed to equal the AVD name — the declared path always wins, with `<avdHome>/<name>.avd` only as
 * the documented fallback when an ini has no path.
 */
export function resolveAvdIdentity(avdName: string, env: NodeJS.ProcessEnv = process.env): AvdIdentity {
  const name = String(avdName ?? '').trim();
  if (!AVD_NAME_RE.test(name)) throw new Error('Invalid AVD name');
  const avdHome = androidAvdHome(env);
  const nativeIni = path.join(avdHome, `${name}.ini`);
  const ini = parseIniFile(nativeIni);
  const declared = ini.path?.trim();
  const nativeAbsolute = declared ? path.resolve(declared) : path.join(avdHome, `${name}.avd`);
  const config = parseIniFile(path.join(nativeAbsolute, 'config.ini'));
  const sysdir = config['image.sysdir.1']?.trim();
  const systemImage = sysdir ? slashes(sysdir)
    : [config['tag.id'], config['abi.type']].filter(Boolean).join('|') || null;
  const nativeUserdata = path.join(nativeAbsolute, 'userdata-qemu.img');
  return {
    avdName: name,
    sdkRoot: androidSdkRoot(env),
    adbPath: androidAdbPath(env),
    avdHome,
    avdIniPath: nativeIni,
    avdAbsolutePath: nativeAbsolute,
    userdataPath: nativeUserdata,
    systemImage,
    datadir: nativeAbsolute,
    data: nativeUserdata,
    pin: {
      avdIniPath: posix(nativeIni),
      avdAbsolutePath: posix(nativeAbsolute),
      userdataPath: posix(nativeUserdata),
      systemImage,
    },
  };
}

/** The registry columns that carry an enrolled identity. */
export interface RegistryIdentityFields {
  persistentMarker?: string | null;
  avdIniPath?: string | null;
  avdAbsolutePath?: string | null;
  userdataPath?: string | null;
  systemImage?: string | null;
}

export type RegistryIdentityState = 'NOT_ENROLLED' | 'VERIFIED' | 'MISMATCH' | 'INCOMPLETE';

export interface RegistryIdentityVerdict {
  state: RegistryIdentityState;
  ok: boolean;
  detail: string;
  /** Which pinned fields no longer match the AVD on disk. */
  mismatches: string[];
}

/**
 * Compare the pinned registry identity with the AVD resolved from disk. Pure and side-effect free:
 * it never repairs, never re-pins and never generates a marker — callers decide what a mismatch means.
 * `NOT_ENROLLED` is the only acceptable "not yet known" state and is reported as ok, so pre-existing
 * rows keep working until their first authorized boot.
 */
export function verifyRegistry(device: RegistryIdentityFields, resolved: AvdIdentity): RegistryIdentityVerdict {
  const pinned = [device.avdIniPath, device.avdAbsolutePath, device.userdataPath, device.systemImage]
    .some((value) => value !== null && value !== undefined && String(value).trim() !== '');
  const marker = String(device.persistentMarker ?? '').trim();
  if (!pinned && !marker) return { state: 'NOT_ENROLLED', ok: true, detail: 'Device has no enrolled identity yet', mismatches: [] };
  if (!UUID_RE.test(marker)) {
    // Pins without a usable marker would let two devices look identical: fail closed instead.
    return { state: 'INCOMPLETE', ok: false, detail: 'Device identity is pinned without a valid persistent marker', mismatches: ['persistentMarker'] };
  }
  const fields: [string, string | null | undefined, string | null][] = [
    ['avdIniPath', device.avdIniPath, resolved.pin.avdIniPath],
    ['avdAbsolutePath', device.avdAbsolutePath, resolved.pin.avdAbsolutePath],
    ['userdataPath', device.userdataPath, resolved.pin.userdataPath],
    ['systemImage', device.systemImage, resolved.pin.systemImage],
  ];
  const mismatches = fields.filter(([, stored, actual]) => String(stored ?? '') !== String(actual ?? '')).map(([field]) => field);
  if (mismatches.length) {
    return {
      state: 'MISMATCH', ok: false, mismatches,
      detail: `Pinned ${mismatches.join(', ')} no longer match the AVD on disk (${resolved.pin.avdAbsolutePath}); refusing to treat it as the enrolled device`,
    };
  }
  return { state: 'VERIFIED', ok: true, detail: `AVD identity matches ${resolved.pin.avdAbsolutePath}`, mismatches: [] };
}

/** Everything this service needs from a booted device. Injected so tests never touch real ADB. */
export interface AndroidIdentityTransport {
  /** Marker contents, or null when the file does not exist. Throws on a real transport failure. */
  readMarker(serial: string): Promise<string | null>;
  /** Write the marker and prove it survived (mount wait + flush included). Enrollment/recovery only. */
  writeMarker(serial: string, marker: string): Promise<void>;
  appInstalled(serial: string, packageName: string): Promise<boolean>;
}

/** Raw adb invocation, injectable so the production transport itself can be tested hermetically. */
export type AdbRunner = (serial: string, args: string[], timeoutMs: number) => Promise<string>;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Production transport: plain `execFile` against the SDK adb, exactly like AndroidRuntimeService.
 * No credentials, no shell interpolation of untrusted values — the marker must be a UUID.
 */
export class AdbIdentityTransport implements AndroidIdentityTransport {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly run: AdbRunner = defaultAdbRunner(env)) {}

  private async adb(serial: string, args: string[], timeout = 15000): Promise<string> {
    if (!SERIAL_RE.test(serial)) throw new Error('Only local emulator serials are supported');
    return this.run(serial, args, timeout);
  }

  /**
   * The external storage mount is not available the instant a boot reports complete. Writing the
   * marker too early creates it on a directory that is about to be replaced, which is exactly how a
   * marker disappears. Wait for the mount before touching it.
   *
   * The probe is passed as ONE argv element: `adb shell` joins its arguments and the DEVICE shell
   * re-parses the result. Passing `sh -c <unquoted command>` therefore splits the command into
   * `sh -c <word>` plus positional parameters — the classic way a marker write ends up as an empty
   * file instead of the value. Commands here must stay single-element and shell-parseable as-is.
   */
  async waitForExternalStorage(serial: string, attempts?: number, pauseMs?: number): Promise<void> {
    const tries = attempts ?? this.mountAttempts();
    const pause = pauseMs ?? this.mountPauseMs();
    const probe = `mkdir -p ${GUEST_MARKER_DIRECTORY} && test -d ${GUEST_MARKER_DIRECTORY} && echo mounted`;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        if ((await this.adb(serial, ['shell', probe])).includes('mounted')) return;
      } catch { /* the mount (or adb itself) may not be up yet */ }
      if (attempt < tries - 1) await delay(pause);
    }
    throw new Error(`External storage was not writable on ${serial} within ${tries} attempts`);
  }

  private mountAttempts(): number {
    const value = Number(this.env.ANDROID_IDENTITY_MOUNT_ATTEMPTS ?? 15);
    return Number.isSafeInteger(value) && value > 0 ? value : 15;
  }

  private mountPauseMs(): number {
    const value = Number(this.env.ANDROID_IDENTITY_MOUNT_PAUSE_MS ?? 1000);
    return Number.isSafeInteger(value) && value >= 0 ? value : 1000;
  }

  async readMarker(serial: string): Promise<string | null> {
    // Boot-complete precedes FUSE readiness; do not classify an unmounted path as identity loss.
    await this.waitForExternalStorage(serial);
    try {
      const output = await this.adb(serial, ['shell', 'cat', GUEST_MARKER_PATH]);
      const first = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
      return first ?? null;
    } catch (error: any) {
      const detail = `${error?.stderr || ''} ${error?.message || ''}`;
      // A missing device/emulator is a transport failure, never "the marker is gone": fail closed
      // rather than reporting an unreadable device as MISSING.
      if (/(device|emulator)/i.test(detail) && /(not found|offline|unauthorized|closed)/i.test(detail)) {
        throw new Error(`Could not read the device identity marker on ${serial}: ${detail.trim()}`);
      }
      // A missing file is the expected "no marker" answer.
      if (/no such file|does not exist|cannot open/i.test(detail)) return null;
      throw new Error(`Could not read the device identity marker on ${serial}: ${error?.message || String(error)}`);
    }
  }

  async writeMarker(serial: string, marker: string): Promise<void> {
    if (!UUID_RE.test(marker)) throw new Error('Refusing to write a non-UUID device identity marker');
    await this.waitForExternalStorage(serial);
    // One argv element, so the device shell (not a half-consumed `sh -c`) performs the redirect.
    await this.adb(serial, ['shell', `echo ${marker} > ${GUEST_MARKER_PATH}`]);
    // The marker lives in the emulator userdata: flush it now, otherwise a cold boot
    // (-no-snapshot-load -no-snapshot-save) can leave an empty or missing file behind.
    await this.adb(serial, ['shell', 'sync']);
    for (let attempt = 0; attempt < 3; attempt++) {
      const readBack = await this.readMarker(serial).catch(() => null);
      if (readBack === marker) return;
      await delay(500);
    }
    throw new Error('Device identity marker did not survive the write');
  }

  async appInstalled(serial: string, packageName: string): Promise<boolean> {
    if (!/^[a-zA-Z][a-zA-Z0-9_.]{1,200}$/.test(packageName)) throw new Error('Invalid package name');
    try {
      return (await this.adb(serial, ['shell', 'pm', 'path', packageName])).includes('package:');
    } catch (error: any) {
      // Mirrors AndroidRuntimeService: `pm path` on an absent package exits 1 with no output. A missing
      // device, an offline device or an ADB failure must throw — reporting "app missing" there would
      // turn a transport problem into an operator reinstall request.
      if (Number(error?.code) === 1 && !String(error?.stderr || '').trim()) return false;
      throw error;
    }
  }
}

/** Default runner: the SDK adb through execFile, preserving stdout/stderr/code on failure. */
function defaultAdbRunner(env: NodeJS.ProcessEnv): AdbRunner {
  return async (serial, args, timeoutMs) => {
    const { stdout } = await runFile(androidAdbPath(env), ['-s', serial, ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 });
    return String(stdout).trim();
  };
}

/**
 * The pre-boot decision. It is deliberately side-effect free: nothing is pinned, no marker is
 * generated into the registry, until a boot actually happened and the guest proved the marker.
 * A failed or refused start must never leave a half-enrolled device behind.
 */
export interface BootIdentityDecision {
  /** False → the device must not boot: ATTENTION with `reason`. */
  ok: boolean;
  reason: string | null;
  identity: AvdIdentity | null;
  verdict: RegistryIdentityVerdict;
  /** This boot creates the enrollment: pin the host identity and the candidate marker on success. */
  bootstrap: boolean;
  /**
   * The registry is enrolled but was never verified on a guest (a first enrollment that failed before
   * the marker was proven). Re-applying the SAME pinned UUID to the guest is recovery, not a new
   * identity. Never true once identityVerifiedAt is set.
   */
  recovery: boolean;
  /** Marker the guest must end up holding: the pinned UUID, or the candidate for a new enrollment. */
  marker: string | null;
}

export type GuestIdentityState = 'ENROLLED' | 'RECOVERED' | 'VERIFIED' | 'MISSING' | 'MISMATCH' | 'UNKNOWN';

export interface GuestIdentityVerdict {
  ok: boolean;
  state: GuestIdentityState;
  detail: string;
}

export type IdentityDeviceRow = RegistryIdentityFields & { id: string; avdName: string; identityVerifiedAt?: Date | null };

export class AndroidIdentityService {
  private transport: AndroidIdentityTransport;

  constructor(transport: AndroidIdentityTransport = new AdbIdentityTransport(),
    private readonly env: NodeJS.ProcessEnv = process.env) {
    this.transport = transport;
  }

  /**
   * Replace the device transport. Hermetic tests fake the runtime, so they must fake this too —
   * otherwise the guest marker check would reach the real ADB.
   */
  setTransport(transport: AndroidIdentityTransport): void {
    this.transport = transport;
  }

  /** Host identity of an AVD, resolved from env SDK/AVD locations. */
  resolve(avdName: string): AvdIdentity {
    return resolveAvdIdentity(avdName, this.env);
  }

  /**
   * Read-only host pin check for a registry row. Returns a verdict instead of throwing so a health
   * check can turn it into ATTENTION rather than an ERROR.
   */
  check(device: IdentityDeviceRow): RegistryIdentityVerdict {
    let resolved: AvdIdentity;
    try {
      resolved = this.resolve(device.avdName);
    } catch (error: any) {
      return { state: 'INCOMPLETE', ok: false, mismatches: ['avdName'],
        detail: `AVD identity could not be resolved: ${error?.message || String(error)}` };
    }
    return verifyRegistry(device, resolved);
  }

  /**
   * Decide what the boot must do, without writing anything anywhere:
   *   - unenrolled → a candidate marker to create and commit only after the guest proves it;
   *   - enrolled, matching, never verified → recovery of the SAME pinned UUID (the case a first
   *     enrollment left behind when it failed before the marker was proven);
   *   - enrolled and matching, already verified → verify only;
   *   - enrolled and drifted → refuse the boot (ATTENTION), never a re-pin, never a new identity.
   */
  prepareBoot(device: IdentityDeviceRow): BootIdentityDecision {
    let identity: AvdIdentity;
    try {
      identity = this.resolve(device.avdName);
    } catch (error: any) {
      const detail = `AVD identity could not be resolved: ${error?.message || String(error)}`;
      return { ok: false, reason: detail, identity: null, bootstrap: false, recovery: false, marker: null,
        verdict: { state: 'INCOMPLETE', ok: false, detail, mismatches: ['avdName'] } };
    }
    const verdict = verifyRegistry(device, identity);
    if (verdict.state === 'NOT_ENROLLED') {
      // A candidate only: it is generated here and persisted by commitEnrollment() after the guest
      // proved it, so a refused start or a failed boot cannot pin an identity that does not exist.
      return { ok: true, reason: null, identity, verdict, bootstrap: true, recovery: false, marker: randomUUID() };
    }
    if (!verdict.ok) {
      // Drift, or pins without a usable marker: fail closed. Recovery only ever re-applies the UUID
      // that is already pinned, so it cannot invent an identity either.
      return { ok: false, reason: verdict.detail, identity, bootstrap: false, recovery: false, marker: null, verdict };
    }
    return { ok: true, reason: null, identity, verdict, bootstrap: false,
      // Recovery is allowed ONLY while the device has never been verified: the registry UUID is
      // re-applied, never regenerated, and a verified device can never take this path.
      recovery: !device.identityVerifiedAt,
      marker: String(device.persistentMarker ?? '').trim() };
  }

  /**
   * Persist the host pin and the marker. Called ONLY after the AVD booted and the guest proved the
   * marker read back, so the registry can never hold an identity the device does not have.
   */
  async commitEnrollment(prisma: PrismaClient, deviceId: string, identity: AvdIdentity, marker: string): Promise<void> {
    if (!UUID_RE.test(marker)) throw new Error('Refusing to enroll a device with a non-UUID marker');
    await prisma.androidDevice.update({ where: { id: deviceId }, data: {
      avdIniPath: identity.pin.avdIniPath,
      avdAbsolutePath: identity.pin.avdAbsolutePath,
      userdataPath: identity.pin.userdataPath,
      systemImage: identity.pin.systemImage,
      persistentMarker: marker,
      identityEnrolledAt: new Date(),
      identityError: null,
    } });
    logActivity({ type: 'android', entityType: 'android_device', entityId: deviceId,
      action: 'identity-enrolled', status: 'updated',
      message: 'Android device identity pinned after a boot that proved the guest marker',
      metadata: { avd: identity.avdName, marker, ...identity.pin } });
  }

  /**
   * Guest marker check after a boot.
   *
   * bootstrap — the boot that enrolls: write the candidate and prove it reads back.
   * recovery  — an enrolled-but-never-verified device: read first, re-apply the SAME pinned UUID only
   *             when the guest does not already hold it.
   * otherwise — read only: a missing or different marker is a defect and is never regenerated.
   */
  async verifyGuest(serial: string, marker: string | null,
    options: { bootstrap?: boolean; recovery?: boolean } = {}): Promise<GuestIdentityVerdict> {
    const expected = String(marker ?? '').trim();
    if (!UUID_RE.test(expected)) return { ok: false, state: 'UNKNOWN', detail: 'No enrolled device identity marker to compare against' };
    if (options.bootstrap) {
      try {
        await this.transport.writeMarker(serial, expected);
      } catch (error: any) {
        return { ok: false, state: 'UNKNOWN', detail: `Device identity marker could not be created on this boot: ${error?.message || String(error)}` };
      }
      return { ok: true, state: 'ENROLLED', detail: `Device identity marker created at ${GUEST_MARKER_PATH}` };
    }
    let actual: string | null;
    try {
      actual = await this.transport.readMarker(serial);
    } catch (error: any) {
      return { ok: false, state: 'UNKNOWN', detail: `Device identity marker could not be read: ${error?.message || String(error)}` };
    }
    if (actual !== null && actual.trim() === expected) {
      return { ok: true, state: 'VERIFIED', detail: 'Guest identity matches the enrolled device' };
    }
    if (options.recovery) {
      // Explicit, bounded recovery of an enrollment that was never proven: the pinned UUID is
      // re-applied as is — a new UUID is never generated here.
      try {
        await this.transport.writeMarker(serial, expected);
      } catch (error: any) {
        return { ok: false, state: 'UNKNOWN', detail: `Enrolled device identity could not be re-applied on this boot: ${error?.message || String(error)}` };
      }
      return { ok: true, state: 'RECOVERED', detail: `Enrolled device identity re-applied at ${GUEST_MARKER_PATH}` };
    }
    if (actual === null) {
      return { ok: false, state: 'MISSING', detail: `${GUEST_MARKER_PATH} is missing; the enrolled identity is not regenerated automatically` };
    }
    return { ok: false, state: 'MISMATCH', detail: `${GUEST_MARKER_PATH} does not match the enrolled device identity` };
  }

  /** Whether an app is present on a booted device. RockBase never installs it for the operator. */
  async appInstalled(serial: string, packageName: string = INSTAGRAM_PACKAGE): Promise<boolean> {
    return this.transport.appInstalled(serial, packageName);
  }

  async instagramInstalled(serial: string): Promise<boolean> {
    return this.appInstalled(serial, INSTAGRAM_PACKAGE);
  }
}

export const androidIdentity = new AndroidIdentityService();

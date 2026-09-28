import { execFile, spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const runFile = promisify(execFile);
const executable = (name: string) => process.platform === 'win32' ? `${name}.exe` : name;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AndroidRuntimeService {
  private processes = new Map<string, ChildProcess>();

  private sdkPath(tool: 'adb' | 'emulator'): string {
    const relative = tool === 'adb' ? 'platform-tools' : 'emulator';
    const candidates = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME,
      process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined];
    for (const sdk of candidates.filter((value): value is string => Boolean(value))) {
      const candidate = path.join(sdk, relative, executable(tool));
      if (existsSync(candidate)) return candidate;
    }
    return executable(tool);
  }

  private async run(tool: 'adb' | 'emulator', args: string[], timeout = 12000): Promise<string> {
    try {
      const { stdout } = await runFile(this.sdkPath(tool), args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
      return String(stdout).trim();
    } catch (error: any) {
      throw new Error(`${tool} ${args[0]} failed: ${error?.message || String(error)}. Install Android SDK platform-tools/emulator and set ANDROID_SDK_ROOT.`);
    }
  }

  async tooling() {
    const result: { adb: boolean; emulator: boolean; error?: string } = { adb: false, emulator: false };
    try { await this.run('adb', ['version']); result.adb = true; } catch (error: any) { result.error = error.message; }
    try { await this.run('emulator', ['-version']); result.emulator = true; } catch (error: any) { result.error = [result.error, error.message].filter(Boolean).join('; '); }
    return result;
  }

  async listAvds(): Promise<string[]> {
    return (await this.run('emulator', ['-list-avds'])).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }

  async connected(): Promise<string[]> {
    const output = await this.run('adb', ['devices']);
    return output.split(/\r?\n/).slice(1).filter((line) => /\tdevice$/.test(line)).map((line) => line.split('\t')[0]);
  }

  async resolveSerial(avdName: string): Promise<string | null> {
    for (const serial of await this.connected()) {
      if (!/^emulator-\d+$/.test(serial)) continue;
      try {
        if ((await this.run('adb', ['-s', serial, 'emu', 'avd', 'name']))
          .split(/\r?\n/)[0].trim() === avdName) return serial;
      } catch { /* unrelated or not yet ready */ }
    }
    return null;
  }

  async health(serial: string): Promise<boolean> {
    if (!/^emulator-\d+$/.test(serial)) throw new Error('Only local emulator serials are supported');
    try {
      const state = await this.run('adb', ['-s', serial, 'get-state']);
      const boot = await this.run('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
      return state === 'device' && boot === '1';
    } catch { return false; }
  }

  async start(avdName: string, ramMb: number, cpuCores: number): Promise<string> {
    if (!(await this.listAvds()).includes(avdName)) throw new Error(`AVD ${avdName} not found in Android SDK`);
    if (await this.resolveSerial(avdName)) throw new Error(`AVD ${avdName} is already running`);
    const args = ['-avd', avdName, '-memory', String(ramMb), '-cores', String(cpuCores)];
    const gpu = process.env.ANDROID_EMULATOR_GPU;
    if (gpu) {
      if (!['auto', 'auto-no-window', 'host', 'swiftshader_indirect', 'angle_indirect'].includes(gpu)) throw new Error('Unsupported ANDROID_EMULATOR_GPU renderer');
      args.push('-gpu', gpu);
    }
    if (process.platform === 'win32' || process.env.DISPLAY === undefined) args.push('-no-window');
    const child = spawn(this.sdkPath('emulator'), args, { stdio: 'ignore', windowsHide: true });
    child.unref();
    this.processes.set(avdName, child);
    child.on('error', () => this.processes.delete(avdName));
    child.on('exit', () => this.processes.delete(avdName));
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Emulator ${avdName} exited during boot (code ${child.exitCode})`);
      try {
        const serial = await this.resolveSerial(avdName);
        if (serial && await this.health(serial)) return serial;
      } catch { /* adb can be unavailable during boot */ }
      await delay(2000);
    }
    const serial = await this.resolveSerial(avdName).catch(() => null);
    if (serial) await this.stop(serial).catch(() => undefined);
    throw new Error(`AVD ${avdName} did not finish booting within 180 seconds`);
  }

  async stop(serial: string): Promise<void> {
    if (!/^emulator-\d+$/.test(serial)) throw new Error('Only local emulator serials can be stopped');
    await this.run('adb', ['-s', serial, 'emu', 'kill']);
    for (let i = 0; i < 30; i++) {
      if (!(await this.connected()).includes(serial)) return;
      await delay(1000);
    }
    throw new Error(`Emulator ${serial} did not stop within 30 seconds`);
  }

  async screenshot(serial: string): Promise<Buffer> {
    if (!/^emulator-\d+$/.test(serial)) throw new Error('Only local emulator serials are supported');
    const { stdout } = await runFile(this.sdkPath('adb'), ['-s', serial, 'exec-out', 'screencap', '-p'],
      { timeout: 15000, encoding: 'buffer', windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
    return stdout as Buffer;
  }

  async control(serial: string, command: { action: string; x?: number; y?: number; x2?: number; y2?: number; durationMs?: number; text?: string }): Promise<void> {
    if (!/^emulator-\d+$/.test(serial)) throw new Error('Only local emulator serials are supported');
    const adb = async (...args: string[]) => { await this.run('adb', ['-s', serial, 'shell', ...args]); };
    if (command.action === 'open-instagram') return this.launchApp(serial, 'com.instagram.android');
    if (command.action === 'back' || command.action === 'home' || command.action === 'wake') {
      await adb('input', 'keyevent', command.action === 'back' ? 'KEYCODE_BACK' : command.action === 'home' ? 'KEYCODE_HOME' : 'KEYCODE_WAKEUP');
      return;
    }
    if (command.action === 'text') {
      // adb input text has shell metacharacter and Unicode limitations; reject rather than corrupting input.
      if (!command.text || command.text.length > 250 || !/^[a-zA-Z0-9 @._-]+$/.test(command.text)) throw new Error('ADB text input supports up to 250 ASCII letters, numbers, spaces, @ . _ -; use device keyboard for other characters');
      await adb('input', 'text', command.text.replace(/ /g, '%s'));
      return;
    }
    if (command.action === 'tap' || command.action === 'swipe') {
      const image = await this.screenshot(serial);
      if (image.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error('Cannot determine Android display bounds');
      const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
      const valid = (x: unknown, max: number) => Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) < max;
      if (!valid(command.x, width) || !valid(command.y, height)) throw new Error('Tap position is outside Android display');
      if (command.action === 'tap') { await adb('input', 'tap', String(command.x), String(command.y)); return; }
      if (!valid(command.x2, width) || !valid(command.y2, height) || !Number.isSafeInteger(command.durationMs) || (command.durationMs as number) < 100 || (command.durationMs as number) > 2000) throw new Error('Invalid swipe coordinates or duration');
      await adb('input', 'swipe', String(command.x), String(command.y), String(command.x2), String(command.y2), String(command.durationMs));
      return;
    }
    throw new Error('Unsupported Android control action');
  }

  async launchApp(serial: string, packageName: string): Promise<void> {
    if (!/^emulator-\d+$/.test(serial) || !/^[a-zA-Z][a-zA-Z0-9_.]{1,200}$/.test(packageName)) {
      throw new Error('Invalid emulator serial or package name');
    }
    if (!await this.packageInstalled(serial, packageName)) throw new Error(`Android app ${packageName} is not installed on this device; install it through the official store with the operator`);
    const result = await this.run('adb', ['-s', serial, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
    if (!/Events injected:\s*1/.test(result)) throw new Error(`Could not launch ${packageName}; review device screen`);
  }

  async packageInstalled(serial: string, packageName: string): Promise<boolean> {
    if (!/^emulator-\d+$/.test(serial) || !/^[a-zA-Z][a-zA-Z0-9_.]{1,200}$/.test(packageName)) throw new Error('Invalid emulator serial or package name');
    try {
      const { stdout } = await runFile(this.sdkPath('adb'), ['-s', serial, 'shell', 'pm', 'path', packageName], { timeout: 12000, windowsHide: true });
      return String(stdout).includes('package:');
    } catch (error: any) {
      if (Number(error?.code) === 1 && !String(error?.stderr || '').trim()) return false;
      throw error;
    }
  }
}

export const androidRuntime = new AndroidRuntimeService();

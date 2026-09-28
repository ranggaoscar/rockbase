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

  async launchApp(serial: string, packageName: string): Promise<void> {
    if (!/^emulator-\d+$/.test(serial) || !/^[a-zA-Z][a-zA-Z0-9_.]{1,200}$/.test(packageName)) {
      throw new Error('Invalid emulator serial or package name');
    }
    await this.run('adb', ['-s', serial, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
  }
}

export const androidRuntime = new AndroidRuntimeService();

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const runFile = promisify(execFile);
const mediaRoot = path.resolve(process.cwd(), 'uploads');
const androidDirectory = '/sdcard/Pictures/RockBase';
const sdkAdb = () => {
  const root = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  return root ? path.join(root, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
};

export class AndroidMediaService {
  private async run(args: string[], timeout = 30_000): Promise<string> {
    const { stdout } = await runFile(sdkAdb(), args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
    return String(stdout).trim();
  }

  private validate(serial: string, jobId: string) {
    if (!/^emulator-\d+$/.test(serial) || !/^[a-f0-9]{8}-[a-f0-9-]{27,}$/.test(jobId)) throw new Error('Invalid emulator serial or Android job ID');
  }

  async stage(serial: string, jobId: string, mediaPath: string) {
    this.validate(serial, jobId);
    const source = await fs.realpath(mediaPath);
    const root = await fs.realpath(mediaRoot);
    if (!source.startsWith(root + path.sep) || path.dirname(source) !== root) throw new Error('Media must be a direct file in RockBase uploads');
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size < 100 || stat.size > 20 * 1024 * 1024) throw new Error('Image must be a 100-byte to 20-MB file');
    const file = await fs.readFile(source);
    const jpeg = file.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const png = file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!jpeg && !png) throw new Error('Only JPEG or PNG images are supported');
    const remote = `${androidDirectory}/${jobId}.${jpeg ? 'jpg' : 'png'}`;
    try {
      await this.run(['-s', serial, 'shell', 'mkdir', '-p', androidDirectory]);
      await this.run(['-s', serial, 'push', source, remote], 90_000);
      const actual = (await this.run(['-s', serial, 'shell', 'sha256sum', remote])).split(/\s+/)[0];
      const expected = createHash('sha256').update(file).digest('hex');
      if (actual !== expected) throw new Error('Media transfer checksum mismatch');
      await this.run(['-s', serial, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${remote}`]);
      return { remote, bytes: stat.size, sha256: actual };
    } catch (error) {
      await this.cleanup(serial, jobId, remote).catch(() => undefined);
      throw error;
    }
  }

  async cleanup(serial: string, jobId: string, remote: string) {
    this.validate(serial, jobId);
    if (remote !== `${androidDirectory}/${jobId}.jpg` && remote !== `${androidDirectory}/${jobId}.png`) throw new Error('Refusing to remove file outside this job staging path');
    await this.run(['-s', serial, 'shell', 'rm', '-f', remote]);
  }
}

export const androidMedia = new AndroidMediaService();

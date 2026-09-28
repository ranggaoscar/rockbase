import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { androidRuntime } from '../AndroidRuntimeService';
import {
  InstagramPublishVerification, InstagramSecurityState, InstagramUiAdapter,
  InstagramUiNotInspectedError,
} from './InstagramUiAdapter';

const runFile = promisify(execFile);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sdkAdb = () => {
  const root = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME
    || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  return root ? path.join(root, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
};

export interface UiNode {
  text: string;
  resourceId: string;
  contentDesc: string;
  clickable: boolean;
  enabled: boolean;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  center: { x: number; y: number };
}

/** Parse a `uiautomator dump` XML document into flat nodes (generic Android tooling). */
export function parseUiXml(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const tagRe = /<node\b([^>]*?)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml))) {
    const attrs: Record<string, string> = {};
    const attrRe = /([\w:-]+)="([^"]*)"/g;
    let attr: RegExpExecArray | null;
    while ((attr = attrRe.exec(match[1]))) attrs[attr[1]] = attr[2];
    const bounds = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds || '');
    if (!bounds) continue;
    const x1 = Number(bounds[1]), y1 = Number(bounds[2]), x2 = Number(bounds[3]), y2 = Number(bounds[4]);
    nodes.push({
      text: attrs.text || '',
      resourceId: attrs['resource-id'] || '',
      contentDesc: attrs['content-desc'] || '',
      clickable: attrs.clickable === 'true',
      enabled: attrs.enabled !== 'false',
      bounds: { x1, y1, x2, y2 },
      center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
    });
  }
  return nodes;
}

/**
 * ADB/uiautomator implementation of the Instagram UI adapter for one emulator.
 *
 * Mechanics (foregrounding, hierarchy dumps, evidence screenshots) are generic Android and
 * verified against a real AVD. The Instagram-specific steps below are intentionally NOT
 * implemented from memory: each throws InstagramUiNotInspectedError until the official app has
 * been inspected on the test AVD and its observed selectors/hierarchy are recorded in
 * working/android-instagram-ui-notes.md.
 */
export class AdbInstagramUiAdapter implements InstagramUiAdapter {
  constructor(private readonly serial: string) {
    if (!/^emulator-\d+$/.test(serial)) throw new Error('Only local emulator serials are supported');
  }

  private async run(args: string[], timeout = 20000): Promise<string> {
    const { stdout } = await runFile(sdkAdb(), ['-s', this.serial, ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return String(stdout);
  }

  /** Dump the current Android UI hierarchy through uiautomator (app-agnostic, used by inspection). */
  async dumpHierarchy(): Promise<UiNode[]> {
    const remote = '/sdcard/rockbase-ui-dump.xml';
    await this.run(['shell', 'uiautomator', 'dump', remote]);
    return parseUiXml(await this.run(['shell', 'cat', remote]));
  }

  async ensureInstagramForeground(): Promise<void> {
    // launchApp throws when the official app is not installed or does not start.
    await androidRuntime.launchApp(this.serial, 'com.instagram.android');
    for (let attempt = 0; attempt < 6; attempt++) {
      // `dumpsys window` (without the `windows` sub-list) is where API 34+ reports mCurrentFocus.
      const focus = await this.run(['shell', 'dumpsys', 'window']).catch(() => '');
      if (/mCurrentFocus=.*com\.instagram\.android/.test(focus)) return;
      await delay(1000);
    }
    throw new Error('Instagram did not come to the foreground; review the device screen');
  }

  async captureEvidence(tag: string): Promise<string> {
    const directory = path.resolve(process.cwd(), 'uploads', 'android-evidence');
    await fs.mkdir(directory, { recursive: true });
    const safeTag = tag.replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 80);
    const file = path.join(directory, `${Date.now()}-${safeTag || 'evidence'}.png`);
    const image = await androidRuntime.screenshot(this.serial);
    if (image.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error('Evidence screenshot is not a PNG');
    await fs.writeFile(file, image);
    return file;
  }

  // ── Instagram-specific steps: implemented only from real observation (fail closed until then) ──

  async detectSecurityState(): Promise<InstagramSecurityState> {
    throw new InstagramUiNotInspectedError('detectSecurityState');
  }

  async readActiveUsername(): Promise<string | null> {
    throw new InstagramUiNotInspectedError('readActiveUsername');
  }

  async openCreatePost(): Promise<void> {
    throw new InstagramUiNotInspectedError('openCreatePost');
  }

  async selectStagedImage(_remotePath: string): Promise<void> {
    throw new InstagramUiNotInspectedError('selectStagedImage');
  }

  async enterCaption(_caption: string): Promise<void> {
    throw new InstagramUiNotInspectedError('enterCaption');
  }

  async reachPublishBoundary(): Promise<void> {
    throw new InstagramUiNotInspectedError('reachPublishBoundary');
  }

  async pressShare(): Promise<void> {
    throw new InstagramUiNotInspectedError('pressShare');
  }

  async verifyPublished(_publishBoundaryAt: Date): Promise<InstagramPublishVerification> {
    throw new InstagramUiNotInspectedError('verifyPublished');
  }
}

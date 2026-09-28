import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { androidRuntime } from '../AndroidRuntimeService';
import {
  InstagramImageSelection, InstagramPreparedState, InstagramPublishNotApprovedError,
  InstagramPublishVerification, InstagramScreenExpectationError, InstagramSecurityState,
  InstagramUiAdapter, InstagramUiNotInspectedError,
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
  /** Fully qualified widget class as reported by uiautomator (optional: older dumps may omit it). */
  className?: string;
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
      className: attrs.class || '',
      clickable: attrs.clickable === 'true',
      enabled: attrs.enabled !== 'false',
      bounds: { x1, y1, x2, y2 },
      center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
    });
  }
  return nodes;
}

/**
 * Resource-ids observed on the officially installed Instagram 447.0.0.55.81 (versionCode
 * 385411990, installer com.android.vending) running on the test AVD. Nothing here is guessed:
 * every id below comes from a real `uiautomator dump` recorded in
 * working/android-instagram-ui-notes.md.
 */
export const INSTAGRAM_ID = {
  feedTab: 'com.instagram.android:id/feed_tab',
  profileTab: 'com.instagram.android:id/profile_tab',
  profileActionBar: 'com.instagram.android:id/profile_action_bar',
  usernameTitle: 'com.instagram.android:id/action_bar_title',
  createEntry: 'com.instagram.android:id/profile_header_create_button',
  newPostTitle: 'com.instagram.android:id/new_post_title',
  galleryNext: 'com.instagram.android:id/next_button_textview',
  galleryTile: 'com.instagram.android:id/gallery_grid_item_thumbnail',
  editorThumb: 'com.instagram.android:id/thumbnail_image',
  editorNext: 'com.instagram.android:id/media_thumbnail_tray_button',
  captionField: 'com.instagram.android:id/caption_input_text_view',
  postPreview: 'com.instagram.android:id/media_preview_recycler_view',
  screenTitle: 'com.instagram.android:id/action_bar_textview_title',
  shareButton: 'com.instagram.android:id/share_footer_button',
  /** Plain text view Instagram uses inside its own informational sheets (e.g. the "Sharing posts" sheet). */
  sheetText: 'ig_text',
} as const;

export const INSTAGRAM_PACKAGE = 'com.instagram.android';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/** Minutes since epoch (UTC arithmetic only: both sides come from the same device clock display). */
function toMinutes(year: number, month: number, day: number, hour: number, minute: number): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 60000);
}

/**
 * Parse the date Instagram prints on a gallery tile, e.g.
 * "Unselected Photo thumbnail created on September 28, 2026 3:45 PM".
 * Returns minutes since epoch, or null when the description is not a dated tile.
 */
export function parseTileCreatedAt(desc: string): number | null {
  const m = /created on\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(desc);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  if (!month) return null;
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === 'PM') hour += 12;
  return toMinutes(Number(m[3]), month, Number(m[2]), hour, Number(m[5]));
}

/**
 * Parse the timestamp column of `adb shell ls -l <file>` (toybox `stat -c %Y` is unavailable on the
 * Android 16 test image, so the listing is the portable source of truth), e.g.
 * "-rw-rw---- 1 u0_a213 media_rw 25983 2026-09-28 15:45 p3c-inspection.png".
 */
export function parseLsMinutes(listing: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(listing);
  if (!m) return null;
  return toMinutes(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

/**
 * Device-level primitives this adapter needs. Production uses ADB; tests inject the same calls
 * backed by real captured hierarchies, so Instagram logic is covered without a device.
 */
export interface InstagramUiTransport {
  launchInstagram(): Promise<void>;
  focusedPackage(): Promise<string | null>;
  dumpHierarchy(): Promise<UiNode[]>;
  tap(x: number, y: number): Promise<void>;
  sendText(value: string): Promise<void>;
  pressBack(): Promise<void>;
  /** Minutes-since-epoch of a file's modification time on the device, or null when unreadable. */
  fileTimestampMinutes(remotePath: string): Promise<number | null>;
  screenshot(): Promise<Buffer>;
}

class AdbInstagramUiTransport implements InstagramUiTransport {
  constructor(private readonly serial: string) {}

  private async run(args: string[], timeout = 20000): Promise<string> {
    const { stdout } = await runFile(sdkAdb(), ['-s', this.serial, ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return String(stdout);
  }

  async launchInstagram(): Promise<void> {
    // launchApp throws when the official app is not installed or does not start.
    await androidRuntime.launchApp(this.serial, INSTAGRAM_PACKAGE);
  }

  async focusedPackage(): Promise<string | null> {
    // `dumpsys window` (without the `windows` sub-list) is where API 34+ reports mCurrentFocus.
    const focus = await this.run(['shell', 'dumpsys', 'window']).catch(() => '');
    const m = /mCurrentFocus=Window\{[^}]*?\s+(?:u\d+\s+)?([\w.]+)\/[^\s}]+/.exec(focus);
    return m ? m[1] : null;
  }

  async dumpHierarchy(): Promise<UiNode[]> {
    const remote = '/sdcard/rockbase-ui-dump.xml';
    await this.run(['shell', 'uiautomator', 'dump', remote]);
    return parseUiXml(await this.run(['shell', 'cat', remote]));
  }

  async tap(x: number, y: number): Promise<void> {
    await this.run(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
  }

  async sendText(value: string): Promise<void> {
    const safe = value.replace(/[^A-Za-z0-9 @._!?,'"()/&+#:-]/g, '');
    if (!safe) throw new Error('Refusing to send an empty/invalid text value');
    await this.run(['shell', 'input', 'text', safe.replace(/ /g, '%s')]);
  }

  async pressBack(): Promise<void> {
    await this.run(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  }

  async fileTimestampMinutes(remotePath: string): Promise<number | null> {
    const listing = await this.run(['shell', 'ls', '-l', remotePath]).catch(() => '');
    return parseLsMinutes(listing);
  }

  async screenshot(): Promise<Buffer> {
    return androidRuntime.screenshot(this.serial);
  }
}

interface NodeQuery { resourceId?: string; contentDesc?: string; text?: string }

/**
 * ADB/uiautomator implementation of the Instagram UI adapter for one emulator.
 *
 * Every step asserts both the screen it starts from and the screen it must arrive at; when a
 * required control is missing or ambiguous it raises InstagramScreenExpectationError instead of
 * tapping something that merely looks close. Share is detected but never pressed here: pressing it
 * is refused with InstagramPublishNotApprovedError until publish is explicitly approved.
 */
export class AdbInstagramUiAdapter implements InstagramUiAdapter {
  private readonly transport: InstagramUiTransport;

  constructor(private readonly serial: string, transport?: InstagramUiTransport) {
    if (!/^emulator-\d+$/.test(serial)) throw new Error('Only local emulator serials are supported');
    this.transport = transport ?? new AdbInstagramUiTransport(serial);
  }

  /** Dump the current Android UI hierarchy through uiautomator (app-agnostic, used by inspection). */
  async dumpHierarchy(): Promise<UiNode[]> {
    return this.transport.dumpHierarchy();
  }

  async ensureInstagramForeground(): Promise<void> {
    await this.transport.launchInstagram();
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await this.transport.focusedPackage() === INSTAGRAM_PACKAGE) return;
      await delay(1000);
    }
    throw new InstagramScreenExpectationError('Instagram did not come to the foreground; review the device screen');
  }

  async captureEvidence(tag: string): Promise<string> {
    const directory = path.resolve(process.cwd(), 'uploads', 'android-evidence');
    await fs.mkdir(directory, { recursive: true });
    const safeTag = tag.replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 80);
    const file = path.join(directory, `${Date.now()}-${safeTag || 'evidence'}.png`);
    const image = await this.transport.screenshot();
    if (image.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error('Evidence screenshot is not a PNG');
    await fs.writeFile(file, image);
    return file;
  }

  // ── Instagram-specific steps, implemented from real observation ──

  /**
   * Screen classification.
   *
   * Positive signals are observed resource-ids. The sign-in wall is detected from the strings the
   * official app shows on its sign-in screen (observed while signed out on the same build); that
   * screen's resource-ids were never dumped, so its detection is deliberately text-based and
   * requires two independent strings before it is trusted. Anything else is UNKNOWN — never "OK".
   */
  async detectSecurityState(): Promise<InstagramSecurityState> {
    const nodes = await this.transport.dumpHierarchy();
    const texts = nodes.map((n) => n.text.toLowerCase());
    const signals = [
      texts.some((t) => t.includes('username, email or mobile number')),
      texts.some((t) => t.trim() === 'log in'),
      texts.some((t) => t.includes('forgot password')),
      texts.some((t) => t.trim() === 'create new account'),
    ].filter(Boolean).length;
    if (signals >= 2) return 'LOGIN_REQUIRED';
    if (this.hasKnownSurface(nodes)) return 'OK';
    return 'UNKNOWN';
  }

  async readActiveUsername(): Promise<string | null> {
    let nodes = await this.transport.dumpHierarchy();
    if (!this.isProfileScreen(nodes)) {
      await this.tapNode(this.requireOne(nodes, { resourceId: INSTAGRAM_ID.profileTab }, 'profile tab'), 'open own profile');
      nodes = await this.waitForScreen((n) => this.isProfileScreen(n), 'own profile did not open');
    }
    const title = this.find(nodes, { resourceId: INSTAGRAM_ID.usernameTitle })[0];
    const value = (title?.text || title?.contentDesc || '').replace(/^@/, '').trim();
    return /^[A-Za-z0-9._]{1,30}$/.test(value) ? value : null;
  }

  async openCreatePost(): Promise<void> {
    let nodes = await this.transport.dumpHierarchy();
    if (!this.isProfileScreen(nodes)) {
      await this.tapNode(this.requireOne(nodes, { resourceId: INSTAGRAM_ID.profileTab }, 'profile tab'), 'open own profile');
      nodes = await this.waitForScreen((n) => this.isProfileScreen(n), 'own profile did not open, cannot reach Create Post');
    }
    await this.tapNode(this.requireOne(nodes, { resourceId: INSTAGRAM_ID.createEntry }, 'profile Create control'), 'open the creation sheet');
    const sheet = await this.waitForScreen(
      (n) => this.find(n, { contentDesc: 'Create new post' }).length === 1,
      'the creation sheet did not open',
    );
    // Strictly the single-image post row: never a reel / story / live / edit entry.
    await this.tapNode(this.requireOne(sheet, { contentDesc: 'Create new post' }, '"Create new post" row'), 'choose "Create new post"');
    await this.waitForScreen((n) => this.isGalleryScreen(n), 'the gallery picker did not open');
  }

  /**
   * Select exactly the staged image.
   *
   * Instagram's picker shows creation time, not filenames, so the staged file is identified by its
   * modification time on the device (the same clock the picker renders) within a two-minute window,
   * and the selection is only accepted once the picker itself reports exactly one selected tile.
   */
  async selectStagedImage(remotePath: string): Promise<InstagramImageSelection> {
    const fileMinutes = await this.transport.fileTimestampMinutes(remotePath);
    if (fileMinutes === null) {
      throw new InstagramScreenExpectationError(`could not read the staged image timestamp on the device (${remotePath})`);
    }
    const nodes = await this.waitForScreen((n) => this.isGalleryScreen(n), 'the gallery picker is not open');
    const initial = this.tiles(nodes).filter((t) => t.contentDesc.startsWith('Selected'));
    if (initial.length > 1) {
      throw new InstagramScreenExpectationError(`refusing to continue: ${initial.length} images are already selected (single-image post expected)`);
    }
    const matches = async () => this.tiles(await this.transport.dumpHierarchy()).filter((t) => {
      const at = parseTileCreatedAt(t.contentDesc);
      return at !== null && Math.abs(at - fileMinutes) <= 2;
    });
    let target = (await matches())[0];
    for (let attempt = 0; !target && attempt < 10; attempt++) {
      await delay(2000);
      target = (await matches())[0];
    }
    if (!target) {
      const seen = this.tiles(nodes).map((t) => t.contentDesc);
      throw new InstagramScreenExpectationError(`the staged image did not appear in the picker (tiles: ${JSON.stringify(seen)})`);
    }
    if (!target.contentDesc.startsWith('Selected')) {
      await this.tapNode(target, 'select the staged image');
    }
    const after = await this.waitForScreen(
      (n) => this.tiles(n).some((t) => t.contentDesc.startsWith('Selected')),
      'the image selection was not registered by Instagram',
    );
    const selected = this.tiles(after).filter((t) => t.contentDesc.startsWith('Selected'));
    if (selected.length !== 1) {
      throw new InstagramScreenExpectationError(`expected exactly one selected image after selecting, saw ${selected.length}`);
    }
    const selectedAt = parseTileCreatedAt(selected[0].contentDesc);
    if (selectedAt === null || Math.abs(selectedAt - fileMinutes) > 2) {
      throw new InstagramScreenExpectationError(`the selected image is not the staged image (selected: ${selected[0].contentDesc})`);
    }
    return { selectedTile: selected[0].contentDesc, selectedImageCount: 1 };
  }

  async enterCaption(caption: string): Promise<void> {
    let nodes = await this.transport.dumpHierarchy();
    if (!this.isGalleryScreen(nodes)) {
      throw new InstagramScreenExpectationError('caption entry started from an unexpected screen: the picker with a selected image was expected');
    }
    const selected = this.tiles(nodes).filter((t) => t.contentDesc.startsWith('Selected'));
    if (selected.length !== 1) {
      throw new InstagramScreenExpectationError(`refusing to continue with ${selected.length} selected images (single-image post expected)`);
    }
    await this.tapNode(this.requireOne(nodes, { resourceId: INSTAGRAM_ID.galleryNext, text: 'Next' }, 'gallery Next'), 'picker Next');
    nodes = await this.waitForScreen((n) => this.isEditorScreen(n), 'the post editor did not open');
    await this.tapNode(this.requireOne(nodes, { resourceId: INSTAGRAM_ID.editorNext }, 'editor Next'), 'editor Next');
    nodes = await this.waitForScreen((n) => this.isCaptionScreen(n), 'the caption screen did not open');
    nodes = await this.dismissInformationalSheet(nodes);
    await this.tapNode(this.requireOne(nodes, { resourceId: INSTAGRAM_ID.captionField }, 'caption field'), 'focus the caption field');
    await this.transport.sendText(caption);
    await delay(1200);
    // Focused caption field opens an in-place editor; BACK commits the text and returns to the screen.
    await this.transport.pressBack();
    const filled = await this.waitForScreen(
      (n) => this.isCaptionScreen(n) && this.captionText(n) !== null,
      'the caption screen did not come back after entering the caption',
    );
    const text = this.captionText(filled);
    if (text !== caption) {
      throw new InstagramScreenExpectationError(`the caption on screen does not match the approved caption (saw ${JSON.stringify(text)})`);
    }
  }

  async reachPublishBoundary(): Promise<void> {
    const nodes = await this.dismissInformationalSheet(await this.transport.dumpHierarchy());
    if (!this.isCaptionScreen(nodes)) {
      throw new InstagramScreenExpectationError('the final Share screen is not the expected "New post" screen');
    }
  }

  async verifyPreparedState(expected: { caption: string }): Promise<InstagramPreparedState> {
    const nodes = await this.dismissInformationalSheet(await this.transport.dumpHierarchy());
    const share = this.find(nodes, { resourceId: INSTAGRAM_ID.shareButton, contentDesc: 'Share' })[0] || null;
    const title = this.find(nodes, { resourceId: INSTAGRAM_ID.screenTitle })[0];
    const preview = this.find(nodes, { resourceId: INSTAGRAM_ID.postPreview })[0] || null;
    const text = this.captionText(nodes);
    const problems: string[] = [];
    if (title?.text !== 'New post') problems.push('the "New post" screen title is not present');
    if (!preview) problems.push('the selected media preview is not present');
    if (!share) problems.push('the Share control is not present');
    if (text !== expected.caption) problems.push(`the caption does not match the approved caption (saw ${JSON.stringify(text)})`);
    return {
      ok: problems.length === 0,
      detail: problems.length
        ? problems.join('; ')
        : 'final Share screen prepared with exactly one image and the approved caption',
      shareSelector: share
        ? `${share.resourceId} (content-desc "${share.contentDesc}", class ${share.className || 'unknown'})`
        : null,
      captionText: text,
      selectedImageCount: 1,
    };
  }

  /** Detects the Share control only — it is never pressed from the preparation flow. */
  async pressShare(): Promise<void> {
    throw new InstagramPublishNotApprovedError('pressShare is not enabled: RockBase prepares the post and stops at the final Share screen until publish is explicitly approved');
  }

  async verifyPublished(_publishBoundaryAt: Date): Promise<InstagramPublishVerification> {
    throw new InstagramUiNotInspectedError('verifyPublished');
  }

  // ── internals ──

  private tiles(nodes: UiNode[]): UiNode[] {
    return this.find(nodes, { resourceId: INSTAGRAM_ID.galleryTile });
  }

  private captionText(nodes: UiNode[]): string | null {
    const field = this.find(nodes, { resourceId: INSTAGRAM_ID.captionField })[0];
    if (!field) return null;
    const text = field.text || '';
    if (!text || text === 'Add a caption…' || text === 'Add a caption...') return '';
    return text;
  }

  private isHomeScreen(nodes: UiNode[]): boolean {
    return this.find(nodes, { resourceId: INSTAGRAM_ID.feedTab, contentDesc: 'Home' }).length === 1;
  }

  private isProfileScreen(nodes: UiNode[]): boolean {
    return this.find(nodes, { resourceId: INSTAGRAM_ID.profileActionBar }).length === 1
      && this.find(nodes, { resourceId: INSTAGRAM_ID.usernameTitle }).length === 1;
  }

  private isGalleryScreen(nodes: UiNode[]): boolean {
    return this.find(nodes, { resourceId: INSTAGRAM_ID.newPostTitle, text: 'New post' }).length === 1
      && this.find(nodes, { resourceId: INSTAGRAM_ID.galleryNext, text: 'Next' }).length === 1
      && this.tiles(nodes).length > 0;
  }

  private isEditorScreen(nodes: UiNode[]): boolean {
    return this.find(nodes, { resourceId: INSTAGRAM_ID.editorNext }).length === 1
      && this.find(nodes, { resourceId: INSTAGRAM_ID.editorThumb, contentDesc: 'Selected photo' }).length === 1;
  }

  private isCaptionScreen(nodes: UiNode[]): boolean {
    return this.find(nodes, { resourceId: INSTAGRAM_ID.captionField }).length === 1
      && this.find(nodes, { resourceId: INSTAGRAM_ID.shareButton, contentDesc: 'Share' }).length === 1
      && this.find(nodes, { resourceId: INSTAGRAM_ID.screenTitle, text: 'New post' }).length === 1;
  }

  /** Any surface this adapter knows how to operate: an authenticated screen, mid-flow or not. */
  private hasKnownSurface(nodes: UiNode[]): boolean {
    return this.isHomeScreen(nodes) || this.isProfileScreen(nodes) || this.isGalleryScreen(nodes)
      || this.isEditorScreen(nodes) || this.isCaptionScreen(nodes);
  }

  /**
   * Instagram shows a one-time informational sheet ("Sharing posts": reuse/remix/download for
   * public accounts) over the caption screen. Only that sheet's acknowledge label is tapped — never
   * "Manage settings" — and only while the sheet copy is actually on screen.
   */
  private async dismissInformationalSheet(nodes: UiNode[]): Promise<UiNode[]> {
    const isSheet = (list: UiNode[]) => list.some((n) => n.text.trim() === 'Sharing posts'
      || n.contentDesc.trim() === 'Sharing posts');
    if (!isSheet(nodes)) return nodes;
    const ack = this.find(nodes, { resourceId: INSTAGRAM_ID.sheetText, text: 'OK' })[0];
    if (!ack) {
      throw new InstagramScreenExpectationError('the "Sharing posts" sheet is blocking the screen and its acknowledge control was not found; review the device screen');
    }
    await this.tapNode(ack, 'acknowledge the informational "Sharing posts" sheet');
    return this.waitForScreen((n) => !isSheet(n), 'the "Sharing posts" sheet did not close');
  }

  private find(nodes: UiNode[], query: NodeQuery): UiNode[] {
    return nodes.filter((n) => (!query.resourceId || n.resourceId === query.resourceId)
      && (query.contentDesc === undefined || n.contentDesc === query.contentDesc)
      && (query.text === undefined || n.text === query.text));
  }

  private requireOne(nodes: UiNode[], query: NodeQuery, label: string): UiNode {
    const hits = this.find(nodes, query);
    if (hits.length !== 1) {
      throw new InstagramScreenExpectationError(`expected exactly one ${label} on screen, found ${hits.length}`);
    }
    return hits[0];
  }

  private async tapNode(node: UiNode, label: string): Promise<void> {
    const { x1, y1, x2, y2 } = node.bounds;
    if (x2 <= x1 || y2 <= y1) {
      throw new InstagramScreenExpectationError(`refusing to tap ${label}: it has empty bounds on screen`);
    }
    await this.transport.tap(node.center.x, node.center.y);
    await delay(1500);
  }

  private async waitForScreen(
    predicate: (nodes: UiNode[]) => boolean,
    failure: string,
    attempts = 10,
  ): Promise<UiNode[]> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const nodes = await this.transport.dumpHierarchy();
      if (predicate(nodes)) return nodes;
      await delay(1500);
    }
    throw new InstagramScreenExpectationError(failure);
  }
}

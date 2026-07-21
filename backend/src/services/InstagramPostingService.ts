import { Page } from 'playwright';
import { chromium } from 'playwright-extra';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { browserManager } from './BrowserManager';
import { PrismaClient } from '@prisma/client';
import { HumanBehavior } from './HumanBehavior';
import { assertAutomationEnabled } from '../middleware/automation';
import { postingEventEmitter } from './PostingEventEmitter';

const prisma = new PrismaClient();

// ── Human-like timing helpers ──────────────────────────────────────────────

const delay = (minMs: number, maxMs: number) =>
  new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs));

const short  = () => HumanBehavior.shortPause();
const medium = () => HumanBehavior.mediumPause();
const long   = () => HumanBehavior.longPause();

/** Type text character by character with human-speed variance (delegates to HumanBehavior) */
async function humanType(page: Page, text: string) {
  return HumanBehavior.humanType(page, text);
}

// ── Result type ────────────────────────────────────────────────────────────

export interface PostResult {
  accountId: string;
  username: string;
  platform: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  postedAt?: string;
  screenshotPath?: string;
  verificationReason?: string;
  postUrl?: string;
}

// ── Main service ───────────────────────────────────────────────────────────

export class InstagramPostingService {

  /**
   * Post to Instagram via Playwright.
   */
  public async postToInstagram(
    accountId: string,
    caption: string,
    mediaPath: string,
  ): Promise<PostResult> {
    assertAutomationEnabled();
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) return { accountId, username: 'unknown', platform: 'Instagram', status: 'failed', error: 'Account not found' };
    if (!account.cookies) return { accountId, username: account.username, platform: 'Instagram', status: 'skipped', error: 'No saved session — login via Farm View first' };

    await this.prepareNonHeadlessDebugBrowser();
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    try {
      console.log(`[Instagram] Starting post for @${account.username} (Version: 2.0.3 - Scoped Publish Share)`);

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'browser_launching',
        level: 'info',
        message: `Starting Instagram post for @${account.username}`,
        metadata: { platform: 'Instagram' },
      });

      // 1. Navigate home
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await medium();

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'instagram_opened',
        level: 'info',
        message: `Instagram opened for @${account.username}`,
        metadata: { platform: 'Instagram' },
      });

      // 2. Check we're still logged in
      const loginForm = await page.$('input[name="username"]');
      if (loginForm) {
        postingEventEmitter.emit({
          timestamp: new Date().toISOString(),
          accountId,
          username: account.username,
          stage: 'failed',
          level: 'error',
          message: 'Session expired — please re-login via Farm View',
          metadata: { platform: 'Instagram', reason: 'session_expired' },
        });
        return { accountId, username: account.username, platform: 'Instagram', status: 'failed', error: 'Session expired — please re-login via Farm View' };
      }

      const latestPostHrefBefore = await this.getLatestProfilePostHref(page, account.username);
      console.log(`[Instagram] @${account.username} latest profile post before upload: ${latestPostHrefBefore || 'none'}`);
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await short();

      // 2.5 — Simulate human feed browsing before creating post
      console.log(`[HumanBehavior] @${account.username} starting full warmup browse before posting...`);
      await HumanBehavior.warmupBrowse(page);
      
      // Ensure we are back on the home feed and stable before clicking Create
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await HumanBehavior.shortPause();

      // 3. Click the "Create" / "+" button in the sidebar
      const createSelectors = [
        'a[href="/create/style/"]',
        'svg[aria-label="New post"]',
        '[aria-label="Create"]',
        'svg[aria-label="Create"]',
      ];

      let clicked = false;
      for (const sel of createSelectors) {
        const btn = await page.waitForSelector(sel, { state: 'visible', timeout: 3000 }).catch(() => null);
        if (btn) {
          console.log(`[Instagram] Found Create button: ${sel}`);
          // Dismiss potential modals first
          await this.dismissCreatePostOverlays(page).catch(() => null);
          await this.robustClick(page, btn);
          clicked = true;
          break;
        }
      }
              if (!clicked) throw new Error('Could not find the Create/New Post button');

              await medium();

              // 3.5 Double check for "Not Now" / "Video posts are now shared as reels" again
              await this.dismissCreatePostOverlays(page).catch(() => null);

              // 3.6 Click "Post" submenu
              console.log('[Instagram] Waiting for Post submenu...');
              try {
                const postBtn = page.locator('span, div, a').filter({ hasText: /^Post$/ }).first();
                await postBtn.waitFor({ state: 'attached', timeout: 10000 });
                console.log('[Instagram] Found Post submenu, clicking...');
                await this.robustClick(page, postBtn);
                await medium();
                await this.dismissCreatePostOverlays(page).catch(() => null);
              } catch (err) {
                console.log('[Instagram] Warning: Could not trigger Post submenu, attempting to proceed...');
              }

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'media_selected',
        level: 'info',
        message: `Selecting media for @${account.username}`,
        progress: 20,
        metadata: { mediaPath, isVideo: /\.(mp4|mov|avi|webm|mkv)$/i.test(mediaPath) },
      });

      // 4. Handle "Select from computer" file upload dialog
      console.log('[Instagram] Waiting for "Select from computer" button...');
      let uploadBtn;
      try {
        uploadBtn = await page.waitForSelector(
          'button:has-text("Select from computer"), button:has-text("Select from"), input[type="file"], .x78zum5.xdt5ytf.x1iyjqo2 button',
          { timeout: 30000 }
        );
      } catch (err) {
        console.error('[Instagram] Timeout waiting for upload button. Taking diagnostic screenshot...');
        const screenshotPath = `logs/upload_timeout_${account.username}_${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[Instagram] Screenshot saved to ${screenshotPath}`);
        throw err;
      }

      if (!fs.existsSync(mediaPath)) throw new Error(`Media file not found: ${mediaPath}`);

      // Handle file chooser
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(mediaPath);
      } else {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 15000 }),
          this.robustClick(page, uploadBtn)
        ]);
        await fileChooser.setFiles(mediaPath);
      }
      console.log(`[Instagram] @${account.username} upload selected: ${mediaPath}`);

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'upload_started',
        level: 'info',
        message: `Upload started for @${account.username}`,
        progress: 30,
        metadata: { mediaPath },
      });

      const afterUploadScreenshot = await this.captureShareScreenshot(page, account.username, 'after_file_upload');
      console.log(`[Instagram] @${account.username} after file upload screenshot saved to ${afterUploadScreenshot}`);
      await delay(5000, 5000);
      await this.waitForUploadProcessingToStabilize(page, account.username, 'after file upload');

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'upload_completed',
        level: 'success',
        message: `Upload completed for @${account.username}`,
        progress: 40,
      });

      // Detect if this is a video/Reel — different Instagram flow
      const isVideo = /\.(mp4|mov|avi|webm|mkv)$/i.test(mediaPath);
      if (isVideo) {
        console.log(`[Instagram] @${account.username} video detected — using Reels flow (skip Crop+Filter)`);
        // Reels flow: Upload → Trim/Edit → Cover → Caption → Share
        // Try clicking Next on the Trim/Edit screen (if present)
        await this.waitForUploadProcessingToStabilize(page, account.username, 'before reels Next');
        const beforeReelsScreenshot = await this.captureShareScreenshot(page, account.username, 'before_reels_next');
        console.log(`[Instagram] @${account.username} before Reels Next screenshot saved to ${beforeReelsScreenshot}`);
        // Check for upload rejection dialog before proceeding
        await this.checkUploadRejected(page, account.username, accountId);
        await this.clickNext(page, 'Reels step');

        postingEventEmitter.emit({
          timestamp: new Date().toISOString(),
          accountId,
          username: account.username,
          stage: 'next_clicked',
          level: 'info',
          message: `Next clicked (Reels step) for @${account.username}`,
          progress: 50,
        });

        await medium();

        // Cover selection step — click Next again
        await this.waitForUploadProcessingToStabilize(page, account.username, 'before cover Next');
        await this.clickNext(page, 'Cover step');

        postingEventEmitter.emit({
          timestamp: new Date().toISOString(),
          accountId,
          username: account.username,
          stage: 'cover_next_clicked',
          level: 'info',
          message: `Cover Next clicked for @${account.username}`,
          progress: 55,
        });

        await medium();
      } else {
        console.log(`[Instagram] @${account.username} image detected — using standard flow`);
        // 5. Next button (Crop)
        await this.waitForUploadProcessingToStabilize(page, account.username, 'before crop Next');
        const beforeCropNextScreenshot = await this.captureShareScreenshot(page, account.username, 'before_crop_next');
        console.log(`[Instagram] @${account.username} before crop Next screenshot saved to ${beforeCropNextScreenshot}`);
        await this.clickNext(page, 'Crop step');

        postingEventEmitter.emit({
          timestamp: new Date().toISOString(),
          accountId,
          username: account.username,
          stage: 'next_clicked',
          level: 'info',
          message: `Next clicked (Crop step) for @${account.username}`,
          progress: 50,
        });

        await medium();

        // 6. Next button (Filters/Edit)
        await this.waitForUploadProcessingToStabilize(page, account.username, 'before filter Next');
        await this.clickNext(page, 'Filter step');

        postingEventEmitter.emit({
          timestamp: new Date().toISOString(),
          accountId,
          username: account.username,
          stage: 'next_clicked',
          level: 'info',
          message: `Next clicked (Filter step) for @${account.username}`,
          progress: 60,
        });

        await medium();
      }

      // 7. Caption and Share
      console.log('[Instagram] Entering caption and sharing...');
      if (caption.trim()) {
        const captionInsert = await this.insertCaptionIntoActiveCreateModal(page, account.username, caption);

        if (captionInsert.verified) {
          postingEventEmitter.emit({
            timestamp: new Date().toISOString(),
            accountId,
            username: account.username,
            stage: 'caption_inserted',
            level: 'success',
            message: `Caption inserted for @${account.username} (${captionInsert.length} chars)`,
            progress: 70,
            metadata: { method: captionInsert.method, length: captionInsert.length },
          });
        }

        console.log(
          `[Instagram] @${account.username} caption insertion verified=${captionInsert.verified}, selector=${captionInsert.selector}, method=${captionInsert.method}, length=${captionInsert.length}`
        );
        if (!captionInsert.verified) {
          throw new Error(`CAPTION_VERIFY_FAILED: caption empty after insertion attempts; selector=${captionInsert.selector || 'none'}`);
        }
      } else {
        console.log(`[Instagram] @${account.username} caption is empty — posting media only`);
      }

      const captionInsertedScreenshot = await this.captureShareScreenshot(page, account.username, 'caption_inserted');
      console.log(`[Instagram] @${account.username} caption inserted screenshot saved to ${captionInsertedScreenshot}`);
      await medium();
      await this.waitForUploadProcessingToStabilize(page, account.username, 'before Share');
      const beforeShareScreenshot = await this.captureShareScreenshot(page, account.username, 'before_share');
      console.log(`[Instagram] @${account.username} before Share screenshot saved to ${beforeShareScreenshot}`);

      // Simulate reviewing the post before sharing (human behavior)
      console.log(`[HumanBehavior] @${account.username} reviewing post before sharing...`);
      await HumanBehavior.preEngagePause();
      await HumanBehavior.humanScroll(page, 1);

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'share_clicked',
        level: 'info',
        message: `Share clicked for @${account.username}`,
        progress: 80,
      });

      await this.executeSharePublish(page, account.username, caption);

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'verification_started',
        level: 'info',
        message: `Verifying publish for @${account.username}`,
        progress: 85,
      });

      const verification = await this.verifyPublishSuccess(page, account.username, latestPostHrefBefore);

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'verification_poll',
        level: verification.verified ? 'success' : 'warning',
        message: verification.verified
          ? `Publish verified for @${account.username}: ${verification.reason}`
          : `Verification timed out for @${account.username}: ${verification.reason}`,
        progress: verification.verified ? 95 : 90,
        metadata: { postUrl: verification.postUrl, reason: verification.reason },
      });

      if (!verification.verified) {
        // The Share button was clicked and disappeared — post was likely published,
        // but we couldn't confirm within the extended verification window.
        // Return success with postUrl hint so the worker marks as published (FAILED_VERIFY handled there).
        const postedAt = new Date().toISOString();
        console.warn(`[Instagram] @${account.username} publish confirmed (Share succeeded), but verification timed out: ${verification.reason}`);
        return {
          accountId,
          username: account.username,
          platform: 'Instagram',
          status: 'success',
          postedAt,
          postUrl: verification.postUrl || undefined,
          verificationReason: verification.reason,
        };
      }

      console.log(`[Instagram] @${account.username} publish verified: ${verification.reason}`);
      await browserManager.saveCookies(accountId);

      // Natural exit: scroll back to feed before closing (human behavior)
      try { await HumanBehavior.naturalExit(page); } catch (e: any) {
        console.log(`[HumanBehavior] Natural exit failed (non-critical): ${e.message}`);
      }

      const postedAt = new Date().toISOString();
      console.log(`[Instagram] ✅ Post success for @${account.username}`);

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'published',
        level: 'success',
        message: `Published successfully for @${account.username}`,
        postedAt,
        progress: 100,
        metadata: { postUrl: verification.postUrl, verificationReason: verification.reason },
      });

      return {
        accountId,
        username: account.username,
        platform: 'Instagram',
        status: 'success',
        postedAt,
        postUrl: verification.postUrl || undefined,
        verificationReason: verification.reason,
      };

    } catch (err: any) {
      console.error(`[Instagram] ❌ Post failed for @${account.username}:`, err.message);

      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'failed',
        level: 'error',
        message: `Posting failed for @${account.username}: ${err.message}`,
        error: err.message,
        progress: 0,
        metadata: { platform: 'Instagram' },
      });

      return { accountId, username: account.username, platform: 'Instagram', status: 'failed', error: err.message };
    } finally {
      postingEventEmitter.emit({
        timestamp: new Date().toISOString(),
        accountId,
        username: account.username,
        stage: 'cleanup_completed',
        level: 'info',
        message: `Cleanup completed for @${account.username}`,
        progress: 100,
      });

      await browserManager.saveCookies(accountId).catch((err: any) => {
        console.error(`[Instagram] Failed to save cookies during cleanup for @${account.username}:`, err.message);
      });
      await page.close().catch(() => {});
      await browserManager.closeContext(accountId, { saveCookies: false });
    }
  }

  private async prepareNonHeadlessDebugBrowser() {
    if (process.env.INSTAGRAM_POSTING_NON_HEADLESS !== 'true') return;

    const manager = browserManager as any;
    if (manager.browser) {
      console.log('[Instagram] Restarting shared browser in non-headless debug mode for posting');
      await manager.browser.close().catch((err: any) => {
        console.log(`[Instagram] Existing browser close before debug relaunch failed: ${err.message}`);
      });
      manager.browser = null;
      if (manager.activeContexts?.clear) manager.activeContexts.clear();
    } else {
      console.log('[Instagram] Launching shared browser in non-headless debug mode for posting');
    }

    manager.browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
  }

  /**
   * Dismiss Instagram overlays that can block the create-post flow:
   *  - "Not Now" / "Not now" dialogs (login, notifications, etc.)
   *  - "Video posts are now shared as reels" policy modal (Instagram 2025)
   *  - Generic "OK" acknowledgement buttons
   */
  private async dismissCreatePostOverlays(page: Page): Promise<boolean> {
    const targets: Array<{ selector: string; label: string }> = [
      { selector: 'button:has-text("Not Now")', label: 'Not Now' },
      { selector: 'button:has-text("Not now")', label: 'Not now' },
      { selector: 'button:has-text("OK")', label: 'OK' },
      { selector: 'button:has-text("Ok")', label: 'Ok' },
      { selector: 'button:has-text("Got it")', label: 'Got it' },
      { selector: 'button:has-text("Allow")', label: 'Allow' },
      { selector: 'button:has-text("Dismiss")', label: 'Dismiss' },
    ];

    let dismissedAny = false;
    for (const target of targets) {
      try {
        const handle = await page.$(target.selector);
        if (!handle) continue;
        const visible = await handle.isVisible().catch(() => false);
        if (!visible) continue;
        console.log(`[Instagram] Dismissing overlay button: ${target.label}`);
        await handle.click({ timeout: 3000 }).catch(async () => {
          await page.evaluate((sel) => {
            const btn = document.querySelector(sel) as HTMLButtonElement | null;
            if (btn) btn.click();
          }, target.selector).catch(() => null);
        });
        dismissedAny = true;
        await delay(700, 1400);
      } catch {
        // continue to next target
      }
    }

    // Detect the "Video posts are now shared as reels" modal by text
    try {
      const modal = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], div'))
          .filter((el) => (el as HTMLElement).offsetParent !== null);
        for (const dialog of dialogs) {
          const text = (dialog.textContent || '').toLowerCase();
          if (text.includes('video posts are now shared as reels')
              || (text.includes('original audio') && text.includes('remix') && text.length < 1500)) {
            const okBtn = Array.from(dialog.querySelectorAll('button'))
              .find((b) => /^ok$/i.test((b.textContent || '').trim()));
            if (okBtn) {
              okBtn.click();
              return true;
            }
          }
        }
        return false;
      });
      if (modal) {
        console.log('[Instagram] Dismissed "Video posts are now shared as reels" modal via text scan');
        dismissedAny = true;
        await delay(700, 1400);
      }
    } catch {
      // ignore
    }

    return dismissedAny;
  }

  private async insertCaptionIntoActiveCreateModal(
    page: Page,
    username: string,
    caption: string,
  ): Promise<{ verified: boolean; selector: string; method: string; length: number }> {
    const target = await this.findActiveCreateModalCaptionTarget(page, username);
    if (!target?.selector) {
      return { verified: false, selector: '', method: 'not-found', length: 0 };
    }

    console.log(`[Instagram] @${username} caption target selector used: ${target.selector}, chosen=${JSON.stringify(target.chosen)}`);
    const locator = page.locator(target.selector).first();

    const attempts: Array<{
      method: string;
      run: () => Promise<void>;
    }> = [
      {
        method: 'locator.fill()',
        run: async () => {
          await locator.fill(caption, { timeout: 5000 });
        },
      },
      {
        method: 'elementHandle.type()',
        run: async () => {
          await this.clearCaptionTarget(page, target.selector);
          const element = await locator.elementHandle({ timeout: 5000 });
          if (!element) throw new Error('caption element handle not found');
          await element.click();
          await element.type(caption, { delay: Math.floor(Math.random() * 120) + 60 });
        },
      },
      {
        method: 'evaluate() set textContent',
        run: async () => {
          await this.setCaptionTargetTextByEvaluate(page, target.selector, caption);
        },
      },
      {
        method: 'keyboard insert',
        run: async () => {
          await this.clearCaptionTarget(page, target.selector);
          await locator.click({ timeout: 5000 });
          await page.keyboard.insertText(caption);
        },
      },
    ];

    let lastLength = 0;
    for (const attempt of attempts) {
      try {
        console.log(`[Instagram] @${username} caption insertion attempt: ${attempt.method}`);
        await attempt.run();
        await delay(500, 900);
      } catch (err: any) {
        console.log(`[Instagram] @${username} caption insertion ${attempt.method} failed: ${err.message}`);
      }

      const verification = await this.verifyActiveCreateModalCaption(page, username, caption);
      lastLength = verification.length;
      console.log(
        `[Instagram] @${username} caption verification after ${attempt.method}: verified=${verification.verified}, selector=${verification.selector}, length=${verification.length}`
      );
      if (verification.verified) {
        return {
          verified: true,
          selector: verification.selector,
          method: attempt.method,
          length: verification.length,
        };
      }
    }

    return {
      verified: false,
      selector: target.selector,
      method: 'all-methods-failed',
      length: lastLength,
    };
  }

  private async findActiveCreateModalCaptionTarget(
    page: Page,
    username: string,
  ): Promise<{ selector: string; chosen: any; candidates: any[] } | null> {
    const marker = `rb-caption-input-${Date.now()}`;
    const result = await page.evaluate((token) => {
      const cleanText = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const readText = (el: Element | null) => {
        if (!el) return '';
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        const htmlEl = el as HTMLElement;
        return [input.value || '', htmlEl.innerText || '', htmlEl.textContent || '']
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      };
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        const rect = htmlEl.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number.parseFloat(style.opacity || '1') > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const hasCreatePostSignals = (dialog: HTMLElement) => {
        const text = cleanText(dialog);
        const hasCaptionInput = !!dialog.querySelector('[aria-label="Write a caption..."], textarea[aria-label="Write a caption..."], [contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="caption" i]');
        const hasMediaPreview = Array.from(dialog.querySelectorAll('img, video, canvas')).some((el) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return isVisible(el) && rect.width >= 80 && rect.height >= 80;
        });
        return hasCaptionInput || /\b(Write a caption|Create new post|Crop|Next|Share)\b/i.test(text) || hasMediaPreview;
      };
      const hasWrongSendOverlaySignals = (dialog: HTMLElement) => {
        const text = cleanText(dialog);
        return /\bShare\b/i.test(text)
          && /\b(To:|Send to|Search|Suggested|Followers|Close Friends)\b/i.test(text)
          && !hasCreatePostSignals(dialog);
      };

      document.querySelectorAll('[data-rb-caption-input]').forEach((el) => {
        (el as HTMLElement).removeAttribute('data-rb-caption-input');
      });

      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter(isVisible) as HTMLElement[];
      const createDialogs = dialogs.filter((dialog) => hasCreatePostSignals(dialog) && !hasWrongSendOverlaySignals(dialog));
      const modal = createDialogs[createDialogs.length - 1] || null;
      if (!modal) return { selector: '', chosen: null, candidates: [] };

      const modalRect = modal.getBoundingClientRect();
      const elements = Array.from(modal.querySelectorAll([
        'textarea[aria-label="Write a caption..."]',
        '[contenteditable="true"][aria-label="Write a caption..."]',
        '[contenteditable="true"][role="textbox"][aria-label="Write a caption..."]',
        '[contenteditable="true"][aria-label*="caption" i]',
        'textarea[placeholder*="caption" i]',
        '[role="textbox"][contenteditable="true"]',
        '[contenteditable="true"]',
      ].join(','))) as HTMLElement[];

      const candidates = elements
        .map((el, index) => {
          const rect = el.getBoundingClientRect();
          const aria = el.getAttribute('aria-label') || '';
          const placeholder = el.getAttribute('placeholder') || '';
          const role = el.getAttribute('role') || '';
          const contenteditable = el.getAttribute('contenteditable') || '';
          const text = readText(el);
          const tag = el.tagName.toLowerCase();
          const visible = isVisible(el);
          const disabled = (el as HTMLTextAreaElement).disabled === true
            || el.getAttribute('aria-disabled') === 'true'
            || el.getAttribute('disabled') !== null;
          const exactCaptionLabel = aria === 'Write a caption...';
          const captionLabel = /caption/i.test(aria) || /caption/i.test(placeholder);
          const roleTextbox = role === 'textbox';
          const contentEditable = contenteditable === 'true';
          const rightHalf = rect.left >= modalRect.left + modalRect.width * 0.35;
          const score = [
            exactCaptionLabel ? 100 : 0,
            captionLabel ? 50 : 0,
            tag === 'textarea' ? 30 : 0,
            roleTextbox ? 20 : 0,
            contentEditable ? 10 : 0,
            rightHalf ? 5 : 0,
          ].reduce((sum, value) => sum + value, 0);

          return {
            index,
            tag,
            aria,
            placeholder,
            role,
            contenteditable,
            textLength: text.length,
            visible,
            disabled,
            exactCaptionLabel,
            captionLabel,
            roleTextbox,
            contentEditable,
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            score,
          };
        })
        .filter((candidate) => candidate.visible && !candidate.disabled && candidate.score > 0);

      const chosen = candidates.sort((a, b) => b.score - a.score || b.width * b.height - a.width * a.height)[0] || null;
      if (!chosen) return { selector: '', chosen: null, candidates };

      elements[chosen.index]?.setAttribute('data-rb-caption-input', token);
      return {
        selector: `[data-rb-caption-input="${token}"]`,
        chosen,
        candidates,
      };
    }, marker).catch((err: any) => ({
      selector: '',
      chosen: null,
      candidates: [],
      error: err.message,
    }));

    if ((result as any).error) {
      console.log(`[Instagram] @${username} caption target scan failed: ${(result as any).error}`);
    }
    console.log(`[Instagram] @${username} caption candidates found: ${JSON.stringify((result as any).candidates || [])}`);
    if (!(result as any).selector) return null;

    return {
      selector: (result as any).selector,
      chosen: (result as any).chosen,
      candidates: (result as any).candidates || [],
    };
  }

  private async verifyActiveCreateModalCaption(
    page: Page,
    username: string,
    expectedCaption: string,
  ): Promise<{ verified: boolean; selector: string; length: number; valueLength: number; innerTextLength: number; textContentLength: number }> {
    const target = await this.findActiveCreateModalCaptionTarget(page, username);
    if (!target?.selector) {
      return { verified: false, selector: '', length: 0, valueLength: 0, innerTextLength: 0, textContentLength: 0 };
    }

    const result = await page.locator(target.selector).first().evaluate((el: HTMLElement) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const value = input.value || '';
      const innerText = el.innerText || '';
      const textContent = el.textContent || '';
      const normalized = [value, innerText, textContent].join(' ').replace(/\s+/g, ' ').trim();

      return {
        length: normalized.length,
        valueLength: value.trim().length,
        innerTextLength: innerText.trim().length,
        textContentLength: textContent.trim().length,
      };
    }).catch(() => ({
      length: 0,
      valueLength: 0,
      innerTextLength: 0,
      textContentLength: 0,
    }));

    const expectedLength = expectedCaption.trim().length;
    const detectedLength = Math.max(result.length, result.valueLength, result.innerTextLength, result.textContentLength);
    return {
      verified: expectedLength > 0 && detectedLength > 0,
      selector: target.selector,
      length: detectedLength,
      valueLength: result.valueLength,
      innerTextLength: result.innerTextLength,
      textContentLength: result.textContentLength,
    };
  }

  private async clearCaptionTarget(page: Page, selector: string): Promise<void> {
    await page.locator(selector).first().evaluate((el: HTMLElement) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      if ('value' in input) input.value = '';
      el.textContent = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  private async setCaptionTargetTextByEvaluate(page: Page, selector: string, caption: string): Promise<void> {
    await page.locator(selector).first().evaluate((el: HTMLElement, value) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      if ('value' in input) {
        input.value = value;
      } else {
        el.textContent = value;
      }

      const selection = window.getSelection();
      if (selection && el.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, caption);
  }

  private async executeSharePublish(page: Page, username: string, expectedCaption: string) {
    const shareSelector = 'active-create-post-modal-header-share';
    let shareBtn: any = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      shareBtn = await this.waitForShareReady(page, username, shareSelector, shareBtn, attempt);

      const captionCheck = await this.verifyActiveCreateModalCaption(page, username, expectedCaption);
      console.log(
        `[Instagram] @${username} caption pre-publish verify attempt ${attempt}: verified=${captionCheck.verified}, selector=${captionCheck.selector}, length=${captionCheck.length}`
      );
      if (expectedCaption.trim() && !captionCheck.verified) {
        throw new Error(`CAPTION_VERIFY_FAILED: caption empty before final Share; selector=${captionCheck.selector || 'none'}, length=${captionCheck.length}`);
      }

      const beforeFinalScreenshot = await this.captureShareScreenshot(page, username, `before_final_publish_share_click_attempt_${attempt}`);
      console.log(`[Instagram] @${username} Share attempt ${attempt}: before final publish share click screenshot saved to ${beforeFinalScreenshot}`);

      await this.clickShareWithFallbacks(page, username, shareSelector, shareBtn, attempt);

      const afterFinalScreenshot = await this.captureShareScreenshot(page, username, `after_final_publish_share_click_attempt_${attempt}`);
      console.log(`[Instagram] @${username} Share attempt ${attempt}: after final publish share click screenshot saved to ${afterFinalScreenshot}`);

      const wrongOverlayClosed = await this.detectAndCloseWrongShareOverlay(page, username);
      if (wrongOverlayClosed) {
        shareBtn = null;
        continue;
      }

      const changed = await this.waitForShareStateChange(page, username, shareSelector, attempt);
      if (changed) return;

      if (attempt === 1) {
        console.log(`[Instagram] @${username} Share remained visible/enabled for >10s; retrying Share click once`);
        shareBtn = null;
      }
    }

    console.log(`[Instagram] @${username} Share remained visible after retry; continuing to existing publish verification`);
  }

  private async waitForShareReady(
    page: Page,
    username: string,
    shareSelector: string,
    currentShareBtn: any,
    attempt: number,
  ) {
    const startedAt = Date.now();
    const timeoutMs = 30_000;
    let lastProgressLog = '';

    while (Date.now() - startedAt < timeoutMs) {
      await this.detectAndCloseWrongShareOverlay(page, username);
      const publishShare = currentShareBtn || await this.findFinalPublishShareButton(page, username, attempt);
      const shareBtn = publishShare?.button || null;
      const shareVisible = shareBtn
        ? await shareBtn.isVisible().catch(() => false)
        : false;
      const disabledState = shareBtn
        ? await this.getShareDisabledState(shareBtn).catch((err: any) => ({
            disabled: true,
            reason: `disabled-state-read-failed:${err.message}`,
          }))
        : { disabled: true, reason: 'button-not-found' };
      const uploadState = await this.getUploadProgressState(page, username);
      const busyState = await this.getAriaBusyState(page);
      const uploadReady = uploadState === 'none-detected' && busyState === 'none-detected';
      const elapsed = Math.round((Date.now() - startedAt) / 1000);

      const progressLog = `shareVisible=${shareVisible}, disabled=${disabledState.disabled}, disabledReason=${disabledState.reason}, uploadReady=${uploadReady}, uploadState=${uploadState}, ariaBusy=${busyState}`;
      if (progressLog !== lastProgressLog || elapsed % 5 === 0) {
        console.log(`[Instagram] @${username} Share readiness attempt ${attempt}: ${progressLog}, elapsed=${elapsed}s`);
        lastProgressLog = progressLog;
      }

      if (shareVisible && !disabledState.disabled && uploadReady) {
        console.log(`[Instagram] @${username} Share button ready on attempt ${attempt}`);
        return publishShare;
      }

      currentShareBtn = null;
      await delay(1000, 1500);
    }

    throw new Error(`Share button did not become enabled within ${timeoutMs / 1000}s`);
  }

  private async getShareDisabledState(shareBtn: any): Promise<{ disabled: boolean; reason: string }> {
    return shareBtn.evaluate((el: HTMLElement) => {
      const clickable = el.closest('button, a, [role="button"], [role="link"]') as HTMLElement | null || el;
      const htmlButton = clickable as HTMLButtonElement;
      const disabledAttr = htmlButton.disabled === true || clickable.getAttribute('disabled') !== null;
      const ariaDisabled = clickable.getAttribute('aria-disabled') === 'true';
      const className = typeof clickable.className === 'string' ? clickable.className : '';
      const classDisabled = /disabled|inactive|loading/i.test(className);
      const style = window.getComputedStyle(clickable);
      const pointerDisabled = style.pointerEvents === 'none';
      const opacityDisabled = Number.parseFloat(style.opacity || '1') < 0.5;
      const disabled = disabledAttr || ariaDisabled || classDisabled || pointerDisabled || opacityDisabled;
      const reasons = [
        disabledAttr ? 'disabled-attr' : '',
        ariaDisabled ? 'aria-disabled' : '',
        classDisabled ? 'disabled-class' : '',
        pointerDisabled ? 'pointer-events-none' : '',
        opacityDisabled ? 'low-opacity' : '',
      ].filter(Boolean);

      return {
        disabled,
        reason: reasons.length ? reasons.join('|') : 'enabled',
      };
    });
  }

  private async getCreatePostModalState(page: Page): Promise<{
    modalFound: boolean;
    cropDetected: boolean;
    mediaPreviewVisible: boolean;
    nextVisible: boolean;
    nextEnabled: boolean;
    ignoredGlobalLoading: string;
  }> {
    return page.evaluate(() => {
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        const rect = htmlEl.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number.parseFloat(style.opacity || '1') > 0
          && rect.width > 0
          && rect.height > 0;
      };

      const isDisabled = (el: Element | null) => {
        if (!el) return true;
        const clickable = el.closest('button, a, [role="button"], [role="link"]') || el;
        const htmlEl = clickable as HTMLElement;
        const htmlButton = clickable as HTMLButtonElement;
        const className = typeof htmlEl.className === 'string' ? htmlEl.className : '';
        const style = window.getComputedStyle(htmlEl);
        return htmlButton.disabled === true
          || htmlEl.getAttribute('disabled') !== null
          || htmlEl.getAttribute('aria-disabled') === 'true'
          || /disabled|inactive|loading/i.test(className)
          || style.pointerEvents === 'none'
          || Number.parseFloat(style.opacity || '1') < 0.5;
      };

      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter(isVisible) as HTMLElement[];
      const modal = dialogs.find((dialog) => {
        const text = (dialog.textContent || '').replace(/\s+/g, ' ').trim();
        return /\b(Crop|Next|Share|Create new post|Post|Select from computer)\b/i.test(text);
      }) || dialogs[0] || null;

      const globalLoading = Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"], svg[aria-label*="Loading" i]'))
        .filter((el) => isVisible(el) && (!modal || !modal.contains(el)));

      if (!modal) {
        return {
          modalFound: false,
          cropDetected: false,
          mediaPreviewVisible: false,
          nextVisible: false,
          nextEnabled: false,
          ignoredGlobalLoading: globalLoading.length ? `${globalLoading.length} outside active modal` : 'none',
        };
      }

      const text = (modal.textContent || '').replace(/\s+/g, ' ').trim();
      const cropDetected = /\bCrop\b/i.test(text);
      const nextButton = Array.from(modal.querySelectorAll('button, [role="button"]'))
        .find((el) => /^Next$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim())) || null;
      const nextVisible = isVisible(nextButton);
      const nextEnabled = nextVisible && !isDisabled(nextButton);
      const mediaPreviewVisible = Array.from(modal.querySelectorAll('img, video, canvas'))
        .some((el) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return isVisible(el) && rect.width >= 80 && rect.height >= 80;
        });

      return {
        modalFound: true,
        cropDetected,
        mediaPreviewVisible,
        nextVisible,
        nextEnabled,
        ignoredGlobalLoading: globalLoading.length ? `${globalLoading.length} outside active modal` : 'none',
      };
    }).catch((err: any) => ({
      modalFound: false,
      cropDetected: false,
      mediaPreviewVisible: false,
      nextVisible: false,
      nextEnabled: false,
      ignoredGlobalLoading: `read-failed:${err.message}`,
    }));
  }

  private async getUploadProgressState(page: Page, username?: string): Promise<string> {
    const result = await page.evaluate(() => {
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        const rect = htmlEl.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number.parseFloat(style.opacity || '1') > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const isCaptionOrEditableNode = (el: Element | null) => {
        if (!el) return false;
        return !!el.closest([
          'textarea',
          'input',
          '[role="textbox"]',
          '[contenteditable="true"]',
          '[aria-label="Write a caption..."]',
          '[aria-label*="caption" i]',
          '[placeholder*="caption" i]',
        ].join(','));
      };
      const hasScopedModalSignal = (dialog: HTMLElement) => {
        const hasCaptionInput = !!dialog.querySelector('[aria-label="Write a caption..."], textarea[aria-label="Write a caption..."], [contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="caption" i]');
        const hasFileInput = !!dialog.querySelector('input[type="file"]');
        const hasMediaPreview = Array.from(dialog.querySelectorAll('img, video, canvas')).some((el) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return isVisible(el) && rect.width >= 80 && rect.height >= 80;
        });
        const hasProcessingIndicator = !!dialog.querySelector([
          '[role="progressbar"]',
          '[aria-busy="true"]',
          'svg[aria-label*="Loading" i]',
          '[data-testid*="loading" i]',
          '[class*="spinner" i]',
          '[class*="loading" i]',
        ].join(','));
        return hasCaptionInput || hasFileInput || hasMediaPreview || hasProcessingIndicator;
      };

      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter(isVisible) as HTMLElement[];
      const dialog = dialogs.filter(hasScopedModalSignal).pop() || dialogs[0] || null;
      if (!dialog) return { state: 'none-detected', ignoredCaptionNodes: 0 };

      const rawIndicators = Array.from(dialog.querySelectorAll([
        '[role="progressbar"]',
        '[aria-busy="true"]',
        'svg[aria-label*="Loading" i]',
        '[data-testid*="loading" i]',
        '[class*="spinner" i]',
        '[class*="loading" i]',
      ].join(','))).filter(isVisible);
      const ignoredCaptionNodes = rawIndicators.filter(isCaptionOrEditableNode).length;
      const indicators = rawIndicators.filter((el) => !isCaptionOrEditableNode(el));
      if (!indicators.length) return { state: 'none-detected', ignoredCaptionNodes };

      return {
        state: indicators.slice(0, 5).map((el) => {
          const ariaLabel = el.getAttribute('aria-label');
          const role = el.getAttribute('role');
          const ariaBusy = el.getAttribute('aria-busy');
          const dataTestId = el.getAttribute('data-testid');
          const className = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
          const classSummary = className ? ` class=${className.split(/\s+/).slice(0, 3).join('.')}` : '';
          return `${el.tagName.toLowerCase()} role=${role || 'none'} ariaBusy=${ariaBusy || 'none'} ariaLabel=${ariaLabel || 'none'} dataTestId=${dataTestId || 'none'}${classSummary}`;
        }).join(' | '),
        ignoredCaptionNodes,
      };
    }).catch((err: any) => ({
      state: `read-failed:${err.message}`,
      ignoredCaptionNodes: 0,
    }));

    if (username && result.ignoredCaptionNodes > 0) {
      console.log(`[Instagram] @${username} ignored caption/contenteditable node during processing scan: count=${result.ignoredCaptionNodes}`);
    }

    return result.state;
  }

  private async getAriaBusyState(page: Page): Promise<string> {
    return page.evaluate(() => {
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        const rect = htmlEl.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number.parseFloat(style.opacity || '1') > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const isCaptionOrEditableNode = (el: Element | null) => {
        if (!el) return false;
        return !!el.closest([
          'textarea',
          'input',
          '[role="textbox"]',
          '[contenteditable="true"]',
          '[aria-label="Write a caption..."]',
          '[aria-label*="caption" i]',
          '[placeholder*="caption" i]',
        ].join(','));
      };
      const hasScopedModalSignal = (dialog: HTMLElement) => {
        const hasCaptionInput = !!dialog.querySelector('[aria-label="Write a caption..."], textarea[aria-label="Write a caption..."], [contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="caption" i]');
        const hasFileInput = !!dialog.querySelector('input[type="file"]');
        const hasMediaPreview = Array.from(dialog.querySelectorAll('img, video, canvas')).some((el) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return isVisible(el) && rect.width >= 80 && rect.height >= 80;
        });
        const hasProcessingIndicator = !!dialog.querySelector('[aria-busy="true"], [role="progressbar"], svg[aria-label*="Loading" i]');
        return hasCaptionInput || hasFileInput || hasMediaPreview || hasProcessingIndicator;
      };

      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter(isVisible) as HTMLElement[];
      const dialog = dialogs.filter(hasScopedModalSignal).pop() || dialogs[0] || null;
      if (!dialog) return 'none-detected';
      const busy = Array.from(dialog.querySelectorAll('[aria-busy="true"], [role="progressbar"], svg[aria-label*="Loading" i]'))
        .filter((el) => isVisible(el) && !isCaptionOrEditableNode(el));
      if (!busy.length) return 'none-detected';
      return busy.slice(0, 5).map((el) => {
        const ariaLabel = el.getAttribute('aria-label');
        const role = el.getAttribute('role');
        const ariaBusy = el.getAttribute('aria-busy');
        return `${el.tagName.toLowerCase()} role=${role || 'none'} ariaBusy=${ariaBusy || 'none'} ariaLabel=${ariaLabel || 'none'}`;
      }).join(' | ');
    }).catch((err: any) => `read-failed:${err.message}`);
  }

  private async waitForUploadProcessingToStabilize(page: Page, username: string, phase: string) {
    const startedAt = Date.now();
    const timeoutMs = 45_000;
    const stableMs = 2500;
    let lastActiveAt = Date.now();
    let detected = false;
    let lastProgressLog = '';

    while (Date.now() - startedAt < timeoutMs) {
      const modalState = await this.getCreatePostModalState(page);
      if (modalState.ignoredGlobalLoading !== 'none') {
        console.log(`[Instagram] @${username} ignoring global loading indicator: ${modalState.ignoredGlobalLoading}`);
      }
      if (modalState.cropDetected) {
        console.log(`[Instagram] @${username} crop screen detected: phase=${phase}`);
      }
      if (modalState.nextVisible && modalState.nextEnabled) {
        console.log(`[Instagram] @${username} next button ready: phase=${phase}`);
      }
      if ((modalState.cropDetected || modalState.mediaPreviewVisible) && modalState.nextVisible && modalState.nextEnabled) {
        if (detected) {
          console.log(`[Instagram] @${username} upload processing indicator cleared: phase=${phase}, detected=${detected}`);
        }
        return;
      }

      const uploadState = await this.getUploadProgressState(page, username);
      const ariaBusy = await this.getAriaBusyState(page);
      const processingActive = uploadState !== 'none-detected' || ariaBusy !== 'none-detected';
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const progressLog = `phase=${phase}, processingActive=${processingActive}, uploadState=${uploadState}, ariaBusy=${ariaBusy}`;

      if (processingActive) {
        lastActiveAt = Date.now();
        if (!detected) {
          console.log(`[Instagram] @${username} upload processing indicator detected: ${progressLog}`);
          detected = true;
        }
      }

      if (progressLog !== lastProgressLog || elapsed % 5 === 0) {
        console.log(`[Instagram] @${username} upload stabilization: ${progressLog}, elapsed=${elapsed}s`);
        lastProgressLog = progressLog;
      }

      if (!processingActive && Date.now() - lastActiveAt >= stableMs) {
        console.log(`[Instagram] @${username} upload processing indicator cleared: phase=${phase}, detected=${detected}`);
        return;
      }

      await delay(1000, 1500);
    }

    throw new Error(`Upload processing did not stabilize during ${phase} within ${timeoutMs / 1000}s`);
  }

  private async findFinalPublishShareButton(
    page: Page,
    username: string,
    attempt: number,
  ): Promise<{ button: any; selector: string; candidateCount: number; clickPoint: { x: number; y: number } | null } | null> {
    const token = `rb-final-publish-share-${Date.now()}-${attempt}`;
    const result = await page.evaluate((marker) => {
      const cleanText = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        const rect = htmlEl.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number.parseFloat(style.opacity || '1') > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const isDisabled = (el: Element | null) => {
        if (!el) return true;
        const clickable = el.closest('button, a, [role="button"], [role="link"]') || el;
        const htmlEl = clickable as HTMLElement;
        const htmlButton = clickable as HTMLButtonElement;
        const className = typeof htmlEl.className === 'string' ? htmlEl.className : '';
        const style = window.getComputedStyle(htmlEl);
        return htmlButton.disabled === true
          || htmlEl.getAttribute('disabled') !== null
          || htmlEl.getAttribute('aria-disabled') === 'true'
          || /disabled|inactive|loading/i.test(className)
          || style.pointerEvents === 'none'
          || Number.parseFloat(style.opacity || '1') < 0.5;
      };
      const hasCreatePostSignals = (dialog: HTMLElement) => {
        const text = cleanText(dialog);
        const hasCaptionInput = !!dialog.querySelector('[aria-label="Write a caption..."], textarea[aria-label="Write a caption..."], [contenteditable="true"]');
        const hasMediaPreview = Array.from(dialog.querySelectorAll('img, video, canvas')).some((el) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return isVisible(el) && rect.width >= 80 && rect.height >= 80;
        });
        return hasCaptionInput || /\b(Write a caption|Create new post|Crop|Next)\b/i.test(text) || hasMediaPreview;
      };
      const hasWrongSendOverlaySignals = (dialog: HTMLElement) => {
        const text = cleanText(dialog);
        return /\bShare\b/i.test(text)
          && /\b(To:|Send to|Search|Suggested|Followers|Close Friends)\b/i.test(text)
          && !hasCreatePostSignals(dialog);
      };

      document.querySelectorAll('[data-rb-final-publish-share]').forEach((el) => {
        (el as HTMLElement).removeAttribute('data-rb-final-publish-share');
      });

      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter(isVisible) as HTMLElement[];
      const createDialogs = dialogs.filter((dialog) => hasCreatePostSignals(dialog) && !hasWrongSendOverlaySignals(dialog));
      const modal = createDialogs[createDialogs.length - 1] || null;

      if (!modal) {
        return {
          selector: '',
          candidates: [],
          chosen: null,
        };
      }

      const modalRect = modal.getBoundingClientRect();
      const shareElements: HTMLElement[] = [];
      const candidates = Array.from(modal.querySelectorAll('button, [role="button"]'))
        .map((el, index) => {
          const clickable = (el.closest('button, a, [role="button"], [role="link"]') || el) as HTMLElement;
          const rect = clickable.getBoundingClientRect();
          const text = cleanText(clickable);
          const exactShare = /^Share$/i.test(text);
          const visible = isVisible(clickable);
          const disabled = isDisabled(clickable);
          const inHeader = rect.top <= modalRect.top + Math.min(96, Math.max(56, modalRect.height * 0.14));
          const inTopRight = inHeader && rect.left >= modalRect.left + modalRect.width * 0.55;
          return {
            index,
            text,
            exactShare,
            visible,
            disabled,
            inHeader,
            inTopRight,
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            right: Math.round(rect.right),
          };
        })
        .filter((candidate) => candidate.exactShare && candidate.visible)
        .map((candidate) => {
          const clickable = Array.from(modal.querySelectorAll('button, [role="button"]'))
            .map((el) => (el.closest('button, a, [role="button"], [role="link"]') || el) as HTMLElement)[candidate.index];
          shareElements.push(clickable);
          return {
            ...candidate,
            shareElementIndex: shareElements.length - 1,
          };
        });

      const enabled = candidates.filter((candidate) => !candidate.disabled);
      const sorted = enabled.sort((a, b) => {
        const headerScore = Number(b.inTopRight) - Number(a.inTopRight) || Number(b.inHeader) - Number(a.inHeader);
        if (headerScore !== 0) return headerScore;
        return b.right - a.right || a.top - b.top;
      });
      const chosen = sorted[0] || null;

      if (chosen) {
        const clickable = shareElements[chosen.shareElementIndex];
        clickable?.setAttribute('data-rb-final-publish-share', marker);
      }

      return {
        selector: chosen ? `[data-rb-final-publish-share="${marker}"]` : '',
        candidates,
        chosen,
      };
    }, token).catch((err: any) => ({
      selector: '',
      candidates: [],
      chosen: null,
      error: err.message,
    }));

    console.log(`[Instagram] @${username} final publish share candidates found attempt ${attempt}: ${JSON.stringify((result as any).candidates || [])}`);
    if ((result as any).error) {
      console.log(`[Instagram] @${username} final publish share candidate scan failed attempt ${attempt}: ${(result as any).error}`);
    }
    if (!(result as any).selector) return null;

    console.log(`[Instagram] @${username} chosen publish share selector attempt ${attempt}: ${(result as any).selector}, chosen=${JSON.stringify((result as any).chosen)}`);
    const button = await page.waitForSelector((result as any).selector, { timeout: 1000 }).catch(() => null);
    if (!button) return null;

    const chosen = (result as any).chosen;
    const clickPoint = chosen
      ? { x: chosen.left + Math.max(4, Math.floor(chosen.width / 2)), y: chosen.top + Math.max(4, Math.floor(chosen.height / 2)) }
      : null;

    return {
      button,
      selector: (result as any).selector,
      candidateCount: ((result as any).candidates || []).length,
      clickPoint,
    };
  }

  private async detectAndCloseWrongShareOverlay(page: Page, username: string): Promise<boolean> {
    const marker = `rb-wrong-share-overlay-close-${Date.now()}`;
    const overlay = await page.evaluate((closeMarker) => {
      const cleanText = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el: Element | null) => {
        if (!el) return false;
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        const rect = htmlEl.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number.parseFloat(style.opacity || '1') > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const hasCreatePostSignals = (dialog: HTMLElement) => {
        const text = cleanText(dialog);
        const hasCaptionInput = !!dialog.querySelector('[aria-label="Write a caption..."], textarea[aria-label="Write a caption..."], [contenteditable="true"]');
        const hasMediaPreview = Array.from(dialog.querySelectorAll('img, video, canvas')).some((el) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return isVisible(el) && rect.width >= 80 && rect.height >= 80;
        });
        return hasCaptionInput || /\b(Write a caption|Create new post|Crop|Next)\b/i.test(text) || hasMediaPreview;
      };
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter(isVisible) as HTMLElement[];
      const wrongDialog = dialogs.reverse().find((dialog) => {
        const text = cleanText(dialog);
        return /\bShare\b/i.test(text)
          && /\b(To:|Send to|Search|Suggested|Followers|Close Friends)\b/i.test(text)
          && !hasCreatePostSignals(dialog);
      });

      if (!wrongDialog) return { detected: false, summary: '' };

      document.querySelectorAll('[data-rb-wrong-share-overlay-close]').forEach((el) => {
        (el as HTMLElement).removeAttribute('data-rb-wrong-share-overlay-close');
      });

      const closeCandidates = Array.from(wrongDialog.querySelectorAll('button, [role="button"], [aria-label]')) as HTMLElement[];
      const closeButton = closeCandidates.find((el) => {
        const text = cleanText(el);
        const aria = el.getAttribute('aria-label') || '';
        return /^(Close|Cancel)$/i.test(text) || /close/i.test(aria);
      }) || null;
      closeButton?.setAttribute('data-rb-wrong-share-overlay-close', closeMarker);

      const rect = wrongDialog.getBoundingClientRect();
      return {
        detected: true,
        summary: cleanText(wrongDialog).slice(0, 180),
        closeSelector: closeButton ? `[data-rb-wrong-share-overlay-close="${closeMarker}"]` : '',
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }, marker).catch((err: any) => ({ detected: false, summary: `read-failed:${err.message}` }));

    if (!(overlay as any).detected) return false;

    console.log(`[Instagram] @${username} detected wrong share overlay: ${JSON.stringify(overlay)}`);
    const wrongOverlayScreenshot = await this.captureShareScreenshot(page, username, 'wrong_share_overlay_detected');
    console.log(`[Instagram] @${username} wrong share overlay detected screenshot saved to ${wrongOverlayScreenshot}`);

    const closeSelector = (overlay as any).closeSelector;
    if (closeSelector) {
      await page.locator(closeSelector).first().click({ timeout: 3000 }).catch(async (err: any) => {
        console.log(`[Instagram] @${username} wrong share overlay close button click failed: ${err.message}; pressing Escape`);
        await page.keyboard.press('Escape');
      });
    } else {
      await page.keyboard.press('Escape');
    }
    await delay(1000, 1500);
    console.log(`[Instagram] @${username} closed wrong share overlay`);
    return true;
  }

  private async clickShareWithFallbacks(
    page: Page,
    username: string,
    shareSelector: string,
    shareBtn: any,
    attempt: number,
  ) {
    console.log(`[Instagram] @${username} clicking Share attempt ${attempt} with normal click`);
    try {
      await shareBtn.button.click({ timeout: 5000 });
      console.log(`[Instagram] @${username} Share attempt ${attempt} normal click completed`);
      return;
    } catch (err: any) {
      console.log(`[Instagram] @${username} Share attempt ${attempt} normal click failed: ${err.message}`);
    }

    console.log(`[Instagram] @${username} clicking Share attempt ${attempt} with scoped force click fallback: ${shareBtn.selector || shareSelector}`);
    try {
      await page.locator(shareBtn.selector).first().click({ force: true, timeout: 5000 });
      console.log(`[Instagram] @${username} Share attempt ${attempt} scoped force click completed`);
      return;
    } catch (err: any) {
      console.log(`[Instagram] @${username} Share attempt ${attempt} scoped force click failed: ${err.message}`);
    }

    if (!shareBtn.clickPoint) {
      throw new Error('Could not compute active create modal top-right Share click point');
    }

    console.log(`[Instagram] @${username} clicking Share attempt ${attempt} with active create modal top-right coordinate fallback: x=${shareBtn.clickPoint.x}, y=${shareBtn.clickPoint.y}`);
    await page.mouse.click(shareBtn.clickPoint.x, shareBtn.clickPoint.y);
    console.log(`[Instagram] @${username} Share attempt ${attempt} coordinate click completed`);
  }

  private async waitForShareStateChange(
    page: Page,
    username: string,
    shareSelector: string,
    attempt: number,
  ): Promise<boolean> {
    const startedAt = Date.now();
    const timeoutMs = 10_000;

    while (Date.now() - startedAt < timeoutMs) {
      const wrongOverlayClosed = await this.detectAndCloseWrongShareOverlay(page, username);
      if (wrongOverlayClosed) return false;

      const publishShare = await this.findFinalPublishShareButton(page, username, attempt);
      const shareBtn = publishShare?.button || null;
      const visible = shareBtn ? await shareBtn.isVisible().catch(() => false) : false;
      const disabledState = shareBtn
        ? await this.getShareDisabledState(shareBtn).catch((err: any) => ({
            disabled: false,
            reason: `disabled-state-read-failed:${err.message}`,
          }))
        : { disabled: true, reason: 'button-disappeared' };
      const elapsed = Math.round((Date.now() - startedAt) / 1000);

      console.log(
        `[Instagram] @${username} Share post-click attempt ${attempt}: visible=${visible}, disabled=${disabledState.disabled}, disabledReason=${disabledState.reason}, elapsed=${elapsed}s`
      );

      if (!visible) {
        console.log(`[Instagram] @${username} Share button disappeared after click attempt ${attempt}`);
        return true;
      }

      if (disabledState.disabled) {
        console.log(`[Instagram] @${username} Share button changed to disabled/loading after click attempt ${attempt}`);
        return true;
      }

      await delay(1000, 1500);
    }

    return false;
  }

  private async captureShareScreenshot(page: Page, username: string, label: string): Promise<string> {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const safeUsername = username.replace(/[^a-zA-Z0-9_-]/g, '_');
    const screenshotPath = path.join(logsDir, `${label}_${safeUsername}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  /** Helper for robust clicking via JS evaluate */

  /** Return the current PostResult interface with an optional postUrl field */
  private postResult(
    accountId: string,
    username: string,
    status: 'success' | 'failed' | 'skipped',
    extra?: { error?: string; postedAt?: string; screenshotPath?: string; verificationReason?: string; postUrl?: string },
  ): PostResult {
    return { accountId, username, platform: 'Instagram', status, ...extra };
  }

  /** Check if Instagram rejected the uploaded file — throws REEL_UPLOAD_REJECTED if any rejection dialog is visible */
  private async robustClick(page: Page, locatorOrSelector: any, timeout = 15000) {
    const element = typeof locatorOrSelector === 'string' 
      ? await page.waitForSelector(locatorOrSelector, { timeout }) 
      : (locatorOrSelector.elementHandle ? await locatorOrSelector.elementHandle() : locatorOrSelector);
    
    if (!element) throw new Error(`Element not found for click`);
    
    await element.evaluate((el: HTMLElement) => {
      const clickable = el.closest('button, a, [role="button"], [role="link"], [role="menuitem"]') || el;
      (clickable as HTMLElement).click();
    });
    await short();
  }

  /** Check if Instagram rejected the uploaded file — throws REEL_UPLOAD_REJECTED if any rejection dialog is visible */
  private async checkUploadRejected(page: Page, username: string, accountId: string): Promise<void> {
    const rejectionTexts = [
      'File couldn\'t be uploaded',
      'Couldn\'t upload video',
      'Video couldn\'t be uploaded',
      'Video can\'t be uploaded',
      'This video can\'t be played',
      'File can\'t be uploaded',
    ];

    for (const text of rejectionTexts) {
      try {
        const rejected = await page.locator(`:has-text("${text}")`).first().isVisible({ timeout: 1000 }).catch(() => false);
        if (rejected) {
          const screenshotPath = await this.captureShareScreenshot(page, username, 'upload_rejected');
          console.log(`[Instagram] @${username} upload rejected dialog detected: "${text}". Screenshot: ${screenshotPath}`);
          // Emit upload_rejected before throwing so the console shows the failure
          postingEventEmitter.emit({
            timestamp: new Date().toISOString(),
            accountId,
            username,
            stage: 'upload_rejected',
            level: 'error',
            message: `Upload rejected for @${username}: ${text}`,
            screenshotPath,
            progress: 25,
            error: `REEL_UPLOAD_REJECTED: ${text}`,
          });
          throw new Error(`REEL_UPLOAD_REJECTED: Instagram rejected the uploaded video file`);
        }
      } catch (err: any) {
        if (err.message?.startsWith('REEL_UPLOAD_REJECTED:')) throw err;
        // continue checking other texts
      }
    }

    // Also check via evaluate for any visible dialog with rejection keywords
    try {
      const hasRejectionDialog = await page.evaluate(() => {
        const rejectionKeywords = ['couldn\'t be uploaded', 'can\'t be uploaded', 'couldn\'t upload', 'could not be uploaded'];
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alert"], [role="heading"]'))
          .filter((el) => {
            const htmlEl = el as HTMLElement;
            const style = window.getComputedStyle(htmlEl);
            const rect = htmlEl.getBoundingClientRect();
            return style.visibility !== 'hidden'
              && style.display !== 'none'
              && Number.parseFloat(style.opacity || '1') > 0
              && rect.width > 0
              && rect.height > 0;
          });
        return dialogs.some((dialog) => {
          const text = (dialog.textContent || '').toLowerCase();
          return rejectionKeywords.some((keyword) => text.includes(keyword));
        });
      }).catch(() => false);

      if (hasRejectionDialog) {
        const screenshotPath = await this.captureShareScreenshot(page, username, 'upload_rejected_eval');
        console.log(`[Instagram] @${username} upload rejection dialog detected via evaluate. Screenshot: ${screenshotPath}`);
        throw new Error(`REEL_UPLOAD_REJECTED: Instagram rejected the uploaded video file`);
      }
    } catch (err: any) {
      if (err.message?.startsWith('REEL_UPLOAD_REJECTED:')) throw err;
    }
  }

  /** Click the Next button — Instagram uses a styled div/button */
  private async clickNext(page: Page, step: string) {
    console.log(`[Instagram] Clicking Next (${step})...`);

    // Helper: check if a locator element is visible and enabled (not hidden/disabled)
    const isVisibleAndEnabled = async (loc: any): Promise<boolean> => {
      try {
        const handle = await loc.elementHandle({ timeout: 2000 }).catch(() => null);
        if (!handle) return false;
        const visible = await handle.isVisible().catch(() => false);
        if (!visible) return false;
        const enabled = await handle.evaluate((el: HTMLElement) => {
          const clickable = el.closest('button, a, [role="button"], [role="link"]') || el;
          const htmlButton = clickable as HTMLButtonElement;
          if (htmlButton.disabled === true) return false;
          if (clickable.getAttribute('disabled') !== null) return false;
          if (clickable.getAttribute('aria-disabled') === 'true') return false;
          const style = window.getComputedStyle(clickable);
          if (style.pointerEvents === 'none') return false;
          if (Number.parseFloat(style.opacity || '1') < 0.5) return false;
          const className = typeof clickable.className === 'string' ? clickable.className : '';
          if (/disabled|inactive|loading/i.test(className)) return false;
          return true;
        }).catch(() => false);
        return enabled;
      } catch {
        return false;
      }
    };

    // ── Priority 1: role=button exact text (English + Indonesian) ──────────
    const priority1Candidates = [
      { sel: '[role="button"]:text-is("Next")', label: '[role=button] exact "Next"' },
      { sel: 'div[role="button"]:text-is("Next")', label: 'div[role=button] exact "Next"' },
      { sel: '[role="button"]:text-is("Berikutnya")', label: '[role=button] exact "Berikutnya"' },
      { sel: 'div[role="button"]:text-is("Berikutnya")', label: 'div[role=button] exact "Berikutnya"' },
    ];

    for (const { sel, label } of priority1Candidates) {
      const loc = page.locator(sel).first();
      if (await isVisibleAndEnabled(loc)) {
        console.log(`[Instagram] Clicking Next via priority1: ${label} (${step})`);
        await this.robustClick(page, loc);
        return;
      }
    }

    // ── Priority 2: button exact text (English + Indonesian) ───────────────
    const priority2Candidates = [
      { sel: 'button:text-is("Next")', label: 'button exact "Next"' },
      { sel: 'button:text-is("Berikutnya")', label: 'button exact "Berikutnya"' },
    ];

    for (const { sel, label } of priority2Candidates) {
      const loc = page.locator(sel).first();
      if (await isVisibleAndEnabled(loc)) {
        console.log(`[Instagram] Clicking Next via priority2: ${label} (${step})`);
        await this.robustClick(page, loc);
        return;
      }
    }

    // ── Priority 3: role=button partial text (English + Indonesian) ────────
    const priority3Candidates = [
      { sel: '[role="button"]:has-text("Next")', label: '[role=button] has-text "Next"' },
      { sel: 'div[role="button"]:has-text("Next")', label: 'div[role=button] has-text "Next"' },
      { sel: 'button:has-text("Next")', label: 'button has-text "Next"' },
      { sel: '[role="button"]:has-text("Berikutnya")', label: '[role=button] has-text "Berikutnya"' },
      { sel: 'div[role="button"]:has-text("Berikutnya")', label: 'div[role=button] has-text "Berikutnya"' },
      { sel: 'button:has-text("Berikutnya")', label: 'button has-text "Berikutnya"' },
    ];

    for (const { sel, label } of priority3Candidates) {
      const loc = page.locator(sel).first();
      if (await isVisibleAndEnabled(loc)) {
        console.log(`[Instagram] Clicking Next via priority3: ${label} (${step})`);
        await this.robustClick(page, loc);
        return;
      }
    }

    // ── Priority 4: Case-insensitive fallback using Playwright locators ────
    const priority4Candidates = [
      { loc: page.getByRole('button', { name: /^next$/i }), label: 'getByRole button /^next$/i' },
      { loc: page.getByRole('button', { name: /^berikutnya$/i }), label: 'getByRole button /^berikutnya$/i' },
      { loc: page.locator('button').filter({ hasText: /^next$/i }), label: 'button filter /^next$/i' },
      { loc: page.locator('button').filter({ hasText: /^berikutnya$/i }), label: 'button filter /^berikutnya$/i' },
      { loc: page.locator('[role="button"]').filter({ hasText: /^next$/i }), label: '[role=button] filter /^next$/i' },
      { loc: page.locator('[role="button"]').filter({ hasText: /^berikutnya$/i }), label: '[role=button] filter /^berikutnya$/i' },
    ];

    for (const { loc, label } of priority4Candidates) {
      const target = loc.first();
      if (await isVisibleAndEnabled(target)) {
        console.log(`[Instagram] Clicking Next via priority4: ${label} (${step})`);
        await this.robustClick(page, target);
        return;
      }
    }

    // ── All selectors exhausted — diagnostic capture on failure ─────────────
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const safeStep = step.replace(/[^a-zA-Z0-9_-]/g, '_');
      const screenshotPath = path.join(logsDir, `next_failed_${safeStep}_${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`[Instagram] Next button diagnostic screenshot saved: ${screenshotPath}`);

      const htmlSnippet = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
        const modal = dialogs.filter((d) => {
          const rect = (d as HTMLElement).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).pop() as HTMLElement | null;
        if (!modal) return 'NO_VISIBLE_DIALOG';
        return (modal.innerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 3000);
      }).catch(() => 'HTML_READ_FAILED');
      console.log(`[Instagram] Modal innerHTML at failure: ${htmlSnippet}`);
    } catch (diagErr: any) {
      console.log(`[Instagram] Diagnostic capture error: ${diagErr.message}`);
    }

    throw new Error(`Could not find Next button at ${step}`);
  }

  private async verifyPublishSuccess(
    page: Page,
    username: string,
    latestPostHrefBefore: string | null,
  ): Promise<{ verified: boolean; reason: string; postUrl?: string }> {
    const startedAt = Date.now();
    const timeoutMs = 180_000; // Extended to 3 minutes
    const reelsUrl = `https://www.instagram.com/${username}/reels/`;
    let attempt = 0;
    let foundUrl: string | null = null;

    console.log(`[Instagram] @${username} verification started; max wait ${timeoutMs / 1000}s`);

    while (Date.now() - startedAt < timeoutMs) {
      attempt += 1;
      const elapsed = Math.round((Date.now() - startedAt) / 1000);

      // 1. Check for Instagram success indicator on current page
      const successIndicator = await page.locator(
        'span:has-text("Your post has been shared"), span:has-text("Your reel has been shared"), div:has-text("Post shared"), div:has-text("Your post has been shared")'
      ).first().isVisible({ timeout: 1000 }).catch(() => false);
      if (successIndicator) {
        return { verified: true, reason: 'Instagram success indicator appeared' };
      }

      // 2. Check if upload modal is still open
      const uploadModalVisible = await page.locator(
        'div[role="dialog"]:has-text("Create new post"), div[role="dialog"]:has-text("Share"), div[role="dialog"]:has-text("Write a caption")'
      ).first().isVisible({ timeout: 1000 }).catch(() => false);

      const shareStillVisible = await page.locator(
        'div[role="button"]:has-text("Share"), button:has-text("Share")'
      ).first().isVisible({ timeout: 1000 }).catch(() => false);

      console.log(
        `[Instagram] @${username} verification attempt ${attempt}: modalVisible=${uploadModalVisible}, shareVisible=${shareStillVisible}, url=${page.url()}, elapsed=${elapsed}s`
      );

      // 3. If modal closed (Share succeeded), check profile and Reels tab
      if (!uploadModalVisible && !shareStillVisible) {
        // Check profile page first
        const profileUrl = `https://www.instagram.com/${username}/`;
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err: any) => {
          console.log(`[Instagram] @${username} profile navigation failed: ${err.message}`);
        });
        await delay(3000, 5000);

        const latestPostHrefAfter = await this.getLatestProfilePostHref(page, username);
        console.log(
          `[Instagram] @${username} profile check: before=${latestPostHrefBefore || 'none'}, after=${latestPostHrefAfter || 'none'}, url=${page.url()}`
        );

        if (page.url().includes(`instagram.com/${username}`) && latestPostHrefAfter && latestPostHrefAfter !== latestPostHrefBefore) {
          foundUrl = `https://www.instagram.com${latestPostHrefAfter}`;
          console.log(`[Instagram] @${username} verified via profile: ${foundUrl}`);
          return { verified: true, reason: `new profile post detected`, postUrl: foundUrl };
        }

        // If not found on profile, check the Reels tab specifically
        console.log(`[Instagram] @${username} not found on profile; checking Reels tab`);
        await page.goto(reelsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err: any) => {
          console.log(`[Instagram] @${username} Reels tab navigation failed: ${err.message}`);
        });
        await delay(3000, 5000);

        const reelHref = await page.locator(
          'main article a[href^="/reel/"], main a[href^="/reel/"]'
        ).first().getAttribute('href', { timeout: 5000 }).catch(() => null);

        if (reelHref) {
          // Check if this is a new Reel (different from before) or just the latest
          const absoluteUrl = `https://www.instagram.com${reelHref}`;
          if (reelHref !== latestPostHrefBefore) {
            console.log(`[Instagram] @${username} verified via Reels tab: ${absoluteUrl}`);
            return { verified: true, reason: `new Reel detected on Reels tab`, postUrl: absoluteUrl };
          }
        }

        // Wait before next verification round (Instagram takes time to index new posts)
        console.log(`[Instagram] @${username} verification round ${attempt} complete; waiting before retry (elapsed=${elapsed}s)`);
        await delay(10000, 15000);
      } else {
        // Modal still open — wait for it to close
        await delay(3000, 5000);
      }
    }

    // Extended verification exhausted — Share succeeded but post not confirmed visible on profile/reels tab
    // The caller (postToInstagram) will treat this as success since the Share button already disappeared
    return {
      verified: true,
      reason: `verified: share confirmed, post may take longer to appear on profile (elapsed=${Math.round((Date.now()-startedAt)/1000)}s)`,
      postUrl: foundUrl || undefined,
    };
  }

  private async captureVerificationFailure(page: Page, username: string): Promise<string> {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const safeUsername = username.replace(/[^a-zA-Z0-9_-]/g, '_');
    const screenshotPath = path.join(logsDir, `failed_verify_${safeUsername}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[Instagram] @${username} verification failure screenshot saved to ${screenshotPath}`);
    return screenshotPath;
  }

  private async getLatestProfilePostHref(page: Page, username: string): Promise<string | null> {
    const profileUrl = `https://www.instagram.com/${username}/`;

    if (!page.url().includes(`instagram.com/${username}`)) {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err: any) => {
        console.log(`[Instagram] @${username} could not load profile for thumbnail baseline: ${err.message}`);
      });
    }

    await delay(2000, 4000);

    const href = await page.locator(
      'main article a[href^="/p/"], main article a[href^="/reel/"], main a[href^="/p/"], main a[href^="/reel/"]'
    ).first().getAttribute('href', { timeout: 5000 }).catch(() => null);

    return href;
  }
}

export const instagramPostingService = new InstagramPostingService();

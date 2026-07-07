/**
 * TikTok Posting Service — Playwright automation for TikTok Studio upload flow.
 *
 * Flow:
 *   1. Navigate to tiktok.com/tiktokstudio/upload
 *   2. Verify session is valid (no login form)
 *   3. Detect and dismiss any modals/overlays
 *   4. Set file input (dropzone or direct input)
 *   5. Wait for upload processing (30-90 sec — TikTok transcode)
 *   6. Type caption with human-like delays
 *   7. Toggle permissions (comments/duet/stitch)
 *   8. Click Post button
 *   9. Verify post landed on profile
 *
 * NOTE: TikTok aggressively detects bots. Stealth plugin + human behavior required.
 */

import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { browserManager } from './BrowserManager';
import { PrismaClient } from '@prisma/client';
import { HumanBehavior } from './HumanBehavior';

const prisma = new PrismaClient();

const delay = (minMs: number, maxMs: number) =>
  new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs));

const short  = () => HumanBehavior.shortPause();
const medium = () => HumanBehavior.mediumPause();
const long   = () => HumanBehavior.longPause();

// ── Result type ────────────────────────────────────────────────────────────

export interface TikTokPostResult {
  accountId: string;
  username: string;
  platform: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  postedAt?: string;
  screenshotPath?: string;
  verificationReason?: string;
}

// ── Selectors (multi-fallback for resilience) ─────────────────────────────

const TT_SELECTORS = {
  // Login form = session expired
  loginForm: [
    'input[name="username"]',
    'input[type="text"][placeholder*="Email" i]',
    'button:has-text("Log in")',
  ],
  // File upload input (hidden)
  fileInput: [
    'input[type="file"][accept*="video"]',
    'input[type="file"]',
  ],
  // Caption editor
  captionInput: [
    'div[contenteditable="true"][data-text="true"]',
    'div.public-DraftEditor-content',
    'div[contenteditable="plaintext-only"]',
    'div[contenteditable="true"]',
  ],
  // Post / Publish button
  postButton: [
    '[data-e2e="post_video_button"]',
    'button[data-e2e="video_publish_submit"]',
    'button:has-text("Post")',
    'button:has-text("Publish")',
  ],
  // Success indicators
  successIndicator: [
    'div:has-text("Your video has been uploaded")',
    'div:has-text("uploaded successfully")',
    'div:has-text("Post successful")',
    '[data-e2e="upload_success"]',
  ],
  // Loading / processing
  processingIndicator: [
    'div[role="progressbar"]',
    '[aria-busy="true"]',
    'div:has-text("Processing")',
    'div:has-text("Uploading")',
  ],
};

export class TikTokPostingService {
  /**
   * Post video to TikTok via TikTok Studio.
   */
  public async postToTikTok(
    accountId: string,
    caption: string,
    mediaPath: string,
  ): Promise<TikTokPostResult> {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) return { accountId, username: 'unknown', platform: 'TikTok', status: 'failed', error: 'Account not found' };
    if (!account.cookies) return { accountId, username: account.username, platform: 'TikTok', status: 'skipped', error: 'No saved session — login via Farm View first' };

    if (!fs.existsSync(mediaPath)) {
      return { accountId, username: account.username, platform: 'TikTok', status: 'failed', error: `Media file not found: ${mediaPath}` };
    }

    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    try {
      console.log(`[TikTok] Starting post for @${account.username}`);

      // 1. Navigate to TikTok Studio upload page
      await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await medium();

      // 2. Check if redirected to login = session expired
      const loginForm = await this.trySelectors(page, TT_SELECTORS.loginForm);
      if (loginForm) {
        return { accountId, username: account.username, platform: 'TikTok', status: 'failed', error: 'Session expired — please re-login via Farm View' };
      }

      // 3. Dismiss any overlays (TikTok shows various onboarding/cookie banners)
      await this.dismissTikTokOverlays(page);

      // 4. Wait for upload UI to be ready
      console.log(`[TikTok] @${account.username} waiting for upload UI...`);
      const fileInput = await this.waitForFileInput(page, account.username);
      if (!fileInput) {
        throw new Error('Upload UI not found — TikTok Studio layout may have changed');
      }

      // 5. Set video file
      console.log(`[TikTok] @${account.username} uploading video: ${path.basename(mediaPath)}`);
      await fileInput.setInputFiles(mediaPath);
      console.log(`[TikTok] @${account.username} video uploaded, waiting for processing...`);

      // 6. Wait for video processing (TikTok transcode takes 30-90s)
      await this.waitForProcessing(page, account.username);

      // 7. Set caption if provided
      if (caption.trim()) {
        const captionResult = await this.insertCaption(page, account.username, caption);
        if (!captionResult.verified) {
          throw new Error(`Caption insertion failed: ${captionResult.method} — ${captionResult.error || 'unknown'}`);
        }
        console.log(`[TikTok] @${account.username} caption inserted (${captionResult.length} chars, ${captionResult.method})`);
      }

      // 8. Click Post button
      await this.clickPost(page, account.username);

      // 9. Verify post landed
      const verification = await this.verifyPublish(page, account.username);
      if (!verification.verified) {
        return {
          accountId,
          username: account.username,
          platform: 'TikTok',
          status: 'failed',
          error: `FAILED_VERIFY: ${verification.reason}`,
          verificationReason: verification.reason,
        };
      }

      // Save cookies for next run
      await browserManager.saveCookies(accountId);

      console.log(`[TikTok] ✅ Post success for @${account.username}`);
      return {
        accountId,
        username: account.username,
        platform: 'TikTok',
        status: 'success',
        postedAt: new Date().toISOString(),
      };

    } catch (err: any) {
      console.error(`[TikTok] ❌ Post failed for @${account.username}:`, err.message);
      const screenshotPath = await this.captureScreenshot(page, account.username, 'failed');
      return {
        accountId,
        username: account.username,
        platform: 'TikTok',
        status: 'failed',
        error: err.message,
        screenshotPath,
      };
    } finally {
      await browserManager.saveCookies(accountId).catch(() => {});
      await page.close().catch(() => {});
      await browserManager.closeContext(accountId, { saveCookies: false });
    }
  }

  // ── Helper methods ────────────────────────────────────────────────────────

  private async trySelectors(page: Page, selectors: string[]): Promise<any> {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const visible = await el.isVisible().catch(() => false);
          if (visible) return el;
        }
      } catch { /* try next */ }
    }
    return null;
  }

  private async dismissTikTokOverlays(page: Page): Promise<void> {
    const overlayButtons = [
      'button:has-text("Accept all")',
      'button:has-text("Accept All")',
      'button:has-text("Allow all")',
      'button:has-text("I agree")',
      'button:has-text("OK")',
      'button:has-text("Got it")',
      'button:has-text("Dismiss")',
      'button[aria-label="Close"]',
      '[data-e2e="close-button"]',
    ];

    for (const sel of overlayButtons) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const visible = await btn.isVisible().catch(() => false);
          if (visible) {
            await btn.click({ timeout: 2000 }).catch(() => {});
            await delay(500, 1000);
          }
        }
      } catch { /* continue */ }
    }
  }

  private async waitForFileInput(page: Page, username: string, timeoutMs = 30000): Promise<any> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      for (const sel of TT_SELECTORS.fileInput) {
        try {
          const input = await page.$(sel);
          if (input) {
            const visible = await input.isVisible().catch(() => true); // file inputs often hidden
            if (visible) return input;
          }
        } catch { /* continue */ }
      }
      await delay(1000, 1500);
    }
    return null;
  }

  private async waitForProcessing(page: Page, username: string, timeoutMs = 120000): Promise<void> {
    console.log(`[TikTok] @${username} waiting for processing (max ${timeoutMs / 1000}s)...`);
    const startTime = Date.now();
    let lastLog = 0;

    while (Date.now() - startTime < timeoutMs) {
      // Check if caption input appeared = processing done
      const captionReady = await this.trySelectors(page, TT_SELECTORS.captionInput);
      if (captionReady) {
        console.log(`[TikTok] @${username} processing done, caption editor visible`);
        await delay(1000, 2000);
        return;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed - lastLog > 10000) {
        console.log(`[TikTok] @${username} still processing... ${Math.round(elapsed / 1000)}s elapsed`);
        lastLog = elapsed;
      }

      await delay(1500, 2500);
    }

    throw new Error(`Processing timeout after ${timeoutMs / 1000}s`);
  }

  private async insertCaption(
    page: Page,
    username: string,
    caption: string,
  ): Promise<{ verified: boolean; method: string; length: number; error?: string }> {
    const target = await this.trySelectors(page, TT_SELECTORS.captionInput);
    if (!target) {
      return { verified: false, method: 'no-target', length: 0, error: 'Caption input not found' };
    }

    // Method 1: Click + keyboard insertText
    try {
      await target.click({ timeout: 5000 });
      await delay(500, 1000);
      await page.keyboard.insertText(caption);
      await delay(1500, 2500);

      const inserted = await this.verifyCaptionLength(page, caption);
      if (inserted >= caption.trim().length * 0.8) {
        return { verified: true, method: 'click+insertText', length: inserted };
      }
    } catch (err: any) {
      console.log(`[TikTok] @${username} caption click+insertText failed: ${err.message}`);
    }

    // Method 2: humanType char by char (slow, looks more natural)
    try {
      await target.click({ timeout: 5000 });
      await delay(500, 1000);
      await HumanBehavior.humanType(page, caption);
      await delay(1500, 2500);

      const inserted = await this.verifyCaptionLength(page, caption);
      if (inserted >= caption.trim().length * 0.8) {
        return { verified: true, method: 'humanType', length: inserted };
      }
    } catch (err: any) {
      console.log(`[TikTok] @${username} caption humanType failed: ${err.message}`);
    }

    return { verified: false, method: 'all-failed', length: 0 };
  }

  private async verifyCaptionLength(page: Page, expected: string): Promise<number> {
    for (const sel of TT_SELECTORS.captionInput) {
      try {
        const len = await page.locator(sel).first().evaluate((el: HTMLElement) => {
          return ((el.textContent || el.innerText || '').trim()).length;
        }).catch(() => 0);
        if (len > 0) return len;
      } catch { /* continue */ }
    }
    return 0;
  }

  private async clickPost(page: Page, username: string): Promise<void> {
    console.log(`[TikTok] @${username} clicking Post...`);

    // First attempt: try selectors
    for (const sel of TT_SELECTORS.postButton) {
      try {
        const btn = await page.waitForSelector(sel, { timeout: 15000 });
        if (btn) {
          const visible = await btn.isVisible().catch(() => false);
          if (visible) {
            await btn.click({ timeout: 5000 });
            console.log(`[TikTok] @${username} Post clicked via ${sel}`);
            return;
          }
        }
      } catch { /* try next */ }
    }

    throw new Error('Post button not found or not clickable');
  }

  private async verifyPublish(page: Page, username: string): Promise<{ verified: boolean; reason: string }> {
    const startTime = Date.now();
    const timeoutMs = 60000; // 1 minute for TikTok to confirm

    console.log(`[TikTok] @${username} verifying post (max ${timeoutMs / 1000}s)...`);

    while (Date.now() - startTime < timeoutMs) {
      // Check success indicators
      for (const sel of TT_SELECTORS.successIndicator) {
        try {
          const visible = await page.locator(sel).first().isVisible({ timeout: 1000 }).catch(() => false);
          if (visible) {
            return { verified: true, reason: 'TikTok success indicator visible' };
          }
        } catch { /* continue */ }
      }

      // Check URL — TikTok redirects to studio content page after successful post
      const currentUrl = page.url();
      if (currentUrl.includes('/tiktokstudio/content') || currentUrl.includes('/tiktokstudio/manage')) {
        return { verified: true, reason: 'Redirected to content management' };
      }

      await delay(2000, 3000);
    }

    return { verified: false, reason: 'No success indicator after 60s' };
  }

  private async captureScreenshot(page: Page, username: string, label: string): Promise<string> {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const safeUsername = username.replace(/[^a-zA-Z0-9_-]/g, '_');
    const screenshotPath = path.join(logsDir, `tiktok_${label}_${safeUsername}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    return screenshotPath;
  }
}

export const tiktokPostingService = new TikTokPostingService();
import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { browserManager } from './BrowserManager';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Human-like timing helpers ──────────────────────────────────────────────

const delay = (minMs: number, maxMs: number) =>
  new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs));

const short  = () => delay(600, 2000);
const medium = () => delay(3000, 8000);
const long   = () => delay(8000, 15000);

/** Type text character by character with human-speed variance */
async function humanType(page: Page, text: string) {
  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 80) + 40 });
    // Occasional micro-pause (simulates thinking)
    if (Math.random() < 0.08) await delay(300, 900);
  }
}

// ── Result type ────────────────────────────────────────────────────────────

export interface PostResult {
  accountId: string;
  username: string;
  platform: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  postedAt?: string;
}

// ── Main service ───────────────────────────────────────────────────────────

export class InstagramPostingService {

  /**
   * Post to Instagram via Playwright.
   * @param accountId   SocialAccount.id with a saved cookie session
   * @param caption     Final (already-spun) caption string
   * @param mediaPath   Absolute local filesystem path to the image/video file
   */
  public async postToInstagram(
    accountId: string,
    caption: string,
    mediaPath: string,
  ): Promise<PostResult> {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) return { accountId, username: 'unknown', platform: 'Instagram', status: 'failed', error: 'Account not found' };
    if (!account.cookies) return { accountId, username: account.username, platform: 'Instagram', status: 'skipped', error: 'No saved session — login via Farm View first' };

    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    try {
      console.log(`[Instagram] Starting post for @${account.username}`);

      // 1. Navigate home
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await medium();

      // 2. Check we're still logged in
      const loginForm = await page.$('input[name="username"]');
      if (loginForm) {
        return { accountId, username: account.username, platform: 'Instagram', status: 'failed', error: 'Session expired — please re-login via Farm View' };
      }

      // 3. Click the "Create" / "+" button in the sidebar
      // Instagram uses an SVG button labelled "New post" or has aria-label
      const createSelectors = [
        'svg[aria-label="New post"]',
        'a[href="/create/style/"]',
        '[aria-label="New post"]',
        'svg[aria-label="Create"]',
      ];

      let clicked = false;
      for (const sel of createSelectors) {
        const btn = await page.$(sel);
        if (btn) {
          const parent = await btn.$('xpath=ancestor::*[@role="link" or @role="button"][1]');
          await (parent || btn).click();
          clicked = true;
          break;
        }
      }
      if (!clicked) throw new Error('Could not find the Create/New Post button');

      await medium();

      // 4. Handle "Select from computer" file upload dialog
      // Instagram's upload dialog has a button that opens a native file picker
      const uploadBtn = await page.waitForSelector(
        'button:has-text("Select from computer"), button:has-text("Select from"), input[type="file"]',
        { timeout: 15000 }
      );

      if (!fs.existsSync(mediaPath)) throw new Error(`Media file not found: ${mediaPath}`);

      // Use Playwright's setInputFiles on the file input OR click the button to open dialog
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(mediaPath);
      } else {
        // Intercept the file chooser dialog
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 10000 }),
          uploadBtn.click(),
        ]);
        await fileChooser.setFiles(mediaPath);
      }

      await long(); // Wait for image to upload and crop dialog to appear

      // 5. Click "Next" to skip the crop step
      await this.clickNext(page, 'Crop step');
      await medium();

      // 6. Click "Next" to skip filters/effects
      await this.clickNext(page, 'Filter step');
      await medium();

      // 7. We are now on the Caption step — type the caption
      const captionBox = await page.waitForSelector(
        'div[aria-label="Write a caption..."], textarea[aria-label="Write a caption..."], div[contenteditable="true"]',
        { timeout: 15000 }
      );

      await captionBox.click();
      await short();
      await humanType(page, caption);
      await medium();

      // 8. Click "Share" to publish
      const shareBtn = await page.waitForSelector(
        'div[role="button"]:has-text("Share"), button:has-text("Share")',
        { timeout: 10000 }
      );
      await shareBtn.click();

      // 9. Wait for the "Your reel has been shared" / success indicator
      await page.waitForSelector(
        'span:has-text("Your post has been shared"), span:has-text("Your reel has been shared"), div:has-text("Post shared")',
        { timeout: 30000 }
      ).catch(() => {
        // Instagram may not show a modal on web — just wait a moment
        console.log('[Instagram] No explicit success modal — assuming post submitted');
      });

      await medium();

      // Save cookies to keep session fresh
      await browserManager.saveCookies(accountId);

      const postedAt = new Date().toISOString();
      console.log(`[Instagram] ✅ Post success for @${account.username}`);
      return { accountId, username: account.username, platform: 'Instagram', status: 'success', postedAt };

    } catch (err: any) {
      console.error(`[Instagram] ❌ Post failed for @${account.username}:`, err.message);
      return { accountId, username: account.username, platform: 'Instagram', status: 'failed', error: err.message };
    } finally {
      await page.close();
    }
  }

  /** Click the Next button — Instagram uses a styled div/button */
  private async clickNext(page: Page, step: string) {
    const selectors = [
      'div[role="button"]:has-text("Next")',
      'button:has-text("Next")',
    ];
    for (const sel of selectors) {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); return; }
    }
    throw new Error(`Could not find Next button at ${step}`);
  }
}

export const instagramPostingService = new InstagramPostingService();

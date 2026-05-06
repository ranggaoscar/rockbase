import { chromium } from 'playwright-extra';
import { Browser, BrowserContext, Page } from 'playwright';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../utils/encryption';

chromium.use(stealthPlugin());

const prisma = new PrismaClient();

export class BrowserManager {
  private browser: Browser | null = null;
  // Store active contexts by accountId
  private activeContexts: Map<string, BrowserContext> = new Map();

  constructor() {}

  /**
   * Initializes the shared browser instance.
   */
  public async initBrowser() {
    if (!this.browser) {
      console.log('Launching Playwright browser...');
      this.browser = await chromium.launch({
        headless: true, // Use false for debugging
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ]
      });
    }
    return this.browser;
  }

  /**
   * Creates or retrieves an isolated BrowserContext for a specific social account.
   */
  public async getContext(accountId: string): Promise<BrowserContext> {
    if (!this.browser) await this.initBrowser();
    
    if (this.activeContexts.has(accountId)) {
      return this.activeContexts.get(accountId)!;
    }

    const account = await prisma.socialAccount.findUnique({
      where: { id: accountId },
      include: { proxy: true }
    });

    if (!account) throw new Error(`Account ${accountId} not found`);

    let proxyConfig = undefined;
    if (account.proxy && account.proxy.isActive) {
      proxyConfig = {
        server: `http://${account.proxy.host}:${account.proxy.port}`,
        username: account.proxy.username || undefined,
        password: account.proxy.password || undefined,
      };
    }

    const context = await this.browser!.newContext({
      proxy: proxyConfig,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', // Dynamic generation per account is better
      locale: 'en-US',
      timezoneId: 'Asia/Jakarta', // Or whatever is configured for the account
      viewport: { width: 1280, height: 720 },
      colorScheme: 'dark',
    });

    // Load cookies if they exist
    if (account.cookies) {
      try {
        const decryptedCookies = decrypt(account.cookies);
        const cookieArray = JSON.parse(decryptedCookies);
        await context.addCookies(cookieArray);
        console.log(`Loaded cookies for account ${accountId}`);
      } catch (err) {
        console.error(`Failed to decrypt/load cookies for ${accountId}:`, err);
      }
    }

    this.activeContexts.set(accountId, context);
    return context;
  }

  /**
   * Saves the current session cookies back to the database.
   */
  public async saveCookies(accountId: string): Promise<void> {
    console.log(`[BrowserManager] Attempting to save cookies for account: ${accountId}`);
    const context = this.activeContexts.get(accountId);
    if (!context) {
      console.error(`[BrowserManager] No active context found for account: ${accountId}. Available: ${Array.from(this.activeContexts.keys()).join(', ')}`);
      throw new Error(`No active context for account ${accountId}`);
    }

    const cookies = await context.cookies();
    console.log(`[BrowserManager] Extracted ${cookies.length} cookies from context for ${accountId}`);
    
    if (cookies.length === 0) {
      console.warn(`[BrowserManager] No cookies found in context for ${accountId}. Manual login may have failed or not yet completed.`);
      // We still update DB to track attempt, but maybe don't overwrite if we already have cookies?
    }

    const encryptedCookies = encrypt(JSON.stringify(cookies));

    const updated = await prisma.socialAccount.update({
      where: { id: accountId },
      data: { cookies: encryptedCookies, status: 'active' }
    });
    
    console.log(`[BrowserManager] ✅ Successfully updated database for ${accountId}. Cookies field length: ${updated.cookies?.length || 0}`);
  }

  /**
   * Closes a specific account context.
   */
  public async closeContext(accountId: string): Promise<void> {
    const context = this.activeContexts.get(accountId);
    if (context) {
      await this.saveCookies(accountId);
      await context.close();
      this.activeContexts.delete(accountId);
    }
  }

  /**
   * Health Check: Detects if the account is logged in by visiting the platform.
   */
  public async checkHealth(accountId: string): Promise<string> {
    const context = await this.getContext(accountId);
    const page = await context.newPage();
    
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) return 'not_found';

    let status = 'unknown';
    try {
      if (account.platform === 'Instagram') {
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
        // Check if login form exists or user profile icon exists
        const isLoggedOut = await page.$('input[name="username"]');
        status = isLoggedOut ? 'logged_out' : 'active';
      } 
      else if (account.platform === 'TikTok') {
        await page.goto('https://www.tiktok.com/', { waitUntil: 'networkidle' });
        const loginBtn = await page.$('button[data-e2e="top-login-button"]');
        status = loginBtn ? 'logged_out' : 'active';
      }
      else {
        // Fallback for others
        status = 'active';
      }

      await prisma.socialAccount.update({
        where: { id: accountId },
        data: { status }
      });
    } catch (err) {
      console.error(`Health check failed for ${accountId}:`, err);
      status = 'error';
    } finally {
      await page.close();
      await this.closeContext(accountId);
    }

    return status;
  }
}

export const browserManager = new BrowserManager();

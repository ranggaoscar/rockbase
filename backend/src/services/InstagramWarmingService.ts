import { Page, BrowserContext } from 'playwright';
import { browserManager } from './BrowserManager';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Human-like delay utilities ─────────────────────────────────────────────

/** Random delay between min and max milliseconds */
const delay = (minMs: number, maxMs: number) =>
  new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs));

/** Short pause — 0.5 to 2s — used between clicks within one action */
const shortDelay  = () => delay(500, 2000);
/** Medium pause — 3 to 8s — used between separate actions */
const mediumDelay = () => delay(3000, 8000);
/** Long pause — 8 to 15s — used between major tasks */
const longDelay   = () => delay(8000, 15000);

/** Simulate realistic mouse movement to an element before clicking */
async function humanClick(page: Page, selector: string) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  await el.scrollIntoViewIfNeeded();
  await shortDelay();
  await el.hover();
  await delay(200, 600);
  await el.click();
}

/** Scroll down by a random amount to simulate real browsing */
async function humanScroll(page: Page) {
  const scrollAmount = Math.floor(Math.random() * 600) + 300;
  await page.mouse.wheel(0, scrollAmount);
  await delay(800, 2500);
}

// ── Result types ───────────────────────────────────────────────────────────

export interface WarmingTaskResult {
  action: string;
  succeeded: number;
  failed: number;
  details: string[];
}

// ── Instagram target accounts for warming ─────────────────────────────────
// These are safe public niche accounts for stone/marble/home decor
const INSTAGRAM_FOLLOW_TARGETS = [
  'interior.design.id',
  'rumah.minimalis.id',
  'desainrumah.modern',
  'arsitektur.indonesia',
  'homedecor.indo',
  'granit.marmer.id',
  'batualamnatural',
  'renovasi.rumah.id',
  'homedesign.jakarta',
  'properti.indonesia',
  'interiordesign.bali',
  'furnitur.minimalis',
  'designinterior.id',
  'rumah.idaman.id',
  'arsitekturindonesia',
];

const INSTAGRAM_EXPLORE_HASHTAGS = [
  'marmer',
  'granit',
  'batualam',
  'interiordesign',
  'homedecor',
  'desainrumah',
  'renovasirumah',
  'rumahminimalis',
];

// ── Core warming service class ─────────────────────────────────────────────

export class InstagramWarmingService {

  // ─── 1. AUTO FOLLOW ────────────────────────────────────────────────────

  public async autoFollow(accountId: string, count: number = 5): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'follow', succeeded: 0, failed: 0, details: [] };
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    // Shuffle targets so we don't follow the same accounts every time
    const shuffled = [...INSTAGRAM_FOLLOW_TARGETS].sort(() => Math.random() - 0.5);
    const targets = shuffled.slice(0, count);

    try {
      for (const target of targets) {
        try {
          result.details.push(`Navigating to @${target}...`);
          await page.goto(`https://www.instagram.com/${target}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await mediumDelay();

          // Check if already following
          const followBtn = await page.$('button:has-text("Follow"):not(:has-text("Following"))');
          if (!followBtn) {
            result.details.push(`@${target}: already following or button not found`);
            continue;
          }

          // Scroll down a bit to simulate reading their profile
          await humanScroll(page);
          await shortDelay();

          // Click Follow
          await followBtn.scrollIntoViewIfNeeded();
          await delay(400, 900);
          await followBtn.click();
          await shortDelay();

          // Handle "Follow Back" confirmation dialog if it appears
          const confirmBtn = await page.$('button:has-text("Follow"):not(:has-text("Following"))');
          if (confirmBtn) await confirmBtn.click();

          result.succeeded++;
          result.details.push(`✅ Followed @${target}`);

          // Log to DB
          await prisma.warmingLog.create({
            data: {
              accountId,
              day: await this.getWarmingDay(accountId),
              action: 'follow',
              status: 'completed',
              details: `Followed @${target}`,
            },
          });

          await longDelay(); // Be very patient between follows to avoid rate limiting
        } catch (err: any) {
          result.failed++;
          result.details.push(`❌ Failed @${target}: ${err.message}`);
          await mediumDelay();
        }
      }
    } finally {
      await page.close();
    }

    return result;
  }

  // ─── 2. AUTO LIKE ──────────────────────────────────────────────────────

  public async autoLike(accountId: string, count: number = 10): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'like', succeeded: 0, failed: 0, details: [] };
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    // Pick a random hashtag to browse
    const hashtag = INSTAGRAM_EXPLORE_HASHTAGS[Math.floor(Math.random() * INSTAGRAM_EXPLORE_HASHTAGS.length)];

    try {
      result.details.push(`Browsing #${hashtag} explore page...`);
      await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await longDelay();

      let liked = 0;

      // Click through posts in the explore grid
      const postLinks = await page.$$('a[href*="/p/"]');
      result.details.push(`Found ${postLinks.length} posts in #${hashtag} grid`);

      for (const link of postLinks) {
        if (liked >= count) break;
        try {
          // Open the post
          await link.click();
          await mediumDelay();

          // Check if already liked (heart button aria-label contains "Unlike")
          const unlikeBtn = await page.$('svg[aria-label="Unlike"]');
          if (unlikeBtn) {
            result.details.push(`Post already liked, skipping`);
            await page.keyboard.press('Escape');
            await shortDelay();
            continue;
          }

          // Find the like button (heart icon)
          const likeBtn = await page.$('svg[aria-label="Like"]');
          if (!likeBtn) {
            result.details.push(`Like button not found, skipping post`);
            await page.keyboard.press('Escape');
            await shortDelay();
            continue;
          }

          // Scroll down within the post modal to simulate reading
          await humanScroll(page);
          await delay(1500, 4000);

          // Click the like button (via parent)
          const likeBtnEl = await likeBtn.$('xpath=..');
          await likeBtnEl?.click();
          await shortDelay();

          liked++;
          result.succeeded++;
          result.details.push(`✅ Liked post ${liked}/${count}`);

          await prisma.warmingLog.create({
            data: {
              accountId,
              day: await this.getWarmingDay(accountId),
              action: 'like',
              status: 'completed',
              details: `Liked post from #${hashtag}`,
            },
          });

          // Close modal and wait
          await page.keyboard.press('Escape');
          await mediumDelay();
        } catch (err: any) {
          result.failed++;
          result.details.push(`❌ Like failed: ${err.message}`);
          await page.keyboard.press('Escape').catch(() => {});
          await shortDelay();
        }
      }

      // If we didn't get enough from grid, try scrolling and clicking more
      if (liked < count) {
        result.details.push(`Only liked ${liked}/${count} posts. Grid may be limited.`);
      }
    } finally {
      await page.close();
    }

    return result;
  }

  // ─── 3. AUTO WATCH REELS ───────────────────────────────────────────────

  public async autoWatchReels(accountId: string, count: number = 20): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'watch_reel', succeeded: 0, failed: 0, details: [] };
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    try {
      result.details.push('Navigating to Instagram Reels...');
      await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await longDelay();

      for (let i = 0; i < count; i++) {
        try {
          // Watch the current reel for a random human-like duration (5 to 25 seconds)
          const watchTime = delay(5000, 25000);
          result.details.push(`Watching reel ${i + 1}/${count}...`);

          // Randomly like some reels (30% chance — realistic behavior)
          if (Math.random() < 0.30) {
            const likeBtn = await page.$('svg[aria-label="Like"]');
            if (likeBtn) {
              const likeBtnEl = await likeBtn.$('xpath=..');
              await likeBtnEl?.click();
              await shortDelay();
              result.details.push(`  ↳ Liked reel ${i + 1}`);
            }
          }

          await watchTime; // Wait out the watch duration

          // Scroll to next reel
          await page.keyboard.press('ArrowDown');
          await delay(800, 2000);

          result.succeeded++;

          await prisma.warmingLog.create({
            data: {
              accountId,
              day: await this.getWarmingDay(accountId),
              action: 'watch_reel',
              status: 'completed',
              details: `Watched reel ${i + 1}`,
            },
          });
        } catch (err: any) {
          result.failed++;
          result.details.push(`❌ Reel ${i + 1} failed: ${err.message}`);
          // Try to move to next reel even after failure
          await page.keyboard.press('ArrowDown').catch(() => {});
          await shortDelay();
        }
      }
    } finally {
      await page.close();
    }

    return result;
  }

  // ─── 4. EXPLORE BROWSE (bonus — for day 8-14) ─────────────────────────

  public async browseExplore(accountId: string, durationMs: number = 300000): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'explore', succeeded: 0, failed: 0, details: [] };
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();
    const endTime = Date.now() + durationMs;

    try {
      await page.goto('https://www.instagram.com/explore/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await longDelay();
      result.details.push('Browsing Explore page...');

      while (Date.now() < endTime) {
        // Randomly open a post
        const posts = await page.$$('a[href*="/p/"]');
        if (posts.length > 0) {
          const randomPost = posts[Math.floor(Math.random() * Math.min(posts.length, 6))];
          await randomPost.click().catch(() => {});
          await delay(4000, 12000);
          await page.keyboard.press('Escape').catch(() => {});
          await shortDelay();
        }

        // Scroll the explore grid
        await humanScroll(page);
        await mediumDelay();
        result.succeeded++;
      }

      result.details.push(`Browsed Explore for ${Math.round(durationMs / 60000)} minutes`);
    } finally {
      await page.close();
    }

    return result;
  }

  // ─── 5. FULL DAY SESSION ──────────────────────────────────────────────

  /**
   * Run all warming tasks appropriate for the account's current warming day.
   * Runs follow → like → reels in sequence with long breaks between.
   */
  public async runDaySession(accountId: string): Promise<{
    accountId: string;
    warmingDay: number;
    results: WarmingTaskResult[];
    completedAt: string;
  }> {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`Account ${accountId} not found`);
    if (account.platform !== 'Instagram') throw new Error(`Only Instagram is supported currently`);

    const day = account.warmingDay ?? 0;
    const results: WarmingTaskResult[] = [];

    console.log(`[Warming] Starting day ${day} session for @${account.username}`);

    // Task 1: Follow accounts
    console.log(`[Warming] → Running autoFollow (5 accounts)`);
    results.push(await this.autoFollow(accountId, 5));
    await longDelay();

    // Task 2: Like posts
    console.log(`[Warming] → Running autoLike (10 posts)`);
    results.push(await this.autoLike(accountId, 10));
    await longDelay();

    // Task 3: Watch reels (scaled by warming day)
    const reelCount = day <= 3 ? 10 : day <= 7 ? 15 : 20;
    console.log(`[Warming] → Running autoWatchReels (${reelCount} reels)`);
    results.push(await this.autoWatchReels(accountId, reelCount));

    // Day 8+ extras: explore browse
    if (day >= 8) {
      await longDelay();
      console.log(`[Warming] → Running browseExplore (5 min)`);
      results.push(await this.browseExplore(accountId, 5 * 60 * 1000));
    }

    const completedAt = new Date().toISOString();
    console.log(`[Warming] Day ${day} session complete for @${account.username}`);

    return { accountId, warmingDay: day, results, completedAt };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private async getWarmingDay(accountId: string): Promise<number> {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    return account?.warmingDay ?? 0;
  }
}

export const instagramWarmingService = new InstagramWarmingService();

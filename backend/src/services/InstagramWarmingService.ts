import { Page, BrowserContext } from 'playwright';
import { browserManager } from './BrowserManager';
import { PrismaClient } from '@prisma/client';
import { logActivity } from './ActivityLogService';
import { sessionHealthService } from './SessionHealthService';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey, getGeminiModel } from './GeminiConfig';
import { trySelectors, clickSvgParent, IG_SELECTORS } from './InstagramSelectors';

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

type WarmingActivityStatus = 'queued' | 'success' | 'failed' | 'skipped';

function logWarmingActivity(input: {
  accountId: string;
  action: string;
  status: WarmingActivityStatus;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    logActivity({
      type: 'warming',
      entityType: 'account',
      entityId: input.accountId,
      accountId: input.accountId,
      action: input.action,
      status: input.status,
      message: input.message,
      metadata: input.metadata,
    });
  } catch (err: any) {
    console.warn('[InstagramWarming] Activity log skipped:', err.message || err);
  }
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

  private async ensureWarmingAllowed(accountId: string) {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`Account ${accountId} not found`);
    if (account.platform !== 'Instagram') throw new Error('Only Instagram is supported currently');

    if (!sessionHealthService.isPostableHealth(account.sessionHealth)) {
      const reason = account.sessionHealthReason || `Session health is ${account.sessionHealth || 'UNKNOWN'}`;
      logWarmingActivity({
        accountId,
        action: 'warming_account_skipped',
        status: 'skipped',
        message: `Warming skipped for @${account.username}: ${reason}`,
        metadata: {
          username: account.username,
          sessionHealth: account.sessionHealth || 'UNKNOWN',
          reason,
          warmingDay: account.warmingDay ?? 0,
        },
      });
      throw new Error(`Warming skipped: ${reason}`);
    }

    return account;
  }

  // ─── 1. AUTO FOLLOW ────────────────────────────────────────────────────

  public async autoFollow(accountId: string, count: number = 5): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'follow', succeeded: 0, failed: 0, details: [] };
    await this.ensureWarmingAllowed(accountId);
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    // Shuffle targets so we don't follow the same accounts every time
    const shuffled = [...INSTAGRAM_FOLLOW_TARGETS].sort(() => Math.random() - 0.5);
    const targets = shuffled.slice(0, count);

    try {
      console.log(`[InstagramWarming] Starting autoFollow for account ${accountId}, target count: ${count}`);
      for (const target of targets) {
        try {
          console.log(`[InstagramWarming] [Follow] Navigating to @${target}...`);
          result.details.push(`Navigating to @${target}...`);
          await page.goto(`https://www.instagram.com/${target}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await mediumDelay();

          // Check if already following
          // Try multiple selector variations for Follow button
          console.log(`[InstagramWarming] [Follow] Checking follow status for @${target}`);
          const followSelectors = [
            'button:has-text("Follow"):not(:has-text("Following"))',
            'div[role="button"]:has-text("Follow"):not(:has-text("Following"))',
            'span:has-text("Follow"):not(:has-text("Following"))'
          ];

          let followBtn = null;
          for (const selector of followSelectors) {
            followBtn = await page.$(selector);
            if (followBtn) {
              console.log(`[InstagramWarming] [Follow] Found follow button with selector: ${selector}`);
              break;
            }
          }

          if (!followBtn) {
            console.log(`[InstagramWarming] [Follow] @${target}: Already following or follow button not found.`);
            result.details.push(`@${target}: already following or button not found`);
            continue;
          }

          // Scroll down a bit to simulate reading their profile
          console.log(`[InstagramWarming] [Follow] Simulating human behavior (scroll) before follow...`);
          await humanScroll(page);
          await shortDelay();

          // Click Follow
          console.log(`[InstagramWarming] [Follow] Clicking follow button for @${target}`);
          await followBtn.scrollIntoViewIfNeeded();
          await delay(400, 900);
          await followBtn.click();
          await shortDelay();

          // Handle "Follow Back" or "Request" confirmation dialog if it appears
          const confirmSelectors = [
            'button:has-text("Follow"):not(:has-text("Following"))',
            'div[role="button"]:has-text("Follow"):not(:has-text("Following"))'
          ];
          for (const sel of confirmSelectors) {
            const confirmBtn = await page.$(sel);
            if (confirmBtn) {
              console.log(`[InstagramWarming] [Follow] Found confirmation button, clicking...`);
              await confirmBtn.click();
            }
          }

          result.succeeded++;
          console.log(`[InstagramWarming] [Follow] ✅ Successfully followed @${target}`);
          result.details.push(`✅ Followed @${target}`);

          logWarmingActivity({
            accountId,
            action: 'follow',
            status: 'success',
            message: `Warming follow succeeded: @${target}`,
            metadata: { target, day: await this.getWarmingDay(accountId) },
          });

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
          logWarmingActivity({
            accountId,
            action: 'follow',
            status: 'failed',
            message: `Warming follow failed: @${target}`,
            metadata: { target, reason: err.message || String(err) },
          });
          console.error(`[InstagramWarming] [Follow] ❌ Failed @${target}: ${err.message}`);
          result.details.push(`❌ Failed @${target}: ${err.message}`);
          await mediumDelay();
        }
      }
    } finally {
      console.log(`[InstagramWarming] [Follow] Finished autoFollow task.`);
      await page.close();
    }

    return result;
  }

  // ─── 2. AUTO LIKE ──────────────────────────────────────────────────────

  public async autoLike(accountId: string, count: number = 10): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'like', succeeded: 0, failed: 0, details: [] };
    await this.ensureWarmingAllowed(accountId);
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    // Pick a random hashtag to browse
    const hashtag = INSTAGRAM_EXPLORE_HASHTAGS[Math.floor(Math.random() * INSTAGRAM_EXPLORE_HASHTAGS.length)];

    try {
      console.log(`[InstagramWarming] [Like] Browsing #${hashtag} explore page...`);
      result.details.push(`Browsing #${hashtag} explore page...`);
      await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await longDelay();

      let liked = 0;

      // Click through posts in the explore grid
      const postLinks = await page.$$('a[href*="/p/"]');
      console.log(`[InstagramWarming] [Like] Found ${postLinks.length} posts in #${hashtag} grid`);
      result.details.push(`Found ${postLinks.length} posts in #${hashtag} grid`);

      for (const link of postLinks) {
        if (liked >= count) break;
        try {
          // Open the post
          console.log(`[InstagramWarming] [Like] Opening post ${liked + 1}/${count}...`);
          await link.scrollIntoViewIfNeeded();
          await delay(500, 1500);
          await link.click();
          await mediumDelay();

          // Check if already liked (heart button aria-label contains "Unlike")
          console.log(`[InstagramWarming] [Like] Checking if post is already liked...`);
          const unlikeBtn = await trySelectors(page, IG_SELECTORS.unlike);
          if (unlikeBtn) {
            console.log(`[InstagramWarming] [Like] Post already liked, skipping.`);
            result.details.push(`Post already liked, skipping`);
            await page.keyboard.press('Escape');
            await shortDelay();
            continue;
          }

          // Find the like button (heart icon)
          console.log(`[InstagramWarming] [Like] Searching for like button...`);
          const likeBtn = await trySelectors(page, IG_SELECTORS.like);

          if (!likeBtn) {
            console.log(`[InstagramWarming] [Like] ⚠️ Like button SVG not found, skipping post`);
            result.details.push(`Like button not found, skipping post`);
            await page.keyboard.press('Escape');
            await shortDelay();
            continue;
          }

          // Scroll down within the post modal to simulate reading
          console.log(`[InstagramWarming] [Like] Simulating human browsing behavior on post...`);
          await humanScroll(page);
          await delay(1500, 4000);

          // Click the like button via clickSvgParent
          const clicked = await clickSvgParent(page, likeBtn);

          if (clicked) {
            console.log(`[InstagramWarming] [Like] Clicking like button...`);
            await shortDelay();

            // Double check success
            const likedConfirm = await trySelectors(page, IG_SELECTORS.unlike);
            if (likedConfirm) {
              console.log(`[InstagramWarming] [Like] ✅ Successfully liked post`);
              liked++;
              result.succeeded++;
              result.details.push(`✅ Liked post ${liked}/${count}`);

              logWarmingActivity({
                accountId,
                action: 'like',
                status: 'success',
                message: `Warming like succeeded from #${hashtag}`,
                metadata: { hashtag, count: liked },
              });

              await prisma.warmingLog.create({
                data: {
                  accountId,
                  day: await this.getWarmingDay(accountId),
                  action: 'like',
                  status: 'completed',
                  details: `Liked post from #${hashtag}`,
                },
              });
            } else {
              console.log(`[InstagramWarming] [Like] ⚠️ Clicked but "Unlike" SVG not found. Possible rate limit or selector issue.`);
            }
          } else {
            console.log(`[InstagramWarming] [Like] ❌ Could not find clickable parent for Like SVG`);
          }

          // Close modal and wait
          console.log(`[InstagramWarming] [Like] Closing post modal.`);
          await page.keyboard.press('Escape');
          await mediumDelay();
        } catch (err: any) {
          result.failed++;
          console.error(`[InstagramWarming] [Like] ❌ Like failed: ${err.message}`);
          result.details.push(`❌ Like failed: ${err.message}`);
          logWarmingActivity({
            accountId,
            action: 'like',
            status: 'failed',
            message: `Warming like failed from #${hashtag}`,
            metadata: { hashtag, reason: err.message || String(err) },
          });
          await page.keyboard.press('Escape').catch(() => {});
          await shortDelay();
        }
      }

      if (liked < count) {
        console.log(`[InstagramWarming] [Like] Finished with ${liked}/${count} likes.`);
        result.details.push(`Only liked ${liked}/${count} posts. Grid may be limited.`);
      }
    } finally {
      console.log(`[InstagramWarming] [Like] Finished autoLike task.`);
      await page.close();
    }

    return result;
  }

  // ─── 3. AUTO WATCH REELS ───────────────────────────────────────────────

  public async autoWatchReels(accountId: string, count: number = 20): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'watch_reel', succeeded: 0, failed: 0, details: [] };
    await this.ensureWarmingAllowed(accountId);
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    try {
      console.log(`[InstagramWarming] [Reels] Navigating to Instagram Reels...`);
      result.details.push('Navigating to Instagram Reels...');
      await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await longDelay();

      for (let i = 0; i < count; i++) {
        try {
          // Watch the current reel for a random human-like duration (5 to 25 seconds)
          const watchTimeSeconds = Math.floor(Math.random() * (25 - 5 + 1)) + 5;
          console.log(`[InstagramWarming] [Reels] Watching reel ${i + 1}/${count} for ${watchTimeSeconds}s...`);
          result.details.push(`Watching reel ${i + 1}/${count}...`);

          // Randomly like some reels (30% chance — realistic behavior)
          if (Math.random() < 0.30) {
            console.log(`[InstagramWarming] [Reels] Decided to like this reel...`);
            const likeBtn = await trySelectors(page, IG_SELECTORS.like);
            if (likeBtn) {
              const reelClicked = await clickSvgParent(page, likeBtn);

              if (reelClicked) {
                console.log(`[InstagramWarming] [Reels] Clicking like button on reel...`);
                await shortDelay();
                result.details.push(`  ↳ Liked reel ${i + 1}`);
              }
            }
          }

          await delay(watchTimeSeconds * 1000, watchTimeSeconds * 1000); // Wait out the watch duration

          // Scroll to next reel
          console.log(`[InstagramWarming] [Reels] Scrolling to next reel (ArrowDown)`);
          await page.keyboard.press('ArrowDown');
          await delay(1200, 2500);

          result.succeeded++;
          logWarmingActivity({
            accountId,
            action: 'watch_reel',
            status: 'success',
            message: `Warming reel watch succeeded: reel ${i + 1}`,
            metadata: { reelIndex: i + 1, count },
          });

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
          console.error(`[InstagramWarming] [Reels] ❌ Reel ${i + 1} failed: ${err.message}`);
          result.details.push(`❌ Reel ${i + 1} failed: ${err.message}`);
          logWarmingActivity({
            accountId,
            action: 'watch_reel',
            status: 'failed',
            message: `Warming reel watch failed: reel ${i + 1}`,
            metadata: { reelIndex: i + 1, count, reason: err.message || String(err) },
          });
          // Try to move to next reel even after failure
          await page.keyboard.press('ArrowDown').catch(() => {});
          await shortDelay();
        }
      }
    } finally {
      console.log(`[InstagramWarming] [Reels] Finished autoWatchReels task.`);
      await page.close();
    }

    return result;
  }

  // ─── 4. EXPLORE BROWSE (bonus — for day 8-14) ─────────────────────────

  public async browseExplore(accountId: string, durationMs: number = 300000): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'explore', succeeded: 0, failed: 0, details: [] };
    await this.ensureWarmingAllowed(accountId);
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

  // ─── AI COMMENT GENERATOR ──────────────────────────────────────────────

  private generateAiComment = async (): Promise<string> => {
    const key = getGeminiApiKey();
    if (!key) return this.getFallbackComment();

    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: getGeminiModel() });
      const prompt = `Generate a SINGLE short, natural Instagram comment (max 50 chars).
You're a real Indonesian person interested in marble/granite/natural stone for interior design.
Mix Indonesian and English naturally. Include 1 emoji max.
Sound genuine, not robotic. Return ONLY the comment text.`;
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      return text || this.getFallbackComment();
    } catch {
      return this.getFallbackComment();
    }
  };

  private getFallbackComment = (): string => {
    const comments = [
      'Kerennn! ✨', 'Bagus banget! 🔥', 'Wah looks amazing 😍',
      'Nice design! 👌', 'Inspiratif banget nih', 'Love this style! 🏠',
      'Mantapp 👍', 'Keren abis! 💎', 'So elegant 😊', 'Cakep banget! ⭐',
    ];
    return comments[Math.floor(Math.random() * comments.length)];
  };

  // ─── 5. AUTO COMMENT ──────────────────────────────────────────────────

  public async autoComment(accountId: string, count: number = 3): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'comment', succeeded: 0, failed: 0, details: [] };
    await this.ensureWarmingAllowed(accountId);
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    const hashtag = INSTAGRAM_EXPLORE_HASHTAGS[Math.floor(Math.random() * INSTAGRAM_EXPLORE_HASHTAGS.length)];

    try {
      console.log(`[InstagramWarming] [Comment] Browsing #${hashtag}...`);
      await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
        waitUntil: 'domcontentloaded', timeout: 45000,
      });
      await longDelay();

      const postLinks = await page.$$('a[href*="/p/"]');
      console.log(`[InstagramWarming] [Comment] Found ${postLinks.length} posts`);

      let commented = 0;
      for (const link of postLinks) {
        if (commented >= count) break;
        try {
          await link.scrollIntoViewIfNeeded();
          await delay(500, 1500);
          await link.click();
          await mediumDelay();

          // Generate AI comment
          const comment = await this.generateAiComment();
          console.log(`[InstagramWarming] [Comment] Generated: "${comment}"`);

          // Find comment input - modern Instagram selectors
          const commentArea = await page.$('textarea[aria-label*="comment" i], textarea[placeholder*="comment" i], textarea[aria-label*="Add a comment" i]');
          if (!commentArea) {
            console.log('[InstagramWarming] [Comment] Comment input not found, skipping');
            result.details.push('Comment input not found');
            await page.keyboard.press('Escape');
            await shortDelay();
            continue;
          }

          await commentArea.scrollIntoViewIfNeeded();
          await shortDelay();
          await commentArea.click();
          await shortDelay();
          await commentArea.type(comment, { delay: 50 + Math.random() * 100 });
          await delay(1000, 2500);

          // Try to find and click Post button
          const postBtn = await page.$('div[role="button"]:has-text("Post"), button:has-text("Post"), div[role="button"] >> text=/^Post$/');
          if (postBtn) {
            await postBtn.click();
            await mediumDelay();

            // Verify comment was posted
            const posted = await page.$(`text="${comment}"`);
            if (posted) {
              commented++;
              result.succeeded++;
              console.log(`[InstagramWarming] [Comment] ✅ Comment posted (${commented}/${count})`);
              result.details.push(`✅ Commented "${comment}" (${commented}/${count})`);

              logWarmingActivity({
                accountId, action: 'comment', status: 'success',
                message: `Warming comment posted from #${hashtag}`,
                metadata: { hashtag, comment, count: commented },
              });

              await prisma.warmingLog.create({
                data: {
                  accountId,
                  day: await this.getWarmingDay(accountId),
                  action: 'comment',
                  status: 'completed',
                  details: `Commented "${comment}" from #${hashtag}`,
                },
              });
            } else {
              result.failed++;
              result.details.push(`Comment may not have posted`);
            }
          } else {
            // Try pressing Enter instead
            console.log('[InstagramWarming] [Comment] Post button not found, trying Enter');
            await page.keyboard.press('Enter');
            await mediumDelay();
            commented++;
            result.succeeded++;
          }

          await page.keyboard.press('Escape');
          await mediumDelay();
        } catch (err: any) {
          result.failed++;
          console.error(`[InstagramWarming] [Comment] Failed:`, err.message);
          result.details.push(`❌ Comment failed: ${err.message}`);
          await page.keyboard.press('Escape').catch(() => {});
          await shortDelay();
        }
      }
    } finally {
      await page.close();
    }
    return result;
  }

  // ─── 6. AUTO VIEW STORIES ─────────────────────────────────────────────

  public async autoViewStory(accountId: string, count: number = 10): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'view_story', succeeded: 0, failed: 0, details: [] };
    await this.ensureWarmingAllowed(accountId);
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    try {
      console.log('[InstagramWarming] [Story] Navigating to home feed for stories...');
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await longDelay();

      let viewed = 0;

      // Click story circles (Instagram top stories bar)
      const storyButtons = await page.$$('div[role="button"] canvas, ul[role="menubar"] button, button:has(canvas), ul li button:has(img[data-src])');

      if (storyButtons.length === 0) {
        // Fallback: click any story-like element
        result.details.push('No story circles found on homepage, skipping');
        return result;
      }

      const maxStories = Math.min(storyButtons.length, count);
      result.details.push(`Found ${storyButtons.length} story circles, viewing ${maxStories}`);

      for (let i = 0; i < maxStories; i++) {
        try {
          const btn = storyButtons[i];
          await btn.scrollIntoViewIfNeeded();
          await shortDelay();
          await btn.click();
          await delay(3000, 6000); // Watch story for 3-6s

          // Advance through stories or dismiss
          for (let s = 0; s < 3; s++) {
            await page.click('body', { position: { x: 700, y: 400 } }).catch(() => {});
            await delay(1500, 3000);
          }

          // Try to close story viewer
          await page.keyboard.press('Escape').catch(() => {});
          await shortDelay();

          viewed++;
          result.succeeded++;
          result.details.push(`✅ Viewed story ${viewed}/${maxStories}`);

          logWarmingActivity({
            accountId, action: 'view_story', status: 'success',
            message: `Warming story viewed (${viewed}/${maxStories})`,
            metadata: { count: viewed },
          });
        } catch (err: any) {
          result.failed++;
          result.details.push(`❌ Story failed: ${err.message}`);
          await page.keyboard.press('Escape').catch(() => {});
        }
      }
    } finally {
      await page.close();
    }
    return result;
  }

  // ─── 7. AUTO SAVE POST ────────────────────────────────────────────────

  public async autoSavePost(accountId: string, count: number = 5): Promise<WarmingTaskResult> {
    const result: WarmingTaskResult = { action: 'save_post', succeeded: 0, failed: 0, details: [] };
    await this.ensureWarmingAllowed(accountId);
    const context = await browserManager.getContext(accountId);
    const page = await context.newPage();

    const hashtag = INSTAGRAM_EXPLORE_HASHTAGS[Math.floor(Math.random() * INSTAGRAM_EXPLORE_HASHTAGS.length)];

    try {
      console.log(`[InstagramWarming] [Save] Browsing #${hashtag}...`);
      await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
        waitUntil: 'domcontentloaded', timeout: 45000,
      });
      await longDelay();

      const postLinks = await page.$$('a[href*="/p/"]');
      console.log(`[InstagramWarming] [Save] Found ${postLinks.length} posts`);

      let saved = 0;
      for (const link of postLinks) {
        if (saved >= count) break;
        try {
          await link.scrollIntoViewIfNeeded();
          await delay(500, 1500);
          await link.click();
          await mediumDelay();

          // Find save/bookmark button
          const saveBtn = await trySelectors(page, IG_SELECTORS.save);
          if (!saveBtn) {
            console.log('[InstagramWarming] [Save] Save button not found, skipping');
            result.details.push('Save button not found');
            await page.keyboard.press('Escape');
            await shortDelay();
            continue;
          }

          await saveBtn.scrollIntoViewIfNeeded();
          await shortDelay();
          await saveBtn.click();
          await mediumDelay();

          saved++;
          result.succeeded++;
          console.log(`[InstagramWarming] [Save] ✅ Saved post (${saved}/${count})`);
          result.details.push(`✅ Saved post ${saved}/${count}`);

          logWarmingActivity({
            accountId, action: 'save_post', status: 'success',
            message: `Warming saved post from #${hashtag}`,
            metadata: { hashtag, count: saved },
          });

          await prisma.warmingLog.create({
            data: {
              accountId,
              day: await this.getWarmingDay(accountId),
              action: 'save_post',
              status: 'completed',
              details: `Saved post from #${hashtag}`,
            },
          });

          await page.keyboard.press('Escape');
          await mediumDelay();
        } catch (err: any) {
          result.failed++;
          console.error(`[InstagramWarming] [Save] Failed:`, err.message);
          result.details.push(`❌ Save failed: ${err.message}`);
          await page.keyboard.press('Escape').catch(() => {});
          await shortDelay();
        }
      }
    } finally {
      await page.close();
    }
    return result;
  }

  // ─── 5. RUN FULL DAY SESSION ───────────────────────────────────────────

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
    const account = await this.ensureWarmingAllowed(accountId);

    const day = account.warmingDay ?? 0;
    const results: WarmingTaskResult[] = [];

    console.log(`[Warming] Starting day ${day} session for @${account.username}`);
    logWarmingActivity({
      accountId,
      action: 'warming_job_started',
      status: 'queued',
      message: `Warming day ${day} started for @${account.username}`,
      metadata: { username: account.username, warmingDay: day },
    });

    // ── Dynamic task schedule based on warming day ────────────
    const schedule = this.getDaySchedule(day);
    console.log(`[Warming] Day ${day} schedule:`, schedule.map((t: any) => `${t.action}(${t.count})`));

    for (const task of schedule) {
      console.log(`[Warming] → Running ${task.action} (${task.count})`);
      try {
        switch (task.action) {
          case 'follow':
            results.push(await this.autoFollow(accountId, task.count));
            break;
          case 'like':
            results.push(await this.autoLike(accountId, task.count));
            break;
          case 'watch_reel':
            results.push(await this.autoWatchReels(accountId, task.count));
            break;
          case 'comment':
            results.push(await this.autoComment(accountId, task.count));
            break;
          case 'view_story':
            results.push(await this.autoViewStory(accountId, task.count));
            break;
          case 'save_post':
            results.push(await this.autoSavePost(accountId, task.count));
            break;
          case 'explore':
            results.push(await this.browseExplore(accountId, task.count * 60_000));
            break;
          default:
            console.warn(`[Warming] Unknown task type: ${task.action}`);
        }
      } catch (err: any) {
        console.error(`[Warming] Task ${task.action} failed:`, err.message);
        results.push({ action: task.action, succeeded: 0, failed: 1, details: [err.message] });
      }
      await longDelay();
    }

    const completedAt = new Date().toISOString();
    console.log(`[Warming] Day ${day} session complete for @${account.username}`);
    logWarmingActivity({
      accountId,
      action: 'warming_job_completed',
      status: 'success',
      message: `Warming day ${day} completed for @${account.username}`,
      metadata: {
        username: account.username,
        warmingDay: day,
        results: results.map((item) => ({
          action: item.action,
          succeeded: item.succeeded,
          failed: item.failed,
        })),
      },
    });

    return { accountId, warmingDay: day, results, completedAt };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /**
   * Returns the warming task schedule based on warming day.
   * Matches the WARMING_TASKS in warmingRoutes for UI consistency.
   */
  private getDaySchedule(day: number): { action: string; count: number }[] {
    if (day <= 3) return [
      { action: 'follow', count: 5 },
      { action: 'like', count: 10 },
      { action: 'watch_reel', count: 10 },
    ];
    if (day <= 7) return [
      { action: 'follow', count: 5 },
      { action: 'like', count: 10 },
      { action: 'watch_reel', count: 15 },
      { action: 'comment', count: 3 },
    ];
    return [
      { action: 'follow', count: 5 },
      { action: 'like', count: 10 },
      { action: 'watch_reel', count: 20 },
      { action: 'comment', count: 3 },
      { action: 'view_story', count: 10 },
      { action: 'save_post', count: 5 },
      { action: 'explore', count: 5 },
    ];
  }

  private async getWarmingDay(accountId: string): Promise<number> {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    return account?.warmingDay ?? 0;
  }
}

export const instagramWarmingService = new InstagramWarmingService();

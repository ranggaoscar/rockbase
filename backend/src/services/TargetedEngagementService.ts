/**
 * TargetedEngagementService — Core engagement automation with full human flow.
 *
 * Every action follows the human behavior protocol:
 *   warmupBrowse → navigate to target → simulateReading → engage → naturalExit
 *
 * Action limits per account per day:
 *   - Follow: max 20-30
 *   - Like: max 50-80
 *   - Comment (AI): max 10-15
 *   - Active hours: 08:00-22:00 WIB
 *   - Staggered: 15-45 min between accounts
 */
import { Page } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { sessionPool } from './SessionPool';
import { HumanBehavior } from './HumanBehavior';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey, getGeminiModel } from './GeminiConfig';
import { trySelectors, clickSvgParent, IG_SELECTORS } from './InstagramSelectors';

const prisma = new PrismaClient();

// ── AI Comment generation ─────────────────────────────────────────────────

const COMMENT_TEMPLATES = {
  indonesian: [
    'Keren banget materialnya! 🔥',
    'Wah bagus banget finishingnya! ✨',
    'Motif alaminya cantik sekali 😍',
    'Cocok banget buat interior modern!',
    'Premium quality! Suka banget 💎',
    'Mantap! Bikin ruangan makin mewah',
    'Natural banget teksturnya! 🪨',
    'Top markotop! Elegan banget 👌',
    'Gak ada lawan materialnya! 🏆',
    'Dream interior banget ini! ❤️',
    'Warna alaminya bikin adem mata 👀',
    'Ini marmer apa granit? Cakep! 😍',
    'Sukses terus untuk projectnya! 🙌',
    'Kualitasnya keliatan dari foto! 💯',
    'Batu alam emang gak ada matinya!',
  ],
  english: [
    'Love this texture! 😍',
    'Perfect for modern interior! ✨',
    'Such beautiful natural stone 🪨',
    'Amazing quality material! 💎',
    'This looks absolutely stunning!',
    'Premium choice for any project 👌',
    'The natural pattern is incredible!',
    'Dream home material right here! 🏠',
    'Love the color variations! ❤️',
    'World-class quality stone! 🌍',
    'This is pure elegance! ✨',
    'Great choice for luxury design!',
    'Natural beauty at its finest 🔥',
    'Would love this for my home!',
    'Outstanding craftsmanship! 👏',
  ],
};

function getRandomComment(): string {
  const useIndo = Math.random() < 0.6; // 60% Indonesian, 40% English
  const pool = useIndo ? COMMENT_TEMPLATES.indonesian : COMMENT_TEMPLATES.english;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function generateAiComment(context: string = ''): Promise<string> {
  const key = getGeminiApiKey();
  if (!key) {
    return getRandomComment();
  }

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: getGeminiModel() });

    const prompt = `
You are commenting on an Instagram post about marble, granite, or natural stone for interior design.
Generate a single short, natural-sounding comment (max 50 characters).
Mix Indonesian and English naturally.
The comment should feel genuine, like a real person interested in interior design/marble.
${context ? `Post context: "${context}"` : ''}

Rules:
- Include 1 emoji max
- Sound natural, not robotic
- Don't use excessive punctuation
- Don't mention "AI" or "bot"
- Vary between Indonesian and English phrases

Return ONLY the comment text, nothing else.`.trim();

    const result = await model.generateContent(prompt);
    const comment = result.response.text().trim();
    return comment || getRandomComment();
  } catch {
    return getRandomComment();
  }
}

// ── Action Result type ────────────────────────────────────────────────────

export interface ActionResult {
  accountId: string;
  actionType: string;
  target: string;
  status: 'completed' | 'failed' | 'skipped';
  details?: string;
  error?: string;
  executedAt: string;
}

// ── Core engagement class ─────────────────────────────────────────────────

export class TargetedEngagementService {

  /**
   * Like a specific Instagram post URL with full human flow.
   */
  public async likePost(accountId: string, postUrl: string): Promise<ActionResult> {
    const result: ActionResult = {
      accountId, actionType: 'like', target: postUrl,
      status: 'completed', executedAt: new Date().toISOString(),
    };

    // Check active hours
    if (!HumanBehavior.isActiveHours()) {
      result.status = 'skipped';
      result.details = 'Outside active hours (08:00-22:00 WIB)';
      return result;
    }

    // Random skip (20% off-actions)
    if (HumanBehavior.shouldSkip()) {
      result.status = 'skipped';
      result.details = 'Random skip (off-action)';
      await this._logEngagement(result);
      return result;
    }

    const context = await sessionPool.acquireSession(accountId);
    const page = await context.newPage();

    try {
      // 1. Warmup browse — never go direct
      await HumanBehavior.warmupBrowse(page);

      // 2. Navigate to the target post
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await HumanBehavior.mediumPause();

      // 3. Simulate reading the post
      await HumanBehavior.simulateReading(page, 5, 15);

      // 4. Pre-engage pause (5-15 seconds)
      await HumanBehavior.preEngagePause();

      // 5. Check if already liked
      const unlikeBtn = await trySelectors(page, IG_SELECTORS.unlike);
      if (unlikeBtn) {
        result.details = 'Already liked';
        console.log(`[Engagement] Post already liked by ${accountId}`);
      } else {
        // Find and click the like button
        const likeBtn = await trySelectors(page, IG_SELECTORS.like);
        if (likeBtn) {
          const clicked = await clickSvgParent(page, likeBtn);
          if (clicked) {
            await HumanBehavior.shortPause();
            result.details = 'Liked successfully';
            console.log(`[Engagement] ✅ Liked post for ${accountId}`);
          } else {
            throw new Error('Like button click failed');
          }
        } else {
          throw new Error('Like button not found on page');
        }
      }

      // 6. Natural exit
      await HumanBehavior.naturalExit(page);
      result.executedAt = new Date().toISOString();

    } catch (err: any) {
      result.status = 'failed';
      result.error = err.message;
      console.error(`[Engagement] ❌ Like failed for ${accountId}:`, err.message);
    } finally {
      await page.close();
      await sessionPool.releaseSession(accountId);
    }

    await this._logEngagement(result);
    return result;
  }

  /**
   * Follow a specific Instagram username with full human flow.
   */
  public async followUser(accountId: string, username: string): Promise<ActionResult> {
    const cleanUsername = username.replace('@', '');
    const result: ActionResult = {
      accountId, actionType: 'follow', target: cleanUsername,
      status: 'completed', executedAt: new Date().toISOString(),
    };

    if (!HumanBehavior.isActiveHours()) {
      result.status = 'skipped';
      result.details = 'Outside active hours';
      return result;
    }

    if (HumanBehavior.shouldSkip()) {
      result.status = 'skipped';
      result.details = 'Random skip (off-action)';
      await this._logEngagement(result);
      return result;
    }

    const context = await sessionPool.acquireSession(accountId);
    const page = await context.newPage();

    try {
      // 1. Warmup browse
      await HumanBehavior.warmupBrowse(page);

      // 2. Navigate to profile
      await page.goto(`https://www.instagram.com/${cleanUsername}/`, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      await HumanBehavior.mediumPause();

      // 3. Simulate reading the profile
      await HumanBehavior.simulateReading(page, 5, 12);

      // 4. Pre-engage pause
      await HumanBehavior.preEngagePause();

      // 5. Check if already following
      const followingBtn = await page.$('button:has-text("Following"), div[role="button"]:has-text("Following")');
      const requestedBtn = await page.$('button:has-text("Requested"), div[role="button"]:has-text("Requested")');
      if (followingBtn || requestedBtn) {
        result.details = 'Already following';
        console.log(`[Engagement] Already following @${cleanUsername}`);
      } else {
        // Find and click Follow button
        const followBtn = await trySelectors(page, IG_SELECTORS.follow);
        if (followBtn) {
          await followBtn.scrollIntoViewIfNeeded();
          await HumanBehavior.randomDelay(400, 900);
          await followBtn.click();
          await HumanBehavior.shortPause();

          // Handle any confirmation dialog
          const confirmBtn = await page.$('button:has-text("Follow"):not(:has-text("Following"))');
          if (confirmBtn) await confirmBtn.click().catch(() => {});

          result.details = `Followed @${cleanUsername}`;
          console.log(`[Engagement] ✅ Followed @${cleanUsername} from ${accountId}`);
        } else {
          throw new Error('Follow button not found');
        }
      }

      // 6. Natural exit
      await HumanBehavior.naturalExit(page);
      result.executedAt = new Date().toISOString();

    } catch (err: any) {
      result.status = 'failed';
      result.error = err.message;
      console.error(`[Engagement] ❌ Follow failed for ${accountId}:`, err.message);
    } finally {
      await page.close();
      await sessionPool.releaseSession(accountId);
    }

    await this._logEngagement(result);
    return result;
  }

  /**
   * Follow a user AND like their recent posts.
   */
  public async followAndLike(accountId: string, username: string, likeCount: number = 3): Promise<ActionResult> {
    const cleanUsername = username.replace('@', '');
    const result: ActionResult = {
      accountId, actionType: 'follow_and_like', target: cleanUsername,
      status: 'completed', executedAt: new Date().toISOString(),
    };

    if (!HumanBehavior.isActiveHours()) {
      result.status = 'skipped';
      result.details = 'Outside active hours';
      return result;
    }

    const context = await sessionPool.acquireSession(accountId);
    const page = await context.newPage();

    try {
      // 1. Warmup browse
      await HumanBehavior.warmupBrowse(page);

      // 2. Navigate to profile
      await page.goto(`https://www.instagram.com/${cleanUsername}/`, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      await HumanBehavior.mediumPause();

      // 3. Read profile
      await HumanBehavior.simulateReading(page, 5, 10);

      // 4. Follow
      const followBtn = await trySelectors(page, IG_SELECTORS.follow);
      if (followBtn) {
        await HumanBehavior.preEngagePause();
        await followBtn.click();
        await HumanBehavior.shortPause();
        console.log(`[Engagement] ✅ Followed @${cleanUsername}`);
      }

      // 5. Like recent posts
      let liked = 0;
      const postLinks = await page.$$('a[href*="/p/"]');

      for (const link of postLinks) {
        if (liked >= likeCount) break;
        if (HumanBehavior.shouldSkip()) continue;

        try {
          await link.click();
          await HumanBehavior.mediumPause();
          await HumanBehavior.simulateReading(page, 3, 8);
          await HumanBehavior.preEngagePause();

          const likeBtn = await trySelectors(page, IG_SELECTORS.like);
          if (likeBtn) {
            const parent = await likeBtn.$('xpath=..');
            if (parent) {
              await parent.click();
              await HumanBehavior.shortPause();
              liked++;
              console.log(`[Engagement] ✅ Liked post ${liked}/${likeCount} from @${cleanUsername}`);
            }
          }

          await page.keyboard.press('Escape');
          await HumanBehavior.mediumPause();
        } catch {
          await page.keyboard.press('Escape').catch(() => {});
          await HumanBehavior.shortPause();
        }
      }

      result.details = `Followed + liked ${liked} posts from @${cleanUsername}`;

      // 6. Natural exit
      await HumanBehavior.naturalExit(page);
      result.executedAt = new Date().toISOString();

    } catch (err: any) {
      result.status = 'failed';
      result.error = err.message;
    } finally {
      await page.close();
      await sessionPool.releaseSession(accountId);
    }

    await this._logEngagement(result);
    return result;
  }

  /**
   * Comment on a specific post with AI-generated unique comment.
   */
  public async commentOnPost(
    accountId: string,
    postUrl: string,
    customComment?: string,
    aiComment?: boolean,
  ): Promise<ActionResult> {
    const result: ActionResult = {
      accountId, actionType: 'comment', target: postUrl,
      status: 'completed', executedAt: new Date().toISOString(),
    };

    if (!HumanBehavior.isActiveHours()) {
      result.status = 'skipped';
      result.details = 'Outside active hours';
      return result;
    }

    if (HumanBehavior.shouldSkip()) {
      result.status = 'skipped';
      result.details = 'Random skip';
      await this._logEngagement(result);
      return result;
    }

    const context = await sessionPool.acquireSession(accountId);
    const page = await context.newPage();

    try {
      // 1. Warmup browse
      await HumanBehavior.warmupBrowse(page);

      // 2. Navigate to post
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await HumanBehavior.mediumPause();

      // 3. Read the post content
      await HumanBehavior.simulateReading(page, 8, 20);

      // 3b. Scrape post context for AI comment
      let postContext = '';
      if (aiComment) {
        try {
          postContext = await page.$eval('h1, span[dir="auto"], div[dir="auto"]:first-of-type', el => {
            const text = (el as HTMLElement).innerText || el.textContent || '';
            return text.slice(0, 200);
          }).catch(() => '');
        } catch { /* ignore scraping errors */ }
      }

      // 4. Generate unique comment
      const comment = customComment || (aiComment && postContext
        ? await generateAiComment(postContext)
        : await generateAiComment());

      // 5. Pre-engage pause
      await HumanBehavior.preEngagePause();

      // 6. Find and click comment input
      let commentInput = await trySelectors(page, IG_SELECTORS.commentInput);

      if (!commentInput) {
        // Try clicking the comment icon first
        const commentIcon = await trySelectors(page, IG_SELECTORS.commentIcon);
        if (commentIcon) {
          await clickSvgParent(page, commentIcon);
          await HumanBehavior.shortPause();
          commentInput = await trySelectors(page, IG_SELECTORS.commentInput);
        }
      }

      if (!commentInput) throw new Error('Comment input not found');

      // 7. Click the comment input and type
      await commentInput.click();
      await HumanBehavior.shortPause();
      await HumanBehavior.humanType(page, comment);
      await HumanBehavior.mediumPause();

      // 8. Submit comment
      const postBtn = await trySelectors(page, IG_SELECTORS.postBtn);
      if (postBtn) {
        await postBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      await HumanBehavior.mediumPause();

      result.details = `Commented: "${comment}"`;
      console.log(`[Engagement] ✅ Commented on post for ${accountId}: "${comment}"`);

      // 9. Natural exit
      await HumanBehavior.naturalExit(page);
      result.executedAt = new Date().toISOString();

    } catch (err: any) {
      result.status = 'failed';
      result.error = err.message;
      console.error(`[Engagement] ❌ Comment failed for ${accountId}:`, err.message);
    } finally {
      await page.close();
      await sessionPool.releaseSession(accountId);
    }

    await this._logEngagement(result);
    return result;
  }

  /**
   * Auto-engagement by hashtag — discover and engage with posts.
   */
  public async engageByHashtag(
    accountId: string,
    hashtag: string,
    actions: { follow?: boolean; like?: boolean; comment?: boolean } = { like: true },
    maxPosts: number = 10,
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const cleanHashtag = hashtag.replace('#', '');

    if (!HumanBehavior.isActiveHours()) {
      results.push({
        accountId, actionType: 'hashtag_engage', target: `#${cleanHashtag}`,
        status: 'skipped', details: 'Outside active hours',
        executedAt: new Date().toISOString(),
      });
      return results;
    }

    const context = await sessionPool.acquireSession(accountId);
    const page = await context.newPage();

    try {
      // 1. Warmup browse
      await HumanBehavior.warmupBrowse(page);

      // 2. Navigate to hashtag explore
      await page.goto(`https://www.instagram.com/explore/tags/${cleanHashtag}/`, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      await HumanBehavior.longPause();

      // 3. Engage with posts in the grid
      const postLinks = await page.$$('a[href*="/p/"]');
      let engaged = 0;

      for (const link of postLinks) {
        if (engaged >= maxPosts) break;
        if (HumanBehavior.shouldSkip()) continue;

        try {
          await link.click();
          await HumanBehavior.mediumPause();
          await HumanBehavior.simulateReading(page, 3, 8);
          await HumanBehavior.preEngagePause();

          // Like
          if (actions.like) {
            const likeBtn = await page.$('svg[aria-label="Like"]');
            if (likeBtn) {
              const parent = await likeBtn.$('xpath=..');
              if (parent) {
                await parent.click();
                await HumanBehavior.shortPause();
                results.push({
                  accountId, actionType: 'like', target: `#${cleanHashtag} post`,
                  status: 'completed', details: `Liked post from #${cleanHashtag}`,
                  executedAt: new Date().toISOString(),
                });
              }
            }
          }

          // Comment (lower frequency)
          if (actions.comment && Math.random() < 0.3) {
            try {
              const comment = await generateAiComment();
              const commentInput = await page.$('textarea[aria-label="Add a comment…"]');
              if (commentInput) {
                await commentInput.click();
                await HumanBehavior.shortPause();
                await HumanBehavior.humanType(page, comment);
                await HumanBehavior.shortPause();
                await page.keyboard.press('Enter');
                await HumanBehavior.mediumPause();
                results.push({
                  accountId, actionType: 'comment', target: `#${cleanHashtag} post`,
                  status: 'completed', details: `Commented: "${comment}"`,
                  executedAt: new Date().toISOString(),
                });
              }
            } catch { /* comment failed, continue */ }
          }

          engaged++;
          await page.keyboard.press('Escape');
          await HumanBehavior.mediumPause();

        } catch {
          await page.keyboard.press('Escape').catch(() => {});
          await HumanBehavior.shortPause();
        }
      }

      // 4. Natural exit
      await HumanBehavior.naturalExit(page);

    } catch (err: any) {
      results.push({
        accountId, actionType: 'hashtag_engage', target: `#${cleanHashtag}`,
        status: 'failed', error: err.message,
        executedAt: new Date().toISOString(),
      });
    } finally {
      await page.close();
      await sessionPool.releaseSession(accountId);
    }

    // Log all results
    for (const r of results) {
      await this._logEngagement(r);
    }

    return results;
  }

  /**
   * Orchestrate: run a targeted action across multiple accounts with staggered timing.
   * Never acts in the same minute. Random 15-45 min between accounts.
   */
  public async runTargetedAction(params: {
    accountIds: string[];
    actionType: 'like' | 'follow' | 'comment' | 'follow_and_like';
    target: string;
    aiComment?: boolean;
    onProgress?: (result: ActionResult) => void;
  }): Promise<ActionResult[]> {
    const { accountIds, actionType, target, aiComment, onProgress } = params;
    const results: ActionResult[] = [];

    // Check active hours first
    await HumanBehavior.waitForActiveHours();

    // Calculate staggered delays
    const delays = HumanBehavior.calculateStaggerDelays(accountIds.length);

    console.log(`[Engagement] Starting ${actionType} campaign for ${accountIds.length} accounts on target: ${target}`);
    console.log(`[Engagement] Stagger delays (min): ${delays.map(d => Math.round(d / 60000)).join(', ')}`);

    for (let i = 0; i < accountIds.length; i++) {
      const accountId = accountIds[i];
      const delayMs = delays[i];

      // Wait for stagger delay
      if (delayMs > 0) {
        console.log(`[Engagement] Waiting ${Math.round(delayMs / 60000)} min before account ${i + 1}/${accountIds.length}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Re-check active hours before each account
      await HumanBehavior.waitForActiveHours();

      let result: ActionResult;

      switch (actionType) {
        case 'like':
          result = await this.likePost(accountId, target);
          break;
        case 'follow':
          result = await this.followUser(accountId, target);
          break;
        case 'comment':
          result = await this.commentOnPost(accountId, target, undefined, aiComment);
          break;
        case 'follow_and_like':
          result = await this.followAndLike(accountId, target);
          break;
        default:
          result = {
            accountId, actionType, target,
            status: 'failed', error: `Unknown action type: ${actionType}`,
            executedAt: new Date().toISOString(),
          };
      }

      results.push(result);

      // Emit progress callback
      if (onProgress) onProgress(result);
    }

    console.log(`[Engagement] Campaign complete. ${results.filter(r => r.status === 'completed').length}/${results.length} succeeded`);
    return results;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _logEngagement(result: ActionResult): Promise<void> {
    try {
      await prisma.engagementLog.create({
        data: {
          accountId: result.accountId,
          actionType: result.actionType,
          target: result.target,
          status: result.status,
          details: result.details || result.error,
        },
      });
    } catch (err) {
      console.error('[Engagement] Failed to log:', err);
    }
  }
}

export const targetedEngagementService = new TargetedEngagementService();

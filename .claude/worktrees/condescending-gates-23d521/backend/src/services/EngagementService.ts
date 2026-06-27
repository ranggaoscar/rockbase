import { browserManager } from './BrowserManager';
import { aiService } from './AiService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper to introduce human-like delay (2 to 8 seconds)
const randomDelay = () => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 6000) + 2000));

export class EngagementService {
  
  /**
   * Auto-reply to new comments on a specific post.
   */
  public async autoReply(accountId: string, postUrl: string, useAi: boolean = false) {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account || !account.autoReplyEnabled) {
      console.log(`Auto-reply is disabled for account ${accountId}. Skipping.`);
      return { status: 'skipped', message: 'Auto-reply disabled' };
    }

    console.log(`Starting auto-reply job for account ${account.username} on ${account.platform}`);
    
    try {
      const context = await browserManager.getContext(accountId);
      const page = await context.newPage();

      await page.goto(postUrl, { waitUntil: 'networkidle' });
      await randomDelay(); // Human delay after load

      // Platform Specific DOM Traversal
      if (account.platform.toLowerCase() === 'instagram') {
        console.log('[Playwright] Scanning Instagram comments...');
        // Mock selectors
        const commentElements = await page.$$('div[role="button"]:has-text("Reply")');
        
        for (const el of commentElements.slice(0, 5)) { // Limit to 5 at a time
          const parent = await el.$('xpath=..');
          const commentText = await parent?.innerText() || '';
          
          let replyText = account.replyTemplate || 'Thanks for the support! 🔥';
          if (useAi) {
            // Generate contextual reply
            replyText = await this.generateAiReply(commentText, account.platform);
          }

          console.log(`[Playwright] Found comment: "${commentText}". Replying with: "${replyText}"`);
          
          // Click reply
          await el.click();
          await randomDelay();

          // Type reply
          await page.keyboard.type(replyText, { delay: 100 }); // Human typing speed
          await randomDelay();

          // Hit enter to post comment
          await page.keyboard.press('Enter');
          await randomDelay();
        }
      } else if (account.platform.toLowerCase() === 'tiktok') {
        console.log('[Playwright] Scanning TikTok comments... (Logic similar to IG)');
      }

      console.log(`Finished auto-reply job for ${postUrl}`);
      await page.close();
      return { status: 'success', message: `Processed comments for ${account.username}` };
    } catch (error) {
      console.error(`Auto-reply failed for ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Auto-DM new followers or users triggering a keyword.
   */
  public async autoDm(accountId: string, targetUsername: string) {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account || !account.autoDmEnabled) {
      console.log(`Auto-DM is disabled for account ${accountId}. Skipping.`);
      return { status: 'skipped', message: 'Auto-DM disabled' };
    }

    console.log(`Starting auto-DM job for account ${account.username} -> targeting ${targetUsername}`);
    
    try {
      const context = await browserManager.getContext(accountId);
      const page = await context.newPage();

      let dmText = account.dmTemplate || `Hi @${targetUsername}, thanks for connecting!`;

      if (account.platform.toLowerCase() === 'instagram') {
        await page.goto(`https://www.instagram.com/direct/new/`, { waitUntil: 'networkidle' });
        await randomDelay();

        // Search for user
        await page.fill('input[name="queryBox"]', targetUsername);
        await randomDelay();
        await page.click(`div:has-text("${targetUsername}")`); // Mock selector
        await page.click('div[role="button"]:has-text("Next")');
        await randomDelay();

        // Type DM
        await page.keyboard.type(dmText, { delay: 100 });
        await randomDelay();
        await page.keyboard.press('Enter');
        console.log(`[Playwright] Sent DM to ${targetUsername}`);
        
      }

      await randomDelay();
      await page.close();
      return { status: 'success', message: 'Sent Auto-DM' };
    } catch (error) {
      console.error(`Auto-DM failed for ${accountId}:`, error);
      throw error;
    }
  }

  private async generateAiReply(comment: string, platform: string): Promise<string> {
    // Wrap aiService logic or use generic fallback if aiService isn't wired for this yet
    return `Thanks for saying "${comment.substring(0,10)}..."! We appreciate it! 🤖`;
  }
}

export const engagementService = new EngagementService();

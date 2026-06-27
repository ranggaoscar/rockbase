import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { browserManager } from '../services/BrowserManager';

const prisma = new PrismaClient();
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379')
};

export const analyticsWorker = new Worker(
  'analyticsQueue',
  async (job: Job<{ accountId: string }>) => {
    const { accountId } = job.data;
    console.log(`Starting analytics scrape for account ${accountId}`);

    try {
      const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new Error(`Account ${accountId} not found`);

      const context = await browserManager.getContext(accountId);
      const page = await context.newPage();

      let followers = 0;
      let following = 0;
      let postsCount = 0;
      let likes = 0;
      let comments = 0;
      let shares = 0;
      let reach = 0;
      let impressions = 0;

      // Simulated scraping logic with randomized deep metrics
      if (account.platform.toLowerCase() === 'instagram') {
        await page.goto(`https://www.instagram.com/${account.username}/`, { waitUntil: 'networkidle' });
        // Simulating extraction from DOM
        followers = Math.floor(Math.random() * 10000) + 1000;
        following = Math.floor(Math.random() * 500) + 100;
        postsCount = Math.floor(Math.random() * 300) + 50;
        
        // Simulating engagement metrics
        likes = Math.floor(followers * (Math.random() * 0.05 + 0.01)); // 1-6% ER
        comments = Math.floor(likes * 0.1);
        shares = Math.floor(likes * 0.05);
        reach = followers * 2;
        impressions = reach * 3;

      } else {
        // Generic fallback logic
        followers = Math.floor(Math.random() * 5000);
        following = Math.floor(Math.random() * 200);
        likes = Math.floor(Math.random() * 1000);
        reach = Math.floor(Math.random() * 8000);
        impressions = Math.floor(Math.random() * 12000);
      }

      await page.close();

      // Save to database
      await prisma.analytics.create({
        data: {
          socialAccountId: accountId,
          followers,
          following,
          postsCount,
          likes,
          comments,
          shares,
          reach,
          impressions
        }
      });

      console.log(`Successfully scraped analytics for ${account.platform}: ${followers} followers.`);
    } catch (error) {
      console.error(`Analytics scrape failed for ${accountId}:`, error);
      throw error;
    }
  },
  { connection }
);

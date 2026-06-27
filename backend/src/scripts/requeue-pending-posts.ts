import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { PostJobData } from '../queue/jobTypes';

dotenv.config();

const prisma = new PrismaClient();
let queue: Queue<PostJobData> | null = null;
const selectedPostIds = process.argv
  .filter((arg) => arg.startsWith('--post-id='))
  .map((arg) => arg.slice('--post-id='.length).trim())
  .filter(Boolean);

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const now = new Date();

  const posts = await prisma.post.findMany({
    where: {
      ...(selectedPostIds.length > 0 ? { id: { in: selectedPostIds } } : {}),
      status: { in: ['pending', 'scheduled'] },
      OR: [{ scheduleAt: null }, { scheduleAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  const candidates = posts
    .map((post) => ({
      post,
      accountIds: parseJsonArray(post.accountIds),
      mediaUrls: parseJsonArray(post.mediaUrls),
    }))
    .filter(({ accountIds, mediaUrls }) => accountIds.length > 0 && mediaUrls.length > 0);

  console.log(`[RequeuePendingPosts] Found ${candidates.length} due pending post(s).`);
  if (selectedPostIds.length > 0) {
    console.log(`[RequeuePendingPosts] Filtered by post id(s): ${selectedPostIds.join(', ')}`);
  }

  if (!confirm) {
    for (const { post, accountIds, mediaUrls } of candidates) {
      console.log(
        `[dry-run] post=${post.id} status=${post.status} accounts=${accountIds.length} media=${mediaUrls[0]}`,
      );
    }
    console.log('[RequeuePendingPosts] Dry run only. Re-run with --confirm to enqueue jobs.');
    return;
  }

  queue = new Queue<PostJobData>('automationQueue', {
    connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
  });

  let added = 0;
  for (const { post, accountIds, mediaUrls } of candidates) {
    for (let index = 0; index < accountIds.length; index++) {
      const accountId = accountIds[index];
      await queue.add(
        'postJob',
        {
          postId: post.id,
          accountId,
          content: post.content,
          mediaUrls,
          spinIndex: index,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
      added++;
      console.log(`[queued] post=${post.id} account=${accountId}`);
    }
  }

  console.log(`[RequeuePendingPosts] Added ${added} job(s) to automationQueue.`);
}

main()
  .catch((error) => {
    console.error('[RequeuePendingPosts] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await queue?.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

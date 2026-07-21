import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { canonicalRequestHash } from '../utils/canonicalRequestHash';
import { DurableIdempotencyService } from './DurableIdempotencyService';
import { isAutomationEnabled } from '../middleware/automation';

export const SCHEDULED_POST_SCOPE = 'scheduled-post.enqueue';
export const SCHEDULED_POST_TIME_ZONE = 'Asia/Jakarta';

export interface ScheduledPostQueueData {
  scheduledPostId: string;
  scheduleHash: string;
}

export function scheduledPostHash(post: {
  id: string;
  content: string;
  mediaUrls: string;
  accountIds: string;
  scheduledAt: Date;
  timezone: string;
  recurrence: string;
  recurrenceInterval: number;
  recurrenceEndDate?: Date | null;
}): string {
  return canonicalRequestHash({
    id: post.id,
    content: post.content,
    mediaUrls: post.mediaUrls,
    accountIds: post.accountIds,
    scheduledAt: post.scheduledAt.toISOString(),
    timezone: post.timezone || SCHEDULED_POST_TIME_ZONE,
    recurrence: post.recurrence,
    recurrenceInterval: post.recurrenceInterval,
    recurrenceEndDate: post.recurrenceEndDate?.toISOString() || null,
  });
}

export function scheduledPostJobId(id: string, hash: string): string {
  return `scheduled-post:${id}:${hash.slice(0, 32)}`;
}

export function isCurrentScheduledPost(post: { status: string }, expectedHash: string, actualHash: string): boolean {
  return post.status === 'pending' && expectedHash === actualHash;
}

export class ScheduledPostConsumerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly scheduledQueue: Queue<ScheduledPostQueueData>,
    private readonly idempotency: DurableIdempotencyService,
  ) {}

  init(intervalMs = Number(process.env.SCHEDULED_POST_INTERVAL_MS || 15_000)): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.poll().catch((error) => console.error('[ScheduledPost] Poll failed:', error)); }, Math.max(1_000, intervalMs));
    this.timer.unref?.();
    void this.poll();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async poll(now = new Date(), take = 25): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.scheduledPost.findMany({
        where: { status: 'pending', scheduledAt: { lte: now } },
        orderBy: { scheduledAt: 'asc' },
        take,
      });
      for (const post of due) await this.enqueue(post);
      return due.length;
    } finally {
      this.running = false;
    }
  }

  async enqueue(post: any): Promise<void> {
    const hash = scheduledPostHash(post);
    const jobId = scheduledPostJobId(post.id, hash);
    const job = await this.scheduledQueue.add('scheduledPost', {
      scheduledPostId: post.id,
      scheduleHash: hash,
    }, { jobId, removeOnComplete: false, removeOnFail: false });

    const begun = await this.idempotency.beginOperation({
      scope: SCHEDULED_POST_SCOPE,
      key: `${post.id}:${hash}`,
      requestHash: hash,
    });
    if (begun.acquired || begun.operation.status === 'IN_PROGRESS') {
      await this.idempotency.markCompleted(SCHEDULED_POST_SCOPE, `${post.id}:${hash}`, {
        resourceType: 'scheduled-post-job',
        resourceId: post.id,
        resultReference: { jobId: String(job.id), queue: 'scheduledPosts' },
      });
    }
  }

  async consume(data: ScheduledPostQueueData): Promise<{ status: string; reason?: string }> {
    const post = await this.prisma.scheduledPost.findUnique({ where: { id: data.scheduledPostId } });
    if (!post) return { status: 'skipped', reason: 'schedule_deleted' };
    if (!isCurrentScheduledPost(post, data.scheduleHash, scheduledPostHash(post))) {
      return { status: 'skipped', reason: 'schedule_changed_or_cancelled' };
    }
    if (!isAutomationEnabled()) return { status: 'skipped', reason: 'automation_disabled' };

    const claimed = await this.prisma.scheduledPost.updateMany({
      where: { id: post.id, status: 'pending' },
      data: { status: 'queued' },
    });
    if (claimed.count !== 1) return { status: 'skipped', reason: 'schedule_no_longer_pending' };

    const created = await this.prisma.post.create({
      data: {
        id: `scheduled-${post.id}-${data.scheduleHash.slice(0, 24)}`,
        workspaceId: 'workspace-default',
        content: post.content,
        mediaUrls: post.mediaUrls,
        accountIds: post.accountIds,
        status: 'pending',
        scheduleAt: post.scheduledAt,
        idempotencyKey: `scheduled:${post.id}:${data.scheduleHash}`,
      },
    });
    const accountIds: string[] = JSON.parse(post.accountIds);
    const mediaUrls: string[] = JSON.parse(post.mediaUrls);
    const automationQueue = new Queue('automationQueue', { connection: this.redisConnection() });
    try {
      await Promise.all(accountIds.map((accountId, index) => automationQueue.add('postJob', {
        postId: created.id,
        accountId,
        content: post.content,
        mediaUrls,
        spinIndex: index,
      }, { jobId: `scheduled-post:${post.id}:${data.scheduleHash.slice(0, 24)}:${accountId}` })));
    } finally {
      await automationQueue.close();
    }
    return { status: 'queued', reason: created.id };
  }

  private redisConnection() {
    return { host: process.env.REDIS_HOST || '127.0.0.1', port: parseInt(process.env.REDIS_PORT || '6379', 10) };
  }
}

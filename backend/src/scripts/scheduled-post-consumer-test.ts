import assert from 'assert/strict';
import {
  ScheduledPostConsumerService,
  SCHEDULED_POST_TIME_ZONE,
  isCurrentScheduledPost,
  scheduledPostHash,
  scheduledPostJobId,
} from '../services/ScheduledPostConsumerService';

const makePost = (overrides: Partial<any> = {}) => ({
  id: 'schedule-1',
  content: 'scheduled content',
  mediaUrls: '["https://media.example/post.jpg"]',
  accountIds: '["account-1"]',
  scheduledAt: new Date('2026-07-21T10:00:00.000Z'),
  timezone: 'Asia/Jakarta',
  recurrence: 'none',
  recurrenceInterval: 1,
  recurrenceEndDate: null,
  status: 'pending',
  ...overrides,
});

class FakeQueue {
  readonly jobs = new Map<string, any>();
  async add(_name: string, data: any, options: { jobId: string }): Promise<any> {
    const existing = this.jobs.get(options.jobId);
    if (existing) return existing;
    const job = { id: options.jobId, data };
    this.jobs.set(options.jobId, job);
    return job;
  }
}

class FakeIdempotency {
  readonly operations = new Set<string>();
  async beginOperation(input: { key: string }): Promise<any> {
    if (this.operations.has(input.key)) return { acquired: false, operation: { status: 'COMPLETED' } };
    this.operations.add(input.key);
    return { acquired: true, operation: { status: 'IN_PROGRESS' } };
  }
  async markCompleted(): Promise<void> {}
}

async function main(): Promise<void> {
  const queue = new FakeQueue();
  const idempotency = new FakeIdempotency();
  const post = makePost();
  const store: any = {
    scheduledPost: {
      async findMany() { return [post]; },
      async findUnique() { return post; },
    },
  };
  const service = new ScheduledPostConsumerService(store, queue as any, idempotency as any);
  const now = new Date('2026-07-21T10:01:00.000Z');

  assert.equal(await service.poll(now), 1);
  assert.equal(await service.poll(now), 1);
  assert.equal(queue.jobs.size, 1);
  assert.equal(queue.jobs.values().next().value.id, scheduledPostJobId(post.id, scheduledPostHash(post)));

  const restarted = new ScheduledPostConsumerService(store, queue as any, idempotency as any);
  await restarted.poll(now);
  assert.equal(queue.jobs.size, 1);

  const hash = scheduledPostHash(post);
  assert.equal(isCurrentScheduledPost({ status: 'cancelled' }, hash, hash), false);
  assert.equal(isCurrentScheduledPost({ status: 'pending' }, hash, scheduledPostHash({ ...post, content: 'rescheduled' })), false);
  assert.equal(isCurrentScheduledPost({ status: 'pending' }, hash, hash), true);
  assert.equal(SCHEDULED_POST_TIME_ZONE, 'Asia/Jakarta');

  process.env.AUTOMATION_ENABLED = 'false';
  const disabled = await service.consume({ scheduledPostId: post.id, scheduleHash: hash });
  assert.deepEqual(disabled, { status: 'skipped', reason: 'automation_disabled' });

  console.log('[ScheduledPostConsumerTest] PASS: due, duplicate polling, restart, cancel, reschedule, timezone, automation gate.');
}

main().catch((error) => {
  console.error('[ScheduledPostConsumerTest] FAIL:', error);
  process.exitCode = 1;
});

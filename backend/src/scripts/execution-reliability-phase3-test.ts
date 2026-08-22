import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { campaignCompletionBlocked } from '../services/CampaignService';
import {
  mergePostResult,
  pendingVerificationTerminalStatus,
  recoverCampaignActionStatus,
  scheduledClaimRecoveryStatus,
  shouldRequeuePost,
} from '../services/ExecutionReliabilityService';
import { PendingVerificationReconciler, PublishVerifier } from '../services/PendingVerificationReconciler';
import { PostResultService } from '../services/PostResultService';
import { ScheduledPostConsumerService } from '../services/ScheduledPostConsumerService';

const scheduled = {
  id: 'schedule-1', content: 'scheduled', mediaUrls: '["media.jpg"]', accountIds: '["account-a"]',
  scheduledAt: new Date('2026-08-22T00:00:00.000Z'), timezone: 'Asia/Jakarta', recurrence: 'none', recurrenceInterval: 1,
  recurrenceEndDate: null, status: 'queued',
};

class FakePostDatabase {
  row = { id: 'post-1', results: JSON.stringify({ existing: { status: 'kept' } }), status: 'pending', postedAt: null as Date | null, accountIds: '["account-a"]' };
  post = {
    findUnique: async ({ where }: any) => where.id === this.row.id ? this.row : null,
    update: async ({ data }: any) => { Object.assign(this.row, data); return this.row; },
    findMany: async () => [],
  };
  async $transaction(callback: any) { return callback(this); }
}

class FakeScheduledDatabase {
  schedules: any[];
  durablePosts = new Set<string>();
  constructor(schedules: any[]) { this.schedules = schedules; }
  scheduledPost = {
    findMany: async ({ where }: any) => this.schedules.filter((item) => item.status === where.status),
    update: async ({ where, data }: any) => {
      const item = this.schedules.find((candidate) => candidate.id === where.id)!;
      Object.assign(item, data);
      return item;
    },
  };
  post = { findUnique: async ({ where }: any) => this.durablePosts.has(where.id) ? { id: where.id } : null };
}

class FakeVerifier implements PublishVerifier {
  calls = 0;
  constructor(private readonly confirmed: boolean, private readonly reason?: string) {}
  async verify() { this.calls++; return { confirmed: this.confirmed, reason: this.reason }; }
}

async function assertPostResultConcurrency(): Promise<void> {
  const database = new FakePostDatabase();
  const service = new PostResultService(database as any);
  await Promise.all([
    service.merge('post-1', 'account-a', { status: 'success' }),
    service.merge('post-1', 'account-b', { status: 'success' }),
  ]);
  assert.deepEqual(JSON.parse(database.row.results), {
    existing: { status: 'kept' },
    'account-a': { status: 'success' },
    'account-b': { status: 'success' },
  });
}

async function assertPendingVerification(): Promise<void> {
  const confirmedDatabase = new FakePostDatabase();
  confirmedDatabase.row.status = 'pending_verify';
  const confirmedVerifier = new FakeVerifier(true, 'PROFILE_EVIDENCE');
  const confirmed = new PendingVerificationReconciler(confirmedDatabase as any, confirmedVerifier, new PostResultService(confirmedDatabase as any));
  assert.equal(await confirmed.reconcilePost('post-1'), 'confirmed');
  assert.equal(confirmedDatabase.row.status, 'published');
  assert.equal(JSON.parse(confirmedDatabase.row.results)['account-a'].status, 'success');
  assert.equal(await confirmed.reconcilePost('post-1'), 'skipped');
  assert.equal(confirmedVerifier.calls, 1);

  const ambiguousDatabase = new FakePostDatabase();
  ambiguousDatabase.row.status = 'pending_verify';
  const ambiguousVerifier = new FakeVerifier(false, 'NO_EVIDENCE');
  const ambiguous = new PendingVerificationReconciler(ambiguousDatabase as any, ambiguousVerifier, new PostResultService(ambiguousDatabase as any));
  assert.equal(await ambiguous.reconcilePost('post-1'), 'unknown');
  assert.equal(ambiguousDatabase.row.status, 'unknown_result');
  assert.equal(JSON.parse(ambiguousDatabase.row.results)['account-a'].status, 'NEEDS_REVIEW');
  assert.equal(await ambiguous.reconcilePost('post-1'), 'skipped');
  assert.equal(ambiguousVerifier.calls, 1);
}

async function assertScheduledClaimRecovery(): Promise<void> {
  const orphanDatabase = new FakeScheduledDatabase([{ ...scheduled }]);
  const orphanService = new ScheduledPostConsumerService(orphanDatabase as any, {} as any, {} as any);
  assert.equal(await orphanService.recoverQueuedClaims(), 1);
  assert.equal(orphanDatabase.schedules[0].status, 'pending');
  assert.equal(await orphanService.recoverQueuedClaims(), 0);

  const durableDatabase = new FakeScheduledDatabase([{ ...scheduled }]);
  const hash = require('../services/ScheduledPostConsumerService').scheduledPostHash(scheduled);
  durableDatabase.durablePosts.add(`scheduled-${scheduled.id}-${hash.slice(0, 24)}`);
  const durableService = new ScheduledPostConsumerService(durableDatabase as any, {} as any, {} as any);
  assert.equal(await durableService.recoverQueuedClaims(), 0);
  assert.equal(durableDatabase.schedules[0].status, 'queued');
}

async function main(): Promise<void> {
  assert.deepEqual(recoverCampaignActionStatus('COMPLETED'), { status: 'completed', state: 'COMPLETED' });
  assert.deepEqual(recoverCampaignActionStatus('IN_PROGRESS'), { status: 'unknown', state: 'DELIVERY_UNKNOWN' });
  assert.equal(campaignCompletionBlocked(['completed', 'unknown']), false);
  assert.equal(campaignCompletionBlocked(['completed', 'pending']), true);
  assert.equal(shouldRequeuePost('pending'), true);
  assert.equal(shouldRequeuePost('pending_verify'), false);
  assert.equal(shouldRequeuePost('pending', 'UNKNOWN'), false);
  assert.equal(scheduledClaimRecoveryStatus('queued', false), 'pending');
  assert.equal(scheduledClaimRecoveryStatus('queued', true), 'queued');
  assert.deepEqual(JSON.parse(mergePostResult('{}', 'account-a', { status: 'success' })), { 'account-a': { status: 'success' } });
  assert.deepEqual(pendingVerificationTerminalStatus(true), { postStatus: 'published', resultStatus: 'success' });
  assert.deepEqual(pendingVerificationTerminalStatus(false), { postStatus: 'unknown_result', resultStatus: 'NEEDS_REVIEW' });
  await assertPostResultConcurrency();
  await assertPendingVerification();
  await assertScheduledClaimRecovery();
  const postRoutes = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'postRoutes.ts'), 'utf8');
  assert.doesNotMatch(postRoutes, /Direct Fallback Mode|instagramPostingService\.postToInstagram\(accountId, finalContent, mediaLocalPath\)/);
  assert.match(postRoutes, /QUEUE_UNAVAILABLE/);
  console.log('[ExecutionReliabilityPhase3Test] PASS: campaign recovery, no ambiguous resend, scheduled recovery, concurrent results, verification reconciliation, and Redis fail-closed policy.');
}

main().catch((error) => { console.error('[ExecutionReliabilityPhase3Test] FAIL:', error); process.exitCode = 1; });

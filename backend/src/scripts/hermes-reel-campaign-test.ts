import assert from 'assert';
import { buildHermesReelAssignments, HermesReelCampaignService } from '../services/HermesReelCampaignService';

async function main() {
  const items = Array.from({ length: 5 }, (_, index) => ({ mediaUrl: 'https://example.invalid/' + index + '.mp4', caption: 'caption-' + index, postType: 'reel' }));
  const assignments = buildHermesReelAssignments(items, items.map((_, index) => ({ id: 'account-' + index })));
  assert.strictEqual(assignments.length, 5);
  assert.throws(() => buildHermesReelAssignments(items, [{ id: 'only-one' }]), /one healthy account/);
  const posts: any[] = [], jobs: any[] = [];
  const fakePrisma: any = { socialAccount: { findFirst: async () => ({ id: 'account-' + jobs.length }) }, campaign: { create: async () => ({ id: 'campaign-1' }) }, campaignAction: { create: async () => ({ id: 'action-' + jobs.length }) }, post: { create: async ({ data }: any) => { const post = { id: 'post-' + posts.length, ...data }; posts.push(post); return post; } } };
  const fakeQueue: any = { add: async (_name: string, data: any, options: any) => jobs.push({ data, options }), close: async () => {} };
  await new HermesReelCampaignService(fakePrisma, fakeQueue).submit({ name: 'five reels', targetType: 'reel', targetValue: 'campaign', items });
  assert.strictEqual(posts.length, 5); assert.strictEqual(jobs.length, 5);
  assert.deepStrictEqual(jobs.map((job) => job.data.content), items.map((item) => item.caption));
  assert.deepStrictEqual(jobs.map((job) => job.data.mediaUrls[0]), items.map((item) => item.mediaUrl));
  assert.strictEqual(new Set(jobs.map((job) => job.options.jobId)).size, 5);
  console.log('Hermes reel campaign targeted tests passed');
}
main().catch((error) => { console.error(error); process.exit(1); });


import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { PostJobData } from '../queue/jobTypes';

export function buildHermesReelAssignments(items: any[], accounts: { id: string }[]) {
  if (items.length !== accounts.length || items.some((item) => item.postType !== 'reel' || !item.caption || !(item.mediaUrl || item.mediaId))) throw new Error('Each reel needs unique mediaUrl and caption, with one healthy account per item');
  return items.map((item, index) => ({ item, accountId: accounts[index].id, index }));
}

export class HermesReelCampaignService {
  constructor(private readonly prisma: PrismaClient, private readonly queue: Pick<Queue<PostJobData>, 'add' | 'close'> = new Queue<PostJobData>('automationQueue', { connection: { host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || 6379) } })) {}
  async submit(input: any) {
    const items = input.items || [];
    const accounts: { id: string }[] = []; for (const item of items) { const platform = String(item.platform || 'instagram').toLowerCase() === 'tiktok' ? 'TikTok' : 'Instagram'; const account = await this.prisma.socialAccount.findFirst({ where: { status: { in: ['active', 'warming_up'] }, sessionHealth: 'HEALTHY', platform, id: { notIn: accounts.map((value) => value.id) } }, select: { id: true }, orderBy: { username: 'asc' } }); if (account) accounts.push(account); }
    const assignments = buildHermesReelAssignments(items, accounts);
    const campaign = await this.prisma.campaign.create({ data: { workspaceId: 'workspace-default', name: input.name, type: 'reel', targetType: input.targetType, targetValue: input.targetValue, accountIds: JSON.stringify(accounts.map((a) => a.id)), planningSummary: JSON.stringify({ source: 'hermes', metadata: input.metadata || null, reelCount: items.length }), totalActions: items.length } });
    const postIds = [];
    for (const { item, accountId, index } of assignments) {
      const mediaUrl = await this.mediaUrl(item);
      const action = await this.prisma.campaignAction.create({ data: { campaignId: campaign.id, accountId, actionType: 'reel', targetUrl: mediaUrl, status: 'pending' } });
      const post = await this.prisma.post.create({ data: { workspaceId: 'workspace-default', content: item.caption, mediaUrls: JSON.stringify([mediaUrl]), accountIds: JSON.stringify([accountId]), status: 'pending', idempotencyKey: `hermes-reel:${campaign.id}:${index}` } });
      await this.queue.add('postJob', { postId: post.id, accountId, campaignId: campaign.id, campaignActionId: action.id, postType: 'reel', content: item.caption, mediaUrls: [mediaUrl], spinIndex: index }, { jobId: `hermes-reel:${campaign.id}:${index}`, attempts: 3, backoff: { type: 'exponential', delay: 30000 } });
      postIds.push(post.id);
    }
    return { ...campaign, postIds };
  }
  private async mediaUrl(item: any): Promise<string> {
    if (item.mediaUrl) return item.mediaUrl;
    if (!item.mediaId) throw new Error('Reel media is required');
    for (const campaign of await this.prisma.campaign.findMany({ select: { planningSummary: true } })) {
      try { const found = JSON.parse(campaign.planningSummary || '{}')?.mediaLibrary?.find((media: any) => media.id === item.mediaId); if (found?.url) return found.url; } catch {}
    }
    throw new Error('mediaId was not found in registered campaign media');
  }
  async close() { await this.queue.close(); }
}


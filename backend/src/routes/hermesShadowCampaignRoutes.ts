import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { authenticateHermesInternal } from '../middleware/hermesAuth';
import { campaignService } from '../services/CampaignService';
import { DurableIdempotencyService, IdempotencyConflictError, IdempotencyValidationError } from '../services/DurableIdempotencyService';
import { canonicalRequestHash } from '../utils/canonicalRequestHash';
import { Queue } from 'bullmq';
import { HermesReelCampaignService } from '../services/HermesReelCampaignService';

const router = Router();
const prisma = new PrismaClient();
const durableIdempotency = new DurableIdempotencyService(prisma);
const scope = 'hermes.shadow-campaign.submit';
const mediaDir = path.join(process.cwd(), 'uploads', 'campaign-media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: mediaDir, filename: (_r, f, cb) => cb(null, `${Date.now()}-${randomUUID()}${path.extname(f.originalname)}`) }),
  limits: { fileSize: 75 * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime'].includes(f.mimetype)),
});

export function hermesSafeAccount(account: any) {
  return {
    id: account.id, username: account.username, platform: account.platform, status: account.status,
    brandTag: account.brandTag ?? null, lastActive: account.lastActive ?? null,
    sessionHealth: account.sessionHealth, sessionHealthCheckedAt: account.sessionHealthCheckedAt ?? null,
  };
}

export function hermesSafeResult(action: any) {
  let result: unknown = null;
  if (action.result) { try { result = JSON.parse(action.result); } catch { result = { status: action.result }; } }
  return { id: action.id, accountId: action.accountId, actionType: action.actionType, status: action.status,
    result, scheduledAt: action.scheduledAt ?? null, executedAt: action.executedAt ?? null };
}

export const campaignPostCancellationData = { status: 'failed', results: JSON.stringify({ status: 'failed', error: 'CAMPAIGN_CANCELLED' }) };

export function campaignCancellationAllowed(status: string, actionStatuses: string[]) { return (status === 'pending' || status === 'paused' || status === 'cancelled') && !actionStatuses.some((value) => value === 'running' || value === 'executing' || value === 'completed'); }
async function removeCampaignQueueJobs(campaignId: string) { const connection = { host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || 6379) }; let removed = 0; for (const name of ['automationQueue', 'engagementQueue', 'scheduledPosts']) { const queue = new Queue(name, { connection }); try { const active = await queue.getJobs(['active']); if (active.some((job) => job.data?.campaignId === campaignId)) throw new Error('Campaign has an executing queue job'); for (const job of await queue.getJobs(['wait', 'delayed', 'paused', 'prioritized'])) if (job.data?.campaignId === campaignId) { await job.remove(); removed++; } } finally { await queue.close(); } } return removed; }

function campaignInput(body: any) {
  return {
    name: String(body.name || ''), type: String(body.type || ''), targetType: String(body.targetType || ''),
    targetValue: String(body.targetValue || ''), accountIds: Array.isArray(body.accountIds) ? body.accountIds.map(String) : [],
    groupIds: Array.isArray(body.groupIds) ? body.groupIds.map(String) : [],
    dailyFollowLimit: body.dailyFollowLimit === undefined ? undefined : Number(body.dailyFollowLimit),
    dailyLikeLimit: body.dailyLikeLimit === undefined ? undefined : Number(body.dailyLikeLimit),
    dailyCommentLimit: body.dailyCommentLimit === undefined ? undefined : Number(body.dailyCommentLimit),
    activeHoursStart: body.activeHoursStart === undefined ? undefined : String(body.activeHoursStart),
    activeHoursEnd: body.activeHoursEnd === undefined ? undefined : String(body.activeHoursEnd),
    items: Array.isArray(body.items) ? body.items.map((item: any) => ({ mediaUrl: item.mediaUrl ? String(item.mediaUrl) : undefined, mediaId: item.mediaId ? String(item.mediaId) : undefined, caption: String(item.caption || ''), postType: String(item.postType || 'reel'), platform: String(item.platform || 'instagram'), metadata: item.metadata || undefined })) : [],
    metadata: body.metadata || undefined,
  };
}

router.use(authenticateHermesInternal);

router.get('/accounts/available', async (_req, res) => {
  const accounts = await prisma.socialAccount.findMany({
    where: { status: { in: ['active', 'warming_up'] }, sessionHealth: { in: ['HEALTHY', 'UNKNOWN'] } },
    select: { id: true, username: true, platform: true, status: true, brandTag: true, lastActive: true, sessionHealth: true, sessionHealthCheckedAt: true },
    orderBy: { username: 'asc' },
  });
  res.json({ accounts: accounts.map(hermesSafeAccount), availableCount: accounts.length });
});

router.get('/accounts/available/count', async (_req, res) => {
  const availableCount = await prisma.socialAccount.count({ where: { status: { in: ['active', 'warming_up'] }, sessionHealth: { in: ['HEALTHY', 'UNKNOWN'] } } });
  res.json({ availableCount });
});

router.post('/campaigns/:id/media', upload.single('media'), async (req: any, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'media file is required' }); return; }
  try {
    const item = { id: randomUUID(), filename: req.file.filename, originalName: req.file.originalname,
      type: req.file.mimetype.startsWith('video/') ? 'video' : 'image', note: String(req.body.note || '').slice(0, 500),
      path: `uploads/campaign-media/${req.file.filename}`, url: `/uploads/campaign-media/${req.file.filename}`,
      mimeType: req.file.mimetype, size: req.file.size, createdAt: new Date().toISOString() } as any;
    const result = await campaignService.addCampaignMedia(String(req.params.id), item);
    res.status(201).json({ media: result.media });
  } catch (err: any) { res.status(err.message === 'Campaign not found' ? 404 : 400).json({ error: err.message }); }
});

router.post('/shadow-campaigns', async (req, res) => {
  const input = campaignInput(req.body);
  if (!input.name || !input.type || !input.targetType || !input.targetValue || (!input.accountIds.length && !input.groupIds.length)) {
    res.status(400).json({ error: 'Required: name, type, targetType, targetValue, and accountIds[] or groupIds[]' }); return;
  }
  const key = req.header('Idempotency-Key')?.trim();
  try {
    let acquired = false;
    if (key) {
      const begun = await durableIdempotency.beginOperation({ scope, key, requestHash: canonicalRequestHash(input), metadata: { source: 'hermes' } });
      if (!begun.acquired) {
        const campaign = begun.operation.resourceId ? await prisma.campaign.findUnique({ where: { id: begun.operation.resourceId }, include: { actions: true } }) : null;
        res.json({ campaign, operation: begun.operation, idempotent: true }); return;
      }
      acquired = true;
    }
    try {
      const reelService = input.items.length ? new HermesReelCampaignService(prisma) : null;
      const campaign = reelService ? await reelService.submit(input) : await campaignService.createCampaign(input);
      await reelService?.close();
      if (key) await durableIdempotency.markCompleted(scope, key, { resourceType: 'campaign', resourceId: campaign.id, resultReference: { campaignId: campaign.id } });
      res.status(201).json({ campaign, mode: 'shadow' });
    } catch (error) {
      if (acquired && key) await durableIdempotency.markUnknown(scope, key, 'SUBMISSION_OUTCOME_UNCERTAIN').catch(() => {});
      throw error;
    }
  } catch (err: any) {
    if (err instanceof IdempotencyConflictError) { res.status(409).json({ error: err.message }); return; }
    if (err instanceof IdempotencyValidationError) { res.status(400).json({ error: err.message }); return; }
    res.status(400).json({ error: err.message || 'Campaign submission failed' });
  }
});

router.get('/campaigns/:id/status', async (req, res) => {
  try { res.json(await campaignService.getCampaignProgress(String(req.params.id))); }
  catch (err: any) { res.status(err.message === 'Campaign not found' ? 404 : 500).json({ error: err.message }); }
});

router.get('/campaigns/:id/results', async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true, totalActions: true, completedActions: true, failedActions: true } });
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
  const actions = await prisma.campaignAction.findMany({ where: { campaignId: campaign.id }, select: { id: true, accountId: true, actionType: true, status: true, result: true, scheduledAt: true, executedAt: true }, orderBy: { scheduledAt: 'asc' } });
  res.json({ campaign, results: actions.map(hermesSafeResult), failures: actions.filter((a) => a.status === 'failed').map(hermesSafeResult) });
});

router.post('/campaigns/:id/cancel', async (req, res) => { const id = String(req.params.id); const campaign = await prisma.campaign.findUnique({ where: { id }, include: { actions: { select: { status: true } } } }); if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; } if (!campaignCancellationAllowed(campaign.status, campaign.actions.map((action) => action.status))) { res.status(409).json({ error: 'Only pending or paused campaigns without executing or completed actions can be cancelled' }); return; } try { const removedJobs = campaign.status === 'cancelled' ? 0 : await removeCampaignQueueJobs(id); const actions = campaign.status === 'cancelled' ? { count: 0 } : await prisma.campaignAction.updateMany({ where: { campaignId: id, status: { in: ['pending', 'queued'] } }, data: { status: 'cancelled' } }); if (campaign.status !== 'cancelled') await prisma.campaign.update({ where: { id }, data: { status: 'cancelled' } }); res.json({ campaignId: id, status: 'cancelled', cancelledActions: actions.count, removedJobs, idempotent: campaign.status === 'cancelled' }); } catch (error: any) { res.status(409).json({ error: error.message || 'Campaign cannot be cancelled' }); } });

export default router;


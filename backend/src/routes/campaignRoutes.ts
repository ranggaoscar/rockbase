/**
 * Campaign Routes — REST API for campaign lifecycle management.
 */
import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { automationGuard } from '../middleware/automation';
import { campaignService } from '../services/CampaignService';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { DurableIdempotencyService, IdempotencyConflictError, IdempotencyValidationError } from '../services/DurableIdempotencyService';
import { canonicalRequestHash } from '../utils/canonicalRequestHash';

const router = Router();
const prisma = new PrismaClient();
const durableIdempotency = new DurableIdempotencyService(prisma);
const CAMPAIGN_SUBMISSION_SCOPE = 'campaign.submit';
const CAMPAIGN_MEDIA_DIR = path.join(process.cwd(), 'uploads', 'campaign-media');
if (!fs.existsSync(CAMPAIGN_MEDIA_DIR)) fs.mkdirSync(CAMPAIGN_MEDIA_DIR, { recursive: true });

const mediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CAMPAIGN_MEDIA_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

const uploadCampaignMedia = multer({
  storage: mediaStorage,
  limits: { fileSize: 75 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/quicktime',
      'application/pdf',
      'text/plain',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.use(authenticateToken);
router.post('/:id/local-webhook', async (req: AuthRequest, res: Response) => {
  const endpoint = process.env.ROCKBASE_LOCAL_WEBHOOK_URL?.trim();
  if (!endpoint) {
    res.status(503).json({ error: 'Webhook integration is not configured' });
    return;
  }

  let url: URL;
  try {
    url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
  } catch {
    res.status(503).json({ error: 'Webhook integration is not configured' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Rockbase-Simulation': 'true',
        ...(process.env.ROCKBASE_LOCAL_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.ROCKBASE_LOCAL_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(req.body.schema ?? req.body),
      signal: controller.signal,
    });
    const responsePayload = await response.text();
    res.status(response.ok ? 200 : 502).json({
      status: response.ok ? 'success' : 'failed',
      webhookStatus: response.status,
      responsePayload,
    });
  } catch {
    res.status(502).json({ error: 'Webhook delivery failed' });
  } finally {
    clearTimeout(timeout);
  }
});

// ── POST /api/campaigns — Create a new campaign ──────────────────────────
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      name, type, targetType, targetValue, accountIds, groupIds,
      dailyFollowLimit, dailyLikeLimit, dailyCommentLimit,
      activeHoursStart, activeHoursEnd,
    } = req.body;

    if (!name || !type || !targetType || !targetValue || (!accountIds?.length && !groupIds?.length)) {
      res.status(400).json({
        error: 'Required: name, type, targetType, targetValue, and accountIds[] or groupIds[]',
      });
      return;
    }

    const idempotencyKey = req.header('Idempotency-Key')?.trim();
    let idempotencyAcquired = false;
    if (idempotencyKey) {
      const begun = await durableIdempotency.beginOperation({
        scope: CAMPAIGN_SUBMISSION_SCOPE,
        key: idempotencyKey,
        requestHash: canonicalRequestHash({
          name, type, targetType, targetValue,
          accountIds: Array.isArray(accountIds) ? accountIds : [],
          groupIds: Array.isArray(groupIds) ? groupIds : [],
          dailyFollowLimit, dailyLikeLimit, dailyCommentLimit, activeHoursStart, activeHoursEnd,
        }),
      });
      if (!begun.acquired) {
        const campaign = begun.operation.resourceId
          ? await prisma.campaign.findUnique({ where: { id: begun.operation.resourceId }, include: { actions: true } })
          : null;
        res.status(200).json({ campaign, operation: begun.operation });
        return;
      }
      idempotencyAcquired = true;
    }

    try {
      const campaign = await campaignService.createCampaign({
        name,
        type,
        targetType,
        targetValue,
        accountIds: Array.isArray(accountIds) ? accountIds : [],
        groupIds: Array.isArray(groupIds) ? groupIds : [],
        dailyFollowLimit, dailyLikeLimit, dailyCommentLimit,
        activeHoursStart, activeHoursEnd,
      });

      if (idempotencyKey) {
        await durableIdempotency.markCompleted(CAMPAIGN_SUBMISSION_SCOPE, idempotencyKey, {
          resourceType: 'campaign',
          resourceId: campaign.id,
          resultReference: { campaignId: campaign.id },
        });
      }

      res.status(201).json({ campaign });
    } catch (error) {
      if (idempotencyAcquired && idempotencyKey) {
        await durableIdempotency.markUnknown(CAMPAIGN_SUBMISSION_SCOPE, idempotencyKey, 'SUBMISSION_OUTCOME_UNCERTAIN').catch(() => {});
      }
      throw error;
    }
  } catch (err: any) {
    console.error('[CampaignRoutes] Create error:', err);
    if (err instanceof IdempotencyConflictError) { res.status(409).json({ error: err.message }); return; }
    if (err instanceof IdempotencyValidationError) { res.status(400).json({ error: err.message }); return; }
    res.status(400).json({ error: err.message });
  }
});

// ─── ARCHIVE & RESTORE ──────────────────────────────────────────────────────

// PATCH /api/campaigns/:id/archive — Archive a campaign
router.patch('/:id/archive', async (req: AuthRequest, res: Response) => {
  try {
    await campaignService.archiveCampaign(String(req.params.id));
    res.json({ success: true, message: 'Campaign archived' });
  } catch (err: any) {
    res.status(err.message === 'Campaign not found' ? 404 : 400).json({ error: err.message });
  }
});

// PATCH /api/campaigns/:id/restore — Restore an archived campaign
router.patch('/:id/restore', async (req: AuthRequest, res: Response) => {
  try {
    await campaignService.restoreCampaign(String(req.params.id));
    res.json({ success: true, message: 'Campaign restored' });
  } catch (err: any) {
    res.status(err.message === 'Campaign not found' ? 404 : 400).json({ error: err.message });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const campaign = await campaignService.updateCampaign(String(req.params.id), {
      ...(req.body.name !== undefined ? { name: String(req.body.name) } : {}),
      ...(req.body.type !== undefined ? { type: String(req.body.type) } : {}),
      ...(req.body.targetType !== undefined ? { targetType: String(req.body.targetType) } : {}),
      ...(req.body.targetValue !== undefined ? { targetValue: String(req.body.targetValue) } : {}),
      ...(Array.isArray(req.body.accountIds) ? { accountIds: req.body.accountIds.map(String) } : {}),
      ...(Array.isArray(req.body.groupIds) ? { groupIds: req.body.groupIds.map(String) } : {}),
      ...(req.body.dailyFollowLimit !== undefined ? { dailyFollowLimit: Number(req.body.dailyFollowLimit) } : {}),
      ...(req.body.dailyLikeLimit !== undefined ? { dailyLikeLimit: Number(req.body.dailyLikeLimit) } : {}),
      ...(req.body.dailyCommentLimit !== undefined ? { dailyCommentLimit: Number(req.body.dailyCommentLimit) } : {}),
      ...(req.body.activeHoursStart !== undefined ? { activeHoursStart: String(req.body.activeHoursStart) } : {}),
      ...(req.body.activeHoursEnd !== undefined ? { activeHoursEnd: String(req.body.activeHoursEnd) } : {}),
    });

    res.json({ campaign });
  } catch (err: any) {
    console.error('[CampaignRoutes] Update error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/campaigns — List all campaigns ──────────────────────────────
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const campaigns = await campaignService.listCampaigns();
    res.json({ campaigns });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/campaigns/:id — Get campaign details + progress ─────────────
// GET /api/campaigns/:id/compose-draft - Read-only bridge into Compose.
router.get('/:id/compose-draft', async (req: AuthRequest, res: Response) => {
  try {
    const draft = await campaignService.getComposeDraft(String(req.params.id));
    res.json({ draft });
  } catch (err: any) {
    res.status(err.message === 'Campaign not found' ? 404 : 500).json({ error: err.message });
  }
});

// GET /api/campaigns/:id/variation-assignments - Planning-only assignment draft bridge.
router.get('/:id/variation-assignments', async (req: AuthRequest, res: Response) => {
  try {
    const draft = await campaignService.getVariationAssignmentDraft(String(req.params.id));
    res.json({ draft });
  } catch (err: any) {
    res.status(err.message === 'Campaign not found' ? 404 : 500).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/generate-plan - Planning-only AI guidance.
router.post('/:id/generate-plan', async (req: AuthRequest, res: Response) => {
  try {
    const result = await campaignService.generateAiPlan(String(req.params.id));
    res.json(result);
  } catch (err: any) {
    console.error('[CampaignRoutes] AI plan error:', err);
    res.status(err.message === 'Campaign not found' ? 404 : 500).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/schedule - Schedule draft preparation only.
router.post('/:id/schedule', async (req: AuthRequest, res: Response) => {
  try {
    const scheduledAt = new Date(String(req.body.scheduledAt || ''));
    const campaign = await campaignService.scheduleCampaign(String(req.params.id), scheduledAt);
    res.json({ campaign });
  } catch (err: any) {
    console.error('[CampaignRoutes] Schedule error:', err);
    res.status(err.message === 'Campaign not found' ? 404 : 400).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/cancel-schedule - Cancel pending scheduled draft preparation.
router.post('/:id/cancel-schedule', async (req: AuthRequest, res: Response) => {
  try {
    const campaign = await campaignService.cancelScheduledCampaign(String(req.params.id));
    res.json({ campaign });
  } catch (err: any) {
    console.error('[CampaignRoutes] Cancel schedule error:', err);
    res.status(err.message === 'Campaign not found' ? 404 : 400).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/retry-scheduler - Retry failed draft preparation only.
router.post('/:id/retry-scheduler', async (req: AuthRequest, res: Response) => {
  try {
    const campaign = await campaignService.retryScheduledCampaign(String(req.params.id));
    res.json({ campaign });
  } catch (err: any) {
    console.error('[CampaignRoutes] Retry scheduler error:', err);
    res.status(err.message === 'Campaign not found' ? 404 : 400).json({ error: err.message });
  }
});

router.get('/:id/media', async (req: AuthRequest, res: Response) => {
  try {
    const result = await campaignService.listCampaignMedia(String(req.params.id));
    res.json(result);
  } catch (err: any) {
    res.status(err.message === 'Campaign not found' ? 404 : 500).json({ error: err.message });
  }
});

router.post('/:id/media', uploadCampaignMedia.single('media'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'media file is required' });
      return;
    }

    const requestedType = String(req.body.type || '');
    const mediaType = ['image', 'video', 'reference'].includes(requestedType)
      ? requestedType as 'image' | 'video' | 'reference'
      : req.file.mimetype.startsWith('video/')
        ? 'video'
        : req.file.mimetype.startsWith('image/')
          ? 'image'
          : 'reference';

    const item = {
      id: randomUUID(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      type: mediaType,
      note: String(req.body.note || '').slice(0, 500),
      path: `uploads/campaign-media/${req.file.filename}`,
      url: `/uploads/campaign-media/${req.file.filename}`,
      mimeType: req.file.mimetype,
      size: req.file.size,
      createdAt: new Date().toISOString(),
    };

    const result = await campaignService.addCampaignMedia(String(req.params.id), item);
    res.status(201).json({ media: result.media, item });
  } catch (err: any) {
    console.error('[CampaignRoutes] Media upload error:', err);
    res.status(err.message === 'Campaign not found' ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id/media/:mediaId', async (req: AuthRequest, res: Response) => {
  try {
    const result = await campaignService.removeCampaignMedia(String(req.params.id), String(req.params.mediaId));
    res.json(result);
  } catch (err: any) {
    console.error('[CampaignRoutes] Remove media reference error:', err);
    res.status(err.message === 'Campaign not found' ? 404 : 500).json({ error: err.message });
  }
});

router.patch('/:id/variation-media', async (req: AuthRequest, res: Response) => {
  try {
    const result = await campaignService.updateVariationMediaReference(
      String(req.params.id),
      String(req.body.variationKey || ''),
      String(req.body.primaryMediaId || ''),
      String(req.body.secondaryMediaId || ''),
    );
    res.json(result);
  } catch (err: any) {
    console.error('[CampaignRoutes] Variation media reference error:', err);
    res.status(err.message === 'Campaign not found' ? 404 : 500).json({ error: err.message });
  }
});

router.patch('/:id/variation-approval', async (req: AuthRequest, res: Response) => {
  try {
    const result = await campaignService.updateVariationApproval(String(req.params.id), {
      variationKey: String(req.body.variationKey || ''),
      ...(req.body.status !== undefined ? { status: String(req.body.status) as any } : {}),
      ...(req.body.reviewerNote !== undefined ? { reviewerNote: String(req.body.reviewerNote || '') } : {}),
    });
    res.json(result);
  } catch (err: any) {
    console.error('[CampaignRoutes] Variation approval error:', err);
    res.status(err.message === 'Campaign not found' ? 404 : 400).json({ error: err.message });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const progress = await campaignService.getCampaignProgress(String(req.params.id));
    res.json(progress);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/campaigns/:id/start — Start a campaign ─────────────────────
router.post('/:id/start', automationGuard, async (req: AuthRequest, res: Response) => {
  try {
    await campaignService.startCampaign(String(req.params.id));
    res.json({ success: true, message: 'Campaign started' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/campaigns/:id/pause — Pause a campaign ─────────────────────
router.post('/:id/pause', async (req: AuthRequest, res: Response) => {
  try {
    await campaignService.pauseCampaign(String(req.params.id));
    res.json({ success: true, message: 'Campaign paused' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/campaigns/:id/resume — Resume a campaign ───────────────────
router.post('/:id/resume', automationGuard, async (req: AuthRequest, res: Response) => {
  try {
    await campaignService.resumeCampaign(String(req.params.id));
    res.json({ success: true, message: 'Campaign resumed' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/campaigns/:id/stop — Stop a campaign ───────────────────────
router.post('/:id/stop', async (req: AuthRequest, res: Response) => {
  try {
    await campaignService.stopCampaign(String(req.params.id));
    res.json({ success: true, message: 'Campaign stopped' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});


// ── GET /api/campaigns/:id/actions — Get action log ──────────────────────
router.get('/:id/actions', async (req: AuthRequest, res: Response) => {
  try {
    const actions = await campaignService.getCampaignActions(String(req.params.id));
    res.json({ actions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

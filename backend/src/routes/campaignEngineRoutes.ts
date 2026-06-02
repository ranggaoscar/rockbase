import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { CampaignEngineBrief, campaignEnginePlannerService } from '../services/CampaignEnginePlannerService';

const router = Router();
router.use(authenticateToken);

function validateBrief(body: Partial<CampaignEngineBrief>): string | null {
  const requiredStringFields: Array<keyof CampaignEngineBrief> = [
    'campaignName',
    'materialCategory',
    'mainColor',
    'goal',
    'periodStart',
    'periodEnd',
    'cta',
    'brandTone',
  ];

  for (const field of requiredStringFields) {
    if (typeof body[field] !== 'string' || !String(body[field]).trim()) {
      return `${field} is required`;
    }
  }

  if (!Array.isArray(body.materials) || body.materials.length === 0) {
    return 'materials must be a non-empty array';
  }

  if (!Array.isArray(body.targetAudience) || body.targetAudience.length === 0) {
    return 'targetAudience must be a non-empty array';
  }

  if (!Number.isFinite(Number(body.accountCount)) || Number(body.accountCount) < 1) {
    return 'accountCount must be a positive number';
  }

  if (!Number.isFinite(Number(body.clusterCount)) || Number(body.clusterCount) < 1) {
    return 'clusterCount must be a positive number';
  }

  return null;
}

router.post('/plan', async (req: AuthRequest, res: Response) => {
  try {
    const validationError = validateBrief(req.body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const brief: CampaignEngineBrief = {
      campaignName: String(req.body.campaignName).trim(),
      materialCategory: String(req.body.materialCategory).trim(),
      mainColor: String(req.body.mainColor).trim(),
      materials: req.body.materials.map((item: unknown) => String(item).trim()).filter(Boolean),
      goal: String(req.body.goal).trim(),
      targetAudience: req.body.targetAudience.map((item: unknown) => String(item).trim()).filter(Boolean),
      periodStart: String(req.body.periodStart).trim(),
      periodEnd: String(req.body.periodEnd).trim(),
      accountCount: Number(req.body.accountCount),
      clusterCount: Number(req.body.clusterCount),
      cta: String(req.body.cta).trim(),
      brandTone: String(req.body.brandTone).trim(),
    };

    const plan = campaignEnginePlannerService.generatePlan(brief);
    res.json({ plan });
  } catch (err: any) {
    console.error('[CampaignEngineRoutes] Plan generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

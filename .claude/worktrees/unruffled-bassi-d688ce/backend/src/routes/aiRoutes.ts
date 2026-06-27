import { Router, Request, Response } from 'express';
import { aiService } from '../services/AiService';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

// POST /api/ai/generate-captions — single caption per platform
router.post('/generate-captions', async (req: Request, res: Response) => {
  try {
    const { topic, platforms, language } = req.body;
    if (!topic || !platforms || platforms.length === 0) {
      res.status(400).json({ error: 'Topic and platforms are required.' });
      return;
    }
    const result = await aiService.generateCaption(topic, platforms, language);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate captions' });
  }
});

// POST /api/ai/generate-batch — batch mode (N captions, 1 tone, 1 platform)
router.post('/generate-batch', async (req: Request, res: Response) => {
  try {
    const { topic, platform, tone, count = 7, niche } = req.body;
    if (!topic || !platform || !tone) {
      res.status(400).json({ error: 'topic, platform, and tone are required' });
      return;
    }
    const result = await aiService.generateBatch(
      topic,
      platform,
      tone,
      Math.min(Number(count), 20),
      niche,
    );
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate batch captions' });
  }
});

// POST /api/ai/best-time
router.post('/best-time', async (req: Request, res: Response) => {
  try {
    const { niche, platform } = req.body;
    const times = await aiService.suggestBestPostingTime(niche, platform);
    res.json({ times });
  } catch {
    res.status(500).json({ error: 'Failed to suggest best times' });
  }
});

export default router;

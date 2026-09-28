import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireRole } from '../middleware/auth';
import { getRockBaseMode } from '../middleware/runtimeMode';
import { androidScheduler } from '../services/AndroidScheduler';
import { enqueueAndroidJob } from '../queue/androidDeviceWorker';

const router = Router();
const prisma = new PrismaClient();
router.use((_req, res, next) => {
  if (getRockBaseMode() !== 'local' || process.platform !== 'win32') {
    res.status(501).json({ error: 'Android smoke jobs require Windows Local Mode' }); return;
  }
  next();
});
router.use(requireRole(['Admin']));
router.get('/', async (_req, res) => {
  try {
    const jobs = await prisma.androidJob.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ jobs });
  } catch { res.status(500).json({ error: 'Failed to read Android jobs' }); }
});
router.get('/:id', async (req, res) => {
  const job = await prisma.androidJob.findUnique({ where: { id: String(req.params.id) } });
  if (!job) { res.status(404).json({ error: 'Android job not found' }); return; }
  res.json({ job });
});
router.post('/smoke', async (req, res: Response) => {
  try {
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : '';
    if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }
    const job = await androidScheduler.submit(accountId);
    try { await enqueueAndroidJob(job.id); }
    catch (error: any) {
      res.status(503).json({ job, error: `Job saved as QUEUED; Redis dispatch pending: ${error.message}` }); return;
    }
    res.status(202).json({ job });
  } catch (error: any) { res.status(409).json({ error: error.message || 'Android job rejected' }); }
});
export default router;

import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest, requireRole } from '../middleware/auth';
import { getRockBaseMode } from '../middleware/runtimeMode';
import { androidDevices, androidMaxConcurrent } from '../services/AndroidDeviceService';
import { androidRuntime } from '../services/AndroidRuntimeService';

const router = Router();
router.use((_req, res, next) => {
  if (getRockBaseMode() !== 'local' || process.platform !== 'win32') {
    res.status(501).json({ error: 'Android Farm requires Windows Local Mode' });
    return;
  }
  next();
});
router.use(requireRole(['Admin']));

function failure(res: Response, error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({ error: 'Device name or AVD already registered' });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    res.status(404).json({ error: 'Device not found' });
  } else {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Android operation failed' });
  }
}

router.get('/tooling', async (_req, res) => {
  const tooling = await androidRuntime.tooling();
  const avds = tooling.emulator ? await androidRuntime.listAvds().catch(() => []) : [];
  res.json({ ...tooling, avds, maxConcurrent: androidMaxConcurrent() });
});
router.get('/', async (_req, res) => {
  try { res.json({ devices: await androidDevices.list() }); } catch (error) { failure(res, error); }
});
router.post('/', async (req: AuthRequest, res: Response) => {
  try { res.status(201).json({ device: await androidDevices.register(req.body || {}) }); } catch (error) { failure(res, error); }
});
for (const action of ['start', 'stop', 'restart', 'health'] as const) {
  router.post('/:id/' + action, async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const device = action === 'health' ? await androidDevices.refresh(id) : await androidDevices[action](id);
      res.json({ device });
    } catch (error) { failure(res, error); }
  });
}
router.get('/:id/screenshot', async (req: AuthRequest, res: Response) => {
  try {
    const image = await androidDevices.screenshot(String(req.params.id));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(image);
  } catch (error) { failure(res, error); }
});

export default router;

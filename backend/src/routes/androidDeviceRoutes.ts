import { Router, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthRequest, requireRole } from '../middleware/auth';
import { getRockBaseMode } from '../middleware/runtimeMode';
import { androidDevices, androidMaxConcurrent } from '../services/AndroidDeviceService';
import { androidRuntime } from '../services/AndroidRuntimeService';
import { AndroidDeviceLeaseService } from '../services/AndroidDeviceLeaseService';

const router = Router();
const prisma = new PrismaClient();
const leases = new AndroidDeviceLeaseService(prisma);
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
  try {
    const devices = await androidDevices.list();
    const queued = await prisma.androidJob.groupBy({ by: ['deviceId'], where: { status: 'QUEUED' }, _count: { id: true } });
    const counts = new Map(queued.map(item => [item.deviceId, item._count.id]));
    const running = await androidRuntime.connected().catch(() => null);
    res.json({ devices: devices.map(device => ({ ...device, queueCount: counts.get(device.id) || 0,
      lease: device.leaseOwner ? { ownerId: device.leaseOwner, jobId: device.leaseJobId, expiresAt: device.leaseExpiresAt } : null })),
      running: running?.length ?? null, maxConcurrent: androidMaxConcurrent() });
  } catch (error) { failure(res, error); }
});
router.post('/', async (req: AuthRequest, res: Response) => {
  try { res.status(201).json({ device: await androidDevices.register(req.body || {}) }); } catch (error) { failure(res, error); }
});
for (const action of ['start', 'stop', 'restart', 'health'] as const) {
  router.post('/:id/' + action, async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const device = action === 'health' ? await androidDevices.refresh(id, true) : await androidDevices[action](id);
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

router.post('/:id/control', async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const device = await prisma.androidDevice.findUnique({ where: { id } });
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    if (!device.enabled || device.status !== 'READY') { res.status(409).json({ error: 'Device must be enabled and READY for operator control' }); return; }
    const lease = await leases.acquire(id, `operator:${req.user?.id || 'local'}`);
    if (!lease) { res.status(409).json({ error: 'Device is leased by a job or needs operator attention' }); return; }
    try {
      const serial = await androidRuntime.resolveSerial(device.avdName);
      if (!serial || !await androidRuntime.health(serial)) throw new Error('Device is not booted and responsive');
      await lease.assertOwner();
      await androidRuntime.control(serial, req.body || {});
      await prisma.androidDevice.updateMany({ where: { id, leaseOwner: lease.ownerId }, data: { idleSince: new Date() } });
      res.json({ success: true });
    } finally { await lease.release(); }
  } catch (error) { failure(res, error); }
});

export default router;

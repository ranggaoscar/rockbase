import { randomUUID, createHash } from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireRole } from '../middleware/auth';
import { getRockBaseMode } from '../middleware/runtimeMode';
import { InstagramPreparationRecovery } from '../services/instagram/InstagramPreparationRecovery';
import { AdbInstagramUiAdapter } from '../services/instagram/AdbInstagramUiAdapter';

const router = Router();
const prisma = new PrismaClient();
const uploadRoot = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadRoot, { recursive: true });
const upload = multer({ storage: multer.diskStorage({ destination: uploadRoot, filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`) }),
  fileFilter: (_req, file, cb) => cb(null, ['.jpg', '.jpeg', '.png'].includes(path.extname(file.originalname).toLowerCase())),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
router.use((_req, res, next) => {
  if (getRockBaseMode() !== 'local' || process.platform !== 'win32') { res.status(501).json({ error: 'Android image drafts require Windows Local Mode' }); return; }
  next();
});
router.use(requireRole(['Admin']));

router.post('/', upload.single('media'), async (req, res) => {
  const file = req.file;
  let retainFile = false;
  try {
    const { accountId, caption, idempotencyKey } = req.body || {};
    if (!file || typeof accountId !== 'string' || typeof caption !== 'string' || !caption.trim() || caption.length > 2200 ||
      typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9_:-]{8,128}$/.test(idempotencyKey)) {
      res.status(400).json({ error: 'Image, Android accountId, caption (1–2200 chars), and stable idempotencyKey (8–128 safe characters) required' }); return;
    }
    const image = await fsp.readFile(file.path);
    const jpeg = image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const png = image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (image.length < 100 || (!jpeg && !png)) { res.status(400).json({ error: 'Only a single PNG or JPEG image is supported' }); return; }
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account || account.executionEngine !== 'android' || account.platform !== 'Instagram' || !account.homeDeviceId) { res.status(409).json({ error: 'An Instagram Android account with home device is required' }); return; }
    const mediaSha256 = createHash('sha256').update(image).digest('hex');
    const key = `android-image:${idempotencyKey}`;
    const same = (job: { accountId: string; caption: string | null; mediaSha256: string | null }) => job.accountId === accountId && job.caption === caption && job.mediaSha256 === mediaSha256;
    const existing = await prisma.androidJob.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (!same(existing)) { res.status(409).json({ error: 'Idempotency key already used for a different image-post request' }); return; }
      res.json({ job: existing, reused: true }); return;
    }
    try {
      const job = await prisma.androidJob.create({ data: { accountId, deviceId: account.homeDeviceId, type: 'ANDROID_IMAGE_POST', status: 'DRAFT',
        caption, mediaPath: file.path, mediaSha256, idempotencyKey: key, reason: 'Awaiting verified Instagram identity and operator approval' } });
      retainFile = true;
      res.status(201).json({ job, reused: false });
      return;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await prisma.androidJob.findUnique({ where: { idempotencyKey: key } });
        if (duplicate && same(duplicate)) { res.json({ job: duplicate, reused: true }); return; }
        res.status(409).json({ error: 'Idempotency key already used for another request' }); return;
      }
      throw error;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Could not create Android image draft' });
  } finally {
    // The original media remains in uploads only when a new draft references it.
    if (file && !retainFile) await fsp.unlink(file.path).catch(() => undefined);
  }
});

router.get('/orchestration-health', async (_req, res) => {
  const health = await (await import('../queue/androidDeviceWorker')).androidOrchestrationHealth();
  res.status(health.healthy ? 200 : 503).json(health);
});

router.post('/:id/recover-preparation', async (req, res) => {
  if (!['reprepare', 'revalidate'].includes(req.body?.mode) || typeof req.body?.idempotencyKey !== 'string') {
    res.status(400).json({ error: 'Explicit mode and original idempotencyKey required' }); return;
  }
  const health = await (await import('../queue/androidDeviceWorker')).androidOrchestrationHealth();
  if (!health.healthy) { res.status(503).json({ error: 'Android orchestration unavailable', health }); return; }
  try {
    const outcome = await new InstagramPreparationRecovery(prisma, serial => new AdbInstagramUiAdapter(serial))
      .recover(String(req.params.id), req.body.idempotencyKey, req.body.mode);
    res.json({ outcome, job: await prisma.androidJob.findUnique({ where: { id: String(req.params.id) } }), reused: true });
  } catch (error: any) { res.status(409).json({ error: error.message }); }
});

router.post('/:id/approve', async (req, res) => {
  const job = await prisma.androidJob.findUnique({ where: { id: String(req.params.id) }, include: { account: true, device: true } });
  if (!job || job.type !== 'ANDROID_IMAGE_POST') { res.status(404).json({ error: 'Android image draft not found' }); return; }
  if (job.publishBoundaryAt || ['PUBLISHING', 'AMBIGUOUS', 'COMPLETED'].includes(job.status)) {
    res.status(409).json({ error: `Job already crossed the publish boundary (${job.status}); Share is never re-attempted — verify the account manually` }); return;
  }
  if (job.status === 'READY_FOR_REAL_POST') {
    // Preparation is already complete on the device: re-approving must not rebuild the post, and
    // Share stays unpressed — publishing needs its own explicit approval.
    res.json({ job, reused: true, prepared: true,
      message: 'Preparation is already complete on the device; Share requires an explicit publish approval and was not pressed' });
    return;
  }
  if (['QUEUED', 'RUNNING', 'READY_TO_PUBLISH'].includes(job.status)) { res.json({ job, reused: true }); return; }
  if (job.status !== 'DRAFT') { res.status(409).json({ error: `Job is ${job.status}; only drafts can be approved` }); return; }
  const account = job.account;
  if (account.platform !== 'Instagram' || account.executionEngine !== 'android' || !account.homeDeviceId || account.homeDeviceId !== job.deviceId) {
    res.status(409).json({ error: 'Android Instagram account with its original home device required' }); return;
  }
  if (!account.androidLastVerifiedAt || !account.androidVerifiedUsername || account.androidHealth !== 'HEALTHY') {
    res.status(409).json({ error: 'Verify the Instagram identity on the home device first; account health must be HEALTHY' }); return;
  }
  if (!job.device.enabled) { res.status(409).json({ error: 'Home device disabled' }); return; }
  if (!job.mediaPath || !job.caption) { res.status(409).json({ error: 'Draft is missing media or caption' }); return; }
  const approved = await prisma.androidJob.update({ where: { id: job.id }, data: { status: 'QUEUED', approvedAt: new Date(), reason: null } });
  // Best-effort fire-and-forget enqueue; the worker sweep (every 30 s) re-enqueues approved
  // QUEUED jobs that are not in the queue, so approval never depends on Redis being reachable here.
  void (await import('../queue/androidDeviceWorker')).enqueueAndroidJob(job.id)
    .catch((error) => console.error('Android image job enqueue failed:', error));
  res.json({ job: approved, reused: false });
});

export default router;

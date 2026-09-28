import { randomUUID, createHash } from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireRole } from '../middleware/auth';
import { getRockBaseMode } from '../middleware/runtimeMode';

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

router.post('/:id/approve', async (req, res) => {
  const job = await prisma.androidJob.findUnique({ where: { id: String(req.params.id) } });
  if (!job || job.type !== 'ANDROID_IMAGE_POST') { res.status(404).json({ error: 'Android image draft not found' }); return; }
  res.status(409).json({ error: 'Publishing is disabled until the official Instagram app, designated test account, identity verifier and worker are validated. Draft retained; no job dispatched.' });
});

export default router;

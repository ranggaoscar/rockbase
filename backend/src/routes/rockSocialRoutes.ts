import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as crypto from 'crypto';
import { automationGuard } from '../middleware/automation';
import {
  createSocialPost,
  getSocialAccounts,
  getSocialAccountById,
  getSelectAccounts,
  getExcludeAccounts,
  uploadImage,
  listRecentPosts,
  getJobStatus,
  clearQueue,
} from '../controllers/rockSocialController';

const router = Router();

const storage = multer.diskStorage({
  destination: path.join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Account endpoints ───────────────────────────────────────────────────────
router.get('/accounts', getSocialAccounts);
router.get('/accounts/:id', getSocialAccountById);
router.get('/select-accounts', getSelectAccounts);
router.get('/exclude-accounts', getExcludeAccounts);

// ── Post endpoints ──────────────────────────────────────────────────────────
router.post('/post', automationGuard, createSocialPost);
router.get('/posts', listRecentPosts);            // Fix #6

// ── Job / Queue endpoints ───────────────────────────────────────────────────
router.get('/jobs/:jobId', getJobStatus);         // Fix #4
router.post('/queue/clear', automationGuard, clearQueue);          // Fix #5

// ── Upload endpoint ─────────────────────────────────────────────────────────
router.post('/upload', upload.single('image'), uploadImage);

export default router;

import { Router } from 'express';
import { getLogs, listLogFilesEndpoint, clearQueue, resetQueue } from '../controllers/systemController';
import { automationGuard } from '../middleware/automation';

const router = Router();

// ── Log endpoints │ Improvement #9 ──────────────────────────────────────────
router.get('/logs', getLogs);
router.get('/logs/files', listLogFilesEndpoint);

// ── Queue endpoints ─────────────────────────────────────────────────────────
router.post('/queue/clear', automationGuard, clearQueue);
router.post('/queue/reset', automationGuard, resetQueue);

export default router;

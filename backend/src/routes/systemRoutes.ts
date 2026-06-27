import { Router } from 'express';
import { getLogs, listLogFilesEndpoint, clearQueue, resetQueue } from '../controllers/systemController';

const router = Router();

// ── Log endpoints │ Improvement #9 ──────────────────────────────────────────
router.get('/logs', getLogs);
router.get('/logs/files', listLogFilesEndpoint);

// ── Queue endpoints ─────────────────────────────────────────────────────────
router.post('/queue/clear', clearQueue);
router.post('/queue/reset', resetQueue);

export default router;

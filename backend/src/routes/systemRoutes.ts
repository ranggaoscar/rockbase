import { Router } from 'express';
import { getLogs, listLogFilesEndpoint } from '../controllers/systemController';

const router = Router();

// ── Log endpoints │ Improvement #9 ──────────────────────────────────────────
router.get('/logs', getLogs);
router.get('/logs/files', listLogFilesEndpoint);

export default router;

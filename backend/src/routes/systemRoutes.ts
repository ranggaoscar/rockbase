import { Router } from 'express';
import { getLogs, listLogFilesEndpoint, clearQueue, resetQueue } from '../controllers/systemController';
import { automationGuard } from '../middleware/automation';
import { noStore, requireSecretAdmin, requireLocalSecretOrigin } from '../middleware/secretAccess';

const router = Router();

// ── Log endpoints │ Improvement #9 ──────────────────────────────────────────
router.get('/logs', noStore, requireLocalSecretOrigin, requireSecretAdmin, getLogs);
router.get('/logs/files', noStore, requireLocalSecretOrigin, requireSecretAdmin, listLogFilesEndpoint);

// ── Queue endpoints ─────────────────────────────────────────────────────────
router.post('/queue/clear', automationGuard, clearQueue);
router.post('/queue/reset', automationGuard, resetQueue);

export default router;

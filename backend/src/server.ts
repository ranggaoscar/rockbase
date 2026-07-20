import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import http from 'http';
import { Server } from 'socket.io';
import { Queue } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as path from 'path';
import { AUTOMATION_DISABLED_MESSAGE, isAutomationEnabled } from './middleware/automation';
import { authenticateToken } from './middleware/auth';
import { assertJwtConfiguration, verifyAccessToken } from './middleware/security';

dotenv.config();
assertJwtConfiguration();

// ── Initialize structured logging ──────────────────────────────────
import { logger } from './services/logger';
logger.info('Server starting up', { nodeVersion: process.version, platform: process.platform });

// ── GLOBAL ERROR HANDLERS — Prevent process crash ──────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception — server will try to recover:', err);
  logger.error('Uncaught Exception — process may need restart', {
    error: err.message,
    stack: err.stack,
    name: err.name,
    pid: process.pid,
    uptime: process.uptime(),
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection — server will try to recover:', reason);
  logger.error('Unhandled Promise Rejection — process may need restart', {
    reason: String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    pid: process.pid,
    uptime: process.uptime(),
  });
});

process.on('exit', (code) => {
  // Log normal exit so we can tell apart graceful shutdowns from crashes.
  logger.warn('Process exit', { code, pid: process.pid, uptime: process.uptime() });
});

process.on('SIGTERM', () => {
  logger.warn('Received SIGTERM', { pid: process.pid });
});

process.on('SIGINT', () => {
  logger.warn('Received SIGINT', { pid: process.pid });
});

const app = express();
const port = process.env.PORT || 3010;

// Gemini Setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key_for_now');

// Redis & BullMQ Setup
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};
const automationQueue = new Queue('automationQueue', { connection });

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
import authRoutes from './routes/authRoutes';
import accountRoutes from './routes/accountRoutes';
import proxyRoutes from './routes/proxyRoutes';
import warmingRoutes from './routes/warmingRoutes';
import postRoutes from './routes/postRoutes';
import aiRoutes from './routes/aiRoutes';
import schedulerRoutes from './routes/schedulerRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import settingsRoutes from './routes/settingsRoutes';
import engagementRoutes from './routes/engagementRoutes';
import campaignRoutes from './routes/campaignRoutes';
import campaignEngineRoutes from './routes/campaignEngineRoutes';
import accountGroupRoutes from './routes/accountGroupRoutes';
import activityRoutes from './routes/activityRoutes';
import rockSocialRoutes from './routes/rockSocialRoutes';
app.get('/livez', (_req, res) => {
  res.status(200).json({ status: 'live' });
});

app.get('/readyz', async (_req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    const client = await automationQueue.client;
    if (await client.ping() !== 'PONG') throw new Error('Redis unavailable');
    await prisma.$disconnect();
    res.status(200).json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});

import systemRoutes from './routes/systemRoutes';

app.use('/api/auth', authRoutes);
app.use('/uploads', authenticateToken, express.static(path.join(process.cwd(), 'uploads')));
app.use('/api', authenticateToken);
app.use('/api/accounts', accountRoutes);
app.use('/api/proxies', proxyRoutes);
app.use('/api/warming', warmingRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/engagement', engagementRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/campaign-engine', campaignEngineRoutes);
app.use('/api/account-groups', accountGroupRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/rock-social', rockSocialRoutes);
app.use('/api/system', systemRoutes); // Improvement #9 — log access

// Health check
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (err: any) {
    dbStatus = `error: ${err.message}`;
  }

  let redisStatus = 'disconnected';
  let queueCounts: any = null;
  try {
    const client = await automationQueue.client;
    const pingResult = await client.ping();
    redisStatus = pingResult === 'PONG' ? 'connected' : `unexpected: ${pingResult}`;

    // Get queue counts
    const states = ['wait', 'active', 'delayed', 'failed', 'completed'] as const;
    queueCounts = await automationQueue.getJobCounts(...states);
  } catch (err: any) {
    redisStatus = `error: ${err.message}`;
  }

  let browserMetrics = { activeContexts: 0, activePages: 0 };
  let activeAccountIds: string[] = [];
  try {
    const { browserManager } = require('./services/BrowserManager');
    browserMetrics = browserManager.getMetrics();
    activeAccountIds = browserManager.getActiveAccountIds();
  } catch (err: any) {
    console.error('[HealthCheck] BrowserManager error:', err);
  }

  const isHealthy = dbStatus === 'connected' && redisStatus === 'connected';

  res.status(isHealthy ? 200 : 500).json({
    status: isHealthy ? 'ok' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    automationEnabled: isAutomationEnabled(),
    workerMode: process.env.RUN_WORKERS_SEPARATELY === 'true' ? 'separate' : 'in-process',
    database: {
      status: dbStatus,
    },
    redis: {
      status: redisStatus,
    },
    queue: queueCounts ? {
      name: 'automationQueue',
      counts: queueCounts,
    } : null,
    browserManager: {
      activeContexts: browserMetrics.activeContexts,
      activePages: browserMetrics.activePages,
      activeAccountIds,
    }
  });

});

// Initialize Workers
if (!isAutomationEnabled()) {
  console.log('[Server] Automation disabled; workers will not start.');
} else if (process.env.RUN_WORKERS_SEPARATELY !== 'true') {
  console.log('[Server] Initializing workers in-process...');
  require('./queue/postingWorker');
  require('./queue/analyticsWorker');
  require('./queue/engagementWorker');
} else {
  console.log('[Server] Workers will run in a separate process.');
}

// HTTP + Socket.io server
const server = http.createServer(app);
export const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});
io.use((socket, next) => {
  const authToken = typeof socket.handshake.auth?.token === 'string'
    ? socket.handshake.auth.token
    : undefined;
  const header = socket.handshake.headers.authorization;
  const headerToken = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : undefined;

  try {
    socket.data.user = verifyAccessToken(authToken || headerToken || '');
    next();
  } catch {
    next(new Error('Authentication required'));
  }
});

// Farm View real-time handlers
import { farmService } from './services/FarmService';
import { sessionPool } from './services/SessionPool';
import { backupService } from './services/BackupService';
import { logRetentionService } from './services/LogRetentionService';
import { campaignSchedulerService } from './services/CampaignSchedulerService';
import { sessionHealthScheduler } from './services/SessionHealthScheduler';

// Initialize auto-backup
backupService.init();
// Initial backup on startup for safety
void backupService.createBackup();
logRetentionService.init();
campaignSchedulerService.init();
if (isAutomationEnabled()) {
  sessionHealthScheduler.init();
} else {
  console.log('[Server] Automation disabled; session health scheduler will not start.');
}

io.on('connection', (socket) => {
  console.log('Client connected to WebSocket:', socket.id);

  const rejectDisabledAutomation = () => {
    if (isAutomationEnabled()) return false;
    socket.emit('automation_disabled', {
      error: 'AUTOMATION_DISABLED',
      message: AUTOMATION_DISABLED_MESSAGE,
    });
    return true;
  };

  socket.on('join_farm', () => {
    if (rejectDisabledAutomation()) return;
    farmService.startStreaming(socket);
  });

  socket.on('leave_farm', () => {
    farmService.stopStreaming(socket);
  });

  socket.on('farm_visible_accounts', (data) => {
    if (rejectDisabledAutomation()) return;
    const accountIds = Array.isArray(data?.accountIds) ? data.accountIds.map(String) : [];
    farmService.updateVisibleAccounts(socket, accountIds);
  });

  socket.on('control_action', async (data) => {
    if (!['Admin', 'Operator'].includes(socket.data.user.role)) {
      socket.emit('authorization_error', { error: 'FORBIDDEN' });
      return;
    }
    if (rejectDisabledAutomation()) return;
    // set_mode needs the live socket reference — handle it here
    if (data.action === 'set_mode') {
      await farmService.setControlMode(
        data.params?.active ? data.accountId : null,
        socket
      );
    } else {
      await farmService.handleControl(data);
    }
  });

  // Session pool status updates
  socket.on('get_pool_status', () => {
    socket.emit('pool_status', sessionPool.getStatus());
  });

  socket.on('disconnect', () => {
    farmService.stopStreaming(socket);
    console.log('Client disconnected:', socket.id);
  });
});

// ── Startup: auto-clean stale BullMQ jobs ──────────────────────────────────
const STARTUP_SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function cleanStaleQueueOnStartup() {
  try {
    // Preserve 'delayed' jobs — these are user-scheduled posts waiting for their
    // scheduled time. Wiping them on restart loses user intent.
    // Only clean 'wait' (queued but not delayed) and 'failed' (terminal failures).
    const states = ['wait', 'failed'] as const;
    const counts = await automationQueue.getJobCounts(...states);
    const delayedCount = (await automationQueue.getJobCounts('delayed')).delayed || 0;
    const totalStale = (counts.wait || 0) + (counts.failed || 0);

    if (totalStale > 0) {
      console.log(`[Startup] Cleaning ${totalStale} stale jobs from previous session (preserving ${delayedCount} delayed job(s))...`);
      for (const state of states) {
        const removed = await automationQueue.clean(0, 10000, state);
        if (removed.length > 0) {
          console.log(`[Startup] Removed ${removed.length} ${state} job(s).`);
        }
      }
      console.log(`[Startup] Stale queue cleaned. ${delayedCount} delayed job(s) preserved.`);
    } else {
      console.log(`[Startup] Queue is clean. No stale jobs. ${delayedCount} delayed job(s) preserved.`);
    }
  } catch (err: any) {
    console.warn('[Startup] Could not clean queue (Redis may not be running):', err.message);
  }
}

// Export session ID so workers/controllers can tag jobs
export { STARTUP_SESSION_ID };

server.listen(port, async () => {
  logger.info(`ROCK BASE backend running on port ${port}`, { sessionId: STARTUP_SESSION_ID });
  console.log(`ROCK BASE backend running on port ${port}`);
  console.log(`Session ID: ${STARTUP_SESSION_ID}`);
  console.log(`Frontend expected at: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);

  // Clean stale queue on every server start
  if (isAutomationEnabled()) {
    await cleanStaleQueueOnStartup();
  } else {
    console.log('[Server] Automation disabled; startup queue cleanup skipped.');
  }
});
server.timeout = 300000; // 5 minutes

// Initialize Browser Manager
import { browserManager } from './services/BrowserManager';

if (isAutomationEnabled()) {
  browserManager.initBrowser().then(() => {
    console.log('Playwright Browser Manager initialized.');
  }).catch((err: any) => {
    console.error('Failed to initialize Playwright:', err);
  });
} else {
  console.log('[Server] Automation disabled; Playwright browser will not start.');
}

// ── Graceful Shutdown ──────────────────────────────────────────────
function gracefulShutdown(signal: string) {
  console.log(`[Shutdown] Received ${signal}. Cleaning up...`);
  logger.info('Server shutting down', { signal });

  // Stop campaign scheduler
  campaignSchedulerService.stop();
  sessionHealthScheduler.stop();

  // Close socket.io
  server.close(() => {
    console.log('[Shutdown] HTTP server closed.');
  });

  // Force-kill all browser contexts
  browserManager.forceKillAll().catch((e: any) => {
    console.error('[Shutdown] Error killing browsers:', e);
  });

  // Release session pool
  sessionPool.releaseAll().catch((e: any) => {
    console.error('[Shutdown] Error releasing session pool:', e);
  });

  // Exit after timeout
  setTimeout(() => {
    console.log('[Shutdown] Forcing exit after cleanup timeout.');
    process.exit(0);
  }, 10000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

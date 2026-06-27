import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import http from 'http';
import { Server } from 'socket.io';
import { Queue } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as path from 'path';

dotenv.config();

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
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

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
import systemRoutes from './routes/systemRoutes';

app.use('/api/auth', authRoutes);
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
if (process.env.RUN_WORKERS_SEPARATELY !== 'true') {
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

// Farm View real-time handlers
import { farmService } from './services/FarmService';
import { sessionPool } from './services/SessionPool';
import { backupService } from './services/BackupService';
import { logRetentionService } from './services/LogRetentionService';
import { campaignSchedulerService } from './services/CampaignSchedulerService';

// Initialize auto-backup
backupService.init();
// Initial backup on startup for safety
backupService.createBackup();
logRetentionService.init();
campaignSchedulerService.init();

io.on('connection', (socket) => {
  console.log('Client connected to WebSocket:', socket.id);

  socket.on('join_farm', () => {
    farmService.startStreaming(socket);
  });

  socket.on('leave_farm', () => {
    farmService.stopStreaming(socket);
  });

  socket.on('farm_visible_accounts', (data) => {
    const accountIds = Array.isArray(data?.accountIds) ? data.accountIds.map(String) : [];
    farmService.updateVisibleAccounts(socket, accountIds);
  });

  socket.on('control_action', async (data) => {
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
    const states = ['wait', 'delayed', 'failed'] as const;
    const counts = await automationQueue.getJobCounts(...states);
    const totalStale = (counts.wait || 0) + (counts.delayed || 0) + (counts.failed || 0);

    if (totalStale > 0) {
      console.log(`[Startup] Cleaning ${totalStale} stale jobs from previous session...`);
      for (const state of states) {
        const removed = await automationQueue.clean(0, 10000, state);
        if (removed.length > 0) {
          console.log(`[Startup] Removed ${removed.length} ${state} job(s).`);
        }
      }
      console.log('[Startup] Stale queue cleaned. Fresh session started.');
    } else {
      console.log('[Startup] Queue is clean. No stale jobs.');
    }
  } catch (err: any) {
    console.warn('[Startup] Could not clean queue (Redis may not be running):', err.message);
  }
}

// Export session ID so workers/controllers can tag jobs
export { STARTUP_SESSION_ID };

server.listen(port, async () => {
  console.log(`ROCK BASE backend running on port ${port}`);
  console.log(`Session ID: ${STARTUP_SESSION_ID}`);
  console.log(`Frontend expected at: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);

  // Clean stale queue on every server start
  await cleanStaleQueueOnStartup();
});
server.timeout = 300000; // 5 minutes

// Initialize Browser Manager
import { browserManager } from './services/BrowserManager';

browserManager.initBrowser().then(() => {
  console.log('Playwright Browser Manager initialized.');
}).catch((err: any) => {
  console.error('Failed to initialize Playwright:', err);
});

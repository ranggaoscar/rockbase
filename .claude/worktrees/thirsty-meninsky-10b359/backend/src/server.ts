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
const port = process.env.PORT || 3000;

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

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/proxies', proxyRoutes);
app.use('/api/warming', warmingRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize Workers
import './queue/postingWorker';
import './queue/analyticsWorker';

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

io.on('connection', (socket) => {
  console.log('Client connected to WebSocket:', socket.id);

  socket.on('join_farm', () => {
    farmService.startStreaming(socket);
  });

  socket.on('leave_farm', () => {
    farmService.stopStreaming(socket);
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

  socket.on('disconnect', () => {
    farmService.stopStreaming(socket);
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(port, () => {
  console.log(`SocialCommand backend running on port ${port}`);
  console.log(`Frontend expected at: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});

// Initialize Browser Manager
import { browserManager } from './services/BrowserManager';

browserManager.initBrowser().then(() => {
  console.log('Playwright Browser Manager initialized.');
}).catch((err: any) => {
  console.error('Failed to initialize Playwright:', err);
});

import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import express from 'express';
import multer from 'multer';
import { Server } from 'socket.io';

function atLeast(value: string, target: string) {
  const left = value.split('.').map(Number); const right = target.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i] > right[i]; }
  return true;
}

async function main() {
  const root = path.resolve(__dirname, '../../..');
  const required: Record<string, string> = { multer: '2.3.0', 'engine.io': '6.6.10', 'socket.io-parser': '4.2.7', ws: '8.21.0', vite: '6.4.3' };
  let versionChecks = 0;
  for (const sub of ['backend', 'frontend']) {
    const lock = JSON.parse(fs.readFileSync(path.join(root, sub, 'package-lock.json'), 'utf8'));
    for (const [packagePath, entry] of Object.entries(lock.packages) as [string, any][]) {
      for (const [name, minimum] of Object.entries(required)) {
        if (!packagePath.endsWith(`node_modules/${name}`)) continue;
        assert(atLeast(entry.version, minimum), `${sub}: ${name} below approved floor`);
        const installed = JSON.parse(fs.readFileSync(path.join(root, sub, packagePath, 'package.json'), 'utf8'));
        assert.equal(installed.version, entry.version, 'Lock and installed versions diverge'); versionChecks++;
      }
    }
  }
  assert(versionChecks >= 6);
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 1024 } });
  app.post('/fixture-upload', upload.single('file'), (req, res) => res.json({ size: req.file?.size, name: req.file?.originalname }));
  const server = http.createServer(app);
  const io = new Server(server);
  io.on('connection', (socket) => socket.on('fixture-ping', (ack) => ack('ok')));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const form = new FormData(); form.append('file', new Blob(['fixture']), 'fixture.txt');
    const response = await fetch(`${url}/fixture-upload`, { method: 'POST', body: form });
    assert.equal(response.status, 200); assert.equal((await response.json() as any).size, 7);
    const clientRequire = createRequire(path.join(root, 'frontend/package.json'));
    const { io: connect } = clientRequire('socket.io-client');
    for (const transports of [['polling', 'websocket'], ['websocket']]) {
      const socket = connect(url, { transports, reconnection: false, timeout: 3000 });
      try {
        await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
        const result = await new Promise((resolve, reject) => socket.timeout(3000).emit('fixture-ping', (error: unknown, value: unknown) => error ? reject(error) : resolve(value)));
        assert.equal(result, 'ok');
      } finally { socket.disconnect(); }
    }
  } finally {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log(`[SecurityDependencySmoke] PASS: ${versionChecks} installed/lock version floors, valid multipart upload, Socket.IO polling/WebSocket compatibility; no social queue or DB accessed.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

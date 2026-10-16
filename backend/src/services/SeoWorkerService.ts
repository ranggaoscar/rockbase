import { spawn, spawnSync, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

const moduleRoot = path.resolve(__dirname, '../../../modules/seo');
const databasePath = process.env.ROCKBASE_SEO_DB
  ? path.resolve(process.env.ROCKBASE_SEO_DB)
  : path.resolve(__dirname, '../../../rockbase-data/seo/seo.sqlite');
const serviceUrl = 'http://127.0.0.1:8765';
// Ephemeral IPC authentication, not a social/auth credential; never persisted or logged.
const token = randomBytes(32).toString('hex');
let processHandle: ChildProcess | undefined;
let starting: Promise<void> | undefined;

async function health(): Promise<boolean> {
  try {
    const response = await fetch(`${serviceUrl}/api/health`, {
      headers: { 'x-seo-token': token }, signal: AbortSignal.timeout(1500),
    });
    return response.ok && (await response.json() as { service?: string }).service === 'rockbase-seo';
  } catch { return false; }
}

async function ensureStarted(): Promise<void> {
  if (await health()) return;
  if (starting) return starting;
  starting = (async () => {
    if (processHandle && processHandle.exitCode === null && !processHandle.killed) {
      throw new Error('SEO worker is not responding. Existing process retained; no duplicate started.');
    }
    const python = path.join(moduleRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (!fs.existsSync(python)) throw new Error('SEO runtime missing. Run modules/seo/SETUP_SEO.bat once.');
    // A reserved port is never taken over or killed. The child will fail closed on conflict.
    processHandle = spawn(python, ['-m', 'seo_engine.api'], {
      cwd: moduleRoot, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
          ['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PLAYWRIGHT_BROWSERS_PATH'].includes(key.toUpperCase()))),
        ROCKBASE_SEO_DB: databasePath, ROCKBASE_SEO_TOKEN: token,
      },
    });
    let startupError = '';
    processHandle.on('error', (error) => { startupError = error.message; });
    processHandle.stderr?.on('data', (data: Buffer) => {
      // Only bounded service diagnostics, no inherited auth/header values.
      startupError = data.toString().slice(-1500);
    });
    for (let i = 0; i < 40; i++) {
      if (await health()) return;
      if (startupError.includes('EADDRINUSE') || (processHandle.exitCode !== null)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('SEO worker did not become ready. Verify Python setup and that local port 8765 is free.');
  })().finally(() => { starting = undefined; });
  return starting;
}

export async function seoRequest(resource: string, workspaceId: string, method = 'GET', body?: unknown): Promise<globalThis.Response> {
  await ensureStarted();
  return fetch(`${serviceUrl}/api${resource}`, {
    method, headers: { 'x-seo-token': token, 'x-workspace-id': workspaceId, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), signal: AbortSignal.timeout(30000),
  });
}

export function stopSeoWorker(): void {
  if (processHandle && processHandle.exitCode === null && processHandle.pid) {
    // Kill only our own SEO process tree, never publishing/browser processes.
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else processHandle.kill('SIGTERM');
  }
}

process.once('exit', stopSeoWorker);

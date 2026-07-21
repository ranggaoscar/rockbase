import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
const DOWNLOAD_TIMEOUT_MS = 60_000;
export type ResolvedReelMedia = { localPath: string; cleanup: () => Promise<void> };
function ensureReadableVideo(localPath: string): Promise<void> {
  return fs.promises.stat(localPath).then((stat) => {
    if (!stat.isFile() || stat.size === 0) throw new Error('REEL_MEDIA_NOT_FOUND: ' + localPath);
  }).catch((error) => {
    if (String(error?.message || '').startsWith('REEL_MEDIA_NOT_FOUND:')) throw error;
    throw new Error('REEL_MEDIA_NOT_FOUND: ' + localPath);
  });
}
async function downloadVideo(url: string, destination: string, redirects = 0): Promise<void> {
  if (redirects > 3) throw new Error('REEL_MEDIA_DOWNLOAD_FAILED: too many redirects');
  await new Promise<void>((resolve, reject) => {
    const parsed = new URL(url);
    const request = (parsed.protocol === 'http:' ? http : https).get(parsed, (response) => {
      if ((response.statusCode || 0) >= 300 && (response.statusCode || 0) < 400 && response.headers.location) {
        response.resume(); downloadVideo(new URL(response.headers.location, parsed).toString(), destination, redirects + 1).then(resolve, reject); return;
      }
      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        response.resume(); reject(new Error('REEL_MEDIA_DOWNLOAD_FAILED: HTTP ' + (response.statusCode || 0))); return;
      }
      const output = fs.createWriteStream(destination); response.pipe(output);
      output.on('finish', () => output.close(() => resolve())); output.on('error', reject);
    });
    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => request.destroy(new Error('REEL_MEDIA_DOWNLOAD_FAILED: timed out')));
    request.on('error', (error) => reject(new Error('REEL_MEDIA_DOWNLOAD_FAILED: ' + error.message)));
  });
}
export async function resolveReelMedia(source: string): Promise<ResolvedReelMedia> {
  let url: URL | undefined; try { url = new URL(source); } catch {}
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    const normalized = source.replace(/\\/g, '/'); const uploadsIndex = normalized.lastIndexOf('/uploads/');
    const localPath = uploadsIndex >= 0 ? path.join(process.cwd(), normalized.slice(uploadsIndex + 1)) : path.isAbsolute(source) ? source : path.join(process.cwd(), 'uploads', path.basename(source));
    await ensureReadableVideo(localPath); return { localPath, cleanup: async () => {} };
  }
  if (url.pathname.startsWith('/uploads/')) {
    const localPath = path.join(process.cwd(), url.pathname.replace(/^\//, ''));
    await ensureReadableVideo(localPath); return { localPath, cleanup: async () => {} };
  }
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rockbase-reel-'));
  const localPath = path.join(tempDir, 'media.mp4');
  try { await downloadVideo(source, localPath); await ensureReadableVideo(localPath); }
  catch (error) { await fs.promises.rm(tempDir, { recursive: true, force: true }); throw error; }
  return { localPath, cleanup: () => fs.promises.rm(tempDir, { recursive: true, force: true }) };
}

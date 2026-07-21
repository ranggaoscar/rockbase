import assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { resolveReelMedia } from '../services/ReelMediaResolver';
async function main() {
  const uploads = path.join(process.cwd(), 'uploads'); await fs.promises.mkdir(uploads, { recursive: true });
  const campaignMedia = path.join(uploads, 'campaign-media'); await fs.promises.mkdir(campaignMedia, { recursive: true });
  const mediaIdPath = path.join(uploads, 'registered-reel.mp4'); await fs.promises.writeFile(mediaIdPath, 'mp4');
  const fromMediaId = await resolveReelMedia('/uploads/registered-reel.mp4'); assert.strictEqual(fromMediaId.localPath, mediaIdPath);
  // Verify campaign-media subdirectory path is preserved (not stripped by path.basename)
  const campaignMediaPath = path.join(campaignMedia, 'campaign-reel.mp4'); await fs.promises.writeFile(campaignMediaPath, 'campaign-mp4');
  const fromCampaignMedia = await resolveReelMedia('/uploads/campaign-media/campaign-reel.mp4');
  assert.strictEqual(fromCampaignMedia.localPath, campaignMediaPath, 'campaign-media subdirectory must be preserved');
  const server = http.createServer((_req, res) => res.end('mp4')); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port; const remote = await resolveReelMedia('http://127.0.0.1:' + port + '/reel');
  assert.match(remote.localPath, /media\.mp4$/); assert.ok((await fs.promises.stat(remote.localPath)).size > 0);
  let publisherPath = ''; await (async (videoPath: string) => { publisherPath = videoPath; })(remote.localPath); assert.strictEqual(publisherPath, remote.localPath);
  await remote.cleanup(); await assert.rejects(fs.promises.stat(remote.localPath)); await new Promise<void>((resolve) => server.close(() => resolve()));
  await assert.rejects(resolveReelMedia('/uploads/missing-reel.mp4'), /REEL_MEDIA_NOT_FOUND/); await fs.promises.unlink(mediaIdPath);
  console.log('Reel media resolver targeted tests passed');
}
main().catch((error) => { console.error(error); process.exit(1); });

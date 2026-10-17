import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createTrendRouter, type TrendDependencies } from '../routes/trendRoutes';
import { TrendStore } from './trends/TrendStore';
import { buildRadar } from './trends/TrendEngine';
import { fetchIndonesiaFeed } from './trends/TrendsRss';
import { readTrendGscReports } from '../routes/gscRoutes';
import { seoRequest } from './SeoWorkerService';
import { getRockBaseMode } from '../middleware/runtimeMode';
import { onGscHistoryInvalidation } from './trends/GscHistoryPrivacy';

const prisma = new PrismaClient();
const root = path.resolve(__dirname, '../../..');
const scope = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 32);
const privateRoot = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local');
let store: TrendStore | undefined;
function getStore(): TrendStore {
  if (getRockBaseMode() !== 'local') throw new Error('Trend private storage disabled outside Local Mode');
  return store ??= new TrendStore(path.join(privateRoot, 'RockBase/installations', scope, 'trends.sqlite'));
}
export function trendDependencies(): TrendDependencies { return {
  store: getStore,
  workspaces: () => prisma.workspace.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
  brands: async workspace => {
    const response = await seoRequest('/brands', workspace);
    if (!response.ok) throw new Error('Website brand registry unavailable');
    const brands = (await response.json() as Array<{key: string; name: string; workspace_id: string}>).filter(b => b.workspace_id === workspace);
    // Owner-requested watchlist identities, not new SEO properties or fabricated social accounts.
    for (const name of ['Magrade', 'Brescia Stone', 'Global Stone']) {
      if (!brands.some(b => b.key.toLowerCase() === name.toLowerCase() || b.name.toLowerCase() === name.toLowerCase())) brands.push({key: name, name, workspace_id: workspace});
    }
    return brands;
  },
  gsc: readTrendGscReports,
  fetchFeed: () => fetchIndonesiaFeed(),
  buildRadar,
  drafts: prisma.draft,
}; }
export const trendRouter = createTrendRouter(trendDependencies());
// A disconnect may happen before /trends opens after a process restart.
// Open and purge persisted history in that case; live stores subscribe themselves.
const unsubscribeHistory = onGscHistoryInvalidation(() => { if (!store) getStore().clearGscHistory(); });
export function closeTrendRuntime() { unsubscribeHistory(); store?.close(); store = undefined; }
process.once('exit', closeTrendRuntime);

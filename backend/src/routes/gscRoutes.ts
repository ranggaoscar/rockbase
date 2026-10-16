import { Router } from 'express';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { AuthRequest } from '../middleware/auth';
import { noStore, isLocalOwner, requireLocalSecretOrigin } from '../middleware/secretAccess';
import { getRockBaseMode, isLoopbackAddress } from '../middleware/runtimeMode';
import { seoRequest } from '../services/SeoWorkerService';
import { WindowsCredentialVault } from '../services/gsc/WindowsCredentialVault';
import { GoogleDesktopOAuth, GscError } from '../services/gsc/GoogleDesktopOAuth';
import { GscAnalytics } from '../services/gsc/GscAnalytics';
import { GscConnection } from '../services/gsc/GscConnection';

interface Website { id: string | number; workspace_id: string; brand_key?: string | null; base_url: string; name: string }
interface RouteDependencies {
  oauth: Pick<GoogleDesktopOAuth, 'configure' | 'connect'> & {
    status: () => Promise<{ enabled: boolean; configured: boolean; connected: boolean; pending: boolean; storage: string; error?: string; setupRequired?: string; provider?: string }>;
    disconnect: () => Promise<{ disconnected: boolean; revoked: boolean; warning?: string }>;
    importServiceAccount?: (filename: unknown) => Promise<unknown>;
  };
  analytics: () => GscAnalytics;
  seo: typeof seoRequest;
  clearData: () => void;
}

export function propertyCoversWebsite(property: string, website: string): boolean {
  let base: URL;
  try { base = new URL(website); } catch { return false; }
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) return false;
  if (property.startsWith('sc-domain:')) {
    const domain = property.slice('sc-domain:'.length).toLowerCase();
    return /^[a-z0-9.-]+$/.test(domain) && (base.hostname === domain || base.hostname.endsWith('.' + domain));
  }
  try {
    const prefix = new URL(property);
    return !prefix.username && !prefix.password && prefix.origin === base.origin && base.href.startsWith(prefix.href);
  } catch { return false; }
}

/** All routes are Local Mode only, even when a Server Mode Admin JWT is valid. */
export function createGscRouter(deps: RouteDependencies): Router {
  const router = Router();
  router.use(noStore);
  router.get('/status', async (req: AuthRequest, res) => {
    if (getRockBaseMode() !== 'local') { res.json(await deps.oauth.status()); return; }
    requireLocalSecretOrigin(req, res, () => {
      if (!isLocalOwner(req)) { res.status(403).json({ error: 'GSC_LOCAL_OWNER_REQUIRED' }); return; }
      void deps.oauth.status().then((value) => res.json(value)).catch(() => res.status(503).json({ error: 'OS credential storage unavailable; run modules/seo/SETUP_SEO.bat. No plaintext fallback.' }));
    });
  });
  router.use((req: AuthRequest, res, next) => {
    if (getRockBaseMode() !== 'local') { res.status(409).json({ error: 'GSC_LOCAL_ONLY', message: 'Desktop Google connections are disabled in Server Mode.' }); return; }
    if (!isLocalOwner(req) || !isLoopbackAddress(req.socket.remoteAddress)) { res.status(403).json({ error: 'GSC_LOCAL_OWNER_REQUIRED' }); return; }
    requireLocalSecretOrigin(req, res, next);
  });
  const handle = (fn: (req: AuthRequest) => Promise<unknown>) => async (req: AuthRequest, res: any) => {
    try { res.json(await fn(req)); }
    catch (error) {
      if (error instanceof GscError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
      // Third-party bodies, token values, stack traces and SQL are never returned or logged.
      const safe = error instanceof Error && /already.*sync|sync.*progress/i.test(error.message);
      res.status(safe ? 409 : 503).json({ error: safe ? 'GSC_SYNC_BUSY' : 'GSC_UNAVAILABLE', message: safe ? 'A Search Console sync is already running. Retry shortly.' : 'Search Console operation unavailable. Check Google connection, property access and local setup; cached data retained.' });
    }
  };
  const site = async (req: AuthRequest): Promise<{ workspace: string; website: Website }> => {
    const workspace = req.method === 'GET' ? req.query.workspace_id : req.body?.workspace_id;
    const websiteId = req.method === 'GET' ? req.query.website_id : req.body?.website_id;
    if (typeof workspace !== 'string' || !workspace || workspace.length > 200 || typeof websiteId !== 'string' || !/^\d+$/.test(websiteId)) {
      throw new GscError('GSC_MAPPING_INVALID', 'Choose an existing website and workspace.', 422);
    }
    const response = await deps.seo('/websites', workspace);
    if (!response.ok) throw new GscError('GSC_WEBSITE_UNAVAILABLE', 'Existing SEO website registry is unavailable.', 503);
    const websites = await response.json() as Website[];
    const website = websites.find((s) => String(s.id) === websiteId && s.workspace_id === workspace);
    if (!website) throw new GscError('GSC_WEBSITE_NOT_FOUND', 'Website not found in this workspace.', 404);
    return { workspace, website };
  };
  router.post('/config', handle(async (req) => { await deps.oauth.configure(req.body); return { configured: true }; }));
  router.post('/service-account', handle(async (req) => {
    if (!deps.oauth.importServiceAccount) throw new GscError('GSC_PROVIDER_UNAVAILABLE', 'Service-account provider is not available.', 409);
    const result = await deps.oauth.importServiceAccount(req.body?.credential_path);
    deps.clearData();
    return result;
  }));
  router.post('/connect', handle(async () => {
    const pending = await deps.oauth.connect();
    deps.clearData(); // a newly consented account must never inherit an old account's cache
    return pending;
  }));
  router.post('/disconnect', handle(async () => {
    // Delete Google-derived cache/mappings as part of an explicit disconnect; never crawler data.
    deps.clearData(); // invalidate in-flight cache writes before waiting for remote revocation
    return deps.oauth.disconnect();
  }));
  router.use(async (_req, res, next) => {
    try {
      if (!(await deps.oauth.status()).connected) {
        res.status(409).json({ error: 'GSC_NOT_CONNECTED', message: 'Connect Google to access local Search Console data.' }); return;
      }
      next();
    } catch { res.status(503).json({ error: 'GSC_STORAGE_UNAVAILABLE', message: 'Secure local Google storage is unavailable.' }); }
  });
  router.get('/properties', handle(async () => deps.analytics().listProperties()));
  router.get('/mapping', handle(async (req) => { const s = await site(req); return deps.analytics().mapping(s.workspace, String(s.website.id)); }));
  router.post('/mapping', handle(async (req) => {
    const s = await site(req); const property = req.body?.property;
    if (typeof property !== 'string' || property.length > 2048 || !propertyCoversWebsite(property, s.website.base_url)) throw new GscError('GSC_PROPERTY_MISMATCH', 'Choose a permitted GSC property that covers the selected website.', 422);
    const properties = await deps.analytics().listProperties();
    if (!properties.some((p) => p.siteUrl === property && p.permissionLevel !== 'siteUnverifiedUser')) throw new GscError('GSC_PROPERTY_FORBIDDEN', 'Property is not available to the connected Google account.', 409);
    return deps.analytics().saveMapping(s.workspace, String(s.website.id), property, s.website.brand_key || null);
  }));
  const enrich = async (report: any, workspace: string, websiteId: string) => {
    if (!report) return null;
    report.crawlStatus = 'No completed crawler scan available; GSC data remains independent.';
    try {
      const scansResponse = await deps.seo(`/websites/${websiteId}/scans`, workspace);
      if (!scansResponse.ok) return report;
      const scans = await scansResponse.json() as any[];
      const scan = scans.find((s) => s.status === 'completed');
      if (!scan) { if (scans[0]?.status === 'failed') report.crawlStatus = 'Latest crawler scan failed. GSC does not prove crawl coverage or resolve crawler issues.'; return report; }
      const pagesResponse = await deps.seo(`/scans/${scan.id}/pages`, workspace);
      if (!pagesResponse.ok) return report;
      const pages = await pagesResponse.json() as any[];
      const issuesResponse = await deps.seo(`/scans/${scan.id}/issues`, workspace);
      const issues = issuesResponse.ok ? await issuesResponse.json() as any[] : null;
      // Exact final/request URL matches only; never merge HTTP/HTTPS, query strings or slash variants.
      report.pagePerformance = report.pagePerformance.map((p: any) => {
        const page = pages.find((x) => x.url === p.page || x.final_url === p.page);
        return { ...p, crawl: page ? { scan_id: scan.id, status_code: page.status_code, title: page.title, indexable: page.indexable,
          issues: issues ? issues.filter((i) => i.url === page.url || i.url === page.final_url).length : undefined } : { note: 'Not observed in the latest completed crawl.' } };
      });
      report.crawlStatus = `Joined exact URLs against completed crawl ${scan.id}; GSC canonical aggregation may differ.`;
    } catch { /* retain truthful independent Google data when crawler unavailable */ }
    return report;
  };
  router.get('/report', handle(async (req) => {
    const s = await site(req);
    const days = req.query.days === undefined ? undefined : Number(req.query.days);
    if (days !== undefined && days !== 7 && days !== 28) throw new GscError('GSC_PERIOD_INVALID', 'Choose 7 or 28 days.', 422);
    return enrich(deps.analytics().report(s.workspace, String(s.website.id), days as 7 | 28 | undefined), s.workspace, String(s.website.id));
  }));
  router.post('/sync', handle(async (req) => {
    const s = await site(req);
    if (![7, 28].includes(req.body?.days) || (req.body.force !== undefined && typeof req.body.force !== 'boolean')) throw new GscError('GSC_PERIOD_INVALID', 'Choose 7 or 28 days.', 422);
    return enrich(await deps.analytics().sync(s.workspace, String(s.website.id), req.body.days, req.body.force === true), s.workspace, String(s.website.id));
  }));
  return router;
}

const installationRoot = path.resolve(__dirname, '../../..');
const oauth = new GscConnection(new WindowsCredentialVault(installationRoot), installationRoot);
let analytics: GscAnalytics | undefined;
// Windows vaults are per-user. Keep derived-data caches per-user too, so two
// Windows operators using one checkout cannot inherit each other's analytics.
const installScope = createHash('sha256').update(installationRoot.toLowerCase()).digest('hex').slice(0, 32);
const privateRoot = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local');
const database = path.join(privateRoot, 'RockBase/installations', installScope, 'gsc.sqlite');
const getAnalytics = () => {
  if (getRockBaseMode() !== 'local') throw new GscError('GSC_LOCAL_ONLY', 'Local Google storage is disabled in Server Mode.', 409);
  return analytics ??= new GscAnalytics(database, (resource, body) => oauth.google(resource, body));
};
const router = createGscRouter({ oauth, analytics: getAnalytics, seo: seoRequest, clearData: () => { if (analytics) analytics.disconnect(); else getAnalytics().disconnect(); } });
process.once('exit', () => { oauth.close(); analytics?.close(); });
export default router;

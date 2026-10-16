import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { GoogleRequest, GscPeriod, GscProperty, GscReport, MetricRow } from './types';
import { GscError } from './GoogleDesktopOAuth';

const ROW_LIMIT = 25000;
const MAX_PAGES = 2;
const CACHE_MS = 6 * 60 * 60 * 1000;
const REQUEST_CAP = 14;

type Mapping = { workspaceId: string; websiteId: string; property: string; brandKey: string | null; updatedAt: string };
type CachedReport = { savedAt: number; report: GscReport };

function utcDate(date: Date): string { return date.toISOString().slice(0, 10); }
function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDate(date);
}
function localEndDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function period(endDate: string, days: number): GscPeriod {
  return { startDate: shiftDate(endDate, -(days - 1)), endDate };
}
function normalizedRow(row: any): MetricRow {
  if (!row || !['clicks', 'impressions', 'position'].every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0)) {
    throw new GscError('GSC_RESPONSE_INVALID', 'Google returned invalid metrics; the previous report was retained.');
  }
  const clicks = Number(row?.clicks);
  const impressions = Number(row?.impressions);
  const position = Number(row?.position);
  const safeClicks = Number.isFinite(clicks) ? clicks : 0;
  const safeImpressions = Number.isFinite(impressions) ? impressions : 0;
  return {
    ...(Array.isArray(row?.keys) ? { keys: row.keys.map(String) } : {}),
    clicks: safeClicks,
    impressions: safeImpressions,
    ctr: safeImpressions > 0 ? safeClicks / safeImpressions : 0,
    position: Number.isFinite(position) ? position : 0,
  };
}
function quotaError(error: any): Error {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  if (status === 403 || status === 429) return new Error(status === 429 ? 'Google Search Console quota exceeded (429).' : 'Google Search Console access or quota denied (403).');
  return error instanceof Error ? error : new Error('Google Search Console request failed.');
}

export class GscAnalytics {
  private db: Database.Database;
  private inflight = new Map<string, Promise<GscReport>>();
  private closed = false;
  private revision = 0;

  constructor(databasePath: string, private google: GoogleRequest) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('secure_delete = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gsc_mappings (
        workspace_id TEXT NOT NULL, website_id TEXT NOT NULL, property TEXT NOT NULL,
        brand_key TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, website_id)
      );
      CREATE TABLE IF NOT EXISTS gsc_reports (
        workspace_id TEXT NOT NULL, website_id TEXT NOT NULL, days INTEGER NOT NULL,
        saved_at INTEGER NOT NULL, report_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, website_id, days)
      );
    `);
  }

  async listProperties(): Promise<GscProperty[]> {
    const response = await this.google('/sites');
    const sites = Array.isArray(response?.siteEntry) ? response.siteEntry : [];
    return sites.filter((site: any) => typeof site?.siteUrl === 'string' && ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(site.permissionLevel)).map((site: any) => ({
      siteUrl: site.siteUrl, permissionLevel: String(site.permissionLevel ?? ''),
    }));
  }

  mapping(workspaceId: string, websiteId: string): Mapping | null {
    const row = this.db.prepare('SELECT workspace_id, website_id, property, brand_key, updated_at FROM gsc_mappings WHERE workspace_id=? AND website_id=?').get(workspaceId, websiteId) as any;
    return row ? { workspaceId: row.workspace_id, websiteId: row.website_id, property: row.property, brandKey: row.brand_key, updatedAt: row.updated_at } : null;
  }

  saveMapping(workspaceId: string, websiteId: string, property: string, brandKey: string | null): Mapping {
    this.revision++;
    const updatedAt = new Date().toISOString();
    const prior = this.mapping(workspaceId, websiteId);
    if (prior?.property !== property || prior.brandKey !== brandKey) {
      this.db.prepare('DELETE FROM gsc_reports WHERE workspace_id=? AND website_id=?').run(workspaceId, websiteId);
    }
    this.db.prepare(`INSERT INTO gsc_mappings (workspace_id, website_id, property, brand_key, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(workspace_id, website_id) DO UPDATE SET property=excluded.property, brand_key=excluded.brand_key, updated_at=excluded.updated_at`)
      .run(workspaceId, websiteId, property, brandKey, updatedAt);
    return { workspaceId, websiteId, property, brandKey, updatedAt };
  }

  disconnect(): void {
    this.revision++;
    const transaction = this.db.transaction(() => {
      this.db.exec('DELETE FROM gsc_mappings; DELETE FROM gsc_reports;');
    });
    transaction();
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  async sync(workspaceId: string, websiteId: string, days: 7 | 28, force = false): Promise<GscReport> {
    if (days !== 7 && days !== 28) throw new Error('GSC sync period must be 7 or 28 days.');
    const map = this.mapping(workspaceId, websiteId);
    if (!map) throw new Error('GSC property is not mapped for this website.');
    const cacheKey = `${workspaceId}\0${websiteId}\0${days}`;
    const cached = this.readCached(workspaceId, websiteId, days);
    if (!force && cached && Date.now() - cached.savedAt < CACHE_MS) return cached.report;
    const active = this.inflight.get(cacheKey);
    if (active) return active;
    if (this.inflight.size) throw new GscError('GSC_SYNC_BUSY', 'A Search Console sync is already running.', 409);
    const revision = this.revision;
    const task = this.fetchReport(workspaceId, websiteId, map, days, revision).finally(() => this.inflight.delete(cacheKey));
    this.inflight.set(cacheKey, task);
    return task;
  }

  report(workspaceId: string, websiteId: string, days?: 7 | 28): GscReport | null {
    const rows = (days
      ? this.db.prepare('SELECT report_json FROM gsc_reports WHERE workspace_id=? AND website_id=? AND days=? ORDER BY saved_at DESC').all(workspaceId, websiteId, days)
      : this.db.prepare('SELECT report_json FROM gsc_reports WHERE workspace_id=? AND website_id=? ORDER BY saved_at DESC').all(workspaceId, websiteId)) as Array<{ report_json: string }>;
    if (!rows.length) return null;
    try { return JSON.parse(rows[0].report_json) as GscReport; } catch { return null; }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.revision++;
    this.db.close();
  }

  private readCached(workspaceId: string, websiteId: string, days: number): CachedReport | null {
    const row = this.db.prepare('SELECT saved_at, report_json FROM gsc_reports WHERE workspace_id=? AND website_id=? AND days=?').get(workspaceId, websiteId, days) as any;
    if (!row) return null;
    try { return { savedAt: row.saved_at, report: JSON.parse(row.report_json) as GscReport }; } catch { return null; }
  }

  private async query(property: string, params: Record<string, unknown>, count: { value: number; valid?: () => void }): Promise<any> {
    count.valid?.();
    if (count.value >= REQUEST_CAP) throw new Error('GSC request safety cap reached; no report was saved.');
    count.value += 1;
    const endpoint = `/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
    try { return await this.google(endpoint, params); } catch (error) { if (error instanceof GscError) throw error; throw quotaError(error); }
  }

  private async fetchRows(property: string, startDate: string, endDate: string, dimensions: string[], requestCount: { value: number }, aggregationType?: string): Promise<{ rows: MetricRow[]; truncated: boolean }> {
    const rows: MetricRow[] = [];
    let truncated = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.query(property, {
        startDate, endDate, dimensions, rowLimit: ROW_LIMIT, startRow: page * ROW_LIMIT,
        dataState: 'final', type: 'web', aggregationType: aggregationType || 'auto',
      }, requestCount);
      const returned = Array.isArray(response?.rows) ? response.rows : [];
      rows.push(...returned.map(normalizedRow));
      if (returned.length < ROW_LIMIT) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
    return { rows, truncated };
  }

  private async total(property: string, dateRange: GscPeriod, requestCount: { value: number }): Promise<MetricRow | null> {
    const response = await this.query(property, {
      startDate: dateRange.startDate, endDate: dateRange.endDate, dimensions: [], rowLimit: 1,
      dataState: 'final', type: 'web', aggregationType: 'byProperty',
    }, requestCount);
    return Array.isArray(response?.rows) && response.rows.length ? normalizedRow(response.rows[0]) : null;
  }

  private async fetchReport(workspaceId: string, websiteId: string, map: Mapping, days: 7 | 28, revision: number): Promise<GscReport> {
    const endDate = shiftDate(localEndDate(), -3);
    const current = period(endDate, days);
    const previous = period(shiftDate(current.startDate, -1), days);
    const valid = () => {
      if (this.closed || revision !== this.revision) throw new GscError('GSC_SYNC_CANCELLED', 'Connection or mapping changed. Stale sync discarded.', 409);
    };
    const count = { value: 0, valid };
    // Sequential calls stop immediately on quota/revocation/disconnect; no queued fan-out.
    const currentTotal = await this.total(map.property, current, count); valid();
    const previousTotal = await this.total(map.property, previous, count); valid();
    const dates = await this.fetchRows(map.property, current.startDate, current.endDate, ['date'], count); valid();
    const pageRows = await this.fetchRows(map.property, current.startDate, current.endDate, ['page'], count); valid();
    const queryRows = await this.fetchRows(map.property, current.startDate, current.endDate, ['query'], count); valid();
    const previousPages = await this.fetchRows(map.property, previous.startDate, previous.endDate, ['page'], count); valid();
    const previousQueries = await this.fetchRows(map.property, previous.startDate, previous.endDate, ['query'], count); valid();
    const previousByPage = new Map(previousPages.rows.map((row) => [row.keys?.[0] ?? '', row]));
    const pagePerformance = pageRows.rows.map((row) => {
      const page = row.keys?.[0] ?? '';
      const old = previousByPage.get(page) ?? null;
      return { ...row, page, previous: old, clickDelta: old ? row.clicks - old.clicks : null };
    });
    const previousByQuery = new Map(previousQueries.rows.map((row) => [row.keys?.[0] ?? '', row]));
    const keywordOpportunities = queryRows.rows.map((row) => {
      const query = row.keys?.[0] ?? '';
      const previous = previousByQuery.get(query) || null;
      const positionOk = row.position >= 4 && row.position <= 20;
      if (!query || !positionOk || row.impressions < 8) return null;
      const confidence: 'established' | 'low_volume' = row.impressions >= 50 ? 'established' : 'low_volume';
      const reason = confidence === 'established'
        ? 'At least 50 impressions and average position 4–20; a review candidate, not guaranteed clicks or ranking improvement.'
        : `Low-volume niche candidate: ${row.impressions} impressions (below 50) at average position ${row.position.toFixed(1)}. Observed only; not a forecast or score.`;
      return { ...row, query, previous, confidence, reason };
    }).filter((row): row is NonNullable<typeof row> => row !== null);
    const ctrOpportunities = pageRows.rows.filter((row) => row.impressions >= 100 && row.position >= 1 && row.position <= 10 && row.ctr < 0.03)
      .map((row) => ({ ...row, page: row.keys?.[0] ?? '', reason: `CTR below 3% (${(row.ctr * 100).toFixed(2)}%) with ${row.impressions} impressions; heuristic only, not a forecast.` }));
    const report: GscReport = {
      mapping: map, periods: { current, previous }, totals: { current: currentTotal, previous: previousTotal },
      dates: dates.rows,
      freshness: { timeZone: 'America/Los_Angeles', dataState: 'final', lastReturnedDate: dates.rows.map((r) => r.keys?.[0] || '').sort().at(-1) || null, searchType: 'web' },
      pagePerformance,
      keywordOpportunities,
      queryPerformance: queryRows.rows.map((row) => ({ ...row, query: row.keys?.[0] ?? '', previous: previousByQuery.get(row.keys?.[0] ?? '') || null })),
      ctrOpportunities,
      coverage: {
        dates: { rowCount: dates.rows.length, truncated: dates.truncated, complete: false, rowLimit: ROW_LIMIT, maxPages: MAX_PAGES },
        pagePerformance: { rowCount: pageRows.rows.length, truncated: pageRows.truncated, complete: false, rowLimit: ROW_LIMIT, maxPages: MAX_PAGES },
        keywordOpportunities: { rowCount: queryRows.rows.length, truncated: queryRows.truncated, complete: false, rowLimit: ROW_LIMIT, maxPages: MAX_PAGES },
      },
      syncedAt: new Date().toISOString(),
      limitations: [
        'Search Console data is delayed; the requested windows end three days before today in America/Los_Angeles. Returned last date is not asserted to be the latest available.',
        'Each dimension request is bounded to 50,000 top rows per selected window (25,000 per page, two pages). This is not a complete daily extraction. Google also caps Search Analytics at 50,000 rows per day/search type; pagination never proves complete coverage.',
        'Property totals are fetched with byProperty aggregation; query/page rows are not summed into totals. Position is the API value; CTR is clicks divided by impressions.',
        'Keyword and CTR opportunities are deterministic heuristics, not forecasts. Missing API rows remain missing, not zero.',
        'GSC omits anonymized queries and can drop detail when grouping by page/query. Page metrics use canonical URLs and may differ from property totals; detail rows must not be added to reconstruct totals.',
      ],
    };
    const save = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO gsc_reports (workspace_id, website_id, days, saved_at, report_json) VALUES (?,?,?,?,?)
        ON CONFLICT(workspace_id, website_id, days) DO UPDATE SET saved_at=excluded.saved_at, report_json=excluded.report_json`)
        .run(workspaceId, websiteId, days, Date.now(), JSON.stringify(report));
    });
    valid(); save();
    return report;
  }
}

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GscAnalytics } from '../services/gsc/GscAnalytics';
import { MetricRow } from '../services/gsc/types';
import { GscError } from '../services/gsc/GoogleDesktopOAuth';

type Request = { path: string; body?: any };

function metric(keys: string[], clicks: number, impressions: number, position: number): MetricRow {
  return { keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

function fixtureGoogle(requests: Request[], overrides: Record<string, any[]> = {}) {
  const end = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(end);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const lagged = new Date(`${today}T00:00:00Z`); lagged.setUTCDate(lagged.getUTCDate() - 3);
  const start = new Date(lagged); start.setUTCDate(start.getUTCDate() - 6);
  const periodStart = start.toISOString().slice(0, 10);
  return async (url: string, body?: unknown): Promise<any> => {
    requests.push({ path: url, body });
    if (url === '/sites') return { siteEntry: [{ siteUrl: 'https://example.test/', permissionLevel: 'siteOwner' }] };
    const params = body as any;
    const dimensions = (params?.dimensions ?? []).join(',');
    const key = `${params?.startDate || ''}:${dimensions}:${params?.startRow ?? 0}`;
    if (overrides[key]) return { rows: overrides[key] };
    if (dimensions === 'date') return { rows: [metric(['2026-01-01'], 1, 10, 2)] };
    if (dimensions === 'page') return { rows: [metric(['https://example.test/a'], 2, 100, 3)] };
    if (dimensions === 'query' && params?.startDate !== periodStart) return { rows: [metric(['stone'], 1, 60, 9)] };
    if (dimensions === 'query') return { rows: [metric(['stone'], 5, 100, 8), metric(['gudang marmer'], 0, 13, 9.5), metric(['tiny'], 0, 3, 6), metric(['page one'], 1, 80, 2)] };
    return { rows: [metric([], 10, 200, 4)] };
  };
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gsc-analytics-'));
  const db = path.join(root, 'gsc.sqlite');
  const requests: Request[] = [];
  const analytics = new GscAnalytics(db, fixtureGoogle(requests));
  try {
    assert.deepEqual(await analytics.listProperties(), [{ siteUrl: 'https://example.test/', permissionLevel: 'siteOwner' }]);
    analytics.saveMapping('ws-a', 'web-a', 'https://example.test/', 'brand-a');
    analytics.saveMapping('ws-b', 'web-b', 'https://other.test/', null);
    assert.equal(analytics.mapping('ws-a', 'web-a')?.property, 'https://example.test/');
    assert.equal(analytics.mapping('ws-a', 'web-b'), null);

    const report = await analytics.sync('ws-a', 'web-a', 7);
    assert.ok(report.totals.current);
    assert.ok(report.pagePerformance[0]?.previous);
    assert.equal(report.totals.current.clicks, 10);
    assert.equal(report.totals.current.ctr, 0.05);
    const previousEnd = new Date(`${report.periods.previous.endDate}T00:00:00Z`);
    previousEnd.setUTCDate(previousEnd.getUTCDate() + 1);
    assert.equal(previousEnd.toISOString().slice(0, 10), report.periods.current.startDate);
    assert.equal(report.dates[0]?.keys?.[0], '2026-01-01');
    assert.equal(report.pagePerformance[0].previous.clicks, 2);
    const opportunities = report.keywordOpportunities;
    assert.deepEqual(opportunities.map((row) => [row.query, row.confidence]), [['stone', 'established'], ['gudang marmer', 'low_volume']]);
    assert.equal(opportunities.find((row) => row.query === 'gudang marmer')?.previous, null);
    assert.equal(opportunities.find((row) => row.query === 'stone')?.previous?.clicks, 1);
    const seven = report.periods;
    const twentyEight = await analytics.sync('ws-a', 'web-a', 28);
    assert.notEqual(twentyEight.periods.current.startDate, seven.current.startDate);
    assert.equal(analytics.report('ws-a', 'web-a', 7)?.periods.current.startDate, seven.current.startDate);
    const inclusive = (start: string, end: string) => (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
    for (const window of [seven, twentyEight.periods]) {
      assert.equal(inclusive(window.current.startDate, window.current.endDate), inclusive(window.previous.startDate, window.previous.endDate));
      assert.ok(window.previous.endDate < window.current.startDate);
    }
    assert.ok(report.coverage && report.limitations.length > 0);
    const count = requests.length;
    await analytics.sync('ws-a', 'web-a', 7);
    assert.equal(requests.length, count, 'successful sync is cached');
    analytics.saveMapping('ws-a', 'web-a', 'https://new.example.test/', 'brand-a');
    assert.equal(analytics.report('ws-a', 'web-a'), null, 'remapping must discard the previous property report');
    for (const request of requests.filter((r) => r.path !== '/sites')) {
      assert.equal(request.body.dataState, 'final'); assert.equal(request.body.type, 'web');
      if (!request.body.dimensions.length) assert.equal(request.body.aggregationType, 'byProperty');
      if (request.body.dimensions.includes('page')) assert.equal(request.body.aggregationType, 'auto');
    }

    const paginationRequests: Request[] = [];
    const pages = Array.from({ length: 25000 }, (_, i) => metric([`https://example.test/${i}`], i, 100, 1));
    const paged = new GscAnalytics(path.join(root, 'paged.sqlite'), fixtureGoogle(paginationRequests, {
      '2026-10-07:page:0': pages,
      '2026-10-07:page:25000': Array.from({ length: 25000 }, (_, i) => metric([`https://example.test/next-${i}`], 1, 1, 1)),
    }));
    try {
      paged.saveMapping('ws', 'site', 'https://example.test/', null);
      const result = await paged.sync('ws', 'site', 7);
      assert.ok(result.coverage.pagePerformance.truncated);
      assert.equal(result.coverage.pagePerformance.rowLimit, 25000);
      assert.ok(paginationRequests.filter((request) => (request.body as any)?.dimensions?.[0] === 'page').length <= 4);
      assert.equal(result.coverage.pagePerformance.complete, false);
    } finally { paged.close(); }

    const missingRequests: Request[] = [];
    const noData = new GscAnalytics(path.join(root, 'missing.sqlite'), async (url, body) => {
      missingRequests.push({ path: url, body });
      if (url === '/sites') return { siteEntry: [] };
      return {};
    });
    try {
      noData.saveMapping('ws', 'site', 'https://missing.test/', null);
      const empty = await noData.sync('ws', 'site', 28);
      assert.equal(empty.totals.current, null);
      assert.equal(empty.dates.length, 0);
    } finally { noData.close(); }

    const failure = new GscAnalytics(path.join(root, 'failure.sqlite'), async () => {
      const error: any = new Error('quota'); error.status = 429; throw error;
    });
    try {
      failure.saveMapping('ws', 'site', 'https://quota.test/', null);
      await assert.rejects(failure.sync('ws', 'site', 7), /quota/i);
      assert.equal(failure.report('ws', 'site'), null, 'failed sync does not persist a partial report');
    } finally { failure.close(); }
    for (const action of ['disconnect', 'remap'] as const) {
      let unblock!: () => void; let entered!: () => void;
      const started = new Promise<void>((r) => { entered = r; });
      const gate = new Promise<void>((r) => { unblock = r; });
      const race = new GscAnalytics(path.join(root, `${action}.sqlite`), async () => {
        entered(); await gate; return { rows: [metric([], 1, 20, 4)] };
      });
      try {
        race.saveMapping('ws', 'site', 'https://example.test/', null);
        const pending = race.sync('ws', 'site', 7);
        await started;
        if (action === 'disconnect') race.disconnect();
        else race.saveMapping('ws', 'site', 'https://other.test/', null);
        unblock();
        await assert.rejects(pending, (e: any) => e instanceof GscError && e.code === 'GSC_SYNC_CANCELLED');
        assert.equal(race.report('ws', 'site'), null, 'in-flight sync must not restore disconnected or remapped data');
      } finally { race.close(); }
    }
    let failedCalls = 0;
    const quota = new GscAnalytics(path.join(root, 'quota.sqlite'), async () => { failedCalls++; throw new GscError('GSC_QUOTA', 'Wait for quota reset.', 429); });
    try {
      quota.saveMapping('ws', 'site', 'https://example.test/', null);
      await assert.rejects(quota.sync('ws', 'site', 7), (e: any) => e.code === 'GSC_QUOTA');
      assert.equal(failedCalls, 1, 'quota must halt before other dimensions are requested');
    } finally { quota.close(); }
    console.log('gsc-analytics-test: PASS (mapping, periods/math, cache, pagination cap, no-data, atomicity, disconnect/remap races, quota stop)');
  } finally {
    analytics.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

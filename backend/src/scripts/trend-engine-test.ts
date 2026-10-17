import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BrandWatch, FeedSnapshot, TrendItem } from '../services/trends/types';
import { TrendStore } from '../services/trends/TrendStore';
import { buildRadar, normalizePhrase, parseTrafficLowerBound } from '../services/trends/TrendEngine';
import { fetchIndonesiaFeed, TRENDS_ID_RSS_URL } from '../services/trends/TrendsRss';

const root = path.resolve(__dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'trend-engine-'));
const watch: BrandWatch = { brandKey: 'global-stone', brandName: 'Global Stone', topics: ['natural stone', 'marble', 'granite'], exclude: ['marble cake'], updatedAt: '2026-10-17T00:00:00.000Z' };
function item(topic: string, trafficText: string, publishedAt = '2026-10-17T00:00:00.000Z', news: TrendItem['news'] = []): TrendItem {
  return { topic, publishedAt, trafficText, trafficLowerBound: parseTrafficLowerBound(trafficText), sourceUrl: TRENDS_ID_RSS_URL, news };
}
function snapshot(id: string, fetchedAt: string, items: TrendItem[], status: 'ok' | 'unavailable' = 'ok'): FeedSnapshot {
  return { id, fetchedAt, sourceUrl: TRENDS_ID_RSS_URL, status, httpStatus: status === 'ok' ? 200 : null, error: status === 'ok' ? null : 'offline', items };
}
async function test(name: string, fn: () => void | Promise<void>) { await fn(); console.log(`PASS ${name}`); }

async function main() {
  await test('normalizes unicode phrases and preserves phrase boundaries', () => {
    assert.equal(normalizePhrase('  GLOBÁL   Stone '), 'globál stone');
    const r = buildRadar(watch, [snapshot('one', '2026-10-17T00:00:00Z', [item('marble cake recipe', '100+')])], [], 'disconnected');
    assert.equal(r.candidates.some(c => c.classification === 'trend_observation'), false, 'excluded phrase suppresses accidental match');
    const boundary = buildRadar({ ...watch, topics: ['mar'] }, [snapshot('two', '2026-10-17T00:00:00Z', [item('market news', '100+')])], [], 'disconnected');
    assert.equal(boundary.candidates.some(c => c.classification === 'trend_observation'), false, 'short brand phrase must not match a word prefix');
  });

  await test('first RSS observation remains observation and emits three deterministic original briefs', () => {
    const s = snapshot('first', '2026-10-17T00:00:00Z', [item('Natural Stone Indonesia', '100+')]);
    const a = buildRadar(watch, [s], [], 'disconnected');
    const b = buildRadar(watch, [s], [], 'disconnected');
    assert.equal(a.candidates[0]?.classification, 'trend_observation');
    assert.equal(a.candidates[0]?.momentum.measured, false);
    assert.equal(a.recommendations.length, 3);
    assert.deepEqual(a.recommendations.map(x => x.format), ['article', 'reel', 'social_post']);
    assert.deepEqual(a.recommendations.map(x => x.id), b.recommendations.map(x => x.id));
    assert.ok(a.recommendations.every(x => x.title && x.content && x.reason && x.evidence.length));
  });

  await test('only same topic and publication cycle with 15-minute positive bucket movement is rising', () => {
    const older = snapshot('old', '2026-10-17T00:00:00Z', [item('Natural Stone Indonesia', '100+', '2026-10-17T00:00:00Z')]);
    const newer = snapshot('new', '2026-10-17T00:15:00Z', [item('Natural Stone Indonesia', '200+', '2026-10-17T00:00:00Z')]);
    const c = buildRadar(watch, [newer, older], [], 'disconnected').candidates[0];
    assert.equal(c.classification, 'rising_trend');
    assert.deepEqual([c.momentum.previous, c.momentum.current, c.momentum.delta, c.momentum.measured], [100, 200, 100, true]);
    assert.match(c.momentum.caveat, /approximate bucket/i);
    const changedCycle = buildRadar(watch, [newer, snapshot('oldcycle', '2026-10-17T00:00:00Z', [item('Natural Stone Indonesia', '100+', '2026-10-16T23:59:00Z')])], [], 'disconnected').candidates[0];
    assert.equal(changedCycle.classification, 'trend_observation');
  });

  await test('GSC opportunity stays labeled and carries actual cached report provenance', () => {
    const report = { mapping: { property: 'sc-domain:example.id' }, periods: { current: { startDate: '2026-10-01', endDate: '2026-10-14' }, previous: { startDate: '2026-09-16', endDate: '2026-09-29' } }, totals: { current: null, previous: null }, dates: [], freshness: { timeZone: 'Asia/Jakarta', dataState: 'fresh', lastReturnedDate: '2026-10-14', searchType: 'web' }, pagePerformance: [], keywordOpportunities: [{ query: 'granite indonesia', clicks: 4, impressions: 220, ctr: 0.018, position: 8, reason: 'impressions', confidence: 'low_volume' as const, previous: null }], queryPerformance: [], ctrOpportunities: [], coverage: { dates: { rowCount: 0, truncated: false, complete: false as const, rowLimit: 1, maxPages: 1 }, pagePerformance: { rowCount: 0, truncated: false, complete: false as const, rowLimit: 1, maxPages: 1 }, keywordOpportunities: { rowCount: 1, truncated: false, complete: false as const, rowLimit: 1, maxPages: 1 } }, syncedAt: '2026-10-17T00:00:00Z', limitations: ['cached'] };
    const radar = buildRadar(watch, [], [{ websiteId: 'w1', websiteName: 'Global Stone', brandKey: 'global-stone', report }], 'connected');
    const c = radar.candidates.find(x => x.classification === 'gsc_opportunity');
    assert.ok(c);
    assert.ok(JSON.stringify(c.evidence).includes('low_volume'));
    assert.ok(JSON.stringify(c.evidence).includes('2026-10-01'));
    assert.equal(c.momentum.measured, false);
  });

  await test('private SQLite scopes watchlists and appends immutable bounded idempotent snapshots', () => {
    const db = path.join(tmp, 'private.sqlite');
    const store = new TrendStore(db);
    store.saveWatchlist('workspace-a', watch);
    assert.equal(store.watchlists('workspace-b').length, 0);
    assert.equal(store.watchlists('workspace-a')[0].brandKey, watch.brandKey);
    const one = snapshot('same', '2026-10-17T00:00:00Z', [item('Natural Stone', '100+')]);
    store.saveSnapshot(one);
    store.saveSnapshot({ ...one, items: [item('tampered', '900+') ] });
    assert.equal(store.snapshots()[0].items[0].topic, 'Natural Stone');
    assert.equal(store.snapshots(500).length, 1);
    for (let i = 0; i < 100; i++) store.saveSnapshot(snapshot(`id-${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), []));
    assert.equal(store.snapshots(500).length, 96);
    store.close();
  });

  await test('Python defusedxml parser handles namespace feed and rejects malformed and entity XML', () => {
    const py = path.join(root, 'modules/seo/.venv/Scripts/python.exe');
    const parser = path.join(__dirname, '../services/trends/parse_trends_rss.py');
    const xml = '<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss"><channel><item><title>Marble stone</title><ht:approx_traffic>100+</ht:approx_traffic><pubDate>Fri, 16 Oct 2026 23:30:00 -0700</pubDate><ht:news_item><ht:news_item_title>News headline</ht:news_item_title><ht:news_item_url>https://news.example/a</ht:news_item_url><ht:news_item_source>Publisher</ht:news_item_source></ht:news_item></item><item><title>Granite</title></item></channel></rss>';
    const good = spawnSync(py, [parser], { input: xml, encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    const parsed = JSON.parse(good.stdout);
    assert.equal(parsed.items[0].trafficText, '100+');
    assert.equal(parsed.items[0].trafficLowerBound, 100);
    assert.equal(parsed.items[1].trafficLowerBound, null);
    assert.equal(parsed.items[0].news[0].source, 'Publisher');
    for (const unsafe of ['<rss><channel>', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///C:/Windows/win.ini">]><rss><channel><item><title>&e;</title></item></channel></rss>']) {
      const bad = spawnSync(py, [parser], { input: unsafe, encoding: 'utf8' });
      assert.notEqual(bad.status, 0);
    }
  });

  await test('RSS adapter uses fixed URL, bounded response and retains unavailable outcome', async () => {
    const good = await fetchIndonesiaFeed({ now: () => new Date('2026-10-17T00:00:00Z'), fetch: async (url, init) => {
      assert.equal(String(url), TRENDS_ID_RSS_URL);
      assert.equal(init?.redirect, 'error');
      return new Response('<rss xmlns:ht="https://trends.google.com/trending/rss"><channel><item><title>Granite</title><ht:approx_traffic>100+</ht:approx_traffic></item></channel></rss>', { status: 200 });
    } });
    assert.equal(good.status, 'ok');
    assert.equal(good.items[0].topic, 'Granite');
    const failed = await fetchIndonesiaFeed({ now: () => new Date('2026-10-17T00:00:00Z'), fetch: async () => { throw new Error('timeout'); } });
    assert.equal(failed.status, 'unavailable');
    assert.deepEqual(failed.items, []);
    assert.equal(failed.error, 'timeout');
  });
  console.log('All Trend Radar engine/store tests passed.');
}
main().finally(() => fs.rmSync(tmp, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });

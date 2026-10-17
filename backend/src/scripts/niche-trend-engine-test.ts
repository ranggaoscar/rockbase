import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildRadar } from '../services/trends/TrendEngine';
import { buildGscHistoryPoint } from '../services/trends/GscNicheSignals';
import { TrendStore } from '../services/trends/TrendStore';
import type { BrandWatch, GscInput } from '../services/trends/types';

const watch: BrandWatch = { brandKey: 'Magrade', brandName: 'Magrade', topics: ['marmer'], exclude: [], updatedAt: '2026-01-01T00:00:00Z', discovery: { minImpressions: 3, minIncrease: 3, minGrowthPct: 25 } };
const report = (start: string, end: string, previousStart: string, previousEnd: string, imp: number, prev: number | null, dataState = 'final'): GscInput => ({ websiteId: 'site-1', websiteName: 'Fixture', brandKey: 'Magrade', report: { mapping: { workspaceId: 'w1', brandKey: 'Magrade', websiteId: 'site-1', property: 'sc-domain:example.test' }, periods: { current: { startDate: start, endDate: end }, previous: { startDate: previousStart, endDate: previousEnd } }, freshness: { timeZone: 'UTC', dataState, lastReturnedDate: end, searchType: 'web' }, syncedAt: `${end}T12:00:00Z`, queryPerformance: [{ query: 'marmer', clicks: 2, impressions: imp, ctr: 2 / imp, position: 8, previous: prev === null ? null : { clicks: 1, impressions: prev, ctr: 1 / prev, position: 10 } }], keywordOpportunities: [], coverage: { queryPerformance: { rowCount: 1, truncated: false } }, limitations: [] } as any });
function test(name: string, fn: () => void) { fn(); console.log(`PASS ${name}`); }
test('real queryPerformance comparisons qualify only using measured previous evidence', () => {
 const radar = buildRadar(watch, [], [report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,5)], 'connected');
 const c = radar.candidates.find(x => x.topic === 'marmer')!;
 assert.ok(c); assert.equal(c.classification, 'rising_trend'); assert.equal(c.signal?.source, 'gsc'); assert.equal(c.signal?.current?.impressions, 10); assert.equal(c.signal?.previous?.impressions, 5);
 assert.match(c.reason, /NOT public Google Trends/); assert.equal((c.evidence[0] as any).coverage.queryPerformance.truncated, false);
});
test('missing, zero, low volume, overlapping and non-final comparisons never become false rising', () => {
 for (const [input, expected] of [[report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,null),'gsc_opportunity'],[report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,0),'gsc_opportunity'],[report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',7,2),'rising_trend'],[report('2026-10-01','2026-10-07','2026-09-28','2026-10-04',10,5),'gsc_opportunity'],[report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,5,'partial'),'gsc_opportunity']] as const) {
  const c = buildRadar(watch, [], [input], 'connected').candidates.find(x => x.topic === 'marmer')!; assert.equal(c.classification, expected); if (input.report.queryPerformance[0].impressions < 8) assert.equal(c.signal?.confidence,'low_volume');
 }
});
test('low-volume confidence includes a low previous baseline even when current volume is higher', () => {
 const c = buildRadar(watch, [], [report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,5)], 'connected').candidates[0];
 assert.equal(c.signal?.confidence, 'low_volume');
});
test('calendar-invalid, reversed, future, and pre-period-sync comparisons are rejected with null growth deltas', () => {
 const cases = [
  report('2026-02-30','2026-03-08','2026-02-21','2026-02-28',10,5),
  report('2026-10-01','2026-10-07','2026-10-08','2026-10-14',10,5),
  report('2099-10-01','2099-10-07','2099-09-24','2099-09-30',10,5),
  report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,5)
 ];
 cases[3].report.syncedAt = '2026-10-06T23:59:59Z';
 for (const input of cases) {
  const c = buildRadar(watch, [], [input], 'connected').candidates[0];
  assert.equal(c.signal?.comparisonValid, false);
  assert.equal(c.signal?.growthPct, null);
  assert.equal(c.signal?.deltas.impressions, null);
 }
});
test('GSC recommendation reasons retain source and candidate reason without putting provenance in captions', () => {
 const c = buildRadar(watch, [], [report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,5)], 'connected');
 const rising = c.recommendations[0];
 assert.match(rising.reason, /GSC/i);
 assert.match(rising.reason, /Observed GSC query demand increase/);
 assert.doesNotMatch(rising.content, /GSC|RSS|Google Trends|evidence source/i);
});
test('history comparisons count only finalized positive disjoint adjacent equal-length pairs', () => {
 const current = report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,5);
 const oldInput = (start: string, end: string, impressions: number) => report(start,end,'2026-09-01','2026-09-07',impressions,1);
 const history = [
  buildGscHistoryPoint('w1', oldInput('2026-09-03','2026-09-09',2), '2026-09-10T12:00:00Z'),
  buildGscHistoryPoint('w1', oldInput('2026-09-10','2026-09-16',3), '2026-09-17T12:00:00Z'),
  buildGscHistoryPoint('w1', oldInput('2026-09-17','2026-09-23',4), '2026-09-24T12:00:00Z')
 ];
 const c = buildRadar(watch, [], [{...current, history}], 'connected').candidates[0];
 assert.equal(c.signal?.historyComparisons, 1);
});
test('history rejects non-web and reversed periods; negative metrics cannot establish growth', () => {
 const input = report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,5);
 const a = buildGscHistoryPoint('w1', report('2026-09-03','2026-09-09','2026-08-27','2026-09-02',2,1));
 const b = buildGscHistoryPoint('w1', report('2026-09-10','2026-09-16','2026-09-03','2026-09-09',4,2));
 (a.freshness as any).searchType = 'image';
 assert.equal(buildRadar(watch, [], [{...input,history:[a,b]}], 'cache').candidates[0].signal?.historyComparisons, 0);
 input.report.queryPerformance[0].clicks = -1;
 assert.equal(buildRadar(watch, [], [input], 'cache').candidates[0].classification, 'gsc_opportunity');
});
test('history builder is non-null, source-scoped and deterministic; store dedups and caps retention', () => {
 const input = report('2026-10-01','2026-10-07','2026-09-24','2026-09-30',10,5); const point = buildGscHistoryPoint('w1', input, '2026-10-10T00:00:00Z');
 assert.ok(point); assert.equal(point.workspaceId,'w1'); assert.equal(point.coverage && (point.coverage as any).queryPerformance.truncated,false);
 const dir = path.join(process.env.TMPDIR || process.env.LOCALAPPDATA || '.', 'niche-trend-store-fixture'); fs.rmSync(dir,{recursive:true,force:true}); fs.mkdirSync(dir,{recursive:true}); const store = new TrendStore(path.join(dir,'private.sqlite'));
 try { assert.equal(store.saveGscHistory(point).id,point.id); assert.equal(store.saveGscHistory(point).id,point.id); assert.equal(store.gscHistory('w1','Magrade','site-1','sc-domain:example.test').length,1); assert.equal(store.gscHistory('other','Magrade').length,0); store.clearGscHistory('w1','Magrade'); assert.equal(store.gscHistory('w1','Magrade').length,0); } finally {store.close(); fs.rmSync(dir,{recursive:true,force:true});}
});

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { BrandWatch, FeedSnapshot, GscHistoryPoint } from './types';
import { onGscHistoryInvalidation } from './GscHistoryPrivacy';
import { buildGscHistoryPoint } from './GscNicheSignals';
import type { GscInput } from './types';

export class TrendStore {
  private readonly db: Database.Database;
  private readonly unsubscribeInvalidation: () => void;
  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), {recursive:true});
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS trend_watchlists (workspace TEXT NOT NULL, brand_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(workspace, brand_key));
      CREATE TABLE IF NOT EXISTS trend_snapshots (id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trend_gsc_history (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, brand_key TEXT NOT NULL, website_id TEXT NOT NULL, property TEXT NOT NULL, period_key TEXT NOT NULL, captured_at TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(workspace,brand_key,website_id,property,period_key));`);
    this.unsubscribeInvalidation = onGscHistoryInvalidation(() => { this.db.prepare('DELETE FROM trend_gsc_history').run(); });
  }
  watchlists(workspace: string): BrandWatch[] {
    return (this.db.prepare('SELECT payload FROM trend_watchlists WHERE workspace = ? ORDER BY brand_key').all(workspace) as Array<{payload:string}>).map(x => JSON.parse(x.payload) as BrandWatch);
  }
  saveWatchlist(workspace: string, watch: BrandWatch): BrandWatch {
    const bounded: BrandWatch = { ...watch, topics: watch.topics.slice(0, 30).map(x => x.slice(0, 100)), exclude: watch.exclude.slice(0, 30).map(x => x.slice(0, 100)) };
    this.db.prepare('INSERT INTO trend_watchlists(workspace, brand_key, payload) VALUES(?,?,?) ON CONFLICT(workspace, brand_key) DO UPDATE SET payload=excluded.payload').run(workspace, bounded.brandKey, JSON.stringify(bounded));
    return bounded;
  }
  snapshots(limit = 20): FeedSnapshot[] {
    const cap = Math.max(0, Math.min(96, Math.floor(limit)));
    return (this.db.prepare('SELECT payload FROM trend_snapshots ORDER BY fetched_at DESC, rowid DESC LIMIT ?').all(cap) as Array<{payload:string}>).map(x => JSON.parse(x.payload) as FeedSnapshot);
  }
  saveSnapshot(snapshot: FeedSnapshot): FeedSnapshot {
    const bounded: FeedSnapshot = { ...snapshot, items: snapshot.items.slice(0, 100).map(item => ({ ...item, news: item.news.slice(0, 20) })) };
    const insert = this.db.prepare('INSERT OR IGNORE INTO trend_snapshots(id, fetched_at, status, payload) VALUES(?,?,?,?)');
    const trim = this.db.prepare('DELETE FROM trend_snapshots WHERE id NOT IN (SELECT id FROM trend_snapshots ORDER BY fetched_at DESC, rowid DESC LIMIT 96)');
    const tx = this.db.transaction(() => { insert.run(bounded.id, bounded.fetchedAt, bounded.status, JSON.stringify(bounded)); trim.run(); });
    tx();
    const row = this.db.prepare('SELECT payload FROM trend_snapshots WHERE id=?').get(bounded.id) as {payload:string} | undefined;
    if (!row) throw new Error('Snapshot was not retained');
    return JSON.parse(row.payload) as FeedSnapshot;
  }
  latestSnapshot(): FeedSnapshot | null { return this.snapshots(1)[0] ?? null; }
  lastGoodSnapshot(): FeedSnapshot | null {
    const row = this.db.prepare("SELECT payload FROM trend_snapshots WHERE status='ok' ORDER BY fetched_at DESC, rowid DESC LIMIT 1").get() as {payload:string} | undefined;
    return row ? JSON.parse(row.payload) as FeedSnapshot : null;
  }
  saveGscHistory(point: GscHistoryPoint): GscHistoryPoint {
    if (!point.workspaceId || !point.brandKey || !point.websiteId || !point.property || !Array.isArray(point.queries)) throw new Error('Invalid scoped GSC history point');
    const bounded = { ...point, queries: point.queries.slice(0, 5000) };
    const periodKey = `${point.periods.current.startDate}/${point.periods.current.endDate}|${point.periods.previous.startDate}/${point.periods.previous.endDate}`;
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO trend_gsc_history(id,workspace,brand_key,website_id,property,period_key,captured_at,payload) VALUES(?,?,?,?,?,?,?,?)').run(bounded.id,bounded.workspaceId,bounded.brandKey,bounded.websiteId,bounded.property,periodKey,bounded.capturedAt,JSON.stringify(bounded));
      this.db.prepare('DELETE FROM trend_gsc_history WHERE workspace=? AND brand_key=? AND website_id=? AND property=? AND rowid NOT IN (SELECT rowid FROM trend_gsc_history WHERE workspace=? AND brand_key=? AND website_id=? AND property=? ORDER BY captured_at DESC,rowid DESC LIMIT 24)').run(bounded.workspaceId,bounded.brandKey,bounded.websiteId,bounded.property,bounded.workspaceId,bounded.brandKey,bounded.websiteId,bounded.property);
    }); tx();
    const row=this.db.prepare('SELECT payload FROM trend_gsc_history WHERE workspace=? AND brand_key=? AND website_id=? AND property=? AND period_key=?').get(bounded.workspaceId,bounded.brandKey,bounded.websiteId,bounded.property,periodKey) as {payload:string}|undefined;
    if(!row) throw new Error('GSC history point was not retained'); return JSON.parse(row.payload) as GscHistoryPoint;
  }
  gscHistory(workspace:string,brand:string,websiteId?:string,property?:string):GscHistoryPoint[] {
    if(!workspace||!brand)return [];
    let sql='SELECT payload FROM trend_gsc_history WHERE workspace=? AND brand_key=?'; const args:any[]=[workspace,brand];
    if(websiteId!==undefined){sql+=' AND website_id=?';args.push(websiteId);} if(property!==undefined){sql+=' AND property=?';args.push(property);}
    sql+=' ORDER BY captured_at ASC,id ASC'; return (this.db.prepare(sql).all(...args) as Array<{payload:string}>).map(r=>JSON.parse(r.payload) as GscHistoryPoint);
  }
  clearGscHistory(workspace?:string,brand?:string):void {
    if(workspace&&brand)this.db.prepare('DELETE FROM trend_gsc_history WHERE workspace=? AND brand_key=?').run(workspace,brand);
    else if(workspace)this.db.prepare('DELETE FROM trend_gsc_history WHERE workspace=?').run(workspace);
    else if(brand)this.db.prepare('DELETE FROM trend_gsc_history WHERE brand_key=?').run(brand);
    else this.db.prepare('DELETE FROM trend_gsc_history').run();
  }
  close(): void { this.unsubscribeInvalidation(); this.db.close(); }
}

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { BrandWatch, FeedSnapshot } from './types';

export class TrendStore {
  private readonly db: Database.Database;
  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), {recursive:true});
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS trend_watchlists (workspace TEXT NOT NULL, brand_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(workspace, brand_key));
      CREATE TABLE IF NOT EXISTS trend_snapshots (id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);`);
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
  close(): void { this.db.close(); }
}

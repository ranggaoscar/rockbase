import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const scratch = process.env.TMPDIR || process.env.TEMP;
if (!scratch) throw new Error('Private scratch directory is required');
const folder = fs.mkdtempSync(path.join(scratch, 'niche-runtime-privacy-'));
try {
  const child = spawnSync(process.execPath, ['-r', 'ts-node/register', '-e', `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const { TrendStore } = require('./src/services/trends/TrendStore');
    const { invalidateGscHistory } = require('./src/services/trends/GscHistoryPrivacy');
    const file = path.join(process.env.LOCALAPPDATA, 'RockBase/installations', '${createHash('sha256').update(path.resolve(__dirname, '../../..').toLowerCase()).digest('hex').slice(0, 32)}', 'trends.sqlite');
    const seed = new TrendStore(file);
    seed.saveGscHistory({id:'fixture',workspaceId:'w',brandKey:'b',websiteId:'1',property:'sc-domain:example.test',capturedAt:'2026-01-03T00:00:00Z',syncedAt:'2026-01-03T00:00:00Z',periods:{current:{startDate:'2026-01-02',endDate:'2026-01-02'},previous:{startDate:'2026-01-01',endDate:'2026-01-01'}},freshness:{},queries:[],coverage:{}});
    seed.close();
    const runtime = require('./src/services/TrendRuntime');
    invalidateGscHistory();
    assert.equal(runtime.trendDependencies().store().gscHistory('w','b').length,0);
    runtime.closeTrendRuntime();
  `], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, LOCALAPPDATA: folder, ROCKBASE_MODE: 'local', TS_NODE_TRANSPILE_ONLY: 'true' }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  console.log('[NicheRuntimePrivacy] PASS persisted history purged before first Trend request after restart; private isolated folder, zero Google/publishing calls.');
} finally { fs.rmSync(folder, { recursive: true, force: true }); }

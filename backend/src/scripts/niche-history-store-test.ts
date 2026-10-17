import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TrendStore } from '../services/trends/TrendStore';
import { buildGscHistoryPoint } from '../services/trends/GscNicheSignals';
import { invalidateGscHistory } from '../services/trends/GscHistoryPrivacy';
import type { GscInput } from '../services/trends/types';
const folder = fs.mkdtempSync(path.join(process.env.TMPDIR || process.env.LOCALAPPDATA || '.', 'niche-retention-'));
const input: GscInput = { websiteId:'1',websiteName:'Fixture',brandKey:'b',report:{mapping:{workspaceId:'w',websiteId:'1',brandKey:'b',property:'sc-domain:example.test'},periods:{current:{startDate:'2026-01-02',endDate:'2026-01-02'},previous:{startDate:'2026-01-01',endDate:'2026-01-01'}},freshness:{dataState:'final',searchType:'web',timeZone:'UTC',lastReturnedDate:'2026-01-02'},syncedAt:'2026-01-03T00:00:00Z',queryPerformance:Array.from({length:5001},(_,i)=>({query:`fixture ${i}`,clicks:0,impressions:1,ctr:0,position:1,previous:null})),coverage:{queryPerformance:{truncated:false}},limitations:[],keywordOpportunities:[]} as any };
let store = new TrendStore(path.join(folder,'history.sqlite'));
try {
 const point = buildGscHistoryPoint('w',input);
 assert.equal(point.queries.length,5000);assert.equal((point.coverage as any).queryPerformance.truncated,true);
 assert.throws(()=>buildGscHistoryPoint('foreign',input));
 const retained=store.saveGscHistory(point);
 assert.equal(store.saveGscHistory({...point,id:'different-id',syncedAt:'2026-01-04T00:00:00Z'}).id,retained.id);
 assert.equal(store.gscHistory('w','b','1','sc-domain:example.test').length,1);
 assert.equal(store.gscHistory('w','b','2','sc-domain:example.test').length,0);
 assert.equal(store.gscHistory('w','b','1','sc-domain:foreign.test').length,0);
 for(let i=0;i<30;i++) {
  const day=(n:number)=>new Date(Date.UTC(2026,1,n)).toISOString().slice(0,10);
  store.saveGscHistory({...point,id:`period-${i}`,queries:[],capturedAt:new Date(Date.UTC(2026,2,i+1)).toISOString(),periods:{current:{startDate:day(i+2),endDate:day(i+2)},previous:{startDate:day(i+1),endDate:day(i+1)}}});
 }
 assert.equal(store.gscHistory('w','b').length,24);
 store.close();store=new TrendStore(path.join(folder,'history.sqlite'));assert.equal(store.gscHistory('w','b').length,24);
 invalidateGscHistory();assert.equal(store.gscHistory('w','b').length,0);
 console.log('[NicheHistoryStore] PASS 5000-row coverage, scope rejection, same-period immutability, 24-period retention, reopen persistence and invalidation. Fixture only.');
} finally {store.close();fs.rmSync(folder,{recursive:true,force:true});}

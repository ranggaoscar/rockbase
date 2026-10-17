import assert from 'node:assert/strict';
import express from 'express';
import { createTrendRouter } from '../routes/trendRoutes';
import { localOperator } from '../middleware/runtimeMode';
import { invalidateGscHistory } from '../services/trends/GscHistoryPrivacy';

async function main() {
 const prior=process.env.ROCKBASE_MODE;process.env.ROCKBASE_MODE='local';
 const saved:any[]=[];let historyReads=0,gscReads=0,connected=true;
 const input:any={websiteId:'1',websiteName:'Fixture',brandKey:'Magrade',report:{mapping:{workspaceId:'w1',websiteId:'1',brandKey:'Magrade',property:'sc-domain:example.test'},periods:{current:{startDate:'2026-10-01',endDate:'2026-10-07'},previous:{startDate:'2026-09-24',endDate:'2026-09-30'}},freshness:{timeZone:'America/Los_Angeles',dataState:'final',searchType:'web',lastReturnedDate:'2026-10-07'},syncedAt:'2026-10-10T00:00:00Z',queryPerformance:[{query:'marmer',clicks:0,impressions:6,ctr:0,position:8,previous:{clicks:0,impressions:2,ctr:0,position:9}}],keywordOpportunities:[],coverage:{},limitations:[]}};
 const watch:any={brandKey:'Magrade',brandName:'Magrade',topics:['marmer'],exclude:[],updatedAt:''};
 const store:any={watchlists:()=>[watch],saveWatchlist:(_w:string,v:any)=>v,snapshots:()=>[],latestSnapshot:()=>null,lastGoodSnapshot:()=>null,saveSnapshot:(v:any)=>v,saveGscHistory:(p:any)=>{if(!saved.some(v=>v.id===p.id))saved.push(p);return p;},gscHistory:()=>{historyReads++;return saved;},clearGscHistory:()=>{saved.length=0;}};
 const deps:any={store:()=>store,workspaces:async()=>[{id:'w1',name:'Fixture'}],brands:async()=>[{key:'Magrade',name:'Magrade',workspace_id:'w1'}],gsc:async()=>{gscReads++;return {inputs:connected?[input]:[],status:connected?'Connected cache':'GSC disconnected. No private report consumed.'};},fetchFeed:async()=>{throw Error('No feed fetch in history capture');},buildRadar:(_w:any,_s:any,inputs:any)=>({brandKey:'Magrade',watchlist:watch,source:{latest:null,lastGood:null,cooldownUntil:null},candidates:[],recommendations:[],gscStatus:'cache',limitations:[],historyInputs:inputs}),drafts:{upsert:async()=>{throw Error('No draft needed')},findFirst:async()=>null}};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as any).user=localOperator;next()});app.use('/api/trends',createTrendRouter(deps));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const root=`http://127.0.0.1:${(server.address() as any).port}/api/trends`;
 const post=(path:string,body:any,method='POST')=>fetch(root+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const payload={workspace_id:'w1',brand_key:'Magrade'};
  assert.equal((await post('/capture',payload)).status,200);
  assert.equal((await post('/capture',payload)).status,200);assert.equal(saved.length,1,'Same report is not another historical observation');
  assert.equal((await post('/capture',{workspace_id:'foreign',brand_key:'Magrade'})).status,404);
  assert.equal((await post('/capture',{workspace_id:'w1',brand_key:'foreign'})).status,404);
  const radar=await (await fetch(root+'/radar?workspace_id=w1&brand_key=Magrade')).json() as any;
  assert.equal(radar.historyStatus.count,1);assert.equal(radar.historyInputs[0].history.length,1);
  const invalid=await post('/watchlist',{...payload,topics:['marmer'],exclude:[],discovery:{minImpressions:-1,minIncrease:3,minGrowthPct:25}},'PUT');assert.equal(invalid.status,422);
  const valid=await post('/watchlist',{...payload,topics:['marmer'],exclude:[],discovery:{minImpressions:3,minIncrease:3,minGrowthPct:25}},'PUT');assert.equal(valid.status,200);assert.equal((await valid.json() as any).discovery.minImpressions,3);
  connected=false;const before=historyReads;await fetch(root+'/radar?workspace_id=w1&brand_key=Magrade');assert.equal(historyReads,before,'Disconnected GSC must not read private history');
  assert.equal((await post('/capture',payload)).status,409);
  process.env.ROCKBASE_MODE='server';const g=gscReads;assert.equal((await post('/capture',payload)).status,409);assert.equal(gscReads,g);
  process.env.ROCKBASE_MODE='local';connected=true;
  deps.gsc=async()=>{invalidateGscHistory();return{inputs:[input],status:'stale returned input'}};
  assert.equal((await post('/capture',payload)).status,409,'Disconnect/remap during async read invalidates capture');
  console.log('[NicheHistoryRoutes] PASS capture/dedup/discovery-validation/disconnect/server/inflight invalidation; no Google or publishing calls.');
 }finally{await new Promise<void>(r=>server.close(()=>r()));if(prior===undefined)delete process.env.ROCKBASE_MODE;else process.env.ROCKBASE_MODE=prior;}
}
main().catch(e=>{console.error(e);process.exitCode=1});

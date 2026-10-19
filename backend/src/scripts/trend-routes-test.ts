import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createTrendRouter } from '../routes/trendRoutes';
import { localOperator } from '../middleware/runtimeMode';

async function main() {
  const previous = process.env.ROCKBASE_MODE;
  process.env.ROCKBASE_MODE = 'local';
  let storeReads = 0; let feedCalls = 0; let gscReads = 0; let draftWrites = 0;
  const snapshots: any[] = []; const watches: any[] = []; const drafts = new Map<string, any>();
  const store: any = {
    latestSnapshot: () => snapshots[0] || null, lastGoodSnapshot: () => snapshots.find(s => s.status === 'ok') || null,
    snapshots: () => snapshots, watchlists: () => watches,
    saveWatchlist: (_w: string, value: any) => { const i=watches.findIndex(v=>v.brandKey===value.brandKey); if(i>=0)watches.splice(i,1); watches.push(value); return value; },
    saveSnapshot: (value: any) => { snapshots.unshift(value); return value; },
  };
  const deps: any = {
    store: () => { storeReads++; return store; },
    workspaces: async () => [{ id: 'w1', name: 'Fixture workspace' }],
    brands: async (workspace: string) => workspace === 'w1' ? [{key:'Magrade',name:'Magrade',workspace_id:'w1'}] : [],
    gsc: async () => { gscReads++; return {inputs:[],status:'No connected GSC report available.'}; },
    fetchFeed: async () => { feedCalls++; await new Promise(r=>setTimeout(r,10)); return {id:'one',fetchedAt:new Date().toISOString(),sourceUrl:'https://trends.google.com/trending/rss?geo=ID',status:'ok',httpStatus:200,error:null,items:[]}; },
    buildRadar: (watch: any, rows: any[], _inputs: any[], status: string) => ({brandKey:watch.brandKey,watchlist:watch,source:{latest:rows[0]||null,lastGood:rows[0]||null,cooldownUntil:null},candidates:[],recommendations:[{id:'rec-one',candidateId:'one',brandKey:watch.brandKey,topic:'marmer',classification:'content_idea',format:'article',title:'Marmer guide',content:'Editorial idea. No verified trend claim.',reason:'Watchlist topic',evidence:[]}],gscStatus:status,limitations:[]}),
    drafts: {
      upsert: async ({where,create}:any) => { if(!drafts.has(where.id)){drafts.set(where.id,{...create,createdAt:new Date(),updatedAt:new Date()});draftWrites++;} return drafts.get(where.id); },
      findFirst: async ({where}:any) => { const d=drafts.get(where.id);return d?.workspaceId===where.workspaceId?d:null; },
      findMany: async ({where}:any) => [...drafts.values()].filter(d=>d.workspaceId===where.workspaceId&&d.id.startsWith(where.id.startsWith)),
      update: async ({where,data}:any) => { const d=drafts.get(where.id); Object.assign(d,data,{updatedAt:new Date()}); return d; },
    },
  };
  const app=express(); app.use(express.json());
  app.use((req,_res,next)=>{(req as any).user=localOperator;next();});
  app.use('/api/trends',createTrendRouter(deps));
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',r));
  const root=`http://127.0.0.1:${(server.address() as any).port}/api/trends`;
  const post=(url:string,body:any,method='POST')=>fetch(root+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let assertions=0;
  try {
    const brands=await (await fetch(root+'/brands?workspace_id=w1')).json() as any;
    assert.equal(brands.brands[0].key,'Magrade');assert.equal(brands.watchlists[0].brandKey,'Magrade');assert(brands.watchlists[0].topics.length);assertions+=3;
    const denied=await post('/watchlist',{workspace_id:'w2',brand_key:'Magrade',topics:['marmer'],exclude:[]},'PUT');assert.equal(denied.status,404);assertions++;
    assert.equal((await post('/watchlist',{workspace_id:'w1',brand_key:'unknown',topics:['marmer'],exclude:[]},'PUT')).status,404);assertions++;
    assert.equal((await post('/watchlist',{workspace_id:'w1',brand_key:'Magrade',topics:[''],exclude:[]},'PUT')).status,422);assertions++;
    assert.equal((await post('/watchlist',{workspace_id:'w1',brand_key:'Magrade',topics:['marmer'],exclude:['sepak bola']},'PUT')).status,200);assertions++;
    const refresh=await Promise.all([post('/refresh',{workspace_id:'w1'}),post('/refresh',{workspace_id:'w1'})]);
    assert(refresh.every(r=>[200,429,409].includes(r.status)));assert.equal(feedCalls,1);assertions+=2;
    await post('/refresh',{workspace_id:'w1'});assert.equal(feedCalls,1);assertions++;
    const radar=await fetch(root+'/radar?workspace_id=w1&brand_key=Magrade');assert.equal(radar.status,200);assert.match(radar.headers.get('cache-control')||'',/no-store/);assertions+=2;
    assert.equal((await post('/drafts',{workspace_id:'w1',brand_key:'Magrade',recommendation_id:'missing'})).status,409);assertions++;
    const values=await Promise.all([post('/drafts',{workspace_id:'w1',brand_key:'Magrade',recommendation_id:'rec-one'}),post('/drafts',{workspace_id:'w1',brand_key:'Magrade',recommendation_id:'rec-one'})]);
    const a=await values[0].json() as any,b=await values[1].json() as any;
    assert.equal(a.draft.id,b.draft.id);assert.equal(draftWrites,1);assert.match(a.composeUrl,/draftId=/);assert.equal(drafts.get(a.draft.id).accountIds,undefined);assertions+=4;
    assert.equal((await fetch(root+`/drafts/${a.draft.id}?workspace_id=w2`)).status,404);assertions++;
    assert.equal((await fetch(root+`/drafts/${a.draft.id}?workspace_id=w1`)).status,200);assertions++;
    // Studio library: list + edit keep provenance server-side and stay workspace-scoped.
    const listed=await (await fetch(root+'/drafts?workspace_id=w1')).json() as any;
    assert.equal(listed.drafts.length,1);assert.equal(listed.drafts[0].format,'article');assert.equal(listed.drafts[0].topic,'marmer');assert.doesNotMatch(listed.drafts[0].excerpt,/Provenance/);assertions+=4;
    assert.equal((await fetch(root+'/drafts?workspace_id=w2')).status,404);assertions++;
    const original=drafts.get(a.draft.id).content as string; const provenance=original.slice(original.indexOf('\n\n---\nProvenance'));
    assert.equal((await post(`/drafts/${a.draft.id}`,{workspace_id:'w2',body:'x'},'PATCH')).status,404);assertions++;
    assert.equal((await post(`/drafts/${a.draft.id}`,{workspace_id:'w1',body:'forged'+provenance},'PATCH')).status,422);assertions++;
    assert.equal((await post(`/drafts/${a.draft.id}`,{workspace_id:'w1',body:'ok',title:'  '},'PATCH')).status,422);assertions++;
    assert.equal((await post(`/drafts/not-a-trend-id`,{workspace_id:'w1',body:'ok'},'PATCH')).status,404);assertions++;
    const edited=await post(`/drafts/${a.draft.id}`,{workspace_id:'w1',body:'Edited brief',title:'Marmer guide v2'},'PATCH');assert.equal(edited.status,200);
    const saved=(await edited.json() as any).draft;assert.equal(saved.title,'Marmer guide v2');assert.equal(saved.content,'Edited brief'+provenance);assert.equal(draftWrites,1);assertions+=4;
    assert.equal((await fetch(root+`/drafts/${a.draft.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'https://evil.invalid'},body:JSON.stringify({workspace_id:'w1',body:'evil'})})).status,403);assertions++;
    assert.equal(drafts.get(a.draft.id).content,'Edited brief'+provenance);assertions++;
    const before=storeReads+gscReads;
    assert.equal((await fetch(root+'/radar?workspace_id=w1&brand_key=Magrade',{headers:{Origin:'https://evil.invalid'}})).status,403);assertions++;
    const host=await new Promise<number>((resolve,reject)=>{const req=http.get(root+'/brands',{headers:{Host:'evil.invalid'}},r=>{r.resume();resolve(r.statusCode||0)});req.on('error',reject)});assert.equal(host,403);assertions++;
    process.env.ROCKBASE_MODE='server';
    for(const endpoint of ['/brands','/radar?workspace_id=w1&brand_key=Magrade',`/drafts/${a.draft.id}?workspace_id=w1`,'/drafts?workspace_id=w1']){assert.equal((await fetch(root+endpoint)).status,409);assertions++;}
    assert.equal((await post(`/drafts/${a.draft.id}`,{workspace_id:'w1',body:'server'},'PATCH')).status,409);assertions++;
    assert.equal(storeReads+gscReads,before);assertions++;
    console.log(`[TrendRoutes] PASS ${assertions} assertions: local-only/no-store/host-origin/workspace/brand/cooldown/parallel/idempotent-existing-Draft/library-list/provenance-preserving-edit; zero queues/posts.`);
  } finally {await new Promise<void>(r=>server.close(()=>r()));if(previous===undefined)delete process.env.ROCKBASE_MODE;else process.env.ROCKBASE_MODE=previous;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

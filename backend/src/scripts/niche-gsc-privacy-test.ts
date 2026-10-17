import assert from 'node:assert/strict';
import express from 'express';
import { createGscRouter } from '../routes/gscRoutes';
import { localOperator } from '../middleware/runtimeMode';
import { gscHistoryRevision, onGscHistoryInvalidation } from '../services/trends/GscHistoryPrivacy';
async function main(){
 const previous=process.env.ROCKBASE_MODE;process.env.ROCKBASE_MODE='local';let purges=0;
 const unsubscribe=onGscHistoryInvalidation(()=>purges++);
 const oauth:any={status:async()=>({connected:true}),configure:async()=>{},connect:async()=>({}),disconnect:async()=>({}),importServiceAccount:async()=>({})};
 const analytics:any={listProperties:async()=>[{siteUrl:'sc-domain:example.com',permissionLevel:'siteOwner'}],saveMapping:()=>({}),report:()=>null};
 const seo:any=async()=>Response.json([{id:1,workspace_id:'w1',name:'Fixture',brand_key:'Magrade',base_url:'https://example.com/'}]);
 const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as any).user=localOperator;next()});app.use('/api/gsc',createGscRouter({oauth,analytics:()=>analytics,seo,clearData:()=>{}}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const root=`http://127.0.0.1:${(server.address() as any).port}/api/gsc`;
 const post=(path:string,body:any={})=>fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{const start=gscHistoryRevision();for(const url of ['/connect','/disconnect','/service-account'])assert.equal((await post(url)).status,200);
 assert.equal((await post('/mapping',{workspace_id:'w1',website_id:'1',property:'sc-domain:example.com'})).status,200);
 assert.equal(purges,4);assert.equal(gscHistoryRevision(),start+4);
 const p=purges;process.env.ROCKBASE_MODE='server';assert.equal((await post('/disconnect')).status,409);assert.equal(purges,p,'Denied Server Mode cannot mutate history');
 console.log('[NicheGscPrivacy] PASS connect/disconnect/provider/mapping invalidation, denied-mode no mutation. Fixture only.');
 }finally{unsubscribe();await new Promise<void>(r=>server.close(()=>r()));if(previous===undefined)delete process.env.ROCKBASE_MODE;else process.env.ROCKBASE_MODE=previous;}
}
main().catch(e=>{console.error(e);process.exitCode=1});

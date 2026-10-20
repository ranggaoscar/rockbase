import assert from 'node:assert/strict';
import express from 'express';
import Module from 'node:module';
import path from 'node:path';

// Real HTTP router; isolated membership/worker dependencies. No owner DB, Redis or external network.
const previous = process.env.ROCKBASE_MODE;
process.env.ROCKBASE_MODE = 'server';
const calls: Array<{ resource: string; workspace: string; method: string }> = [];
const loader = Module as any;
const originalLoad = loader._load;
loader._load = function (name: string, parent: any, isMain: boolean) {
  if (parent?.filename.endsWith(path.join('routes', 'seoRoutes.ts'))) {
    if (name === '@prisma/client') return { PrismaClient: class {
      workspace = { findMany: async ({ where }: any) => where.users?.some?.userId === 'member' ? [{ id: 'w1', name: 'Fixture', accounts: [] }] : [] };
    } };
    if (name === '../services/SeoWorkerService') return { seoRequest: async (resource: string, workspace: string, method = 'GET') => {
      calls.push({ resource, workspace, method });
      if (resource === '/brands') return Response.json([{key:'alpha', name:'Alpha',workspace_id:'w1'},{key:'beta',name:'Beta',workspace_id:'w1'}]);
      if (resource === '/competitors/1') return Response.json({competitor:{id:1,website_id:10,workspace_id:'w1',brand_key:'alpha'}});
      if (resource === '/competitors/2') return Response.json({competitor:{id:2,workspace_id:'w2',brand_key:'alpha'}});
      if (resource === '/competitors/3') return Response.json({competitor:{id:3,workspace_id:'w1',brand_key:'retired'}});
      return Response.json({resource,workspace,method});
    } };
  }
  return originalLoad.call(this,name,parent,isMain);
};
async function main() {
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{if(req.headers['x-fixture-auth']!=='member'){res.status(401).json({error:'fixture auth required'});return;} (req as any).user={id:'member',role:req.headers['x-fixture-role']||'Admin'};next();});
  try { app.use('/api/seo',require('../routes/seoRoutes').default); } finally {loader._load=originalLoad;}
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const root=`http://127.0.0.1:${(server.address() as any).port}/api/seo`;
  const headers={'x-fixture-auth':'member'};let assertions=0;
  const check=(condition:unknown,label:string)=>{assert(condition,label);assertions++;};
  const post=(url:string,body:unknown,role='Operator')=>fetch(root+url,{method:'POST',headers:{...headers,'Content-Type':'application/json','x-fixture-role':role},body:JSON.stringify(body)});
  try {
    for(const route of ['/competitors','/competitors/1','/competitors/1/scans','/competitors/1/findings']){
      check((await fetch(root+route)).status===401,'authentication');const before=calls.length;
      check((await fetch(root+route+'?workspace_id=w2',{headers})).status===404,'Admin still needs membership');
      check(calls.slice(before).every(c=>c.resource==='/brands'),'denial before competitor read');
    }
    check((await fetch(root+'/competitors?brand_key=invalid',{headers})).status===422,'unknown brand');
    check((await fetch(root+'/competitors/2/findings',{headers})).status===404,'foreign relationship');
    check((await fetch(root+'/competitors/3/findings',{headers})).status===404,'retired brand fails closed');
    check((await fetch(root+'/competitors/1/findings?brand_key=beta',{headers})).status===404,'brand mismatch');
    check((await fetch(root+'/competitors/1/findings?scan_id=not-a-number',{headers})).status===422,'scan identifier');
    const forwarded=await(await fetch(root+'/competitors/1/findings?scan_id=7&brand_key=alpha&untrusted=ignored',{headers})).json() as any;
    check(forwarded.resource.includes('scan_id=7')&&!forwarded.resource.includes('untrusted'),'query allowlist');
    check((await fetch(root+'/competitors',{headers})).status===200,'authorized cross-brand list');
    check((await post('/competitors',{name:'Fixture',base_url:'https://fixture.example/',brand_key:'alpha'},'Viewer')).status===403,'Viewer registration');
    check((await post('/competitors',{name:'Fixture',base_url:'https://fixture.example/',brand_key:'bogus'})).status===422,'invalid registration brand');
    check((await post('/competitors/1/scans',{max_urls:26,mode:'http'})).status===422,'bounded scan');
    check((await post('/competitors/1/scans',{max_urls:1,mode:'browser'})).status===422,'HTTP only');
    check((await post('/competitors/1/scans',{max_urls:1,mode:'http',brand_key:'beta'})).status===422,'scan relation brand');
    check((await post('/competitors/1/scans',{max_urls:1,mode:'http'})).status===200,'explicit valid scan forwarded');
    check((await post('/competitors/1/findings',{})).status===404,'POST findings not allowed');
    process.env.ROCKBASE_MODE='local';
    check((await fetch(root+'/competitors',{headers:{...headers,Origin:'https://hostile.invalid'}})).status===403,'local hostile origin');
    console.log(`[CompetitorRoutes] PASS ${assertions} HTTP gateway assertions; isolated dependency fixtures, no owner DB/Redis/external calls.`);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));if(previous===undefined)delete process.env.ROCKBASE_MODE;else process.env.ROCKBASE_MODE=previous;}
}
main().catch(error=>{loader._load=originalLoad;console.error(error);process.exitCode=1;});

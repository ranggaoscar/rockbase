import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';

const previous=process.env.ROCKBASE_MODE;
process.env.ROCKBASE_MODE='local';
let connected=true, statusReads=0, reportReads=0, googleCalls=0;
const loader=Module as any, original=loader._load;
let mapping:any={workspaceId:'w1',websiteId:'2',brandKey:'Magrade',property:'sc-domain:example.com'};
loader._load=function(name:string,parent:any,isMain:boolean){
 if(parent?.filename.endsWith(path.join('routes','gscRoutes.ts'))){
  if(name==='../services/gsc/GscConnection')return {GscConnection:class{async status(){statusReads++;return{connected};}close(){}google(){googleCalls++;throw Error('Unexpected Google call');}}};
  if(name==='../services/gsc/WindowsCredentialVault')return {WindowsCredentialVault:class{}};
  if(name==='../services/gsc/GscAnalytics')return {GscAnalytics:class{report(workspace:string,website:string){reportReads++;return{mapping,periods:{current:{startDate:'2026-09-16',endDate:'2026-10-13'},previous:{startDate:'2026-08-19',endDate:'2026-09-15'}},keywordOpportunities:[{query:'marmer',impressions:12,clicks:1,ctr:1/12,position:9,confidence:'low_volume',reason:'Observed low-volume candidate'}],syncedAt:'2026-10-16T12:00:00Z'};}close(){}}};
  if(name==='../services/SeoWorkerService')return {seoRequest:async()=>Response.json([{id:2,workspace_id:'w1',brand_key:'Magrade',name:'Fixture',base_url:'https://example.com/'},{id:3,workspace_id:'w2',brand_key:'Magrade',name:'Foreign',base_url:'https://example.com/'}])};
 }
 return original.call(this,name,parent,isMain);
};
async function main(){
 let read:typeof import('../routes/gscRoutes').readTrendGscReports;
 try {read=require('../routes/gscRoutes').readTrendGscReports;}finally{loader._load=original;}
 const valid=await read('w1','Magrade');assert.equal(valid.inputs.length,1);assert.equal(valid.inputs[0].report.keywordOpportunities[0].confidence,'low_volume');
 assert.equal((await read('w2','Magrade')).inputs.length,0,'Report mapping cannot cross workspace');
 mapping={...mapping,property:'sc-domain:unrelated.invalid'};assert.equal((await read('w1','Magrade')).inputs.length,0,'Actual website and GSC property must match');
 mapping={...mapping,property:'sc-domain:example.com',brandKey:'Brescia Stone'};assert.equal((await read('w1','Magrade')).inputs.length,0,'Do not attribute report to client-selected brand');
 connected=false;const before=reportReads;assert.equal((await read('w1','Magrade')).inputs.length,0);assert.equal(reportReads,before,'Disconnected cache must not be read');
 process.env.ROCKBASE_MODE='server';const vaultBefore=statusReads;assert.equal((await read('w1','Magrade')).inputs.length,0);assert.equal(statusReads,vaultBefore,'Server Mode must not read connection/vault');assert.equal(googleCalls,0);
 console.log('[TrendGscProjection] PASS actual workspace/site/brand/property, low-volume period evidence, disconnected/server no-read; zero Google requests.');
 if(previous===undefined)delete process.env.ROCKBASE_MODE;else process.env.ROCKBASE_MODE=previous;
}
main().catch(e=>{loader._load=original;console.error(e);process.exitCode=1});

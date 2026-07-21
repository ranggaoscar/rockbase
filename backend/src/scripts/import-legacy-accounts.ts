import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const SOURCE_DB = path.resolve(process.cwd(), 'backend/prisma/dev.db');
const FIELDS = ['workspaceId','platform','username','accountPassword','email','status','cookies','proxyId','brandTag','notes','warmingDay','warmingStartDate','lastActive','autoReplyEnabled','autoDmEnabled','replyTemplate','dmTemplate','sessionHealth','sessionHealthReason','sessionHealthCheckedAt'] as const;
export interface ImportSummary { source:number; inserted:number; updated:number; skipped:number; failed:number; skippedFields:string[] }
const safe = (v:unknown) => String(v).replace(/password|cookie|token|secret/gi,'[redacted]');

export async function runLegacyAccountImport(opts:{sourceDb?:string;targetUrl?:string;dryRun?:boolean}={}):Promise<ImportSummary> {
  const sourceDb=opts.sourceDb||process.env.LEGACY_SOURCE_DB||SOURCE_DB, targetUrl=opts.targetUrl||process.env.DATABASE_URL;
  if(!targetUrl||!targetUrl.startsWith('file:')) throw new Error('DATABASE_URL must use a local SQLite file');
  if(!fs.existsSync(sourceDb)) throw new Error(`Legacy source database not found: ${sourceDb}`);
  const source=new PrismaClient({datasources:{db:{url:`file:${sourceDb}`}}}), target=new PrismaClient({datasources:{db:{url:targetUrl}}});
  const out:ImportSummary={source:0,inserted:0,updated:0,skipped:0,failed:0,skippedFields:[]};
  try {
    const accounts=await source.socialAccount.findMany({include:{groupMemberships:{include:{group:true}},proxy:true}}); out.source=accounts.length;
    if(!opts.dryRun){const raw=targetUrl.slice(5);const direct=path.resolve(process.cwd(),raw);const candidates=[path.resolve(process.cwd(),'prisma',raw),path.resolve(process.cwd(),'backend/prisma',raw)];const p=path.isAbsolute(raw)?raw:(candidates.find(fs.existsSync)||direct);if(fs.existsSync(p))fs.copyFileSync(p,p+'.backup-'+Date.now());else throw new Error('Target SQLite database file not found for backup')}
    for(const a of accounts) try {
      if(!opts.dryRun) await target.workspace.upsert({where:{id:a.workspaceId},update:{},create:{id:a.workspaceId,name:`Imported workspace ${a.workspaceId}`}});
      if(a.proxy&&!opts.dryRun) await target.proxy.upsert({where:{id:a.proxy.id},update:a.proxy,create:a.proxy});
      for(const m of a.groupMemberships) if(!opts.dryRun) await target.accountGroup.upsert({where:{id:m.group.id},update:m.group,create:m.group});
      const data:any={}; for(const f of FIELDS) if(f in a)data[f]=(a as any)[f]; else if(!out.skippedFields.includes(f))out.skippedFields.push(f);
      data.sessionHealth='UNKNOWN';data.sessionHealthReason='Legacy import requires session revalidation';data.sessionHealthCheckedAt=null;
      const old=await target.socialAccount.findFirst({where:{workspaceId:a.workspaceId,platform:a.platform,username:a.username},select:{id:true}});
      if(!opts.dryRun){const imported=old?await target.socialAccount.update({where:{id:old.id},data}):await target.socialAccount.create({data});for(const m of a.groupMemberships)await target.accountGroupMember.upsert({where:{groupId_accountId:{groupId:m.groupId,accountId:imported.id}},update:{},create:{groupId:m.groupId,accountId:imported.id}})}
      if(old)out.updated++;else out.inserted++;
    } catch(e:any){out.failed++;console.error(`Account ${safe(a.platform)}/${safe(a.username)} failed: ${safe(e.message)}`)}
    return out;
  } finally {await source.$disconnect();await target.$disconnect()}
}
async function main(){try{console.log(JSON.stringify(await runLegacyAccountImport({dryRun:process.argv.includes('--dry-run')})))}catch(e:any){console.error(safe(e.message));process.exitCode=1}}
if(require.main===module)void main();



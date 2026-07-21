import { PrismaClient } from '@prisma/client';
import { decrypt } from '../utils/encryption';

type Outcome = 'VALID'|'EXPIRED'|'MISSING_SESSION'|'DECRYPTION_FAILED'|'NEEDS_CHALLENGE'|'CHECK_FAILED';
const prisma=new PrismaClient();
const limit=Math.max(1,Math.min(2,Number(process.env.SESSION_VALIDATION_CONCURRENCY||1)));
const safeReason:Record<Outcome,string>={VALID:'Existing session validated',EXPIRED:'Existing session expired',MISSING_SESSION:'No stored session',DECRYPTION_FAILED:'Stored session could not be decrypted',NEEDS_CHALLENGE:'Session requires challenge handling',CHECK_FAILED:'Session validation check failed'};

export function classifySession(status:number,text:string):Outcome{
  if(/checkpoint|challenge|verify your account|confirm your account/i.test(text))return 'NEEDS_CHALLENGE';
  if(status===401||/log in|login|sign up/i.test(text))return 'EXPIRED';
  return status>=200&&status<400?'VALID':'CHECK_FAILED';
}
function health(outcome:Outcome){return outcome==='VALID'?'HEALTHY':outcome==='EXPIRED'||outcome==='MISSING_SESSION'?'EXPIRED':outcome==='NEEDS_CHALLENGE'?'CHECKPOINT':'UNKNOWN'}
async function check(account:any):Promise<Outcome>{
  if(!account.cookies)return 'MISSING_SESSION';
  let cookies:any[];try{cookies=JSON.parse(decrypt(account.cookies))}catch{return 'DECRYPTION_FAILED'}
  if(!Array.isArray(cookies)||!cookies.length)return 'MISSING_SESSION';
  try{const cookie=cookies.map(c=>`${c.name}=${c.value}`).join('; ');const r=await fetch('https://www.instagram.com/',{headers:{Cookie:cookie,'User-Agent':'Mozilla/5.0'},redirect:'manual',signal:AbortSignal.timeout(15000)});return classifySession(r.status,(await r.text()).slice(0,50000))}catch{return 'CHECK_FAILED'}
}
export async function validateImportedSessions(dryRun=false){
  const accounts=await prisma.socialAccount.findMany({select:{id:true,cookies:true}}), totals:Record<Outcome,number>={VALID:0,EXPIRED:0,MISSING_SESSION:0,DECRYPTION_FAILED:0,NEEDS_CHALLENGE:0,CHECK_FAILED:0};let cursor=0;
  const worker=async()=>{while(cursor<accounts.length){const a=accounts[cursor++],outcome=await check(a);totals[outcome]++;if(!dryRun)await prisma.socialAccount.update({where:{id:a.id},data:{sessionHealth:health(outcome),sessionHealthReason:safeReason[outcome],sessionHealthCheckedAt:new Date()}})}};
  await Promise.all(Array.from({length:Math.min(limit,accounts.length)},worker));return {total:accounts.length,...totals};
}
async function main(){const dryRun=process.argv.includes('--dry-run');try{console.log(JSON.stringify(await validateImportedSessions(dryRun)))}finally{await prisma.$disconnect()}}
if(require.main===module)void main();

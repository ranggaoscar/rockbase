import { createHash } from 'node:crypto';
import type { GscInput, GscHistoryPoint, GscMetric } from './types';
import type { GscPeriod } from '../gsc/types';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
const validDate=(s:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(`${s}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;};
const validTimestamp=(s:string)=>Number.isFinite(Date.parse(s));
const days=(a:string,b:string)=>Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000);
const metric=(r:any):GscMetric|null=>r&&Number.isFinite(r.clicks)&&r.clicks>=0&&Number.isFinite(r.impressions)&&r.impressions>=0&&r.clicks<=r.impressions&&Number.isFinite(r.position)&&r.position>=0?{clicks:r.clicks,impressions:r.impressions,ctr:r.impressions>0?r.clicks/r.impressions:null,position:r.position}:null;
export function buildGscHistoryPoint(workspace:string,input:GscInput,capturedAt=new Date().toISOString()):GscHistoryPoint {
 const r=input.report, m=r.mapping??{}, property=String(m.property??'');
 if(!workspace||!property||m.workspaceId!==workspace||m.brandKey!==input.brandKey||String(m.websiteId)!==String(input.websiteId)) throw new Error('GSC history scope does not match connected report mapping');
 const periods=r.periods; const queries=(r.queryPerformance??[]).slice(0,5000).map(q=>({...q,query:String(q.query).slice(0,300)}));
 const identity={workspaceId:workspace,brandKey:input.brandKey,websiteId:input.websiteId,property,periods, syncedAt:r.syncedAt};
 return {id:hash(identity),workspaceId:workspace,brandKey:input.brandKey,websiteId:input.websiteId,property,capturedAt,syncedAt:r.syncedAt,periods,freshness:r.freshness,queries,coverage:{...r.coverage,queryPerformance:{rowCount:queries.length,truncated:(r.queryPerformance?.length??0)>5000||Boolean((r.coverage as any)?.queryPerformance?.truncated)}}};
}
export function signalFor(query:string,currentRow:any,input:GscInput,watch:any) {
 const current=metric(currentRow), previous=metric(currentRow.previous); const p=input.report.periods; const cur=p.current, prev=p.previous;
 const today=new Date().toISOString().slice(0,10), syncedAt=input.report.syncedAt, freshness=input.report.freshness;
 let valid=!!current&&!!previous&&freshness?.dataState==='final'&&freshness?.searchType==='web'&&validDate(cur.startDate)&&validDate(cur.endDate)&&validDate(prev.startDate)&&validDate(prev.endDate)&&prev.startDate<=prev.endDate&&cur.startDate<=cur.endDate&&cur.endDate<=today&&prev.endDate<cur.startDate&&days(cur.startDate,cur.endDate)===days(prev.startDate,prev.endDate)&&prev.endDate<=(freshness.lastReturnedDate??'')&&cur.endDate<=(freshness.lastReturnedDate??'')&&days(prev.endDate,cur.startDate)===1&&validTimestamp(syncedAt)&&Date.parse(syncedAt)>=Date.parse(`${cur.endDate}T00:00:00Z`);
 let invalidReason=valid?'':!previous?'missing_previous':input.report.freshness?.dataState!=='final'?'not_finalized':input.report.freshness?.searchType!=='web'?'not_web_search':'invalid_or_nonadjacent_periods';
 let history:{snapshotId:string;capturedAt:string;syncedAt:string;startDate:string;endDate:string;impressions:number;clicks:number;ctr:number|null;position:number;finalized:boolean}[]=[];
 const scope=(x:any)=>x.workspaceId===input.report.mapping?.workspaceId&&x.brandKey===input.brandKey&&String(x.websiteId)===String(input.websiteId)&&x.property===input.report.mapping?.property;
 for(const h of [...(input.history??[]), ...(input.history?.length?[]:[])].filter(scope)){
  if(!Array.isArray(h.queries))continue; const q=h.queries.find((r:any)=>r.query===query); const mm=metric(q); if(mm)history.push({snapshotId:h.id,capturedAt:h.capturedAt,syncedAt:h.syncedAt,startDate:h.periods.current.startDate,endDate:h.periods.current.endDate,impressions:mm.impressions,clicks:mm.clicks,ctr:mm.ctr,position:mm.position,finalized:h.freshness?.dataState==='final'&&h.freshness?.searchType==='web'&&validDate(h.periods.current.startDate)&&validDate(h.periods.current.endDate)&&h.periods.current.startDate<=h.periods.current.endDate&&h.periods.current.endDate<=(h.freshness.lastReturnedDate??'')});
 }
 const unique=new Map(history.map(x=>[`${x.startDate}/${x.endDate}`,x])); history=[...unique.values()].sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.capturedAt.localeCompare(b.capturedAt));
 let historyComparisons=0; for(let i=1;i<history.length;){const a=history[i-1],b=history[i];const positive=a.impressions>0&&b.impressions>a.impressions;const finalized=a.finalized&&b.finalized&&validDate(a.startDate)&&validDate(a.endDate)&&validDate(b.startDate)&&validDate(b.endDate)&&a.endDate<=today&&b.endDate<=today&&validTimestamp(a.syncedAt)&&validTimestamp(b.syncedAt)&&a.syncedAt.slice(0,10)>=a.endDate&&b.syncedAt.slice(0,10)>=b.endDate;if(positive&&finalized&&a.endDate<b.startDate&&days(a.startDate,a.endDate)===days(b.startDate,b.endDate)&&days(a.endDate,b.startDate)===1){historyComparisons++;i+=2;}else i++;}
 const di=valid?current!.impressions-previous!.impressions:null, growthPct=valid&&previous!.impressions>0?(di!/previous!.impressions)*100:null;
 let status:'increasing'|'declining'|'stable'|'newly_observed'|'opportunity'|'unknown'=!valid?'opportunity':di!>0?'increasing':di!<0?'declining':'stable';
 const cfg=watch.discovery??{minImpressions:3,minIncrease:3,minGrowthPct:25}; const qualified=valid&&current!.impressions>=cfg.minImpressions&&previous!.impressions>0&&di!>=cfg.minIncrease&&growthPct!>=cfg.minGrowthPct;
 if(!valid&&current&&!previous)status='newly_observed';
 return {signal:{source:'gsc' as const,status,confidence:current&&current.impressions<8||previous&&previous.impressions<8?'low_volume' as const:valid?'observed' as const:'insufficient' as const,basis:qualified?'Observed GSC query demand increase, NOT public Google Trends growth or a forecast.':'Cached GSC queryPerformance evidence only; no forecast or public Google Trends inference.',comparisonValid:valid,invalidReason:valid?undefined:invalidReason,current,previous,deltas:{impressions:di,clicks:valid?current!.clicks-previous!.clicks:null,ctrPp:valid&&current!.ctr!==null&&previous!.ctr!==null?(current!.ctr-previous!.ctr)*100:null,positionImprovement:valid?previous!.position-current!.position:null},growthPct,periods:p,history:history.map(({finalized:_finalized,...point})=>point),historyComparisons},qualified};
}

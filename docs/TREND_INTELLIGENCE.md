# Phase 4 Trend Intelligence — implementation contract

Base: synced main `7821eeace53dc3961c44e24ac16e41f7da3fd919`; branch `feat/trend-intelligence-phase4`. No push/deploy/commit before acceptance. Existing Social/SEO behavior retained. Low cost: no paid AI, no new package, no autonomous publisher, no scheduler.

## Product and evidence rules

Use fixed official public source `https://trends.google.com/trending/rss?geo=ID`, bounded request/timeout/size and no arbitrary redirects/URLs. Parse XML via existing SEO Python venv stdlib + defusedxml, not regex/XML external entities. No article/image fetch. Retain snapshot timestamp, source URL, feed fetchedAt, HTTP outcome, raw approximate traffic text, parsed lower bound nullable, publication time and news source/link. Missing/unavailable != empty success. Keep last-good data labeled stale when refresh fails. Cooldown 15 min, no automatic polling network.

Brand watchlists: workspace-scoped, configurable topics and include/exclude phrases. Reuse existing registry identities and include the three owner-requested watchlist brands Magrade, Brescia Stone and Global Stone when absent; these are watchlist configurations, not new social accounts, SEO websites or Google properties. Matching uses normalized Unicode word/phrase boundaries, not substring `mar` in names. Explain matched phrase and which field; news headline mention is weaker relevance than topic title. No popularity invented by brand relevance.

Classification:
- `rising_trend`: same RSS topic and publication cycle in at least two distinct dated snapshots, positive numeric lower-bound traffic increase with >=15 min interval; expose prior/current bounds + timestamps, delta, caveat 'approximate bucket movement, not exact search growth'. No fabricated percentage or normalized Trends 0–100 index.
- `trend_observation`: present in Trending Now RSS, but insufficient/comparable evidence to measure increase. Never market this as verified growth; first-seen is not rising.
- `gsc_opportunity`: actual cached GSC keyword opportunity in workspace+website exact brand mapping, period/metrics/confidence/property/syncedAt carried; not a real-time public trend. Current GSC readonly local owner connection gates access; report retrieval only, no forced sync.
- `content_idea`: ordinary watchlist editorial idea, explicitly no external trend evidence. Recommendations may exist without matching public trends; label their basis plainly.

Generate 3 original deterministic briefs per candidate: `article`, `reel`, `social_post`, title/hook/outline/CTA and reason/evidence, no stock/price/technical facts invented. Public RSS text is untrusted data, never code or AI instructions.

## Backend service contract

`backend/src/services/trends/types.ts`, `TrendStore.ts`, `TrendEngine.ts`, `TrendsRss.ts`, `parse_trends_rss.py`; no social DB schema edits.

Types:
```
BrandWatch {brandKey,brandName,topics:string[],exclude:string[],updatedAt}
TrendItem {topic,publishedAt:string|null,trafficText,trafficLowerBound:number|null,sourceUrl,news:Array<{title,url,source}>}
FeedSnapshot {id:string,fetchedAt,sourceUrl,status:'ok'|'unavailable',httpStatus:number|null,error:string|null,items:TrendItem[]}
GscInput {websiteId,websiteName,brandKey,report:GscReport}
Candidate {id,brandKey,topic,classification,reason,relevance:{matchedTerms:string[],field:string},momentum:{previous:number|null,current:number|null,delta:number|null,previousAt:string|null,currentAt:string|null,measured:boolean,caveat:string},evidence:object[]}
Recommendation {id,candidateId,brandKey,topic,classification,format:'article'|'reel'|'social_post',title,content,reason,evidence:object[]}
Radar {brandKey,watchlist:BrandWatch,source:{latest:FeedSnapshot|null,lastGood:FeedSnapshot|null,cooldownUntil:string|null},candidates:Candidate[],recommendations:Recommendation[],gscStatus:string,limitations:string[]}
```

Store constructor(path), watchlists(workspace): BrandWatch[], saveWatchlist(workspace,watch), snapshots(limit=20): FeedSnapshot[], saveSnapshot(snapshot): FeedSnapshot, latestSnapshot(): FeedSnapshot|null, lastGoodSnapshot(): FeedSnapshot|null, close(). Snapshot fetch is shared public feed, brand watchlists are scoped. Append immutable snapshot records; idempotent snapshot id; caller caps retention/rows. `buildRadar(watch,snapshots,gscInputs,gscStatus)` returns Radar, no network/DB side effects. `fetchIndonesiaFeed()` returns FeedSnapshot, injectable fetch/now for tests; malformed feeds fail explicitly.

Local private SQLite: per-user installation path `LOCALAPPDATA/RockBase/installations/<same-root-hash>/trends.sqlite`, distinct from social/GSC DB. Bound histories to latest 96 snapshots and feed 100 items; raw archive optional in private scratch, never Git. No private GSC copy persisted in public feed snapshots. Candidate/recommendation IDs must be deterministic across reloads and include evidence identity so draft provenance is stable.

## Routes / UI contract (parent integration)

All `/api/trends` routes behind existing `authenticateToken`, no-store, Local Mode owner+loopback+Host/Origin gate. Server Mode fails closed before data/vault read.
- `GET /brands?workspace_id=` returns `{workspaces:[{id,name}],brands:[{key,name,workspace_id}],watchlists:BrandWatch[]}` from actual workspace+SEO brand registry.
- `PUT /watchlist` body `{workspace_id,brand_key,topics:string[],exclude:string[]}` authorized existing brand; validate max30 phrases/100 chars, no blank.
- `POST /refresh` body `{workspace_id}` fetches shared fixed RSS once, cooldown15min, retains failure outcome; no Google request.
- `GET /radar?workspace_id=&brand_key=` returns Radar using persisted feed and read-only existing GSC reports. Disconnected GSC never consumed.
- `POST /drafts` body `{workspace_id,brand_key,recommendation_id}` server recomputes recommendation from current evidence; creates idempotent existing Prisma `Draft` record (not Post/Campaign/queue). Draft title/content carry evidence provenance and do not preselect accounts/schedule. Store cross-link in trend DB, use deterministic scoped Draft ID for replay safety. Response `{draft:{id,title,content,workspaceId},composeUrl:'/compose?draftId=...&workspace_id=...'}`.
- `GET /drafts/:id?workspace_id=` returns `{draft}` workspace-owned existing draft, not arbitrary user-supplied content.

Frontend native `/trends` inside existing shell. Brand picker, editable watchlist, explicit refresh, source time/status/cooldown, separate classification labels, candidate evidence/details/momentum, filter format/classification, create/open draft with no publication. Empty and unavailable states honest. Use authenticated axios. Add Compose read-only draft loader with visible provenance and explicit 'apply to editor' click, zero auto account selection/publish. Preserve existing campaign/planner draft flows.

## Acceptance

Test parser malformed/missing metrics/XXE; snapshot atomicity/cooldown/stale; boundaries/relevance; first snapshot not rise, time interval/cycle match; measured lower-bound delta fixture; GSC periods and low-volume unchanged; private scopes and server-mode no reads; deterministic idempotent Draft with concurrent/replayed requests. Build backend/frontend; actual end-to-end RSS live fetch→private snapshot→brand matching/GSC reports→recommendations→existing Draft→Compose/reload; no fabricated live rising case if none exists. Browser desktop/mobile, zero publish/queue/network side effects beyond approved feed read and draft creation. No owner credential changes. No push/deploy.

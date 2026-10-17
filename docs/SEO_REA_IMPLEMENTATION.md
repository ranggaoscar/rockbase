# SEO improvements from controlled REA R&D

## Scope

Implement the three accepted independent improvements in the existing `/seo` module: typed link graph/depth; canonical/redirect integrity and duplicate descriptions; grouped actionable issues and evidence exports. No vendor implementation/text copying, new infrastructure, live Google calls, owner-data changes, push or deployment. Preserve existing URL safety, robots behavior, scan history, Local Mode and GSC.

## Stable internal contracts

### Extraction additions (existing `rules.extract_page`)

Keep existing fields and `status_code` as the final observed HTTP status for backward compatibility. Add `first_status_code`, `final_status_code`, `link_edges` and `link_edges_truncated`. Each occurrence edge has `source_url`, `target_url`, `kind` (`hyperlink` or `canonical`), `anchor`, `rel` (string array), `follow` (boolean), `occurrence` (integer). Preserve repeated hyperlinks and nofollow. Body edges belong to the final observed document. Redirect edges are derived separately from `redirect_chain`. Never retain credential-bearing URL values in new fields. Inaccessible targets remain unknown.

Integrity rule codes: `duplicate_description`, `canonical_target_error`, `canonical_target_noindex`, `canonical_target_blocked`, `canonical_target_redirect`, `canonical_target_unknown`, `canonical_loop`, `canonical_conflict`, `canonical_invalid`, `redirect_chain`, `redirect_loop`, `redirect_broken`. Existing rule codes stay readable. Canonical to another valid URL and intentional noindex remain review findings, not proof of a Google indexing failure. Failed redirect traversal must preserve observed hops.

### `GET /api/seo/scans/:id/graph`

Workspace-scoped. Returns `{available, version:1, start_url, nodes, edges, histogram, coverage, warnings}`. Edges use the above shape plus `redirect` and `sitemap` kinds, with observed `source_status_code`, `target_status_code`, `target_final_status_code` and `status_code` for redirect hops. Nodes: `{url, observed, status_code, indexable, depth:number|null, redirect_hops:number|null, path:string[], inlinks, unique_inlinks, followed_inlinks, unique_followed_inlinks, outlinks, unique_outlinks, discovery_sources:string[]}`. Link counters count hyperlink occurrences only; canonical/redirect/sitemap are separate typed relations. Depth uses followed hyperlinks (cost one) with redirects (cost zero); hop count stays explicit. Canonicals/sitemaps do not establish HTML navigational depth. Histogram entries `{depth,count}`. Coverage includes `scope:'observed_scan'`, `complete:false`, `truncated`, `legacy`, `edge_count`. Legacy scans without occurrence data return `available:false`, never invented occurrences. Graph is persisted in additive SEO-only `scan_graphs`, not social DB.

### `GET /api/seo/scans/:id/issue-groups`

Returns `{groups, coverage, note}`. Group: `{code,category,issue_type,priority,confidence,title,recommendation,fix_steps:string[],priority_reason,affected_count,eligible_count,coverage_pct:number|null,affected_urls:string[],occurrences,issues:Issue[]}`. Priority remains `high|medium|low`; types `issue|warning|opportunity|insight`; confidence `observed|review|unknown`. Category `links|metadata|indexability|redirects|access`. Denominator is the population eligible for that rule in the selected scan, not unqualified all-URL totals. Old issues gain read-time metadata defaults, not DB rewrites. Grouped sorting is deterministic and explained; no AI score, ranking or revenue prediction.

### Exports

Existing export route accepts `kind=pages|issues|links|issue-groups|actions`, `format=csv|json`; existing `q`, `priority`, `status` filters remain. Action/group exports also accept `category`, `confidence`, `issue_type` and apply the active filters against the same unfiltered eligible population. JSON carries scan identity and coverage notes. Actions are flattened source→target→first/final status→rule reason→fix steps with group denominator. Links are typed occurrences. CSV guards formula injection and supports mixed old/new records using the union of keys. HTTP adapter remains authenticated/workspace-scoped and forwards only allowlisted routes and query keys.

## Acceptance

- Duplicate link occurrences vs unique source counts; hyperlink vs canonical; nofollow respected; depth four; shortest-path relaxation independent of crawl order; sitemap-only unknown depth; legacy unknown and incomplete coverage.
- Differentiate safe canonical consolidation from 404/noindex/blocked/redirect/loop/unknown; no extra unsafe network requests. Preserve first/final statuses and redirect hops; duplicate descriptions grouped separately from body content and redirect aliases.
- Group issues with eligible denominator, confidence, written-original fix checklist and rationale; drill down and export source-target evidence. Intentional noindex not presented as an unconditional fix.
- Exercise fixture crawler→SQLite→API→UI, export and reload; test denied workspace access and legacy data; TypeScript/build gates. Tests use scratch databases, no real social queue or credentials.

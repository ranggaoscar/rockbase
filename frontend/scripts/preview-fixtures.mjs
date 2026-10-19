#!/usr/bin/env node
/**
 * RockBase UI preview fixtures — SYNTHETIC DATA ONLY.
 *
 * A dependency-free stand-in for the backend so the interface can be reviewed
 * on desktop and mobile without starting the real API, workers, queues,
 * browser sessions, Google connections or AI providers. Nothing here proves a
 * live integration; it only exercises UI states.
 *
 *   node scripts/preview-fixtures.mjs            # listens on 127.0.0.1:3911
 *   ROCKBASE_API_TARGET=http://127.0.0.1:3911 VITE_ROCKBASE_MODE=local npm run dev
 *
 * Switch scenario at runtime:  POST /__fixture/scenario/{full|empty|degraded}
 * All brands, domains and numbers are fictional (*.example domains).
 */
import http from 'node:http'
import { createHash } from 'node:crypto'

const PORT = Number(process.env.FIXTURE_PORT || 3911)
let scenario = process.env.FIXTURE_SCENARIO || 'full'

const now = Date.now()
const iso = (offsetMs = 0) => new Date(now + offsetMs).toISOString()
const H = 3_600_000, D = 24 * H
const day = (offsetDays) => new Date(now + offsetDays * D).toISOString().slice(0, 10)
const NOTE = 'SYNTHETIC PREVIEW FIXTURE — not owner data, not a live integration.'

/* ── Identity ───────────────────────────────────────────────────────────── */
const workspaces = [{ id: 'ws-demo', name: 'Demo Studio' }]
const brands = [
  { key: 'fieldnote', name: 'Fieldnote Coffee', workspace_id: 'ws-demo', source: 'WebsiteBrand' },
  { key: 'harbor', name: 'Harbor Ceramics', workspace_id: 'ws-demo', source: 'WebsiteBrand' },
]
const websites = [
  { id: '11', name: 'Fieldnote Coffee', base_url: 'https://fieldnote.example', workspace_id: 'ws-demo', brand_key: 'fieldnote' },
  { id: '12', name: 'Harbor Ceramics', base_url: 'https://harbor-ceramics.example', workspace_id: 'ws-demo', brand_key: 'harbor' },
]

/* ── SEO crawl ──────────────────────────────────────────────────────────── */
const scans = {
  11: [
    { id: '301', website_id: '11', status: 'completed', started_at: iso(-3 * H), finished_at: iso(-3 * H + 4 * 60_000), max_urls: 100, mode: 'auto', pages_count: 64, issues_count: 23,
      summary: { status_counts: { '200': 58, '301': 4, '404': 2 }, priority_counts: { high: 4, medium: 11, low: 8 }, indexable_count: 55, robots_url: 'https://fieldnote.example/robots.txt', robots_status: 200, sitemap_urls: [{ url: 'https://fieldnote.example/sitemap.xml', status: 200 }], sitemap_discovered: 61, discovered_count: 71, skipped_robots: 3, warnings: [NOTE] } },
    { id: '288', website_id: '11', status: 'completed', started_at: iso(-8 * D), finished_at: iso(-8 * D + 5 * 60_000), max_urls: 100, mode: 'auto', pages_count: 60, issues_count: 31,
      summary: { status_counts: { '200': 52, '404': 8 }, priority_counts: { high: 7, medium: 14, low: 10 }, indexable_count: 49, warnings: [NOTE] } },
  ],
  12: [],
}
const groupsFor = () => [
  { code: 'meta_description_missing', category: 'metadata', issue_type: 'issue', priority: 'high', confidence: 'observed', title: 'Product pages are missing meta descriptions', recommendation: 'Write a unique 140–160 character description for each product page. Lead with the roast profile and brew method.', fix_steps: ['Export the affected URLs', 'Draft descriptions in your CMS', 'Rescan to confirm'], priority_reason: 'Affects indexable product pages that receive search impressions.', affected_count: 12, eligible_count: 55, coverage_pct: 21.8, affected_urls: ['https://fieldnote.example/shop/ethiopia-guji', 'https://fieldnote.example/shop/colombia-huila', 'https://fieldnote.example/shop/house-blend'], occurrences: 12, issues: [] },
  { code: 'broken_internal_link', category: 'links', issue_type: 'issue', priority: 'high', confidence: 'observed', title: 'Internal links point to 404 pages', recommendation: 'Update or remove links to retired brew guides.', fix_steps: ['Open each source page', 'Replace the link target', 'Rescan'], priority_reason: 'Broken links waste crawl budget and strand readers.', affected_count: 2, eligible_count: 64, coverage_pct: 3.1, affected_urls: ['https://fieldnote.example/guides/aeropress-old'], occurrences: 5, issues: [] },
  { code: 'title_too_long', category: 'metadata', issue_type: 'warning', priority: 'medium', confidence: 'observed', title: 'Titles longer than 60 characters', recommendation: 'Shorten titles so the brand name is not truncated.', fix_steps: ['Trim to under 60 characters'], priority_reason: 'May be truncated in results; impact unverified.', affected_count: 9, eligible_count: 64, coverage_pct: 14.1, affected_urls: ['https://fieldnote.example/guides/pour-over-ratio-guide-for-beginners'], occurrences: 9, issues: [] },
  { code: 'redirect_chain', category: 'redirects', issue_type: 'warning', priority: 'medium', confidence: 'review', title: 'Redirect chains of 2+ hops', recommendation: 'Point links directly at the final URL.', fix_steps: ['Update internal links'], priority_reason: 'Adds latency; review whether chains are intentional.', affected_count: 4, eligible_count: 64, coverage_pct: 6.3, affected_urls: ['https://fieldnote.example/brew'], occurrences: 4, issues: [] },
  { code: 'thin_h1', category: 'metadata', issue_type: 'opportunity', priority: 'low', confidence: 'review', title: 'Pages without a descriptive H1', recommendation: 'Add a single H1 that states the page topic.', fix_steps: ['Add H1'], priority_reason: 'Low impact; editorial clarity.', affected_count: 6, eligible_count: 64, coverage_pct: 9.4, affected_urls: [], occurrences: 6, issues: [] },
]
const issuesFor = () => groupsFor().flatMap((g, gi) => g.affected_urls.map((url, i) => ({ id: `${gi}-${i}`, scan_id: '301', code: g.code, priority: g.priority, title: g.title, recommendation: g.recommendation, url })))
const pagesFor = () => Array.from({ length: 18 }, (_, i) => ({
  id: `p${i}`, scan_id: '301', url: i === 0 ? 'https://fieldnote.example/' : `https://fieldnote.example/${['shop', 'guides', 'journal'][i % 3]}/item-${i}`,
  status_code: i === 7 ? 404 : i === 9 ? 301 : 200, title: i === 7 ? null : `Fieldnote page ${i}`, indexable: i % 6 !== 5, render_mode: 'http', depth: i % 4, inlinks: 3 + i, unique_inlinks: 2 + i, outlinks: 12, unique_outlinks: 10,
}))

/* ── Google Search Console (cached report) ──────────────────────────────── */
const gscState = { configured: true, connected: true }
const report = (days = 28, syncedOffset = -2 * D) => {
  const end = -3, start = end - days + 1
  const dates = Array.from({ length: days }, (_, i) => { const imp = 380 + Math.round(90 * Math.sin(i / 3)) + i * 6; const clk = Math.round(imp * (0.031 + (i % 5) * 0.002)); return { keys: [day(start + i)], clicks: clk, impressions: imp, ctr: clk / imp, position: 14.2 - i * 0.05 } })
  const sum = (k) => dates.reduce((a, r) => a + r[k], 0)
  return {
    mapping: { workspaceId: 'ws-demo', websiteId: '11', property: 'sc-domain:fieldnote.example', brandKey: 'fieldnote' },
    periods: { current: { startDate: day(start), endDate: day(end) }, previous: { startDate: day(start - days), endDate: day(start - 1) } },
    totals: { current: { clicks: sum('clicks'), impressions: sum('impressions'), ctr: sum('clicks') / sum('impressions'), position: 13.6 }, previous: { clicks: Math.round(sum('clicks') * 0.86), impressions: Math.round(sum('impressions') * 0.91), ctr: (sum('clicks') * 0.86) / (sum('impressions') * 0.91), position: 15.1 } },
    dates,
    freshness: { timeZone: 'America/Los_Angeles', dataState: 'final', lastReturnedDate: day(end), searchType: 'web' },
    crawlStatus: 'Joined exact URLs against completed crawl 301.',
    pagePerformance: [
      { page: 'https://fieldnote.example/guides/pour-over-ratio', clicks: 212, impressions: 5120, ctr: 0.0414, position: 6.2, previous: { clicks: 160, impressions: 4300, ctr: 0.037, position: 7.9 }, clickDelta: 52, crawl: { status_code: 200, indexable: true, issues: 1 } },
      { page: 'https://fieldnote.example/shop/ethiopia-guji', clicks: 88, impressions: 2210, ctr: 0.0398, position: 9.4, previous: { clicks: 91, impressions: 2050, ctr: 0.044, position: 9.1 }, clickDelta: -3, crawl: { status_code: 200, indexable: true, issues: 2 } },
      { page: 'https://fieldnote.example/journal/cold-brew-at-home', clicks: 41, impressions: 1904, ctr: 0.0215, position: 11.8, previous: null, clickDelta: null, crawl: { note: 'Not observed in the latest completed crawl.' } },
    ],
    keywordOpportunities: [
      { query: 'pour over coffee ratio', clicks: 64, impressions: 2310, ctr: 0.0277, position: 7.4, reason: 'Position 4–20 with ≥50 impressions; a better snippet or section may lift clicks.', confidence: 'established' },
      { query: 'cold brew concentrate ratio', clicks: 9, impressions: 640, ctr: 0.014, position: 12.9, reason: 'Ranking on page two with steady impressions.', confidence: 'established' },
      { query: 'guji natural tasting notes', clicks: 1, impressions: 31, ctr: 0.032, position: 15.2, reason: 'Low-volume query in positions 4–20.', confidence: 'low_volume' },
    ],
    queryPerformance: [],
    ctrOpportunities: [{ page: 'https://fieldnote.example/journal/cold-brew-at-home', clicks: 41, impressions: 1904, ctr: 0.0215, position: 11.8, reason: 'CTR below the site median for this position band.' }],
    coverage: { pagePerformance: { rowCount: 3, truncated: false }, keywordOpportunities: { rowCount: 3, truncated: false } },
    syncedAt: iso(syncedOffset),
    limitations: [NOTE, 'Google anonymises low-volume queries; totals will not equal the sum of rows.'],
  }
}

/* ── Trend Radar ───────────────────────────────────────────────────────── */
const watch = { brandKey: 'fieldnote', brandName: 'Fieldnote Coffee', topics: ['pour over', 'cold brew', 'single origin', 'coffee grinder'], exclude: ['jobs', 'barista vacancy'], discovery: { minImpressions: 3, minIncrease: 3, minGrowthPct: 25 }, updatedAt: iso(-6 * D) }
const feed = { id: 'snap-1', fetchedAt: iso(-4 * H), sourceUrl: 'https://trends.google.com/trending/rss?geo=ID', status: 'ok', httpStatus: 200, error: null, items: [] }
const radar = (brandKey) => {
  const candidates = [
    { id: 'c1', brandKey, topic: 'pour over coffee ratio', classification: 'gsc_opportunity', reason: 'Impressions rose between comparable GSC periods for a watched topic.',
      relevance: { matchedTerms: ['pour over'], field: 'query' },
      momentum: { previous: 1840, current: 2310, delta: 470, previousAt: iso(-31 * D), currentAt: iso(-3 * D), measured: true, caveat: 'Measured GSC impressions for two comparable 28-day periods. Not a forecast.' },
      signal: { source: 'gsc', status: 'increasing', confidence: 'observed', basis: 'Comparable 28-day periods from the cached GSC report.', comparisonValid: true, current: { clicks: 64, impressions: 2310, ctr: 0.0277, position: 7.4 }, previous: { clicks: 47, impressions: 1840, ctr: 0.0255, position: 8.6 }, deltas: { impressions: 470, clicks: 17, ctrPp: 0.22, positionImprovement: 1.2 }, growthPct: 25.5, periods: { current: { startDate: day(-30), endDate: day(-3) }, previous: { startDate: day(-58), endDate: day(-31) } }, history: [{ snapshotId: 'h1', capturedAt: iso(-10 * D), syncedAt: iso(-10 * D), startDate: day(-38), endDate: day(-11), impressions: 2050, clicks: 52, ctr: 0.025, position: 8.1 }], historyComparisons: 1 },
      evidence: [{ type: 'google_search_console_cached', title: 'Search Console · pour over coffee ratio', query: 'pour over coffee ratio', property: 'sc-domain:fieldnote.example', clicks: 64, impressions: 2310, ctr: 0.0277, position: 7.4, syncedAt: iso(-2 * D) }] },
    { id: 'c2', brandKey, topic: 'cold brew', classification: 'rising_trend', reason: 'Trending Now traffic bucket moved up between two saved feed snapshots.',
      relevance: { matchedTerms: ['cold brew'], field: 'title' },
      momentum: { previous: 2000, current: 5000, delta: 3000, previousAt: iso(-28 * H), currentAt: iso(-4 * H), measured: true, caveat: 'Approximate traffic bucket movement (2K+ → 5K+), not exact search growth.' },
      signal: { source: 'rss', status: 'increasing', confidence: 'observed', basis: 'Public Trending Now RSS buckets, Indonesia.', comparisonValid: true, current: null, previous: null, deltas: { impressions: null, clicks: null, ctrPp: null, positionImprovement: null }, growthPct: null, periods: null, history: [], historyComparisons: 0 },
      evidence: [{ type: 'google_trends_rss', title: 'cold brew', trafficText: '5K+', trafficLowerBound: 5000, fetchedAt: iso(-4 * H), url: 'https://trends.google.com/trending/rss?geo=ID', news: [{ title: 'Example: summer café menus lean into cold brew', url: 'https://news.example/cold-brew', source: 'news.example' }] }] },
    { id: 'c3', brandKey, topic: 'single origin', classification: 'trend_observation', reason: 'Seen once in the Trending Now feed; no earlier snapshot to compare.',
      relevance: { matchedTerms: ['single origin'], field: 'news' },
      momentum: { previous: null, current: 1000, delta: null, previousAt: null, currentAt: iso(-4 * H), measured: false, caveat: '' },
      signal: { source: 'rss', status: 'newly_observed', confidence: 'insufficient', basis: 'First observation only.', comparisonValid: false, invalidReason: 'No previous snapshot.', current: null, previous: null, deltas: { impressions: null, clicks: null, ctrPp: null, positionImprovement: null }, growthPct: null, periods: null, history: [], historyComparisons: 0 },
      evidence: [{ type: 'google_trends_rss', title: 'single origin espresso', trafficText: '1K+', trafficLowerBound: 1000, fetchedAt: iso(-4 * H) }] },
    { id: 'c4', brandKey, topic: 'coffee grinder', classification: 'content_idea', reason: 'Watchlist topic with no external evidence in saved sources.',
      relevance: { matchedTerms: ['coffee grinder'], field: 'watchlist' },
      momentum: { previous: null, current: null, delta: null, previousAt: null, currentAt: null, measured: false, caveat: '' },
      evidence: [] },
  ]
  const rec = (id, c, format, title, content) => ({ id, candidateId: c.id, brandKey, topic: c.topic, classification: c.classification, format, title, content, reason: c.reason, evidence: c.evidence })
  const recommendations = [
    rec('r1', candidates[0], 'article', 'The pour-over ratio guide, rewritten for page one', '# Working title\nThe pour-over ratio guide\n\n## Search intent\nPeople searching “pour over coffee ratio” want a number fast, then a reason to adjust.\n\n## Outline\n1. The 1:16 starting point\n2. When to go stronger\n3. A printable ratio card\n\n## Evidence to cite\nGSC impressions rose 25.5% between comparable periods.'),
    rec('r2', candidates[0], 'social_post', 'Carousel: three ratios, three cups', 'Slide 1 — “1:15, 1:16, 1:17. Same beans, three cups.”\nSlide 2 — What changes in the cup…\nCTA — Save this for your next brew.'),
    rec('r3', candidates[1], 'reel', 'Reel: 20-second cold brew concentrate', 'Hook: “Cold brew in one jar, no gadgets.”\nBeats: grind → steep 14h → dilute 1:1.'),
    rec('r4', candidates[3], 'article', 'Choosing a first grinder (editorial idea)', '# Editorial idea\nNo trend evidence. Write only if it serves your audience.'),
  ]
  return { brandKey, watchlist: { ...watch, brandKey }, source: { latest: feed, lastGood: feed, cooldownUntil: null }, candidates, recommendations,
    gscStatus: 'Cached GSC report for sc-domain:fieldnote.example (synced 2 days ago).', limitations: [NOTE, 'RSS traffic values are buckets, not counts.'],
    historyStatus: { count: 1, lastCapturedAt: iso(-10 * D), note: 'Private cached GSC history only. No Google sync.' } }
}

/* ── Drafts (Prisma Draft rows created from Radar) ─────────────────────── */
const SEP = '\n\n---\nProvenance (review, not a publication claim):\n'
const drafts = new Map()
const seedDraft = (rec, ageMs) => {
  const id = 'trend-' + createHash('sha256').update(JSON.stringify(['ws-demo', 'fieldnote', rec.id])).digest('hex')
  const provenance = { source: 'RockBase Trend Radar', classification: rec.classification, brandKey: rec.brandKey, topic: rec.topic, format: rec.format, reason: rec.reason, evidence: rec.evidence }
  drafts.set(id, { id, workspaceId: 'ws-demo', title: rec.title, content: rec.content + SEP + JSON.stringify(provenance, null, 2), platforms: rec.format === 'article' ? '[]' : '["Instagram"]', createdAt: iso(-ageMs), updatedAt: iso(-ageMs / 2) })
  return id
}
const resetDrafts = () => { drafts.clear(); if (scenario !== 'empty') { const r = radar('fieldnote').recommendations; seedDraft(r[0], 2 * D); seedDraft(r[1], 5 * H) } }

/* ── Social operations ─────────────────────────────────────────────────── */
const opsSummary = () => scenario === 'empty'
  ? { accounts: { total: 0, ready: 0, unverified: 0, attention: 0, disconnected: 0 }, campaigns: { active: 0, draft: 0 }, publishingQueue: { queued: 0, running: 0, delayed: 0 }, recentActivity: [] }
  : { accounts: { total: 6, ready: 4, unverified: 0, attention: 2, disconnected: 1 }, campaigns: { active: 1, draft: 2 }, publishingQueue: { queued: 3, running: 1, delayed: 1 },
      recentActivity: [{ id: 'a1', action: 'campaign_post_completed', status: 'success', message: 'Post completed for @fieldnote.roasters', createdAt: iso(-50 * 60_000), accountUsername: 'fieldnote.roasters', campaignName: 'Autumn single origins' }] }
const queueRows = () => [
  { id: 'q1', source: 'campaign', accountId: 'acc1', account: 'fieldnote.roasters', platform: 'instagram', campaign: 'Autumn single origins', status: 'completed', scheduledAt: iso(-2 * H), updatedAt: iso(-50 * 60_000), result: null },
  { id: 'q2', source: 'campaign', accountId: 'acc2', account: 'fieldnote.brewlab', platform: 'instagram', campaign: 'Autumn single origins', status: 'queued', scheduledAt: iso(2 * H), updatedAt: iso(-H), result: null },
  { id: 'q3', source: 'quick_post', accountId: 'acc3', account: 'harbor.studio', platform: 'tiktok', campaign: 'Quick post', status: 'needs_attention', scheduledAt: null, updatedAt: iso(-3 * H), result: 'Session expired — reconnect before retrying.' },
  { id: 'q4', source: 'campaign', accountId: 'acc1', account: 'fieldnote.roasters', platform: 'instagram', campaign: 'Autumn single origins', status: 'failed', scheduledAt: iso(-D), updatedAt: iso(-D), result: 'Upload rejected: media aspect ratio.' },
]

/* ── Router ────────────────────────────────────────────────────────────── */
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch { resolve({}) } }) })
const parseDraft = (d) => {
  const [body, tail] = d.content.split(SEP); let p = {}; try { p = tail ? JSON.parse(tail) : {} } catch {}
  return { id: d.id, title: d.title, excerpt: body.replace(/[#*>\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180), format: p.format || (d.platforms === '[]' ? 'article' : 'social_post'), topic: p.topic || null, classification: p.classification || null, brandKey: p.brandKey || null, createdAt: d.createdAt, updatedAt: d.updatedAt }
}

resetDrafts()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture')
  const p = url.pathname.replace(/^\/api/, '')
  const q = Object.fromEntries(url.searchParams)
  const m = req.method
  const degraded = scenario === 'degraded'
  const empty = scenario === 'empty'

  if (p.startsWith('/__fixture/scenario/') && m === 'POST') { scenario = p.split('/').pop(); resetDrafts(); return json(res, 200, { scenario }) }

  // SEO registry + crawler
  if (p === '/seo/brands') return degraded ? json(res, 503, { error: 'Existing workspace registry is unavailable; no social data was changed.' }) : json(res, 200, [{ key: '', name: 'Demo Studio', workspace_id: 'ws-demo', source: 'Workspace' }, ...brands])
  if (p === '/seo/websites' && m === 'GET') return degraded ? json(res, 503, { error: 'SEO worker unavailable' }) : json(res, 200, empty ? [] : websites)
  let mm
  if ((mm = p.match(/^\/seo\/websites\/(\d+)\/scans$/))) {
    if (m === 'POST') return json(res, 200, { ...scans[mm[1]]?.[0], id: '399', status: 'running', started_at: iso(), finished_at: null, pages_count: 12 })
    return json(res, 200, empty ? [] : scans[mm[1]] || [])
  }
  if ((mm = p.match(/^\/seo\/scans\/(\d+)$/))) return json(res, 200, mm[1] === '399' ? { ...scans[11][0], id: '399', status: 'completed', started_at: iso(-60_000), finished_at: iso() } : Object.values(scans).flat().find((s) => s.id === mm[1]) || scans[11][0])
  if (/^\/seo\/scans\/\d+\/pages$/.test(p)) return json(res, 200, pagesFor())
  if (/^\/seo\/scans\/\d+\/issues$/.test(p)) return json(res, 200, issuesFor())
  if (/^\/seo\/scans\/\d+\/issue-groups$/.test(p)) return json(res, 200, { groups: groupsFor(), coverage: { scope: 'scan population', complete: true }, note: NOTE })
  if (/^\/seo\/scans\/\d+\/compare$/.test(p)) return json(res, 200, { previous_scan_id: 288, added_urls: ['https://fieldnote.example/guides/pour-over-ratio', 'https://fieldnote.example/shop/house-blend', 'https://fieldnote.example/journal/cold-brew-at-home', 'https://fieldnote.example/shop/kenya-aa'], removed_urls: [], changed_urls: [{ url: 'https://fieldnote.example/', fields: { title: { before: 'Home', after: 'Fieldnote Coffee' } } }], new_issues: issuesFor().slice(0, 2), resolved_issues: Array.from({ length: 10 }, (_, i) => ({ ...issuesFor()[i % issuesFor().length], id: `resolved-${i}` })), note: null })
  if (/^\/seo\/scans\/\d+\/graph$/.test(p)) return json(res, 200, { available: true, version: 2, start_url: 'https://fieldnote.example/', nodes: pagesFor().map((x) => ({ url: x.url, observed: true, status_code: x.status_code, indexable: x.indexable, depth: x.depth, redirect_hops: 0, path: [], inlinks: x.inlinks, unique_inlinks: x.unique_inlinks, followed_inlinks: x.inlinks, unique_followed_inlinks: x.unique_inlinks, outlinks: 12, unique_outlinks: 10, discovery_sources: ['crawl'] })), edges: [{ source_url: 'https://fieldnote.example/', target_url: 'https://fieldnote.example/shop/item-3', kind: 'hyperlink', anchor: 'Shop', follow: true, source_status_code: 200, target_status_code: 200, target_final_status_code: 200 }], histogram: [{ depth: 0, count: 1 }, { depth: 1, count: 6 }, { depth: 2, count: 7 }, { depth: 3, count: 4 }], coverage: { scope: 'observed scan', complete: true }, warnings: [] })
  if (/^\/seo\/scans\/\d+\/export$/.test(p)) return json(res, 200, { note: NOTE })

  // GSC (cached projection; sync is simulated and only on explicit POST)
  if (p === '/gsc/status') {
    if (empty) return json(res, 200, { enabled: true, configured: false, connected: false, pending: false, storage: 'Windows Credential Manager' })
    return json(res, 200, { enabled: true, configured: gscState.configured, connected: gscState.connected, pending: false, storage: 'Windows Credential Manager', provider: 'oauth_desktop' })
  }
  if (p === '/gsc/properties') return json(res, 200, [{ siteUrl: 'sc-domain:fieldnote.example', permissionLevel: 'siteOwner' }, { siteUrl: 'https://harbor-ceramics.example/', permissionLevel: 'siteFullUser' }])
  if (p === '/gsc/mapping' && m === 'GET') return json(res, 200, q.website_id === '11' ? report().mapping : null)
  if (p === '/gsc/mapping' && m === 'POST') { const b = await readBody(req); return json(res, 200, { workspaceId: b.workspace_id, websiteId: b.website_id, property: b.property }) }
  if (p === '/gsc/report') return json(res, 200, q.website_id === '11' ? report(Number(q.days) === 7 ? 7 : 28, degraded ? -9 * D : -2 * D) : null)
  if (p === '/gsc/sync' && m === 'POST') { const b = await readBody(req); return json(res, 200, report(b.days === 7 ? 7 : 28, 0)) }
  if (p === '/gsc/disconnect') { gscState.connected = false; return json(res, 200, { disconnected: true, revoked: false }) }
  if (p === '/gsc/config' || p === '/gsc/connect' || p === '/gsc/service-account') return json(res, 409, { message: 'Preview fixture: Google connection is disabled. No credentials are accepted.' })

  // Trend Radar
  if (p === '/trends/brands') return json(res, 200, { workspaces, brands: brands.map(({ source, ...b }) => b), watchlists: brands.map((b) => ({ ...watch, brandKey: b.key, brandName: b.name })) })
  if (p === '/trends/radar') return degraded ? json(res, 503, { error: 'Trend operation unavailable; retained data was not replaced.' }) : json(res, 200, empty ? { ...radar(q.brand_key), candidates: [], recommendations: [], source: { latest: null, lastGood: null, cooldownUntil: null }, gscStatus: 'GSC disconnected. No private report consumed.', historyStatus: { count: 0, lastCapturedAt: null, note: 'No history.' } } : radar(q.brand_key))
  if (p === '/trends/watchlist' && m === 'PUT') { const b = await readBody(req); Object.assign(watch, { topics: b.topics, exclude: b.exclude, discovery: b.discovery, updatedAt: iso() }); return json(res, 200, { ...watch, brandKey: b.brand_key }) }
  if (p === '/trends/refresh') return json(res, 200, { cached: true, snapshot: feed, cooldownUntil: iso(11 * 60_000) })
  if (p === '/trends/capture') return json(res, 200, { captured: 0, historyCount: 1, status: 'Cached GSC evidence captured locally. No Google request; repeated report is not new growth evidence.' })
  if (p === '/trends/drafts' && m === 'GET') return json(res, 200, { drafts: [...drafts.values()].filter((d) => d.workspaceId === (q.workspace_id || 'ws-demo')).map(parseDraft).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) })
  if (p === '/trends/drafts' && m === 'POST') { const b = await readBody(req); const rec = radar(b.brand_key).recommendations.find((r) => r.id === b.recommendation_id); if (!rec) return json(res, 409, { error: 'Recommendation changed or expired. Reload the current evidence.' }); const id = [...drafts.keys()].find((k) => k === 'trend-' + createHash('sha256').update(JSON.stringify(['ws-demo', 'fieldnote', rec.id])).digest('hex')) || seedDraft(rec, 0); const d = drafts.get(id); return json(res, 200, { draft: { id, title: d.title, content: d.content, workspaceId: d.workspaceId }, composeUrl: `/compose?draftId=${id}&workspace_id=ws-demo` }) }
  if ((mm = p.match(/^\/trends\/drafts\/(trend-[a-f0-9]{64})$/))) {
    const d = drafts.get(mm[1]); if (!d) return json(res, 404, { error: 'Draft not found in this workspace.' })
    if (m === 'PATCH') { const b = await readBody(req); const tail = d.content.includes(SEP) ? SEP + d.content.split(SEP)[1] : ''; d.content = String(b.body ?? '') + tail; if (typeof b.title === 'string') d.title = b.title; d.updatedAt = iso(Date.now() - now) }
    return json(res, 200, { draft: { id: d.id, title: d.title, content: d.content, workspaceId: d.workspaceId, createdAt: d.createdAt, updatedAt: d.updatedAt } })
  }

  // Social operations
  if (p === '/activity/operations-summary') return json(res, 200, opsSummary())
  if (p === '/activity/publishing-queue') return degraded ? json(res, 503, { error: 'Queue status unavailable' }) : json(res, 200, { rows: empty ? [] : queueRows() })
  if (p === '/activity/queue-summary') return json(res, 200, { waiting: 3, active: 1, delayed: 1 })
  if (p === '/activity') return json(res, 200, { items: [], nextCursor: null })

  if (m === 'GET') return json(res, 200, [])
  return json(res, 404, { error: 'Preview fixture: this action is not simulated. Nothing was sent anywhere.' })
})

server.listen(PORT, '127.0.0.1', () => console.log(`[fixtures] synthetic API on http://127.0.0.1:${PORT} · scenario=${scenario}`))

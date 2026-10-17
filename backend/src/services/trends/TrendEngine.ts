import { createHash } from 'node:crypto';
import type { BrandWatch, Candidate, CandidateClassification, FeedSnapshot, GscInput, Radar, Recommendation, TrendItem } from './types';
import { signalFor } from './GscNicheSignals';

export function normalizePhrase(value: string): string { return value.normalize('NFKC').toLocaleLowerCase('id-ID').trim().replace(/\s+/g, ' '); }
export function parseTrafficLowerBound(value: string): number | null {
  const match = value.trim().replace(/\s/g, '').match(/^([\d,.]+)([KMB])?\+?$/i);
  if (!match) return null;
  const grouped = /^\d{1,3}(?:,\d{3})+$/.test(match[1]);
  const number = Number(grouped ? match[1].replace(/,/g, '') : match[1].replace(',', '.')) * ({K:1000,M:1000000,B:1000000000}[match[2]?.toUpperCase() as 'K'|'M'|'B'] || 1);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
const id = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
function containsPhrase(text: string, phrase: string): boolean {
  if (phrase.length < 3) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text);
}
function relevance(watch: BrandWatch, item: TrendItem): { matchedTerms: string[]; field: string } | null {
  const excluded = watch.exclude.map(normalizePhrase).filter(Boolean);
  const topic = normalizePhrase(item.topic);
  const headlines = item.news.map(n => normalizePhrase(n.title));
  if (excluded.some(term => containsPhrase(topic, term) || headlines.some(headline => containsPhrase(headline, term)))) return null;
  const matched: string[] = [];
  const topicMatches = watch.topics.map(normalizePhrase).filter(Boolean).filter(term => containsPhrase(topic, term));
  if (topicMatches.length) matched.push(...topicMatches);
  if (matched.length) return { matchedTerms: [...new Set(matched)], field: 'topic' };
  const newsMatches = watch.topics.map(normalizePhrase).filter(Boolean).filter(term => headlines.some(headline => containsPhrase(headline, term)));
  return newsMatches.length ? { matchedTerms: [...new Set(newsMatches)], field: 'news_headline' } : null;
}
const candidateLabels: Record<CandidateClassification, string> = {
  rising_trend: 'Approximate RSS traffic bucket increased across comparable observations.',
  trend_observation: 'Present in public Trending Now RSS; evidence is insufficient to measure increase.',
  gsc_opportunity: 'Cached Search Console keyword opportunity; this is not a real-time public trend.',
  content_idea: 'Watchlist editorial idea only; no external trend evidence.'
};
function recommendationSet(c: Candidate): Recommendation[] {
  const subject = c.topic;
  const isGsc = c.signal?.source === 'gsc';
  const origin = c.classification === 'content_idea' ? 'ide watchlist tanpa bukti tren eksternal' : isGsc ? c.classification === 'rising_trend' ? 'perubahan permintaan query pada periode GSC tersimpan' : 'peluang keyword dari laporan GSC tersimpan' : c.classification === 'rising_trend' ? 'pergerakan bucket RSS yang terukur secara terbatas' : 'observasi RSS, bukan bukti pertumbuhan';
  const specs: Array<{ format: Recommendation['format']; title: string; content: string }> = [
    { format: 'article', title: `Panduan memilih ${subject} untuk proyek yang tahan lama`, content: `Buat artikel orisinal tentang ${subject}. Outline: kebutuhan proyek; cara membandingkan karakter visual; pertanyaan untuk ditanyakan kepada pemasok. Hindari klaim teknis, harga, atau stok yang belum diverifikasi. CTA: konsultasikan kebutuhan dan sampel dengan tim.` },
    { format: 'reel', title: `3 hal yang perlu diperhatikan saat membahas ${subject}`, content: `Hook: “Sebelum memilih ${subject}, cek tiga hal ini.” Tampilkan sampel nyata, variasi tampilan, dan konteks penggunaan tanpa klaim spesifikasi. Tutup dengan ajakan melihat material secara langsung.` },
    { format: 'social_post', title: `Pertanyaan untuk memulai percakapan tentang ${subject}`, content: `Post orisinal: “Saat merencanakan proyek, apa yang paling penting dari ${subject} — tampilan, perawatan, atau kecocokan ruang?” Ajak audiens menjawab; verifikasi semua detail produk sebelum menambahkan fakta.` }
  ];
  const sourceReason = isGsc ? `${c.reason} Source: cached GSC.` : candidateLabels[c.classification];
  return specs.map(s => ({ id: id([c.id, s.format]), candidateId: c.id, brandKey: c.brandKey, topic: c.topic, classification: c.classification, format: s.format, title: s.title, content: s.content, reason: `${sourceReason} Brief basis: ${origin}.`, evidence: c.evidence }));
}
function makeCandidate(watch: BrandWatch, topic: string, classification: CandidateClassification, reason: string, rel: { matchedTerms: string[]; field: string }, evidence: object[], momentum: Candidate['momentum']): Candidate {
  const candidateId = id([watch.brandKey, topic, classification, evidence]);
  return { id: candidateId, brandKey: watch.brandKey, topic, classification, reason, relevance: rel, momentum, evidence, };
}
const noMomentum = (): Candidate['momentum'] => ({ previous: null, current: null, delta: null, previousAt: null, currentAt: null, measured: false, caveat: 'No comparable numeric observations; missing values are not zero.' });
export function buildRadar(watch: BrandWatch, snapshots: FeedSnapshot[], gscInputs: GscInput[], gscStatus: string): Radar {
  const ordered = [...snapshots].sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt));
  const latest = ordered[0] ?? null;
  const lastGood = ordered.find(s => s.status === 'ok') ?? null;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  if (latest?.status === 'ok') for (const entry of latest.items) {
    const rel = relevance(watch, entry);
    if (!rel) continue;
    const key = normalizePhrase(entry.topic);
    if (seen.has(key)) continue;
    seen.add(key);
    const priorSnapshot = ordered.slice(1).find(s => s.status === 'ok' && Date.parse(latest.fetchedAt) - Date.parse(s.fetchedAt) >= 15 * 60 * 1000 && s.items.some(old => normalizePhrase(old.topic) === key && old.publishedAt === entry.publishedAt));
    const priorItem = priorSnapshot?.items.find(old => normalizePhrase(old.topic) === key && old.publishedAt === entry.publishedAt);
    const previous = priorItem?.trafficLowerBound ?? null;
    const current = entry.trafficLowerBound;
    const measured = !!priorSnapshot && entry.publishedAt !== null && Number.isFinite(Date.parse(entry.publishedAt)) && previous !== null && current !== null && current > previous;
    const momentum: Candidate['momentum'] = priorSnapshot ? { previous, current, delta: previous !== null && current !== null ? current - previous : null, previousAt: priorSnapshot.fetchedAt, currentAt: latest.fetchedAt, measured, caveat: measured ? 'Approximate bucket movement, not exact search growth.' : 'Comparable topic/cycle observed, but numeric lower-bound increase is not established; missing values are not zero.' } : noMomentum();
    const classification = measured ? 'rising_trend' : 'trend_observation';
    const evidence: object[] = [{ type: 'google_trends_rss', snapshotId: latest.id, fetchedAt: latest.fetchedAt, publishedAt: entry.publishedAt, sourceUrl: latest.sourceUrl, trafficText: entry.trafficText, trafficLowerBound: current, news: entry.news }];
    if (priorSnapshot && priorItem) evidence.push({ type: 'google_trends_rss_comparison', snapshotId: priorSnapshot.id, fetchedAt: priorSnapshot.fetchedAt, publishedAt: priorItem.publishedAt, trafficText: priorItem.trafficText, trafficLowerBound: previous });
    candidates.push(makeCandidate(watch, entry.topic, classification, candidateLabels[classification], rel, evidence, momentum));
  }
  for (const input of gscInputs) {
    if (input.brandKey !== watch.brandKey) continue;
    const rows = input.report.queryPerformance?.length ? input.report.queryPerformance : input.report.keywordOpportunities;
    const byQuery = new Set<string>();
    for (const kw of rows) {
      const query = normalizePhrase(kw.query);
      if (!query || byQuery.has(query)) continue;
      byQuery.add(query);
      const rel = relevance(watch, { topic: kw.query, publishedAt: null, trafficText: '', trafficLowerBound: null, sourceUrl: '', news: [] });
      // A keyword is relevant by configured topic phrase, never by substring brand matching.
      if (!rel) continue;
      const ev: any = { type: 'google_search_console_cached', websiteId: input.websiteId, websiteName: input.websiteName, brandKey: input.brandKey, property: input.report.mapping?.property ?? null, periods: input.report.periods, syncedAt: input.report.syncedAt, query: kw.query, clicks: kw.clicks, impressions: kw.impressions, ctr: kw.ctr, position: kw.position, previous: kw.previous ?? null, freshness: input.report.freshness, coverage: input.report.coverage, limitations: input.report.limitations };
      if ('reason' in kw) ev.reason = (kw as any).reason;
      if ('confidence' in kw) ev.confidence = (kw as any).confidence;
      const measured = signalFor(kw.query, kw, input, watch);
      const classification = measured.qualified ? 'rising_trend' : 'gsc_opportunity';
      const reason = measured.qualified ? measured.signal.basis : `${candidateLabels.gsc_opportunity} ${measured.signal.invalidReason ?? measured.signal.status}.`;
      const c = makeCandidate(watch, kw.query, classification, reason, rel, [ev], { previous: measured.signal.previous?.impressions ?? null, current: measured.signal.current?.impressions ?? null, delta: measured.signal.deltas.impressions, previousAt: input.report.periods.previous.endDate, currentAt: input.report.periods.current.endDate, measured: measured.qualified, caveat: measured.signal.basis });
      c.signal = measured.signal;
      candidates.push(c);
    }
  }
  if (!candidates.length) for (const topic of watch.topics) {
    const clean = topic.trim(); if (!clean) continue;
    if (!relevance(watch, { topic: clean, publishedAt: null, trafficText: '', trafficLowerBound: null, sourceUrl: '', news: [] })) continue;
    candidates.push(makeCandidate(watch, clean, 'content_idea', candidateLabels.content_idea, { matchedTerms: [topic], field: 'watchlist' }, [{ type: 'watchlist', updatedAt: watch.updatedAt, note: 'Editorial suggestion only; no public trend evidence.' }], noMomentum()));
  }
  const rank: Record<CandidateClassification, number> = { rising_trend: 0, gsc_opportunity: 1, trend_observation: 2, content_idea: 3 };
  candidates.sort((a, b) => rank[a.classification]-rank[b.classification] || Number(b.signal?.deltas.impressions ?? 0)-Number(a.signal?.deltas.impressions ?? 0) || Number(b.signal?.current?.impressions ?? 0)-Number(a.signal?.current?.impressions ?? 0) || a.topic.localeCompare(b.topic));
  const limitedCandidates = candidates.slice(0, 100);
  const recommendations = limitedCandidates.flatMap(recommendationSet).slice(0,300);
  const latestAt = latest ? Date.parse(latest.fetchedAt) : NaN;
  return { brandKey: watch.brandKey, watchlist: watch, source: { latest, lastGood, cooldownUntil: Number.isFinite(latestAt) ? new Date(latestAt + 15 * 60 * 1000).toISOString() : null }, candidates: limitedCandidates, recommendations, gscStatus, limitations: ['RSS approximate traffic values are bucket lower bounds, not exact volume or a Trends index.', 'One observation never establishes rising momentum.', 'Observed GSC increases are not public Google Trends growth or forecasts.', 'Cached GSC opportunities are separate from public trend evidence.', 'Briefs require human fact-checking; no price, stock, or technical claims are sourced here.', ...(candidates.length > 100 ? [`Candidate output truncated from ${candidates.length} to 100.`] : []), ...(candidates.length * 3 > 300 ? ['Recommendation briefs truncated to 300.'] : [])] };
}

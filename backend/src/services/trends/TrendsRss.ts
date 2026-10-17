import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { FeedSnapshot, TrendItem } from './types';

export const TRENDS_ID_RSS_URL = 'https://trends.google.com/trending/rss?geo=ID';
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8_000;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
interface ParsedFeed { items: TrendItem[] }
export interface FeedOptions { fetch?: Fetcher; now?: () => Date; pythonPath?: string }
function safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 200) : 'RSS request failed'; }
async function boundedBody(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error('RSS response exceeds size limit');
  if (!response.body) throw new Error('RSS response body missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('RSS response exceeds size limit'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
function parseXml(xml: string, pythonPath: string): TrendItem[] {
  const script = path.join(__dirname, 'parse_trends_rss.py');
  const result = spawnSync(pythonPath, [script], { input: xml, encoding: 'utf8', timeout: 4_000, maxBuffer: 1_000_000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('RSS XML parsing failed');
  const parsed = JSON.parse(result.stdout) as ParsedFeed;
  if (!Array.isArray(parsed.items) || parsed.items.length > 100) throw new Error('RSS parser returned invalid items');
  return parsed.items.slice(0, 100);
}
export async function fetchIndonesiaFeed(options: FeedOptions = {}): Promise<FeedSnapshot> {
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const python = options.pythonPath ?? path.resolve(__dirname, '../../../../modules/seo/.venv/Scripts/python.exe');
  const fetcher = options.fetch ?? globalThis.fetch;
  let httpStatus: number | null = null;
  try {
    const response = await fetcher(TRENDS_ID_RSS_URL, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    httpStatus = response.status;
    if (!response.ok) throw new Error(`RSS HTTP ${response.status}`);
    const xml = await boundedBody(response);
    const items = parseXml(xml, python);
    const id = createHash('sha256').update(`${TRENDS_ID_RSS_URL}\n${fetchedAt}\n${xml}`).digest('hex').slice(0, 32);
    return { id, fetchedAt, sourceUrl: TRENDS_ID_RSS_URL, status: 'ok', httpStatus, error: null, items };
  } catch (error) {
    return { id: createHash('sha256').update(`${TRENDS_ID_RSS_URL}\n${fetchedAt}\n${httpStatus}\n${safeError(error)}`).digest('hex').slice(0, 32), fetchedAt, sourceUrl: TRENDS_ID_RSS_URL, status: 'unavailable', httpStatus, error: safeError(error), items: [] };
  }
}

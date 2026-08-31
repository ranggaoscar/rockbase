const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const INSTAGRAM_POST_PATH = /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/;
const INSTAGRAM_USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const CHALLENGE_PATTERN = /checkpoint|challenge|confirm your account|verify your account|verification required|suspended|temporarily blocked|try again later/i;

export const MAX_DIRECT_ENGAGEMENT_ACCOUNTS = Math.max(
  1,
  Math.min(10, Number(process.env.MAX_DIRECT_ENGAGEMENT_ACCOUNTS || 3)),
);

export function parseExplicitAccountIds(input: unknown, maxAccounts = MAX_DIRECT_ENGAGEMENT_ACCOUNTS): string[] {
  if (!Array.isArray(input)) throw new Error('accountIds must be an array');
  const ids = [...new Set(input.map((value) => String(value).trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error('At least one accountId is required');
  if (ids.length > maxAccounts) throw new Error(`Direct engagement is limited to ${maxAccounts} accounts per request`);
  return ids;
}

export function validateInstagramPostUrl(input: unknown): string {
  let url: URL;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    throw new Error('A valid Instagram post or reel URL is required');
  }
  if (url.protocol !== 'https:' || !INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('A valid Instagram post or reel URL is required');
  }
  const match = url.pathname.match(INSTAGRAM_POST_PATH);
  if (!match) throw new Error('A valid Instagram post or reel URL is required');
  url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function normalizeInstagramUsername(input: unknown): string {
  const username = String(input ?? '').trim().replace(/^@+/, '');
  if (!INSTAGRAM_USERNAME.test(username) || username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
    throw new Error('Invalid Instagram username');
  }
  return username;
}

export function calculateSequentialWaits(cumulativeDelays: number[]): number[] {
  let previous = 0;
  return cumulativeDelays.map((delay) => {
    const safeDelay = Math.max(0, Number(delay) || 0);
    const wait = Math.max(0, safeDelay - previous);
    previous = safeDelay;
    return wait;
  });
}

export function containsPlatformChallenge(input: string): boolean {
  return CHALLENGE_PATTERN.test(input);
}

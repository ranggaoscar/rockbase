const SUPPORTED_PLATFORMS = new Map([
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
]);

const ACCOUNT_PUBLIC_FIELDS = [
  'id',
  'workspaceId',
  'platform',
  'username',
  'executionEngine',
  'homeDeviceId',
  'email',
  'status',
  'proxyId',
  'brandTag',
  'notes',
  'warmingDay',
  'warmingStartDate',
  'lastActive',
  'autoReplyEnabled',
  'autoDmEnabled',
  'replyTemplate',
  'dmTemplate',
  'createdAt',
  'updatedAt',
  'sessionHealth',
  'sessionHealthReason',
  'sessionHealthCheckedAt',
] as const;

export const accountPublicSelect = Object.fromEntries(
  ACCOUNT_PUBLIC_FIELDS.map((field) => [field, true]),
) as Record<(typeof ACCOUNT_PUBLIC_FIELDS)[number], true>;

export function accountPublicPayload(account: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    ACCOUNT_PUBLIC_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(account, field))
      .map((field) => [field, account[field]]),
  );
}

export function normalizeAccountInput(input: {
  username?: unknown;
  platform?: unknown;
}): { username: string; platform: string } {
  const username = String(input.username ?? '').trim().replace(/^@+/, '');
  if (!username) throw new Error('Username is required');
  if (username.length > 64) throw new Error('Username is too long');

  const platformKey = String(input.platform ?? '').trim().toLowerCase();
  const platform = SUPPORTED_PLATFORMS.get(platformKey);
  if (!platform) throw new Error('Unsupported platform. Use Instagram or TikTok');

  return { username, platform };
}

export function normalizeImportedCookies(input: unknown): {
  serialized: string;
  cookieCount: number;
} {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error('Cookies must be a JSON cookie array exported from the browser');
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Cookies must be a non-empty JSON cookie array');
  }
  if (parsed.length > 250) throw new Error('Cookie import is limited to 250 entries');

  const cookies = parsed.map((cookie, index) => {
    if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) {
      throw new Error(`Cookie ${index + 1} must be an object`);
    }
    const record = cookie as Record<string, unknown>;
    if (typeof record.name !== 'string' || !record.name.trim() || typeof record.value !== 'string') {
      throw new Error(`Cookie ${index + 1} must include string name and value fields`);
    }
    if (record.domain !== undefined && typeof record.domain !== 'string') {
      throw new Error(`Cookie ${index + 1} has an invalid domain`);
    }
    if (record.path !== undefined && typeof record.path !== 'string') {
      throw new Error(`Cookie ${index + 1} has an invalid path`);
    }
    return record;
  });

  return { serialized: JSON.stringify(cookies), cookieCount: cookies.length };
}

import * as crypto from 'crypto';

// Deprecated process-local request lock. It is not a durable source of truth and
// remains only for existing route compatibility until Sub-batch 4B2.
const activeRequests = new Map<string, number>();
const LOCK_TTL_MS = 15000; // 15 seconds TTL

/**
 * Generates a unique, deterministic SHA-256 idempotency key based on job parameters.
 */
export function generateIdempotencyKey({
  accountId,
  mediaFilename,
  content,
  campaignId,
  scheduledAt,
}: {
  accountId: string;
  mediaFilename: string;
  content: string;
  campaignId?: string | null;
  scheduledAt?: string | Date | null;
}): string {
  const normAccountId = accountId.trim();
  const normMedia = mediaFilename.trim();
  const normContent = content.replace(/\r\n/g, '\n').trim();
  const normCampaignId = campaignId ? campaignId.trim() : 'direct';

  let normSchedule = 'direct';
  if (scheduledAt) {
    const date = new Date(scheduledAt);
    if (!isNaN(date.getTime())) {
      // Round to the nearest minute to prevent slight timing offsets
      const ms = date.getTime();
      const roundedMs = Math.round(ms / 60000) * 60000;
      normSchedule = new Date(roundedMs).toISOString();
    }
  }

  const rawString = [normAccountId, normMedia, normContent, normCampaignId, normSchedule].join('|');
  return crypto.createHash('sha256').update(rawString).digest('hex');
}

/**
 * Generates a payload hash for a request to be used as a locking key.
 */
export function generateRequestPayloadHash(body: any, files?: any[] | any): string {
  const accountIdsStr = body.accountIds || body.assignments || '[]';
  const captionStr = body.baseCaption || body.content || '';
  const mediaIndicator = files ? (Array.isArray(files) ? files.map(f => f.originalname + f.size).join(',') : (files.originalname + files.size)) : 'no-file';
  
  const rawString = [accountIdsStr, captionStr, mediaIndicator].join('|');
  return crypto.createHash('sha256').update(rawString).digest('hex');
}

/**
 * Tries to acquire a lock for a request payload hash.
 * Returns true if acquired, false if locked (duplicate request).
 */
export function acquireRequestLock(payloadKey: string): boolean {
  const now = Date.now();
  const lastRequestTime = activeRequests.get(payloadKey);

  // If there's an active lock within TTL, reject
  if (lastRequestTime && now - lastRequestTime < LOCK_TTL_MS) {
    return false;
  }

  activeRequests.set(payloadKey, now);
  return true;
}

/**
 * Releases a request lock.
 */
export function releaseRequestLock(payloadKey: string): void {
  activeRequests.delete(payloadKey);
}

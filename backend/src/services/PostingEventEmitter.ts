/**
 * PostingEventEmitter — Structured runtime event emitter for posting execution stages.
 *
 * Responsibilities:
 *   - Emit structured events through Socket.IO to the "execution_console" room
 *   - Keep last N events in memory so they survive page refresh
 *   - Redact credentials, tokens, cookies, session data, authorization headers from metadata
 *   - Provide getRecentEvents() for a REST fallback endpoint
 */

import { io } from '../server';

// ── Types ──────────────────────────────────────────────────────────────────

export type PostingStage =
  | 'campaign_received'
  | 'account_selected'
  | 'account_lock_acquired'
  | 'account_lock_released'
  | 'daily_budget_checked'
  | 'browser_launching'
  | 'browser_ready'
  | 'instagram_opening'
  | 'instagram_opened'
  | 'media_resolving'
  | 'media_selected'
  | 'upload_started'
  | 'upload_processing'
  | 'upload_completed'
  | 'upload_rejected'
  | 'next_clicked'
  | 'cover_next_clicked'
  | 'caption_inserted'
  | 'share_clicked'
  | 'verification_started'
  | 'verification_poll'
  | 'published'
  | 'pending_verify'
  | 'retry_scheduled'
  | 'failed'
  | 'cleanup_started'
  | 'cleanup_completed';

export type EventLevel = 'info' | 'success' | 'warning' | 'error';

export interface PostingEvent {
  timestamp: string;
  campaignId?: string;
  postId?: string;
  accountId: string;
  username: string;
  stage: PostingStage;
  level: EventLevel;
  message: string;
  attempt?: number;
  progress?: number; // 0–100
  metadata?: Record<string, unknown>;
  screenshotPath?: string;
  postedAt?: string;
  error?: string;
}

// ── Known credential/sensitive keys — always stripped from metadata ─────────

const SENSITIVE_KEYS = new Set([
  'password',
  'cookies',
  'token',
  'session',
  'authorization',
  'authorizationheader',
  'jwt',
  'access_token',
  'refresh_token',
  'secret',
  'api_key',
  'apikey',
  'certificate',
  'private_key',
  'auth_token',
  'bearer',
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEYS.has(lower);
}

/**
 * Deep-redact sensitive values from an object. Returns a new object safe for transport.
 */
function redactSensitive(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isSensitiveKey(key)) {
      output[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = redactSensitive(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      output[key] = value.map((item) =>
        item !== null && typeof item === 'object' ? redactSensitive(item as Record<string, unknown>) : item,
      );
    } else {
      output[key] = value;
    }
  }
  return output;
}

// ── Event emitter ──────────────────────────────────────────────────────────

const MAX_BUFFERED_EVENTS = 200;
const emittedIds = new Set<string>();
let eventCounter = 0;

class PostingEventEmitterService {
  private buffered: PostingEvent[] = [];

  /**
   * Emit a structured posting event to the "execution_console" room (Socket.IO)
   * and buffer it for page-refresh recovery.
   */
  public emit(event: PostingEvent): void {
    const id = `${event.stage}-${event.accountId}-${event.timestamp}`;
    if (emittedIds.has(id)) return;
    emittedIds.add(id);

    // Keep the set bounded
    if (emittedIds.size > MAX_BUFFERED_EVENTS * 3) {
      const iterator = emittedIds.values();
      const toDelete = Math.floor(emittedIds.size / 2);
      for (let i = 0; i < toDelete; i++) {
        emittedIds.delete(iterator.next().value as string);
      }
    }

    // Redact metadata before emitting
    const safeEvent: PostingEvent = {
      ...event,
      metadata: redactSensitive(event.metadata as Record<string, unknown>),
    };

    // Increment counter for ordering
    eventCounter += 1;

    // Buffer
    this.buffered.push(safeEvent);
    if (this.buffered.length > MAX_BUFFERED_EVENTS) {
      this.buffered.shift();
    }

    // Emit via Socket.IO to the execution_console room
    try {
      io.to('execution_console').emit('posting_execution_event', safeEvent);
    } catch (err) {
      // Socket.IO not available — silently ignore
    }
  }

  /**
   * Return buffered events most-recent-first, optionally filtered.
   */
  public getRecentEvents(
    limit = 50,
    filters?: { campaignId?: string; accountId?: string; username?: string; stage?: string },
  ): PostingEvent[] {
    let events = this.buffered.slice();

    if (filters?.campaignId) {
      events = events.filter((e) => e.campaignId === filters.campaignId);
    }
    if (filters?.accountId) {
      events = events.filter((e) => e.accountId === filters.accountId);
    }
    if (filters?.username) {
      events = events.filter((e) => e.username.toLowerCase().includes(filters.username!.toLowerCase()));
    }
    if (filters?.stage) {
      events = events.filter((e) => e.stage === filters.stage);
    }

    return events.reverse().slice(0, limit);
  }

  /**
   * Clear buffered events (useful for testing).
   */
  public clear(): void {
    this.buffered = [];
    emittedIds.clear();
    eventCounter = 0;
  }
}

export const postingEventEmitter = new PostingEventEmitterService();

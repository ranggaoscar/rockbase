/**
 * SessionPool — Manages concurrent Playwright browser contexts.
 *
 * Max 15 simultaneous sessions. Additional requests are queued (FIFO).
 * When a session is released, the next queued account auto-starts.
 * Emits events for real-time dashboard monitoring.
 */
import { BrowserContext } from 'playwright';
import { EventEmitter } from 'events';
import { browserManager } from './BrowserManager';

const MAX_CONCURRENT = 15;

interface QueueEntry {
  accountId: string;
  resolve: (context: BrowserContext) => void;
  reject: (error: Error) => void;
}

export class SessionPool extends EventEmitter {
  private activeSessions: Map<string, BrowserContext> = new Map();
  private queue: QueueEntry[] = [];

  constructor() {
    super();
  }

  /**
   * Acquire a browser context for an account.
   * Returns immediately if under the limit, otherwise queues.
   */
  public async acquireSession(accountId: string): Promise<BrowserContext> {
    // If this account already has an active session, return it
    if (this.activeSessions.has(accountId)) {
      const existing = this.activeSessions.get(accountId)!;
      if (this.isContextUsable(existing)) {
        console.log(`[SessionPool] Account ${accountId} already has active session, reusing`);
        return existing;
      }
      console.warn(`[SessionPool] Removing stale session for ${accountId}`);
      this.activeSessions.delete(accountId);
    }

    // If under the limit, create immediately
    if (this.activeSessions.size < MAX_CONCURRENT) {
      return this._createSession(accountId);
    }

    // Otherwise, queue the request
    console.log(`[SessionPool] Pool full (${this.activeSessions.size}/${MAX_CONCURRENT}). Queuing ${accountId} (position: ${this.queue.length + 1})`);

    return new Promise<BrowserContext>((resolve, reject) => {
      this.queue.push({ accountId, resolve, reject });
      this._emitStatus();
    });
  }

  /**
   * Release a session — saves cookies, closes context, auto-starts next queued.
   */
  public async releaseSession(accountId: string): Promise<void> {
    const context = this.activeSessions.get(accountId);
    if (!context) {
      console.log(`[SessionPool] No active session for ${accountId} to release`);
      return;
    }

    try {
      // Save cookies before closing
      await browserManager.saveCookies(accountId);
    } catch (err) {
      console.error(`[SessionPool] Failed to save cookies for ${accountId}:`, err);
    }

    await browserManager.closeContext(accountId, { saveCookies: false });
    this.activeSessions.delete(accountId);
    console.log(`[SessionPool] Released session for ${accountId}. Active: ${this.activeSessions.size}/${MAX_CONCURRENT}, Queue: ${this.queue.length}`);

    this._emitStatus();

    // Auto-start next queued account
    await this._processQueue();
  }

  /**
   * Release all active sessions (used for shutdown or stop-all).
   */
  public async releaseAll(): Promise<void> {
    console.log(`[SessionPool] Releasing all ${this.activeSessions.size} sessions...`);

    // Reject all queued entries
    for (const entry of this.queue) {
      entry.reject(new Error('Session pool stopped'));
    }
    this.queue = [];

    // Release all active sessions
    const accountIds = [...this.activeSessions.keys()];
    for (const accountId of accountIds) {
      await this.releaseSession(accountId).catch(() => {});
    }

    this._emitStatus();
  }

  /**
   * Get current pool status for dashboard display.
   */
  public getStatus(): {
    active: string[];
    queued: string[];
    activeCount: number;
    queuedCount: number;
    maxConcurrent: number;
  } {
    return {
      active: [...this.activeSessions.keys()],
      queued: this.queue.map((e) => e.accountId),
      activeCount: this.activeSessions.size,
      queuedCount: this.queue.length,
      maxConcurrent: MAX_CONCURRENT,
    };
  }

  /**
   * Check if an account has an active session.
   */
  public hasSession(accountId: string): boolean {
    return this.activeSessions.has(accountId);
  }

  /**
   * Get the context for an active session (without acquiring).
   */
  public getActiveContext(accountId: string): BrowserContext | undefined {
    return this.activeSessions.get(accountId);
  }

  // ── Private methods ────────────────────────────────────────────────────────

  private async _createSession(accountId: string): Promise<BrowserContext> {
    console.log(`[SessionPool] Creating session for ${accountId}. Active: ${this.activeSessions.size + 1}/${MAX_CONCURRENT}`);

    const context = await browserManager.getContext(accountId);
    this.activeSessions.set(accountId, context);
    this._emitStatus();

    return context;
  }

  private async _processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.activeSessions.size < MAX_CONCURRENT) {
      const entry = this.queue.shift()!;
      try {
        const context = await this._createSession(entry.accountId);
        entry.resolve(context);
      } catch (err) {
        entry.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private _emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  private isContextUsable(context: BrowserContext): boolean {
    try {
      context.pages();
      return !!context.browser()?.isConnected();
    } catch {
      return false;
    }
  }
}

// Singleton export
export const sessionPool = new SessionPool();

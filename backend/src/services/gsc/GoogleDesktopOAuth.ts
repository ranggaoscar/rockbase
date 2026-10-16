import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { CredentialVault } from './WindowsCredentialVault';
import { getRockBaseMode } from '../../middleware/runtimeMode';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
interface Client { client_id: string; client_secret?: string }
interface Tokens { access_token: string; refresh_token: string; expires_at: number }
interface Pending { state: string; verifier: string; redirect: string; expires: number; server: http.Server; timer: NodeJS.Timeout; consumed: boolean }
export class GscError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}
type Fetcher = typeof fetch;

/** Desktop credentials are never reachable through the Server Mode API. */
export class GoogleDesktopOAuth {
  private pending?: Pending;
  private lastError?: string;
  private epoch = 0;
  private refreshing?: Promise<Tokens>;
  private nextRequest = 0;
  private cooldownUntil = 0;
  private connecting = false;
  private disconnecting = false;
  private tokenMutation: Promise<void> = Promise.resolve();
  constructor(private vault: CredentialVault, private request: Fetcher = fetch) {}
  private local() {
    if (getRockBaseMode() !== 'local') throw new GscError('GSC_LOCAL_ONLY', 'Google Desktop connections are disabled in Server Mode.', 409);
  }
  private persistTokens(tokens: Tokens | null, epoch: number): Promise<void> {
    const operation = this.tokenMutation.then(async () => {
      if (tokens && (epoch !== this.epoch || getRockBaseMode() !== 'local')) throw new GscError('GSC_CANCELLED', 'Google connection changed.', 409);
      if (tokens) await this.vault.write('tokens', JSON.stringify(tokens));
      else await this.vault.delete('tokens');
    });
    this.tokenMutation = operation.catch(() => {});
    return operation;
  }
  private async client(): Promise<Client | null> {
    this.local();
    const value = await this.vault.read('client');
    return value ? JSON.parse(value) : null;
  }
  async status() {
    if (getRockBaseMode() !== 'local') return { enabled: false, configured: false, connected: false, pending: false, storage: 'Windows Credential Manager', error: 'Desktop OAuth is Local Mode only. Server Mode cannot access local tokens.' };
    const client = await this.client();
    const tokens = await this.vault.read('tokens');
    return { enabled: true, configured: !!client, connected: !!tokens && !this.disconnecting, pending: !!this.pending,
      storage: 'Windows Credential Manager', error: this.lastError,
      setupRequired: client ? undefined : 'Create a Google Cloud OAuth client of type Desktop app, enable Search Console API, then configure this installation.' };
  }
  async configure(value: Client) {
    this.local();
    if (!value || typeof value.client_id !== 'string' || !/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.client_id)
      || (value.client_secret !== undefined && (typeof value.client_secret !== 'string' || value.client_secret.length > 512))) {
      throw new GscError('GSC_CLIENT_INVALID', 'Use the Client ID and optional client secret from a Google Desktop OAuth client.', 422);
    }
    if (this.pending || this.connecting || this.disconnecting || await this.vault.read('tokens')) throw new GscError('GSC_DISCONNECT_FIRST', 'Disconnect Google before replacing the Desktop client.', 409);
    await this.vault.write('client', JSON.stringify({ client_id: value.client_id, client_secret: value.client_secret || undefined }));
    this.lastError = undefined;
  }
  private finishPending(expected?: Pending) {
    if (!this.pending) return;
    if (expected && this.pending !== expected) return;
    clearTimeout(this.pending.timer); this.pending.server.close(); this.pending = undefined;
  }
  async connect() {
    this.local();
    if (this.pending || this.connecting || this.disconnecting) throw new GscError('GSC_OAUTH_PENDING', 'A Google connection operation is already waiting.', 409);
    this.connecting = true;
    const epoch = this.epoch;
    try {
    if (await this.vault.read('tokens')) throw new GscError('GSC_ALREADY_CONNECTED', 'Disconnect the current Google account before connecting another.', 409);
    const client = await this.client();
    if (!client) throw new GscError('GSC_SETUP_REQUIRED', 'Configure a Google OAuth Desktop Client ID first.', 409);
    this.lastError = undefined;
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const server = http.createServer((req, res) => { void this.callback(req, res, client, epoch); });
    server.requestTimeout = 10000;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    if (epoch !== this.epoch) { server.close(); throw new GscError('GSC_CANCELLED', 'Connection cancelled.', 409); }
    server.unref();
    const port = (server.address() as { port: number }).port;
    const redirect = `http://127.0.0.1:${port}/oauth2/callback`;
    const expires = Date.now() + 5 * 60 * 1000;
    const timer = setTimeout(() => { this.lastError = 'Google consent expired. Connect again when ready.'; this.finishPending(); }, 5 * 60 * 1000);
    timer.unref();
    this.pending = { state, verifier, redirect, expires, server, timer, consumed: false };
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: 'code',
      scope: GSC_SCOPE, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' }).toString();
    return { authorizationUrl: url.toString(), expiresAt: new Date(expires).toISOString() };
    } finally { this.connecting = false; }
  }
  private async callback(req: http.IncomingMessage, res: http.ServerResponse, client: Client, epoch: number) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const deny = () => { res.writeHead(400); res.end('Invalid or expired Google connection. Return to RockBase.'); };
    const pending = this.pending;
    if (!pending || pending.consumed || epoch !== this.epoch || Date.now() > pending.expires
      || req.method !== 'GET' || req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== new URL(pending.redirect).host) { deny(); return; }
    let url: URL;
    try { url = new URL(req.url || '', pending.redirect); } catch { deny(); return; }
    const state = url.searchParams.get('state') || '';
    const a = Buffer.from(state); const b = Buffer.from(pending.state);
    if (url.pathname !== '/oauth2/callback' || url.searchParams.getAll('state').length !== 1 || a.length !== b.length || !timingSafeEqual(a, b)) { deny(); return; }
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error')) {
      this.lastError = 'Google access was not granted. No account connected.'; this.finishPending();
      res.end('Google connection cancelled. Return to RockBase.'); return;
    }
    if (!code || code.length > 4096 || url.searchParams.getAll('code').length !== 1) { deny(); return; }
    pending.consumed = true;
    try {
      const result = await this.tokenRequest({ client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}),
        grant_type: 'authorization_code', code, redirect_uri: pending.redirect, code_verifier: pending.verifier });
      if (!result.refresh_token) throw new GscError('GSC_REFRESH_MISSING', 'Google did not grant offline access. Reconnect and approve access.');
      const tokens = this.validateTokens(result, result.refresh_token);
      if (this.epoch !== epoch || this.pending !== pending || Date.now() > pending.expires || getRockBaseMode() !== 'local') throw new GscError('GSC_CANCELLED', 'Connection cancelled or expired.');
      await this.persistTokens(tokens, epoch);
      if (this.epoch !== epoch) throw new GscError('GSC_CANCELLED', 'Connection cancelled.');
      this.lastError = undefined;
      res.end('Google Search Console connected. You can close this tab and return to RockBase.');
    } catch (error) {
      if (this.epoch === epoch) this.lastError = error instanceof GscError ? error.message : 'Google connection could not be securely saved. Retry from RockBase.';
      res.writeHead(400); res.end('Google connection could not be completed. Return to RockBase for details.');
    } finally { this.finishPending(pending); }
  }
  private async tokenRequest(body: Record<string, string>): Promise<any> {
    const response = await this.request('https://oauth2.googleapis.com/token', { method: 'POST',
      body: new URLSearchParams(body), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'error', signal: AbortSignal.timeout(20000) });
    const data = await response.json() as any;
    if (!response.ok) {
      if (data.error === 'invalid_grant') throw new GscError('GSC_RECONNECT_REQUIRED', 'Google authorization expired or was revoked. Disconnect and reconnect.', 409);
      throw new GscError('GSC_OAUTH_FAILED', 'Google rejected the Desktop OAuth configuration or grant. Check client type and consent setup.', 409);
    }
    return data;
  }
  private validateTokens(data: any, refresh: string): Tokens {
    if (!data || typeof data.access_token !== 'string' || data.access_token.length > 2048 || typeof refresh !== 'string' || refresh.length > 2048
      || typeof data.expires_in !== 'number' || data.expires_in <= 0 || data.expires_in > 86400
      || (data.token_type && data.token_type.toLowerCase() !== 'bearer')
      || (data.scope && data.scope !== GSC_SCOPE)) {
      throw new GscError('GSC_SCOPE_INVALID', 'Google must grant only the Search Console readonly scope.');
    }
    return { access_token: data.access_token, refresh_token: refresh, expires_at: Date.now() + data.expires_in * 1000 };
  }
  private async accessToken(): Promise<string> {
    this.local();
    const value = await this.vault.read('tokens');
    if (!value) throw new GscError('GSC_NOT_CONNECTED', 'Connect Google before reading Search Console.', 409);
    const stored: Tokens = JSON.parse(value);
    if (stored.expires_at > Date.now() + 60000) return stored.access_token;
    if (!this.refreshing) {
      const epoch = this.epoch;
      this.refreshing = (async () => {
        const client = await this.client();
        if (!client) throw new GscError('GSC_SETUP_REQUIRED', 'Desktop OAuth client is missing.', 409);
        const result = await this.tokenRequest({ client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}),
          grant_type: 'refresh_token', refresh_token: stored.refresh_token });
        const updated = this.validateTokens(result, result.refresh_token || stored.refresh_token);
        if (epoch !== this.epoch) throw new GscError('GSC_CANCELLED', 'Google connection was disconnected.', 409);
        await this.persistTokens(updated, epoch);
        if (epoch !== this.epoch) throw new GscError('GSC_CANCELLED', 'Google connection was disconnected.', 409);
        return updated;
      })().finally(() => { this.refreshing = undefined; });
    }
    return (await this.refreshing).access_token;
  }
  async google(path: string, body?: unknown, external?: { accessToken: () => Promise<string>; valid: () => boolean }): Promise<any> {
    this.local();
    if (this.disconnecting) throw new GscError('GSC_CANCELLED', 'Google connection is being disconnected.', 409);
    if (!(path === '/sites' || /^\/sites\/[^/]+\/searchAnalytics\/query$/.test(path))) throw new GscError('GSC_PATH_INVALID', 'Unsupported Search Console read operation.', 422);
    const epoch = this.epoch;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (external && !external.valid()) throw new GscError('GSC_CANCELLED', 'Google connection changed.', 409);
      if (this.cooldownUntil > Date.now()) throw new GscError('GSC_QUOTA', 'Google quota limit reached; wait at least 15 minutes before another sync.', 429);
      const wait = Math.max(0, this.nextRequest - Date.now()); this.nextRequest = Date.now() + wait + 350;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (this.cooldownUntil > Date.now()) throw new GscError('GSC_QUOTA', 'Google quota limit reached; wait at least 15 minutes.', 429);
      const access = await (external ? external.accessToken() : this.accessToken());
      if (epoch !== this.epoch || (external && !external.valid())) throw new GscError('GSC_CANCELLED', 'Google connection changed. Retry after reconnect.', 409);
      let response: Response;
      try {
        response = await this.request('https://www.googleapis.com/webmasters/v3' + path, {
          method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(25000),
        });
      } catch { throw new GscError('GSC_NETWORK', 'Search Console request timed out or network was unavailable. Cached results retained.'); }
      // Quota / transient responses need not have a JSON body. Inspect status
      // before parsing so HTML 429/503 responses cannot defeat safe handling.
      if (response.status === 429) {
        this.cooldownUntil = Date.now() + 15 * 60 * 1000;
        throw new GscError('GSC_QUOTA', 'Google quota limit reached; wait at least 15 minutes. Cached results retained.', 429);
      }
      if (response.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, (attempt + 1) * 1000)); continue; }
      const data = await response.json().catch(() => {
        if (response.ok) throw new GscError('GSC_RESPONSE_INVALID', 'Google returned an unreadable response; previous data retained.');
        return {};
      }) as any;
      if (epoch !== this.epoch || (external && !external.valid())) throw new GscError('GSC_CANCELLED', 'Google connection changed.', 409);
      if (response.ok) return data;
      const quota = response.status === 429 || (response.status === 403 && /quota|rateLimit/i.test(JSON.stringify(data.error?.errors?.map((x: any) => x.reason) || [])));
      if (quota) { this.cooldownUntil = Date.now() + 15 * 60 * 1000; throw new GscError('GSC_QUOTA', 'Google quota limit reached; wait at least 15 minutes. Cached results retained.', 429); }
      if (response.status === 401) throw new GscError('GSC_RECONNECT_REQUIRED', 'Google authorization is no longer valid. Disconnect and reconnect.', 409);
      if (response.status === 403) throw new GscError('GSC_PERMISSION', 'Search Console denied access. Check property permission and that Search Console API is enabled.', 409);
      throw new GscError('GSC_API_FAILED', 'Search Console could not return data. Previous cached results retained.');
    }
    throw new GscError('GSC_API_FAILED', 'Search Console temporarily unavailable.');
  }
  async disconnect() {
    this.local();
    if (this.disconnecting) throw new GscError('GSC_DISCONNECTING', 'Disconnect is already running.', 409);
    this.disconnecting = true;
    this.epoch++; this.finishPending(); this.lastError = undefined;
    try {
    await this.tokenMutation;
    const value = await this.vault.read('tokens');
    await this.persistTokens(null, this.epoch);
    if (!value) return { disconnected: true, revoked: true };
    let revoked = false;
    try {
      const stored: Tokens = JSON.parse(value);
      const response = await this.request('https://oauth2.googleapis.com/revoke', { method: 'POST',
        body: new URLSearchParams({ token: stored.refresh_token }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        redirect: 'error', signal: AbortSignal.timeout(10000) });
      revoked = response.ok;
    } catch { /* local deletion already succeeded; never log token-bearing response */ }
    return { disconnected: true, revoked, warning: revoked ? undefined : 'Local tokens removed. Google revocation was not confirmed; review Google Account app access if necessary.' };
    } finally { this.disconnecting = false; }
  }
  close() { this.epoch++; this.finishPending(); }
}

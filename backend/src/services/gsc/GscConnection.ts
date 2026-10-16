import fs from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { CredentialVault } from './WindowsCredentialVault';
import { GoogleDesktopOAuth, GscError, GSC_SCOPE } from './GoogleDesktopOAuth';
import { getRockBaseMode } from '../../middleware/runtimeMode';

interface ServiceCredential { client_email: string; private_key: string }

/** Provider facade: preserves Desktop OAuth and adds explicitly imported service accounts. */
export class GscConnection {
  private epoch = 0;
  private busy = false;
  private access?: { token: string; expires: number };
  private pendingAccess?: Promise<string>;
  private desktop: GoogleDesktopOAuth;
  constructor(private vault: CredentialVault, private installationRoot: string, private request: typeof fetch = fetch) {
    this.desktop = new GoogleDesktopOAuth(vault, request);
  }
  private local() {
    if (getRockBaseMode() !== 'local') throw new GscError('GSC_LOCAL_ONLY', 'Google connections are disabled in Server Mode.', 409);
  }
  async status() {
    if (getRockBaseMode() !== 'local') return { enabled: false, configured: false, connected: false, pending: false,
      provider: 'oauth_desktop', providers: ['oauth_desktop', 'service_account'], storage: 'Windows Credential Manager', error: 'Local Google credentials are unavailable in Server Mode.' };
    const sa = await this.vault.read('service_account');
    if (sa) return { enabled: true, configured: true, connected: !this.busy, pending: false, provider: 'service_account',
      providers: ['oauth_desktop', 'service_account'], storage: 'Windows Credential Manager' };
    return { ...await this.desktop.status(), provider: 'oauth_desktop', providers: ['oauth_desktop', 'service_account'] };
  }
  async configure(value: { client_id: string; client_secret?: string }) {
    this.local(); await this.requireNoService(); return this.desktop.configure(value);
  }
  async connect() { this.local(); await this.requireNoService(); return this.desktop.connect(); }
  private async requireNoService() {
    if (this.busy || await this.vault.read('service_account')) throw new GscError('GSC_DISCONNECT_FIRST', 'Disconnect the current provider before changing Google authentication.', 409);
  }
  private validate(value: any): ServiceCredential {
    if (!value || (value.type !== undefined && value.type !== 'service_account')
      || typeof value.client_email !== 'string' || !/^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(value.client_email)
      || typeof value.private_key !== 'string' || value.private_key.length > 2400
      || (value.token_uri !== undefined && value.token_uri !== 'https://oauth2.googleapis.com/token') || value.subject || value.sub) {
      throw new GscError('GSC_SERVICE_INVALID', 'Select a valid Google service-account JSON without user impersonation.', 422);
    }
    try {
      const key = createPrivateKey(value.private_key);
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error();
    } catch { throw new GscError('GSC_SERVICE_INVALID', 'Service-account RSA key is invalid.', 422); }
    const minimal = { client_email: value.client_email, private_key: value.private_key };
    if (Buffer.byteLength(JSON.stringify(minimal)) > 2560) throw new GscError('GSC_SERVICE_TOO_LARGE', 'This key exceeds the OS credential payload limit; no plaintext fallback is used.', 422);
    return minimal;
  }
  async importServiceAccount(filename: unknown) {
    this.local();
    if (this.busy) throw new GscError('GSC_BUSY', 'A Google connection operation is running.', 409);
    this.busy = true;
    const epoch = this.epoch;
    try {
      if (await this.vault.read('service_account') || (await this.desktop.status()).connected || (await this.desktop.status()).pending) {
        throw new GscError('GSC_DISCONNECT_FIRST', 'Disconnect the current Google provider before importing another.', 409);
      }
      if (typeof filename !== 'string' || !/^[A-Za-z]:[\\/]/.test(filename) || filename.length > 1000 || filename.includes('\0') || !filename.toLowerCase().endsWith('.json')) {
        throw new GscError('GSC_SERVICE_PATH', 'Enter an absolute local Windows path to your own service-account JSON (no network paths).', 422);
      }
      const real = await fs.realpath(filename);
      if (!/^[A-Za-z]:[\\/]/.test(real)) throw new GscError('GSC_SERVICE_PATH', 'Network credential paths are not supported.', 422);
      const relative = path.relative(this.installationRoot, real);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new GscError('GSC_SERVICE_PATH', 'Keep source credentials outside the RockBase repository.', 422);
      const stat = await fs.stat(real);
      if (!stat.isFile() || stat.size > 16384) throw new GscError('GSC_SERVICE_INVALID', 'Service-account file is invalid or too large.', 422);
      let parsed: any;
      try { parsed = JSON.parse(await fs.readFile(real, 'utf8')); }
      catch { throw new GscError('GSC_SERVICE_INVALID', 'Service-account file could not be read as JSON.', 422); }
      if (parsed.type !== 'service_account') throw new GscError('GSC_SERVICE_INVALID', 'Choose a service-account JSON, not Desktop OAuth or another credential.', 422);
      const credential = this.validate(parsed);
      const token = await this.issueAccess(credential);
      if (epoch !== this.epoch) throw new GscError('GSC_CANCELLED', 'Connection cancelled.', 409);
      // Verify actual permission before saving; never persist the source path/full JSON.
      const properties = await this.desktop.google('/sites', undefined, { accessToken: async () => token.token, valid: () => epoch === this.epoch });
      if (epoch !== this.epoch) throw new GscError('GSC_CANCELLED', 'Connection cancelled.', 409);
      await this.vault.write('service_account', JSON.stringify(credential));
      if (await this.vault.read('service_account') !== JSON.stringify(credential)) throw new GscError('GSC_SERVICE_STORAGE', 'OS credential read-back did not match. Import not verified.', 503);
      this.access = token;
      const count = Array.isArray(properties.siteEntry) ? properties.siteEntry.filter((p: any) => ['siteOwner','siteFullUser','siteRestrictedUser'].includes(p.permissionLevel)).length : 0;
      return { configured: true, connected: true, provider: 'service_account', propertyCount: count, sourcePreserved: true };
    } catch (error) {
      if (error instanceof GscError) throw error;
      throw new GscError('GSC_SERVICE_UNAVAILABLE', 'Service-account import failed. Source file was not modified; no plaintext fallback.', 503);
    } finally { this.busy = false; }
  }
  private async issueAccess(credential: ServiceCredential) {
    const assertion = jwt.sign({ scope: GSC_SCOPE }, credential.private_key, { algorithm: 'RS256',
      issuer: credential.client_email, audience: 'https://oauth2.googleapis.com/token', expiresIn: 3600 });
    let response: Response;
    try {
      response = await this.request('https://oauth2.googleapis.com/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        redirect: 'error', signal: AbortSignal.timeout(20000) });
    } catch { throw new GscError('GSC_SERVICE_NETWORK', 'Google service-account token exchange was unavailable.', 503); }
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 4096
      || typeof data.expires_in !== 'number' || data.expires_in <= 0 || data.expires_in > 3600
      || (data.scope && data.scope !== GSC_SCOPE)) throw new GscError('GSC_SERVICE_GRANT', 'Google rejected the service-account grant. Check existing key validity, clock and API access.', 409);
    return { token: data.access_token as string, expires: Date.now() + data.expires_in * 1000 };
  }
  private async serviceAccess(): Promise<string> {
    this.local();
    if (this.access && this.access.expires > Date.now() + 60000) return this.access.token;
    if (!this.pendingAccess) {
      const epoch = this.epoch;
      this.pendingAccess = (async () => {
        const raw = await this.vault.read('service_account');
        if (!raw) throw new GscError('GSC_NOT_CONNECTED', 'Connect a Google provider first.', 409);
        const result = await this.issueAccess(this.validate(JSON.parse(raw)));
        if (epoch !== this.epoch || this.busy) throw new GscError('GSC_CANCELLED', 'Google provider changed.', 409);
        this.access = result; return result.token;
      })().finally(() => { this.pendingAccess = undefined; });
    }
    return this.pendingAccess;
  }
  async google(resource: string, body?: unknown) {
    this.local();
    if (this.busy) throw new GscError('GSC_BUSY', 'Google connection operation in progress.', 409);
    const epoch = this.epoch;
    if (await this.vault.read('service_account')) return this.desktop.google(resource, body, { accessToken: () => this.serviceAccess(), valid: () => epoch === this.epoch && !this.busy });
    return this.desktop.google(resource, body);
  }
  async disconnect() {
    this.local();
    if (this.busy) throw new GscError('GSC_BUSY', 'A Google connection operation is running. Retry shortly.', 409);
    this.busy = true; this.epoch++; this.access = undefined;
    try {
      if (await this.vault.read('service_account')) {
        await this.vault.delete('service_account');
        // Deliberately no OAuth revoke, IAM mutation, key deletion or source-file write.
        this.desktop.close();
        return { disconnected: true, revoked: false, provider: 'service_account', sourcePreserved: true,
          warning: 'RockBase disconnected locally. The original service-account key and Hermes access were not revoked or deleted.' };
      }
      return await this.desktop.disconnect();
    } finally { this.busy = false; }
  }
  close() { this.epoch++; this.access = undefined; this.desktop.close(); }
}

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export type CredentialKey = 'client' | 'tokens' | 'service_account';
export interface CredentialVault {
  read(key: CredentialKey): Promise<string | null>;
  write(key: CredentialKey, value: string): Promise<void>;
  delete(key: CredentialKey): Promise<void>;
}

/** Path-scoped install identity; another checkout or Windows account cannot inherit tokens. */
export class WindowsCredentialVault implements CredentialVault {
  readonly namespace: string;
  constructor(installationRoot: string) {
    this.namespace = 'RockBase/GSC/v1/' + createHash('sha256').update(path.resolve(installationRoot).toLowerCase()).digest('hex').slice(0, 32);
  }
  async operation(operation: 'read' | 'write' | 'delete', key: string, value?: string): Promise<string | null> {
    if (process.platform !== 'win32') throw new Error('Windows Credential Manager is required; no plaintext fallback.');
    const python = path.resolve(__dirname, '../../../../modules/seo/.venv/Scripts/python.exe');
    const bridge = path.resolve(__dirname, '../../../../backend/src/services/gsc/credential_vault.py');
    if (!fs.existsSync(python) || !fs.existsSync(bridge)) throw new Error('Run modules/seo/SETUP_SEO.bat before using secure Google storage.');
    return new Promise((resolve, reject) => {
      const child = spawn(python, ['-I', bridge], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: Object.fromEntries(Object.entries(process.env).filter(([k]) => ['SYSTEMROOT','WINDIR','PATH'].includes(k.toUpperCase()))),
      });
      let output = ''; let settled = false;
      const fail = () => { if (!settled) { settled = true; reject(new Error('Windows Credential Manager unavailable; credentials were not saved to files.')); } };
      const timer = setTimeout(() => { child.kill(); fail(); }, 10000);
      child.stdout.on('data', (data: Buffer) => { output += data.toString(); if (output.length > 16384) { child.kill(); fail(); } });
      child.stderr.resume(); // never echo bridge diagnostics or credential data
      child.on('error', () => { clearTimeout(timer); fail(); });
      child.stdin.on('error', fail);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        try {
          const result = JSON.parse(output);
          if (code !== 0 || result.ok !== true) { fail(); return; }
          settled = true; resolve(typeof result.value === 'string' ? result.value : null);
        } catch { fail(); }
      });
      child.stdin.end(JSON.stringify({ operation, target: `${this.namespace}/${key}`, value }));
    });
  }
  read(key: CredentialKey) { return this.operation('read', key); }
  async write(key: CredentialKey, value: string) { await this.operation('write', key, value); }
  async delete(key: CredentialKey) { await this.operation('delete', key); }
}

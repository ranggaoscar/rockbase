import crypto from 'crypto';

const GCM_IV_LENGTH = 12;
const GCM_AUTH_TAG_LENGTH = 16;
const CURRENT_VERSION = 'v2';

export function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error('ENCRYPTION_KEY must be configured with exactly 64 hexadecimal characters.');
  }
  if (!/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters.');
  }
  return key;
}

export function assertEncryptionConfiguration(): void {
  getEncryptionKey();
}

export function encrypt(text: string): string {
  const key = Buffer.from(getEncryptionKey(), 'hex');
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_AUTH_TAG_LENGTH });
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return [CURRENT_VERSION, iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

export function decrypt(text: string): string {
  const key = Buffer.from(getEncryptionKey(), 'hex');
  if (text.startsWith(`${CURRENT_VERSION}:`)) {
    const parts = text.split(':');
    if (parts.length !== 4) throw new Error('Invalid encrypted text format');
    const [, ivHex, authTagHex, encryptedHex] = parts;
    if (!/^[a-f0-9]{24}$/i.test(ivHex) || !/^[a-f0-9]{32}$/i.test(authTagHex) || !/^[a-f0-9]*$/i.test(encryptedHex)) {
      throw new Error('Invalid encrypted text format');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'), { authTagLength: GCM_AUTH_TAG_LENGTH });
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]).toString();
  }

  // Backward compatibility: decrypt legacy AES-256-CBC values so existing
  // accounts and backups remain usable. Every subsequent write uses v2/GCM.
  const textParts = text.split(':');
  const ivHex = textParts.shift();
  if (!ivHex) throw new Error('Invalid encrypted text format');
  if (!/^[a-f0-9]{32}$/i.test(ivHex)) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(ivHex, 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

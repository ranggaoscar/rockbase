/** Owner-invoked local maintenance only. Receives credentials over stdin, never argv/logs. */
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

export async function changeAdminPassword(databasePath: string, backupPath: string, userId: string, password: string) {
  if (password.length < 16 || Buffer.byteLength(password, 'utf8') > 72 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Use a unique passphrase of 16+ characters, at most 72 UTF-8 bytes, with upper/lowercase letters and digits.');
  }
  const db = new Database(databasePath, { fileMustExist: true });
  try {
    const user = db.prepare('SELECT id,role,password FROM User WHERE id=?').get(userId) as { id: string; role: string; password: string } | undefined;
    if (!user || user.role !== 'Admin') throw new Error('The specified existing administrator was not found.');
    if (await bcrypt.compare(password, user.password)) throw new Error('The new password must differ from the current password.');
    const hash = await bcrypt.hash(password, 12);
    // Exclusive new destination: never overwrite an existing recovery backup.
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    const fd = fs.openSync(backupPath, 'wx', 0o600); fs.closeSync(fd);
    await db.backup(backupPath);
    const backup = new Database(backupPath, { readonly: true });
    try { if (backup.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Recovery backup integrity failed.'); }
    finally { backup.close(); }
    const result = db.prepare("UPDATE User SET password=?,updatedAt=? WHERE id=? AND role='Admin' AND password=?")
      .run(hash, Date.now(), userId, user.password);
    if (result.changes !== 1) throw new Error('Concurrent account change; no password was replaced.');
    const stored = db.prepare('SELECT password FROM User WHERE id=?').get(userId) as { password: string };
    if (!await bcrypt.compare(password, stored.password)) throw new Error('Password read-back verification failed.');
    return { updated: true, backupCreated: true, socialEncryptionUnchanged: true };
  } finally { db.close(); }
}

async function main() {
  if (!process.argv.includes('--apply-owner-approved')) throw new Error('Explicit --apply-owner-approved is required; no credentials changed.');
  dotenv.config({ quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith('file:')) throw new Error('Existing local SQLite configuration is required.');
  const raw = url.slice(5).split('?')[0];
  const database = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), 'prisma', raw);
  const input: Buffer[] = [];
  let bytes = 0;
  for await (const part of process.stdin) {
    bytes += part.length;
    if (bytes > 8192) throw new Error('Input exceeds safety limit.');
    input.push(part);
  }
  const body = JSON.parse(Buffer.concat(input).toString('utf8'));
  if (typeof body.userId !== 'string' || typeof body.password !== 'string') throw new Error('Invalid input.');
  const backup = path.resolve(process.cwd(), 'backups', `owner-password-${Date.now()}-${process.pid}.sqlite`);
  const result = await changeAdminPassword(database, backup, body.userId, body.password);
  console.log(JSON.stringify(result));
}

if (require.main === module) main().catch(() => {
  // Never render raw parser/SQLite errors: their context may include submitted credentials.
  console.error('Administrator password change did not complete. Check input, backup availability and selected existing Admin. No secret is logged.');
  process.exitCode = 1;
});

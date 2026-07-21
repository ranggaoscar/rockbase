import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const REQUIRED_TABLES = ['_prisma_migrations', 'User', 'Workspace', 'SocialAccount', 'Post', 'Campaign', 'ActivityLog'];

export interface BackupManifest {
  formatVersion: 1;
  createdAt: string;
  environment: string;
  sourceDatabase: string;
  databaseFile: string;
  sha256: string;
  sizeBytes: number;
  migrations: string[];
  media: { included: false; strategy: 'separate-media-backup' };
}

export function runtimeRoot(): string {
  return path.resolve(process.cwd());
}

export function assertInside(candidate: string, allowedRoot: string, label: string): void {
  const relative = path.relative(path.resolve(allowedRoot), path.resolve(candidate));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new Error(`${label} must remain inside its allowed runtime directory.`);
}

export function resolveActiveSqliteDatabasePath(databaseUrl = process.env.DATABASE_URL, root = runtimeRoot()): string {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) throw new Error('DATABASE_URL must be a file: SQLite URL.');
  const value = databaseUrl.slice(5).split('?')[0];
  if (!value || value === ':memory:' || value === '::memory:') throw new Error('In-memory SQLite databases cannot be backed up.');
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(root, 'prisma', value));
  assertInside(resolved, root, 'Active SQLite database');
  fs.accessSync(resolved, fs.constants.R_OK);
  return resolved;
}

export function resolveBackupRoot(root = runtimeRoot()): string {
  const resolved = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'));
  assertInside(resolved, root, 'Backup directory');
  return resolved;
}

export function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function migrationInventory(databasePath: string): string[] {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return (database.prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name').all() as Array<{ migration_name: string }>).map((row) => row.migration_name);
  } finally {
    database.close();
  }
}

export function validateBackup(backupDirectory: string): BackupManifest {
  const manifestPath = path.join(backupDirectory, 'manifest.json');
  const checksumPath = path.join(backupDirectory, 'checksums.sha256');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(checksumPath)) throw new Error('Backup is incomplete: manifest or checksum file is missing.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
  if (manifest.formatVersion !== 1 || manifest.databaseFile !== 'database.sqlite') throw new Error('Backup manifest format is not supported.');
  const databasePath = path.join(backupDirectory, manifest.databaseFile);
  if (!fs.existsSync(databasePath)) throw new Error('Backup database file is missing.');
  const actualChecksum = sha256(databasePath);
  if (manifest.sha256 !== actualChecksum || !fs.readFileSync(checksumPath, 'utf8').trim().startsWith(`${actualChecksum}  database.sqlite`)) throw new Error('Backup checksum validation failed.');
  if (fs.readFileSync(databasePath).subarray(0, 16).toString('utf8') !== 'SQLite format 3\u0000') throw new Error('Backup database is not a SQLite file.');
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`SQLite integrity_check failed: ${integrity}`);
    const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length) throw new Error(`Backup is missing required Prisma tables: ${missing.join(', ')}`);
    if (JSON.stringify(migrationInventory(databasePath)) !== JSON.stringify(manifest.migrations)) throw new Error('Backup migration inventory does not match the database.');
  } finally {
    database.close();
  }
  return manifest;
}

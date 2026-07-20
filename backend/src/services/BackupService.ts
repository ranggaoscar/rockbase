import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import { BackupManifest, migrationInventory, resolveActiveSqliteDatabasePath, resolveBackupRoot, sha256, validateBackup } from '../utils/sqliteRecovery';

export class BackupService {
  private backupRoot(): string {
    const root = resolveBackupRoot();
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  public init(): void {
    cron.schedule('0 0 * * *', () => {
      console.log('[BackupService] Starting scheduled backup...');
      void this.createBackup();
    });
    console.log('[BackupService] Auto-backup initialized daily; automatic deletion is disabled.');
  }

  public async createBackup(): Promise<string | null> {
    let temporaryDirectory: string | undefined;
    try {
      const sourceDatabase = resolveActiveSqliteDatabasePath();
      const backupRoot = this.backupRoot();
      const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
      const name = `backup-${timestamp}`;
      const finalDirectory = path.join(backupRoot, name);
      if (fs.existsSync(finalDirectory)) throw new Error(`Backup directory already exists: ${name}`);
      temporaryDirectory = path.join(backupRoot, `.${name}.partial-${process.pid}`);
      fs.mkdirSync(temporaryDirectory);
      const databasePath = path.join(temporaryDirectory, 'database.sqlite');
      const source = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
      try {
        await source.backup(databasePath);
      } finally {
        source.close();
      }

      const manifest: BackupManifest = {
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'unknown',
        sourceDatabase: path.relative(process.cwd(), sourceDatabase),
        databaseFile: 'database.sqlite',
        sha256: sha256(databasePath),
        sizeBytes: fs.statSync(databasePath).size,
        migrations: migrationInventory(databasePath),
        media: { included: false, strategy: 'separate-media-backup' },
      };
      fs.writeFileSync(path.join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      fs.writeFileSync(path.join(temporaryDirectory, 'checksums.sha256'), `${manifest.sha256}  database.sqlite\n`, { mode: 0o600 });
      validateBackup(temporaryDirectory);
      fs.renameSync(temporaryDirectory, finalDirectory);
      console.log(`[BackupService] Verified SQLite backup created: ${name}`);
      return finalDirectory;
    } catch (error) {
      console.error('[BackupService] Backup failed:', error);
      if (temporaryDirectory) console.error(`[BackupService] Partial backup retained for inspection: ${temporaryDirectory}`);
      return null;
    }
  }

  public getBackups(): Array<{ name: string; path: string; time: Date }> {
    const backupRoot = this.backupRoot();
    return fs.readdirSync(backupRoot)
      .filter((name) => name.startsWith('backup-'))
      .map((name) => ({ name, path: path.join(backupRoot, name), time: fs.statSync(path.join(backupRoot, name)).mtime }))
      .sort((a, b) => b.time.getTime() - a.time.getTime());
  }
}

export const backupService = new BackupService();

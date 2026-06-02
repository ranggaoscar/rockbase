import * as fs from 'fs';
import * as path from 'path';
import * as cron from 'node-cron';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const DB_PATH = path.join(process.cwd(), 'dev.db');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const MAX_BACKUPS = 7;

export class BackupService {
  constructor() {
    this.ensureBackupDir();
  }

  private ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  public init() {
    cron.schedule('0 0 * * *', () => {
      console.log('[BackupService] Starting scheduled backup...');
      this.createBackup();
    });
    console.log('[BackupService] Auto-backup system initialized (every 24h, keep last 7)');
  }

  public createBackup(): string | null {
    this.ensureBackupDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFolderName = `backup-${timestamp}`;
    const backupFolderPath = path.join(BACKUP_DIR, backupFolderName);

    try {
      fs.mkdirSync(backupFolderPath, { recursive: true });

      if (fs.existsSync(DB_PATH)) {
        fs.copyFileSync(DB_PATH, path.join(backupFolderPath, 'dev.db'));
      } else {
        console.warn('[BackupService] dev.db not found, skipping database backup.');
      }

      if (fs.existsSync(UPLOADS_DIR)) {
        fs.cpSync(UPLOADS_DIR, path.join(backupFolderPath, 'uploads'), { recursive: true });
      } else {
        console.info('[BackupService] No uploads directory found, skipping.');
      }

      console.log(`[BackupService] Backup created: ${backupFolderName}`);
      this.rotateBackups();
      return backupFolderPath;
    } catch (err) {
      console.error('[BackupService] Backup failed:', err);
      // Clean up partial backup folder if it exists
      if (fs.existsSync(backupFolderPath)) {
        fs.rmSync(backupFolderPath, { recursive: true, force: true });
      }
      return null;
    }
  }

  private rotateBackups() {
    try {
      const backups = fs.readdirSync(BACKUP_DIR)
        .map(name => ({ name, path: path.join(BACKUP_DIR, name) }))
        .filter(f => fs.statSync(f.path).isDirectory() && f.name.startsWith('backup-'))
        .map(f => ({ name: f.name, time: fs.statSync(f.path).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);

      if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(MAX_BACKUPS);
        for (const backup of toDelete) {
          fs.rmSync(path.join(BACKUP_DIR, backup.name), { recursive: true, force: true });
          console.log(`[BackupService] Deleted old backup: ${backup.name}`);
        }
      }
    } catch (err) {
      console.error('[BackupService] Backup rotation failed:', err);
    }
  }

  public getBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtime
      }))
      .sort((a, b) => b.time.getTime() - a.time.getTime());
  }
}

export const backupService = new BackupService();

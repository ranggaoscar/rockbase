import { backupService } from '../services/BackupService';

async function main() {
  console.log('[ManualBackup] Starting immediate database backup...');
  const path = backupService.createBackup();
  if (path) {
    console.log(`[ManualBackup] Success! Backup saved to: ${path}`);
    process.exit(0);
  } else {
    console.error('[ManualBackup] Failed to create backup.');
    process.exit(1);
  }
}

main();

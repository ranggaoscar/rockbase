import fs from 'fs';
import path from 'path';
import { assertInside, validateBackup } from '../utils/sqliteRecovery';

function usage(): never {
  throw new Error('Usage: restore-backup.ts verify-only <backup-dir> | restore-to-target <backup-dir> <new-target-db>');
}

function resolveTarget(target: string): string {
  const allowedRoot = path.resolve(process.env.RESTORE_TARGET_ROOT || path.join(process.cwd(), 'restore-targets'));
  const resolved = path.resolve(target);
  assertInside(resolved, allowedRoot, 'Restore target');
  if (fs.existsSync(resolved)) throw new Error('Restore target already exists; restore only permits a new target.');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

async function main(): Promise<void> {
  const [mode, backupDirectory, target] = process.argv.slice(2);
  if (!mode || !backupDirectory) usage();
  const manifest = validateBackup(path.resolve(backupDirectory));
  if (mode === 'verify-only') {
    if (target) usage();
    console.log(`[Restore] Verified backup created ${manifest.createdAt}; no data was restored.`);
    return;
  }
  if (mode !== 'restore-to-target' || !target) usage();
  const source = path.join(path.resolve(backupDirectory), manifest.databaseFile);
  const destination = resolveTarget(target);
  const temporary = `${destination}.partial-${process.pid}`;
  if (fs.existsSync(temporary)) throw new Error('Restore temporary target already exists; inspect it before retrying.');
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
  fs.renameSync(temporary, destination);
  console.log(`[Restore] Restored verified backup to new target: ${destination}`);
}

main().catch((error) => {
  console.error('[Restore] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

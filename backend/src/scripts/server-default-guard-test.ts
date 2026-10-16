import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findDefaultCredentialUserIds, SHIPPED_DEFAULT_PASSWORDS } from '../utils/serverDefaultCredentialGuard';

const BACKEND_DIR = path.resolve(__dirname, '../..');
// Relative from BACKEND_DIR: the absolute project path contains spaces that
// break through `shell: true` child spawning on Windows.
const RUNNER = 'src/scripts/server-mode-default-guard-runner.ts';

function runGuard(env: Record<string, string>): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['ts-node', '--files', RUNNER], {
      env: { ...process.env, ...env },
      cwd: BACKEND_DIR,
      shell: process.platform === 'win32',
    });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stderr: stderr + stdout }));
  });
}

async function main() {
  const defaultHash = await bcrypt.hash(SHIPPED_DEFAULT_PASSWORDS[0], 4);
  const uniqueHash = await bcrypt.hash(`UniqueFixture-${Date.now()}-RockBase`, 4);

  const flagged = await findDefaultCredentialUserIds([
    { id: 'legacy-account', password: defaultHash },
    { id: 'safe-account', password: uniqueHash },
  ]);
  assert.deepEqual(flagged, ['legacy-account'], 'helper must flag exactly the shipped-default account');

  const clean = await findDefaultCredentialUserIds([
    { id: 'safe-account', password: uniqueHash },
    { id: 'empty-account', password: '' },
  ]);
  assert.deepEqual(clean, [], 'unique/local accounts must never be flagged');

  // Server Mode against the operator's real database: the legacy default is
  // still valid there, so the preflight must fail closed (read-only check).
  const legacyRun = await runGuard({ ROCKBASE_MODE: 'server', DATABASE_URL: 'file:./dev.db' });
  assert.equal(legacyRun.code, 1, `Server Mode must not start while a shipped default credential remains valid; output: ${legacyRun.stderr}`);
  assert.match(legacyRun.stderr, /Server Mode cannot start while dashboard accounts still accept/, `expected refusal message; output: ${legacyRun.stderr}`);
  const guardLines = legacyRun.stderr.split(/\r?\n/).filter((line) => line.includes('[ServerModeGuard]'));
  assert.ok(guardLines.length >= 1, 'guard banner expected in refusal output');
  assert.doesNotMatch(guardLines.join('\n'), /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'refusal output must not leak account identifiers');

  // Local Mode is the primary passwordless experience: the guard is a no-op.
  const localRun = await runGuard({ ROCKBASE_MODE: 'local', DATABASE_URL: 'file:./dev.db' });
  assert.equal(localRun.code, 0, `Local Mode must not run the account preflight; output: ${localRun.stderr}`);

  // A database with only unique credentials passes the Server Mode preflight.
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rockbase-server-guard-'));
  try {
    const file = path.join(dir, 'guard-fixture.db');
    const Database = require('better-sqlite3');
    const db = new Database(file);
    db.exec('CREATE TABLE User(id TEXT PRIMARY KEY, role TEXT, password TEXT)');
    db.prepare('INSERT INTO User VALUES(?,?,?)').run('safe-admin', 'Admin', uniqueHash);
    db.close();
    const cleanRun = await runGuard({ ROCKBASE_MODE: 'server', DATABASE_URL: `file:${file}` });
    assert.equal(cleanRun.code, 0, `preflight should pass with unique credentials; stderr: ${cleanRun.stderr}`);
    assert.match(cleanRun.stderr, /preflight passed/, 'expected preflight success message');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('[ServerModeDefaultGuard] PASS: helper detects shipped defaults only; Server Mode refuses a legacy default-credential DB fail-closed; Local Mode is a no-op; unique-credential DB passes.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

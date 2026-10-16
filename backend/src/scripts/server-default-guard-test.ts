import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findDefaultCredentialUserIds, SHIPPED_DEFAULT_PASSWORDS } from '../utils/serverDefaultCredentialGuard';

const BACKEND_DIR = path.resolve(__dirname, '../..');
const RUNNER = 'src/scripts/server-mode-default-guard-runner.ts';

function runGuard(env: Record<string, string>): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--files', RUNNER], {
      env: { ...process.env, ...env },
      cwd: BACKEND_DIR,
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

  // Portable, isolated fixtures: never require or open the operator's database.
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rockbase-server-guard-'));
  try {
    const file = path.join(dir, 'guard-fixture.db');
    const Database = require('better-sqlite3');
    const db = new Database(file);
    db.exec('CREATE TABLE User(id TEXT PRIMARY KEY, role TEXT, password TEXT)');
    db.prepare('INSERT INTO User VALUES(?,?,?)').run('legacy-admin', 'Admin', defaultHash);
    db.close();

    const legacyRun = await runGuard({ ROCKBASE_MODE: 'server', DATABASE_URL: `file:${file}` });
    assert.equal(legacyRun.code, 1, `Server Mode must refuse shipped defaults; output: ${legacyRun.stderr}`);
    assert.match(legacyRun.stderr, /Server Mode cannot start while dashboard accounts still accept/);
    assert(!legacyRun.stderr.includes('legacy-admin'), 'refusal output must not leak account identifiers');

    // Local Mode must not even need an accessible database.
    const unavailable = `file:${path.join(dir, 'absent-directory', 'unavailable.db')}`;
    const localRun = await runGuard({ ROCKBASE_MODE: 'local', DATABASE_URL: unavailable });
    assert.equal(localRun.code, 0, `Local Mode must skip the preflight; output: ${localRun.stderr}`);
    const unavailableRun = await runGuard({ ROCKBASE_MODE: 'server', DATABASE_URL: unavailable });
    assert.equal(unavailableRun.code, 1, 'An unavailable database must fail closed in Server Mode');
    assert.match(unavailableRun.stderr, /Database credential verification unavailable/);

    const cleanDb = new Database(file);
    cleanDb.prepare('UPDATE User SET password = ?').run(uniqueHash);
    cleanDb.close();
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

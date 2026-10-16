import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set before importing logger: its existing startup cleanup must only see this test's scratch directory.
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rockbase-redaction-'));
process.env.LOG_DIR = path.join(scratch, 'logs');

async function main() {
  const { scrubSensitiveData, installConsoleRedaction } = await import('../utils/sensitiveData');
  const canaries = ['pw-canary', 'cookie-canary', 'auth-canary', 'token-canary', 'secret-canary', 'api-canary', 'enc-canary', 'bearer-canary'];
  const error = new Error('request failed?token=token-canary');
  (error as any).password = 'pw-canary';
  (error as any).headers = { Authorization: 'Bearer auth-canary' };
  const circular: any = { password: 'pw-canary', items: [{ cookie: 'cookie-canary', label: 'kept' }, 'https://u:p%40ss@example.invalid/a?api_key=api-canary'], error };
  circular.self = circular;
  const originalPassword = circular.password;
  const safe = scrubSensitiveData(circular);
  const safeText = JSON.stringify(safe);
  for (const canary of canaries.slice(0, 7)) assert.equal(safeText.includes(canary), false, `leaked ${canary}`);
  assert.equal(safeText.includes('Bearer auth-canary'), false);
  assert.equal((safe as any).items[0].label, 'kept');
  assert.equal((safe as any).self, '[Circular]');
  assert.equal(circular.password, originalPassword, 'input was mutated');
  for (const text of [
    'request Cookie: sessionid=EXTRA_COOKIE; csrftoken=EXTRA_CSRF',
    'password=EXTRA_FIRST EXTRA_SECOND',
    'Authorization: Basic EXTRA_BASIC==',
    'https://example.invalid/?code=EXTRA_CODE&key=EXTRA_KEY&signature=EXTRA_SIG',
  ]) assert(!JSON.stringify(scrubSensitiveData(text)).includes('EXTRA_'), 'textual credential escaped redaction');
  assert(!JSON.stringify(scrubSensitiveData(new URL('https://x.invalid/?access_token=EXTRA_URL'))).includes('EXTRA_URL'));
  assert.match(JSON.stringify(scrubSensitiveData('https://x.invalid/?access%5Ftoken=token-canary&ok=yes')), /REDACTED/);
  assert.match(JSON.stringify(scrubSensitiveData('{"apiKey":"api-canary","title":"retained"}')), /REDACTED/);
  assert.match(JSON.stringify(scrubSensitiveData('Authorization: Bearer bearer-canary')), /REDACTED/);
  assert.equal(JSON.stringify(scrubSensitiveData('Cookie: session=cookie-canary')).includes('cookie-canary'), false);
  assert.equal(JSON.stringify(scrubSensitiveData('x-api-key: api-canary')).includes('api-canary'), false);
  assert.equal(JSON.stringify(scrubSensitiveData('https://user:pass%40word@example.invalid/path')).includes('pass%40word'), false);
  assert.match(JSON.stringify(scrubSensitiveData('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature')), /REDACTED/);

  const { logger, readRecentLogs } = await import('../services/logger');
  logger.info('query ?token=token-canary', { password: 'pw-canary', items: [{ cookie: 'cookie-canary', label: 'visible' }], count: 3 });
  const newLog = readRecentLogs(1).join('\n');
  for (const canary of canaries.slice(0, 7)) assert.equal(newLog.includes(canary), false, `logger leaked ${canary}`);
  assert.match(newLog, /visible/);
  // Historical text is sanitized at read time; its underlying bytes remain unchanged.
  const logFile = path.join(process.env.LOG_DIR!, `rockbase-${new Date().toISOString().slice(0, 10)}.log`);
  const rawNewLog = fs.readFileSync(logFile, 'utf-8');
  for (const canary of canaries) assert(!rawNewLog.includes(canary), 'Raw file output leaked a canary');
  fs.appendFileSync(logFile, '{"password":"old-canary","message":"historic"}\n', 'utf-8');
  const before = fs.readFileSync(logFile, 'utf-8');
  const recent = readRecentLogs(1).join('\n');
  assert.equal(recent.includes('old-canary'), false);
  assert.equal(fs.readFileSync(logFile, 'utf-8'), before);

  const captured: unknown[][] = [];
  const originalLog = console.log;
  console.log = ((...args: unknown[]) => { captured.push(args); }) as typeof console.log;
  try {
    installConsoleRedaction();
    installConsoleRedaction();
    console.log({ token: 'token-canary', benign: 'visible' });
    console.log('password=%s', 'FORMAT_SECRET_CANARY');
  } finally { console.log = originalLog; }
  assert.equal(JSON.stringify(captured).includes('token-canary'), false);
  assert.equal(JSON.stringify(captured).includes('FORMAT_SECRET_CANARY'), false);
  assert.match(JSON.stringify(captured), /visible/);
  console.log(`[SensitiveDataRedaction] PASS: recursive, string, error, URL, JSON, console and file/read-path redaction; non-mutating; no real logs or credentials used.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});
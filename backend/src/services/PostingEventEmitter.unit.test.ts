/**
 * PostingEventEmitter isolated tests — no server boot required.
 * Run: npx ts-node --transpile-only src/services/PostingEventEmitter.unit.test.ts
 */

// Replace the server import with a stub BEFORE importing the emitter.
import Module from 'module';
const realResolve = (Module as any)._resolveFilename;
const realLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, ...rest: any[]) {
  if (request.endsWith('server') || request.endsWith('server.ts')) {
    return { io: { to: () => ({ emit: () => {} }) } };
  }
  return realLoad.call(this, request, parent, ...rest);
};

import { postingEventEmitter, PostingEvent } from './PostingEventEmitter';

function makeEvent(overrides: Partial<PostingEvent> = {}): PostingEvent {
  return {
    timestamp: new Date().toISOString(),
    accountId: 'acc-1',
    username: 'testuser',
    stage: 'browser_launching',
    level: 'info',
    message: 'Test event',
    ...overrides,
  };
}

let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log('  PASS  ' + message);
  else { console.log('  FAIL  ' + message); failed += 1; }
}

console.log('\n=== PostingEventEmitter Unit Tests ===\n');

// 1. Stage union includes all required stages
const stages: PostingEvent['stage'][] = [
  'campaign_received', 'account_selected', 'account_lock_acquired', 'account_lock_released',
  'daily_budget_checked', 'browser_launching', 'browser_ready', 'instagram_opening',
  'instagram_opened', 'media_resolving', 'media_selected', 'upload_started', 'upload_processing',
  'upload_completed', 'upload_rejected', 'next_clicked', 'cover_next_clicked',
  'caption_inserted', 'share_clicked', 'verification_started', 'verification_poll',
  'published', 'pending_verify', 'retry_scheduled', 'failed', 'cleanup_started', 'cleanup_completed',
];
console.log('1. Stage contract');
postingEventEmitter.clear();
for (const stage of stages) {
  postingEventEmitter.emit(makeEvent({ stage, message: `stage-${stage}`, timestamp: `2026-01-01T00:00:00.${stages.indexOf(stage).toString().padStart(3, '0')}Z` }));
}
const seen = new Set(postingEventEmitter.getRecentEvents(200).map(e => e.stage));
for (const stage of stages) {
  assert(seen.has(stage), `stage ${stage} is in event contract and storable`);
}

// 2. Credential redaction
console.log('\n2. Credential redaction');
postingEventEmitter.clear();
postingEventEmitter.emit(makeEvent({
  metadata: {
    password: 'p', token: 't', cookies: 'c', authorization: 'a', session: 's',
    api_key: 'k', bearer: 'b', safeField: 'ok',
    nested: { password: 'p2', safe: 'yes' },
  } as any,
}));
const meta: any = postingEventEmitter.getRecentEvents(1)[0].metadata;
assert(meta.password === '[REDACTED]', 'password redacted');
assert(meta.token === '[REDACTED]', 'token redacted');
assert(meta.cookies === '[REDACTED]', 'cookies redacted');
assert(meta.authorization === '[REDACTED]', 'authorization redacted');
assert(meta.session === '[REDACTED]', 'session redacted');
assert(meta.api_key === '[REDACTED]', 'api_key redacted');
assert(meta.bearer === '[REDACTED]', 'bearer redacted');
assert(meta.safeField === 'ok', 'safe field preserved');
assert(meta.nested.password === '[REDACTED]', 'nested password redacted');
assert(meta.nested.safe === 'yes', 'nested safe field preserved');

// 3. Emit failure must not throw
console.log('\n3. Emit never throws even with bad input');
try {
  postingEventEmitter.emit({} as any);
  postingEventEmitter.emit(makeEvent({ accountId: '' }));
  assert(true, 'emit() does not throw on minimal input');
} catch (e: any) {
  assert(false, `emit() threw: ${e.message}`);
}

// 4. Buffer retention
console.log('\n4. Buffer retention');
postingEventEmitter.clear();
for (let i = 0; i < 250; i++) {
  postingEventEmitter.emit(makeEvent({ timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(Math.floor(i / 60)).padStart(3, '0')}Z`, stage: 'upload_started', message: `e${i}` }));
}
const total = postingEventEmitter.getRecentEvents(500);
assert(total.length <= 200, `buffer capped: ${total.length} <= 200`);

// 5. Filter campaignId
console.log('\n5. Filter campaignId');
postingEventEmitter.clear();
postingEventEmitter.emit(makeEvent({ campaignId: 'camp-1', message: 'c1' }));
postingEventEmitter.emit(makeEvent({ campaignId: 'camp-2', message: 'c2' }));
postingEventEmitter.emit(makeEvent({ message: 'none' }));
const camp1 = postingEventEmitter.getRecentEvents(10, { campaignId: 'camp-1' });
assert(camp1.length === 1 && camp1[0].message === 'c1', 'filter by campaignId works');

// 6. Filter username
console.log('\n6. Filter username');
postingEventEmitter.clear();
postingEventEmitter.emit(makeEvent({ username: 'alice', message: 'a' }));
postingEventEmitter.emit(makeEvent({ username: 'bob', message: 'b' }));
const alice = postingEventEmitter.getRecentEvents(10, { username: 'alice' });
assert(alice.length === 1 && alice[0].username === 'alice', 'filter by username works');

// 7. Dedupe by stage+accountId+timestamp
console.log('\n7. Dedupe by stage+accountId+timestamp');
postingEventEmitter.clear();
const e1 = makeEvent({ stage: 'browser_launching', timestamp: '2026-01-01T00:00:00.000Z' });
postingEventEmitter.emit(e1);
postingEventEmitter.emit(e1);
assert(postingEventEmitter.getRecentEvents(10).length === 1, 'duplicate dedup');

// 8. Event level types
console.log('\n8. Event level types');
postingEventEmitter.clear();
for (const level of ['info', 'success', 'warning', 'error'] as const) {
  postingEventEmitter.emit(makeEvent({ level, message: level, timestamp: `2026-01-01T00:00:0${'info, success, warning, error'.split(', ').indexOf(level)}.000Z` }));
}
const levels = new Set(postingEventEmitter.getRecentEvents(10).map(e => e.level));
assert(levels.has('info'), 'info level stored');
assert(levels.has('success'), 'success level stored');
assert(levels.has('warning'), 'warning level stored');
assert(levels.has('error'), 'error level stored');

// 9. Clear resets buffer
console.log('\n9. Clear resets buffer');
postingEventEmitter.clear();
assert(postingEventEmitter.getRecentEvents(100).length === 0, 'buffer is empty after clear');

console.log('\n' + (failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`));
process.exit(failed === 0 ? 0 : 1);

/**
 * PostingEventEmitter tests — run with:
 *   npx ts-node --transpile-only src/services/PostingEventEmitter.test.ts
 *
 * Covers:
 *   - event ordering
 *   - dedup on reconnect
 *   - credential redaction
 *   - page refresh persistence (getRecentEvents)
 *   - buffer limits
 *   - filtering
 */

// We test the buffering/getRecentEvents logic directly.
// Socket.IO is not actually available during testing, but the
// io.to().emit() call is wrapped in try/catch in the service.
// We import the module even without a real Socket.IO server.
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

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ ${message}`);
  }
}

async function runTests() {
  console.log('\n📋 PostingEventEmitter Tests\n');

  // ── 1. Event ordering ────────────────────────────────────────────────
  console.log('1. Event ordering');
  postingEventEmitter.clear();

  const e1 = makeEvent({ stage: 'browser_launching', message: 'first' });
  const e2 = makeEvent({ stage: 'instagram_opened', message: 'second' });
  const e3 = makeEvent({ stage: 'upload_started', message: 'third' });

  postingEventEmitter.emit(e1);
  postingEventEmitter.emit(e2);
  postingEventEmitter.emit(e3);

  const recent = postingEventEmitter.getRecentEvents(10);
  assert(recent.length === 3, 'returns all 3 events');
  assert(recent[0].message === 'third', 'most recent first: third');
  assert(recent[1].message === 'second', 'most recent first: second');
  assert(recent[2].message === 'first', 'most recent first: first');

  // ── 2. Reconnect dedup ───────────────────────────────────────────────
  console.log('\n2. Reconnect dedup');
  postingEventEmitter.clear();

  const dedupEvent = makeEvent({
    stage: 'browser_launching',
    timestamp: '2026-01-01T00:00:00.000Z',
  });

  postingEventEmitter.emit(dedupEvent);
  postingEventEmitter.emit(dedupEvent); // duplicate

  const dedupResult = postingEventEmitter.getRecentEvents(10);
  assert(dedupResult.length === 1, 'duplicate events are deduplicated');

  // Different timestamps should NOT be deduplicated
  postingEventEmitter.clear();
  postingEventEmitter.emit(makeEvent({ stage: 'browser_launching', timestamp: '2026-01-01T00:00:00.000Z' }));
  postingEventEmitter.emit(makeEvent({ stage: 'browser_launching', timestamp: '2026-01-01T00:00:01.000Z' }));
  const noDedupResult = postingEventEmitter.getRecentEvents(10);
  assert(noDedupResult.length === 2, 'different timestamps are not deduplicated');

  // ── 3. Credential redaction ──────────────────────────────────────────
  console.log('\n3. Credential redaction');
  postingEventEmitter.clear();

  const credEvent = makeEvent({
    metadata: {
      password: 'supersecret',
      token: 'eyJhbGciOiJIUzI1NiJ9',
      cookies: 'session=abc123',
      authorization: 'Bearer some-jwt',
      session: 'active',
      safeField: 'this-is-ok',
      nestedSensitive: {
        api_key: 'sk-123456',
        secret: 'my-secret',
        nestedSafe: 'hello',
      },
    } as any,
  });

  postingEventEmitter.emit(credEvent);
  const credResult = postingEventEmitter.getRecentEvents(1);
  const meta = credResult[0].metadata as Record<string, any>;

  assert(meta.password === '[REDACTED]', 'password redacted');
  assert(meta.token === '[REDACTED]', 'token redacted');
  assert(meta.cookies === '[REDACTED]', 'cookies redacted');
  assert(meta.authorization === '[REDACTED]', 'authorization redacted');
  assert(meta.session === '[REDACTED]', 'session redacted');
  assert(meta.safeField === 'this-is-ok', 'safe field passes through');
  assert(meta.nestedSensitive.api_key === '[REDACTED]', 'nested api_key redacted');
  assert(meta.nestedSensitive.secret === '[REDACTED]', 'nested secret redacted');
  assert(meta.nestedSensitive.nestedSafe === 'hello', 'nested safe field passes through');

  // ── 4. Page refresh persistence (getRecentEvents) ────────────────────
  console.log('\n4. Page refresh persistence');
  postingEventEmitter.clear();

  for (let i = 0; i < 10; i++) {
    postingEventEmitter.emit(makeEvent({ stage: 'upload_started', message: `event-${i}` }));
  }
  assert(postingEventEmitter.getRecentEvents(100).length === 10, 'all 10 events buffered');

  const limited = postingEventEmitter.getRecentEvents(5);
  assert(limited.length === 5, 'getRecentEvents respects limit');

  // ── 5. Filtering ─────────────────────────────────────────────────────
  console.log('\n5. Filtering');
  postingEventEmitter.clear();

  postingEventEmitter.emit(makeEvent({ campaignId: 'camp-1', message: 'campaign-1 event' }));
  postingEventEmitter.emit(makeEvent({ campaignId: 'camp-2', message: 'campaign-2 event' }));
  postingEventEmitter.emit(makeEvent({ message: 'no campaign' }));

  const byCampaign = postingEventEmitter.getRecentEvents(10, { campaignId: 'camp-1' });
  assert(byCampaign.length === 1, 'filter by campaignId works');
  assert(byCampaign[0].message === 'campaign-1 event', 'correct campaign filtered');

  postingEventEmitter.clear();
  postingEventEmitter.emit(makeEvent({ username: 'alice', message: 'alice event' }));
  postingEventEmitter.emit(makeEvent({ username: 'bob', message: 'bob event' }));

  const byUsername = postingEventEmitter.getRecentEvents(10, { username: 'alice' });
  assert(byUsername.length === 1, 'filter by username works');
  assert(byUsername[0].username === 'alice', 'correct username filtered');

  // ── 6. Buffer limit ──────────────────────────────────────────────────
  console.log('\n6. Buffer limit');
  postingEventEmitter.clear();

  for (let i = 0; i < 250; i++) {
    postingEventEmitter.emit(makeEvent({
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
  }

  const allEvents = postingEventEmitter.getRecentEvents(300);
  assert(allEvents.length <= 200, `buffer capped at 200: ${allEvents.length} events stored`);

  // ── 7. Event levels ──────────────────────────────────────────────────
  console.log('\n7. Event levels');
  postingEventEmitter.clear();

  postingEventEmitter.emit(makeEvent({ level: 'info', message: 'info event' }));
  postingEventEmitter.emit(makeEvent({ level: 'success', message: 'success event' }));
  postingEventEmitter.emit(makeEvent({ level: 'warning', message: 'warning event' }));
  postingEventEmitter.emit(makeEvent({ level: 'error', message: 'error event' }));

  const levels = postingEventEmitter.getRecentEvents(10);
  assert(levels.length === 4, 'all levels stored');
  const levelValues = levels.map((e) => e.level);
  assert(levelValues.includes('info'), 'info level present');
  assert(levelValues.includes('success'), 'success level present');
  assert(levelValues.includes('warning'), 'warning level present');
  assert(levelValues.includes('error'), 'error level present');

  // ── Summary ──────────────────────────────────────────────────────────
  const failed = process.exitCode === 1;
  if (failed) {
    console.log('\n❌ Some tests FAILED\n');
  } else {
    console.log('\n✅ All tests PASSED\n');
  }
  process.exit(failed ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});

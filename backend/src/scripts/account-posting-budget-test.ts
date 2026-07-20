import assert from 'assert/strict';
import {
  AccountPostingBudgetService,
  POSTING_BUDGET_TIME_ZONE,
  postingBudgetDay,
} from '../services/AccountPostingBudgetService';
import { RedisLockClient } from '../services/AccountExecutionLockService';


class FakeRedis implements RedisLockClient {
  private readonly hashes = new Map<string, Map<string, string>>();

  async set(_key: string, _value: string, _px: 'PX', _ttl: number, _nx: 'NX'): Promise<string | null> { throw new Error('unused'); }

  async eval(script: string, _keys: number, key: string, operationId: string, limit?: string): Promise<number> {
    const hash = this.hashes.get(key) || new Map<string, string>();
    this.hashes.set(key, hash);
    if (script.includes('HDEL')) {
      if (hash.get(operationId) !== 'RESERVED') return 0;
      hash.delete(operationId);
      if (hash.size === 0) this.hashes.delete(key);
      return 1;
    }
    if (script.includes('HLEN') && script.includes('RESERVED')) {
      if (hash.has(operationId)) return 2;
      if (hash.size >= Number(limit)) return 0;
      hash.set(operationId, 'RESERVED');
      return 1;
    }
    if (script.includes('EXECUTING')) {
      if (!hash.has(operationId)) return 0;
      hash.set(operationId, 'EXECUTING');
      return 1;
    }
    if (script.includes('COMPLETED')) {
      if (!hash.has(operationId)) return 0;
      hash.set(operationId, 'COMPLETED');
      return 1;
    }
    return 0;
  }
}

async function main(): Promise<void> {
  const service = new AccountPostingBudgetService(new FakeRedis());
  const now = new Date('2026-07-20T12:00:00.000Z');

  const first = await service.reserve('account-a', 'operation-1', 1, now);
  assert.ok(first);
  assert.equal(await service.reserve('account-a', 'operation-2', 1, now), null);

  const concurrent = await Promise.all([
    service.reserve('account-b', 'operation-1', 1, now),
    service.reserve('account-b', 'operation-2', 1, now),
  ]);
  assert.equal(concurrent.filter(Boolean).length, 1);

  const retry = await service.reserve('account-a', 'operation-1', 1, now);
  assert.ok(retry);
  assert.equal(retry!.created, false);

  assert.equal(postingBudgetDay(new Date('2026-07-20T16:59:59.000Z')), '2026-07-20');
  assert.equal(postingBudgetDay(new Date('2026-07-20T17:00:00.000Z')), '2026-07-21');
  assert.equal(POSTING_BUDGET_TIME_ZONE, 'Asia/Jakarta');

  const pending = await service.reserve('account-c', 'operation-pending', 1, now);
  assert.ok(pending);
  assert.equal(await pending!.releaseIfPending(), true);
  assert.ok(await service.reserve('account-c', 'operation-next', 1, now));

  const unknown = await service.reserve('account-d', 'operation-unknown', 1, now);
  assert.ok(unknown);
  assert.equal(await unknown!.startExecution(), true);
  assert.equal(await unknown!.releaseIfPending(), false);
  assert.equal(await service.reserve('account-d', 'operation-next', 1, now), null);

  console.log('[AccountPostingBudgetTest] PASS: limit, concurrency, retry, timezone rollover, pending release, unknown hold.');
}

main().catch((error) => {
  console.error('[AccountPostingBudgetTest] FAIL:', error);
  process.exitCode = 1;
});

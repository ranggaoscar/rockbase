import assert from 'assert/strict';
import {
  AccountExecutionLockService,
  RedisLockClient,
} from '../services/AccountExecutionLockService';

class FakeRedis implements RedisLockClient {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  async set(key: string, value: string, _px: 'PX', ttl: number, _nx: 'NX'): Promise<'OK' | null> {
    this.expire(key);
    if (this.values.has(key)) return null;
    this.values.set(key, { value, expiresAt: Date.now() + Number(ttl) });
    return 'OK';
  }

  async eval(script: string, _keys: number, key: string, owner: string, ttl?: string): Promise<number> {
    this.expire(key);
    const current = this.values.get(key);
    if (!current || current.value !== owner) return 0;
    if (script.includes('PEXPIRE')) {
      current.expiresAt = Date.now() + Number(ttl);
      return 1;
    }
    this.values.delete(key);
    return 1;
  }

  private expire(key: string): void {
    if (this.values.get(key)?.expiresAt! <= Date.now()) this.values.delete(key);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const redis = new FakeRedis();
  const first = new AccountExecutionLockService(redis, { ttlMs: 30, heartbeatMs: 0, ownerId: () => 'owner-a' });
  const second = new AccountExecutionLockService(redis, { ttlMs: 30, heartbeatMs: 0, ownerId: () => 'owner-b' });

  const concurrent = await Promise.all([first.acquire('account-1'), second.acquire('account-1')]);
  assert.equal(concurrent.filter(Boolean).length, 1);
  assert.equal(await second.acquire('account-1'), null);
  assert.equal(await concurrent[0]!.release(), true);
  assert.ok(await second.acquire('account-1'));

  const expiring = await first.acquire('account-2');
  assert.ok(expiring);
  await wait(40);
  assert.ok(await second.acquire('account-2'));

  const heartbeat = new AccountExecutionLockService(redis, { ttlMs: 30, heartbeatMs: 5, ownerId: () => 'owner-heartbeat' });
  const lease = await heartbeat.acquire('account-3');
  assert.ok(lease);
  await wait(45);
  assert.equal(await second.acquire('account-3'), null);
  assert.equal(await lease!.release(), true);

  console.log('[AccountExecutionLockTest] PASS: concurrency, owner release, TTL expiry, heartbeat.');
}

main().catch((error) => {
  console.error('[AccountExecutionLockTest] FAIL:', error);
  process.exitCode = 1;
});

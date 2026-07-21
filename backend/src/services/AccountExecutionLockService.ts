import IORedis from 'ioredis';
import { randomUUID } from 'crypto';

const RELEASE_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const EXTEND_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

export interface RedisLockClient {
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<string | null>;
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

export interface AccountExecutionLockOptions {
  ttlMs?: number;
  heartbeatMs?: number;
  ownerId?: () => string;
}

export class AccountExecutionLease {
  private readonly heartbeat?: NodeJS.Timeout;
  private released = false;
  public lost = false;

  constructor(
    private readonly client: RedisLockClient,
    private readonly key: string,
    public readonly ownerId: string,
    private readonly ttlMs: number,
    heartbeatMs: number,
  ) {
    if (heartbeatMs > 0) {
      this.heartbeat = setInterval(() => {
        this.extend().catch(() => { this.lost = true; });
      }, heartbeatMs);
      this.heartbeat.unref?.();
    }
  }

  async extend(): Promise<boolean> {
    if (this.released || this.lost) return false;
    const extended = await this.client.eval(EXTEND_IF_OWNER, 1, this.key, this.ownerId, String(this.ttlMs));
    if (Number(extended) !== 1) this.lost = true;
    return !this.lost;
  }

  async release(): Promise<boolean> {
    if (this.released) return false;
    this.released = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    const released = await this.client.eval(RELEASE_IF_OWNER, 1, this.key, this.ownerId);
    return Number(released) === 1;
  }
}

export class AccountExecutionLockService {
  private readonly ttlMs: number;
  private readonly heartbeatMs: number;
  private readonly ownerId: () => string;

  constructor(
    private readonly client: RedisLockClient = new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    }) as unknown as RedisLockClient,
    options: AccountExecutionLockOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.heartbeatMs = options.heartbeatMs ?? Math.floor(this.ttlMs / 3);
    this.ownerId = options.ownerId ?? randomUUID;
  }

  async acquire(accountId: string): Promise<AccountExecutionLease | null> {
    const ownerId = this.ownerId();
    const result = await this.client.set(this.key(accountId), ownerId, 'PX', this.ttlMs, 'NX');
    if (result !== 'OK') return null;
    return new AccountExecutionLease(this.client, this.key(accountId), ownerId, this.ttlMs, this.heartbeatMs);
  }

  private key(accountId: string): string {
    return `rockbase:account-execution:${accountId}`;
  }
}

export const accountExecutionLockService = new AccountExecutionLockService();

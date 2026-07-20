import IORedis from 'ioredis';
import { RedisLockClient } from './AccountExecutionLockService';

export const POSTING_BUDGET_TIME_ZONE = 'Asia/Jakarta';

const RESERVE_BUDGET = `
if redis.call('HGET', KEYS[1], ARGV[1]) then return 2 end
if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], 'RESERVED')
redis.call('PEXPIREAT', KEYS[1], ARGV[3])
return 1
`;

const START_BUDGET = `
local state = redis.call('HGET', KEYS[1], ARGV[1])
if not state then return 0 end
if state == 'RESERVED' then redis.call('HSET', KEYS[1], ARGV[1], 'EXECUTING') end
return 1
`;

const COMPLETE_BUDGET = `
if not redis.call('HGET', KEYS[1], ARGV[1]) then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], 'COMPLETED')
return 1
`;

const RELEASE_PENDING_BUDGET = `
if redis.call('HGET', KEYS[1], ARGV[1]) ~= 'RESERVED' then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
if redis.call('HLEN', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end
return 1
`;

export function postingBudgetDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: POSTING_BUDGET_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function nextBudgetReset(now: Date): number {
  const [year, month, day] = postingBudgetDay(now).split('-').map(Number);
  // ponytail: fixed UTC+07 is valid for Asia/Jakarta; use a zone-aware conversion if this timezone becomes configurable.
  return Date.UTC(year, month - 1, day + 1) - (7 * 60 * 60 * 1000);
}

export class AccountPostingBudgetReservation {
  constructor(
    private readonly client: RedisLockClient,
    private readonly key: string,
    private readonly operationId: string,
    public readonly created: boolean,
  ) {}

  async startExecution(): Promise<boolean> {
    return Number(await this.client.eval(START_BUDGET, 1, this.key, this.operationId)) === 1;
  }

  async complete(): Promise<boolean> {
    return Number(await this.client.eval(COMPLETE_BUDGET, 1, this.key, this.operationId)) === 1;
  }

  async releaseIfPending(): Promise<boolean> {
    return Number(await this.client.eval(RELEASE_PENDING_BUDGET, 1, this.key, this.operationId)) === 1;
  }
}

export class AccountPostingBudgetService {
  constructor(
    private readonly client: RedisLockClient = new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    }) as unknown as RedisLockClient,
  ) {}

  async reserve(accountId: string, operationId: string, limit: number, now = new Date()): Promise<AccountPostingBudgetReservation | null> {
    const key = `rockbase:posting-budget:${accountId}:${postingBudgetDay(now)}`;
    const result = Number(await this.client.eval(RESERVE_BUDGET, 1, key, operationId, String(limit), String(nextBudgetReset(now))));
    if (result === 0) return null;
    return new AccountPostingBudgetReservation(this.client, key, operationId, result === 1);
  }
}

export const accountPostingBudgetService = new AccountPostingBudgetService();

import { PrismaClient } from '@prisma/client';
import { logActivity } from './ActivityLogService';

/** The status a job carries while its prepared screen is trusted to still exist on the device. */
export const READY_FOR_REAL_POST = 'READY_FOR_REAL_POST';
/** Terminal status for a prepared post whose on-device Share screen can no longer be trusted. */
export const PREPARATION_EXPIRED = 'PREPARATION_EXPIRED';

/**
 * Why an on-device prepared screen stopped being trusted. Kept short and enumerable so the reason
 * travels into the job result and the activity log without leaking device internals.
 */
export type PreparationExpiryReason =
  | 'hold_expired'
  | 'device_offline'
  | 'device_shutdown'
  | 'device_started'
  | 'device_restarted'
  | 'device_refreshed'
  | 'runtime_lost'
  /** The on-device prepared screen could not be confirmed (app process reset, composer lost). */
  | 'validator_failed';

export interface PreparedExpiryOutcome {
  /** How many jobs actually transitioned to PREPARATION_EXPIRED. */
  expired: number;
  /** The jobs that transitioned, with their device, so callers can release reservations. */
  jobs: { id: string; deviceId: string }[];
}

/** The columns this service reads to decide whether a prepared job may expire. */
interface PreparedJobRow {
  id: string;
  deviceId: string;
  status: string;
  result: unknown;
  publishBoundaryAt: Date | null;
  updatedAt: Date;
}

const SELECT = { id: true, deviceId: true, status: true, result: true, publishBoundaryAt: true, updatedAt: true } as const;

/** The prepared post's bounded hold window, if it recorded a readable one. */
export function preparedHoldUntil(result: unknown): Date | null {
  const raw = (result as any)?.hold?.until;
  if (!raw) return null;
  const until = new Date(raw);
  return Number.isNaN(until.getTime()) ? null : until;
}

/** Share invocations recorded on the prepared result; unreadable is treated as unsafe (NaN). */
function shareInvocationCount(result: unknown): number {
  const value = (result as any)?.shareInvocationCount;
  if (value === undefined || value === null) return 0;
  const count = Number(value);
  return Number.isFinite(count) ? count : Number.NaN;
}

/**
 * Fail-closed safety gate. A prepared post may only expire while it provably never crossed the
 * publish boundary and never invoked Share. Anything else may represent a real publish and is left
 * untouched for manual verification, exactly like AMBIGUOUS.
 */
export function isSafeToExpire(job: { publishBoundaryAt: Date | null; result: unknown }): boolean {
  return job.publishBoundaryAt === null && shareInvocationCount(job.result) === 0;
}

/** A hold is closed once its window has passed — or was never recorded, so it is unbounded/stale. */
export function isHoldClosed(result: unknown, now = new Date()): boolean {
  const until = preparedHoldUntil(result);
  return !until || until.getTime() <= now.getTime();
}

/**
 * Owns the READY_FOR_REAL_POST lifecycle.
 *
 * A prepared post exists only for as long as its on-device Share screen survives. A boot, a
 * shutdown, an offline runtime or an expired hold window all destroy that screen, and the job must
 * then stop advertising a hold that no longer exists — it becomes PREPARATION_EXPIRED.
 *
 * The transition is a guarded, conditional `updateMany` (`status = READY_FOR_REAL_POST AND
 * publishBoundaryAt IS NULL`) so a concurrent worker that crosses the boundary, or a second sweep,
 * can never double-transition or resurrect an expired preparation.
 *
 * Safety is enforced twice: only READY_FOR_REAL_POST jobs are eligible, and `isSafeToExpire`
 * rejects any job with a publish boundary or a non-zero Share count.
 */
export class AndroidPreparedStateService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Expire the specific prepared jobs (used by the hold sweep so a live sibling hold survives). */
  async expireJobs(jobIds: string[], reason: PreparationExpiryReason, now = new Date()): Promise<PreparedExpiryOutcome> {
    const ids = [...new Set(jobIds)];
    if (!ids.length) return { expired: 0, jobs: [] };
    const rows = await this.prisma.androidJob.findMany({
      where: { id: { in: ids }, status: READY_FOR_REAL_POST }, select: SELECT,
    }) as PreparedJobRow[];
    return this.transition(rows, reason, now);
  }

  /** Expire every trusted prepared post on one device (offline, shutdown, boot, runtime loss). */
  async expireForDevice(deviceId: string, reason: PreparationExpiryReason, now = new Date()): Promise<PreparedExpiryOutcome> {
    const rows = await this.prisma.androidJob.findMany({
      where: { deviceId, status: READY_FOR_REAL_POST }, select: SELECT,
    }) as PreparedJobRow[];
    return this.transition(rows, reason, now);
  }

  /** Expire trusted prepared posts across devices (cold reconciliation from a device list). */
  async expireForDevices(deviceIds: string[], reason: PreparationExpiryReason, now = new Date()): Promise<PreparedExpiryOutcome> {
    const ids = [...new Set(deviceIds)];
    if (!ids.length) return { expired: 0, jobs: [] };
    const rows = await this.prisma.androidJob.findMany({
      where: { deviceId: { in: ids }, status: READY_FOR_REAL_POST }, select: SELECT,
    }) as PreparedJobRow[];
    return this.transition(rows, reason, now);
  }

  /** Expire prepared posts whose bounded hold window has closed. Used by the scheduler sweep. */
  async expireClosedHolds(reason: PreparationExpiryReason = 'hold_expired', now = new Date()): Promise<PreparedExpiryOutcome> {
    const rows = await this.prisma.androidJob.findMany({
      where: { status: READY_FOR_REAL_POST }, select: SELECT,
    }) as PreparedJobRow[];
    return this.transition(rows.filter((row) => isHoldClosed(row.result, now)), reason, now);
  }

  private async transition(rows: PreparedJobRow[], reason: PreparationExpiryReason, now: Date): Promise<PreparedExpiryOutcome> {
    const eligible = rows.filter((row) => isSafeToExpire(row));
    if (!eligible.length) return { expired: 0, jobs: [] };
    const results = await this.prisma.$transaction(eligible.map((row) => this.prisma.androidJob.updateMany({
      where: { id: row.id, status: READY_FOR_REAL_POST, publishBoundaryAt: null, updatedAt: row.updatedAt },
      data: { status: PREPARATION_EXPIRED, verificationResult: PREPARATION_EXPIRED,
        reason: `Prepared UI is no longer trusted (${reason}); original intent retained, Share never invoked`,
        result: expiredResult(row.result, reason, now) },
    })));
    const jobs = eligible.filter((_row, index) => results[index].count === 1).map((row) => ({ id: row.id, deviceId: row.deviceId }));
    for (const job of jobs) {
      logActivity({
        type: 'android', entityType: 'android_job', entityId: job.id, action: 'prepared-expired', status: 'expired',
        message: `Android prepared screen expired (${reason}); Share was never pressed`,
        metadata: { reason, deviceId: job.deviceId, hold: preparedHoldUntil(rows.find((row) => row.id === job.id)?.result)?.toISOString() ?? null },
      });
    }
    return { expired: jobs.length, jobs };
  }
}

/**
 * Preserve every field the worker recorded (preparedAt, hold.until, shareInvocationCount, …) and add
 * the expiry marker. Never touches result fields the safety gate depends on.
 */
function expiredResult(result: unknown, reason: PreparationExpiryReason, now: Date) {
  const base = result && typeof result === 'object' && !Array.isArray(result)
    ? { ...(result as Record<string, unknown>) } : {};
  return { ...base, preparationExpiredAt: now.toISOString(), preparationExpiredReason: reason } as any;
}

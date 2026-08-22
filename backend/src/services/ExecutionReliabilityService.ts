export type DeliveryRecoveryState = 'SAFE_TO_RETRY' | 'DELIVERY_UNKNOWN' | 'COMPLETED' | 'FAILED' | 'NEEDS_VERIFICATION';

export function recoverCampaignActionStatus(operationStatus?: string | null): { status: string; state: DeliveryRecoveryState } {
  if (operationStatus === 'COMPLETED') return { status: 'completed', state: 'COMPLETED' };
  if (operationStatus === 'FAILED') return { status: 'failed', state: 'FAILED' };
  return { status: 'unknown', state: 'DELIVERY_UNKNOWN' };
}

export function shouldRequeuePost(status: string, deliveryStatus?: string): boolean {
  if (status === 'pending_verify' || status === 'unknown_result') return false;
  if (deliveryStatus === 'UNKNOWN' || deliveryStatus === 'IN_PROGRESS') return false;
  return status === 'pending' || status === 'scheduled';
}

export function mergePostResult(
  serialized: string | null | undefined,
  accountId: string,
  result: Record<string, unknown>,
): string {
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(serialized || '{}'); } catch {}
  return JSON.stringify({ ...current, [accountId]: result });
}

export function pendingVerificationTerminalStatus(verified: boolean): { postStatus: string; resultStatus: string } {
  return verified
    ? { postStatus: 'published', resultStatus: 'success' }
    : { postStatus: 'unknown_result', resultStatus: 'NEEDS_REVIEW' };
}

export function scheduledClaimRecoveryStatus(status: string, hasDurablePost: boolean): 'pending' | 'queued' {
  return status === 'queued' && !hasDurablePost ? 'pending' : status === 'queued' ? 'queued' : 'pending';
}

export type OperatorAttentionReason =
  | 'SESSION_EXPIRED'
  | 'LOGIN_REQUIRED'
  | 'CHECKPOINT'
  | 'VERIFICATION_REQUIRED'
  | 'ACCOUNT_UNAVAILABLE'

export function operatorAttentionReason(account: { status?: string | null; sessionHealth?: string | null }): OperatorAttentionReason | null {
  const health = account.sessionHealth || 'UNKNOWN'
  if (health === 'NEEDS_RELOGIN') return 'LOGIN_REQUIRED'
  if (health === 'CHECKPOINT') return 'CHECKPOINT'
  if (health === 'EXPIRED') return 'SESSION_EXPIRED'
  if (['error', 'logged_out', 'flagged'].includes(account.status || '')) return 'ACCOUNT_UNAVAILABLE'
  return null
}

export function needsOperatorAttention(account: { status?: string | null; sessionHealth?: string | null }) {
  return operatorAttentionReason(account) !== null
}

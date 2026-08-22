import { pendingVerificationReconciler, PendingVerificationReconciler } from './PendingVerificationReconciler';
import { ScheduledPostConsumerService } from './ScheduledPostConsumerService';
import { scheduledPostConsumerService } from '../queue/scheduledPostConsumer';

export class ExecutionReliabilityReconciler {
  constructor(
    private readonly pendingVerification: PendingVerificationReconciler = pendingVerificationReconciler,
    private readonly scheduledPosts: ScheduledPostConsumerService = scheduledPostConsumerService,
  ) {}

  async reconcile(): Promise<{ verified: { confirmed: number; unknown: number }; recoveredScheduledClaims: number }> {
    const [verified, recoveredScheduledClaims] = await Promise.all([
      this.pendingVerification.reconcilePending(),
      this.scheduledPosts.recoverQueuedClaims(),
    ]);
    return { verified, recoveredScheduledClaims };
  }
}

export const executionReliabilityReconciler = new ExecutionReliabilityReconciler();

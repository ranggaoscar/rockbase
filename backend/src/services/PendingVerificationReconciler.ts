import { PrismaClient } from '@prisma/client';
import { pendingVerificationTerminalStatus } from './ExecutionReliabilityService';
import { PostResultService } from './PostResultService';

export interface PublishVerificationEvidence {
  confirmed: boolean;
  reason?: string;
}

export interface PublishVerifier {
  verify(post: { id: string; accountIds: string; results: string | null }): Promise<PublishVerificationEvidence>;
}

export class NoEvidencePublishVerifier implements PublishVerifier {
  async verify(): Promise<PublishVerificationEvidence> {
    return { confirmed: false, reason: 'NO_DURABLE_PLATFORM_EVIDENCE' };
  }
}

export class PendingVerificationReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly verifier: PublishVerifier = new NoEvidencePublishVerifier(),
    private readonly results = new PostResultService(prisma),
  ) {}

  async reconcilePost(postId: string): Promise<'confirmed' | 'unknown' | 'skipped'> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.status !== 'pending_verify') return 'skipped';

    let evidence: PublishVerificationEvidence;
    try {
      evidence = await this.verifier.verify(post);
    } catch {
      evidence = { confirmed: false, reason: 'VERIFIER_ERROR' };
    }

    const accountIds = this.parseAccountIds(post.accountIds);
    const terminal = pendingVerificationTerminalStatus(evidence.confirmed);
    for (const accountId of accountIds) {
      await this.results.merge(post.id, accountId, {
        status: terminal.resultStatus,
        reason: evidence.reason || null,
        reconciled: true,
      }, { status: terminal.postStatus, ...(evidence.confirmed ? { postedAt: new Date() } : {}) });
    }
    return evidence.confirmed ? 'confirmed' : 'unknown';
  }

  async reconcilePending(limit = 25): Promise<{ confirmed: number; unknown: number }> {
    const posts = await this.prisma.post.findMany({
      where: { status: 'pending_verify' },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    let confirmed = 0;
    let unknown = 0;
    for (const post of posts) {
      const result = await this.reconcilePost(post.id);
      if (result === 'confirmed') confirmed++;
      if (result === 'unknown') unknown++;
    }
    return { confirmed, unknown };
  }

  private parseAccountIds(value: string): string[] {
    try { return Array.isArray(JSON.parse(value)) ? JSON.parse(value).map(String) : []; }
    catch { return []; }
  }
}

export const pendingVerificationReconciler = new PendingVerificationReconciler(new PrismaClient());

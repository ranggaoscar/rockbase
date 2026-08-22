import { PrismaClient } from '@prisma/client';
import { mergePostResult } from './ExecutionReliabilityService';

export class PostResultService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaClient) {}

  async merge(
    postId: string,
    accountId: string,
    result: Record<string, unknown>,
    data: { status?: string; postedAt?: Date } = {},
  ): Promise<void> {
    const previous = this.queues.get(postId) || Promise.resolve();
    const operation = previous.then(() => this.writeMergedResult(postId, accountId, result, data));
    this.queues.set(postId, operation.catch(() => {}));
    try {
      await operation;
    } finally {
      if (this.queues.get(postId) === operation) this.queues.delete(postId);
    }
  }

  private async writeMergedResult(
    postId: string,
    accountId: string,
    result: Record<string, unknown>,
    data: { status?: string; postedAt?: Date },
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const post = await transaction.post.findUnique({
        where: { id: postId },
        select: { results: true },
      });
      if (!post) throw new Error(`Post ${postId} not found while recording account result`);
      await transaction.post.update({
        where: { id: postId },
        data: {
          ...(data.status ? { status: data.status } : {}),
          ...(data.postedAt ? { postedAt: data.postedAt } : {}),
          results: mergePostResult(post.results, accountId, result),
        },
      });
    });
  }
}

export const postResultService = new PostResultService(new PrismaClient());

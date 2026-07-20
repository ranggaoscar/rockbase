import { canonicalRequestHash } from './canonicalRequestHash';

export const ROCK_SOCIAL_POST_SCOPE = 'rock-social.post';
export const POSTING_WORKER_DELIVERY_SCOPE = 'posting-worker.delivery';

export function rockSocialPostRequestHash(input: {
  imageUrl: string;
  caption: string;
  accountIds: string[];
  scheduledTime?: string | null;
}): string {
  return canonicalRequestHash(input);
}

export function postingWorkerDeliveryIdentity(input: {
  postId: string;
  accountId: string;
  content: string;
  mediaUrls: string[];
  postIdempotencyKey?: string | null;
}) {
  return {
    scope: POSTING_WORKER_DELIVERY_SCOPE,
    key: `${input.postId}:${input.accountId}`,
    requestHash: canonicalRequestHash(input),
  };
}

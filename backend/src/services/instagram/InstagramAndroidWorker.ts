import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { PrismaClient } from '@prisma/client';
import { logActivity } from '../ActivityLogService';
import { androidMedia } from '../AndroidMediaService';
import {
  InstagramIdentityMismatchError, InstagramPublishNotApprovedError, InstagramScreenExpectationError,
  InstagramSecurityError, InstagramUiAdapter, InstagramUiNotInspectedError,
} from './InstagramUiAdapter';

export type InstagramOutcomeStatus =
  | 'COMPLETED' | 'FAILED' | 'AMBIGUOUS' | 'NEEDS_ATTENTION' | 'SKIPPED' | 'READY_FOR_REAL_POST';

export interface InstagramJobOutcome {
  status: InstagramOutcomeStatus;
  reason?: string;
  result?: Record<string, unknown>;
}

type MediaStager = Pick<typeof androidMedia, 'stage' | 'cleanup'>;

const clamp = (value: string, max = 500) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
const normalized = (username: string) => username.trim().replace(/^@/, '').toLowerCase();

/**
 * The Instagram Android publish pipeline for a single image post.
 *
 * Runs only while the scheduler holds the device lease and the device is claimed BUSY, so the
 * device is never shared with operator control or another job. Responsibilities:
 * verifyIdentity → stageSingleImage → openCreatePost → selectImage → enterCaption →
 * reachPublishBoundary → [publishOnce → verifyResult]. Nothing else.
 *
 * Safety contract:
 * - identity must MATCH the account bound to the job; anything else is NEEDS_ATTENTION, no post;
 * - login walls / checkpoints / security prompts are NEVER bypassed: stop, one evidence artifact,
 *   NEEDS_ATTENTION, no retries;
 * - preparation-only by default: the flow stops at READY_FOR_REAL_POST with the post fully built on
 *   the final Share screen and Share never pressed. Crossing the boundary additionally requires
 *   ANDROID_PUBLISH_APPROVED=true (an explicit operator publish approval);
 * - the Share boundary is crossed at most once per job, enforced by an atomic publishBoundaryAt
 *   claim; a worker crash or re-delivery after the boundary can never press Share again;
 * - SUCCESS is recorded only from explicit post-publication verification; anything unverifiable
 *   after the boundary is AMBIGUOUS (fail closed), never auto-retried.
 */
export class InstagramAndroidWorker {
  /**
   * Publish approval is read per run (never cached): with it unset the worker can only prepare.
   * It must stay unset until pressShare is implemented and an operator grants publish approval.
   */
  private get publishApproved(): boolean {
    return process.env.ANDROID_PUBLISH_APPROVED === 'true';
  }

  constructor(
    private readonly prisma: PrismaClient,
    private readonly adapter: InstagramUiAdapter,
    /** Emulator serial the adapter is bound to; used for media staging/cleanup. */
    private readonly serial: string,
    private readonly media: MediaStager = androidMedia,
  ) {}

  async run(jobId: string): Promise<InstagramJobOutcome> {
    const job = await this.prisma.androidJob.findUnique({ where: { id: jobId }, include: { account: true } });
    if (!job) throw new Error('Android job not found');
    if (job.type !== 'ANDROID_IMAGE_POST') throw new Error('Instagram worker received a non image-post job');
    if (job.status === 'COMPLETED') {
      return { status: 'COMPLETED', reason: 'Job already completed', result: (job.result as Record<string, unknown>) || undefined };
    }
    if (job.status === 'READY_FOR_REAL_POST') {
      // Re-delivery of an already prepared post must never rebuild or publish it.
      return {
        status: 'READY_FOR_REAL_POST',
        reason: 'Post is already prepared and awaits publish approval; the device was left untouched',
        result: (job.result as Record<string, unknown>) || undefined,
      };
    }
    if (job.publishBoundaryAt) {
      // The Share boundary was already crossed (by this or an earlier attempt). Never again.
      await this.prisma.androidJob.updateMany({ where: { id: jobId, status: { not: 'COMPLETED' } },
        data: { status: 'AMBIGUOUS', reason: clamp('Publish boundary already crossed; manual verification required and Share is never retried') } });
      return { status: 'AMBIGUOUS', reason: 'Publish boundary already crossed; manual verification required' };
    }
    if ((job.status !== 'QUEUED' && job.status !== 'RUNNING') || !job.approvedAt) {
      return { status: 'SKIPPED', reason: `Job is ${job.status} without operator approval` };
    }
    const account = job.account;
    if (account.executionEngine !== 'android' || account.homeDeviceId !== job.deviceId) {
      return { status: 'SKIPPED', reason: 'Android account requires its original home device' };
    }
    if (!job.mediaPath || !job.caption || !job.mediaSha256) {
      return this.failBeforeShare(job, 'Draft is missing media or caption');
    }
    // The media must still match what the operator approved — re-hash before any device action.
    const approvedImage = await fs.readFile(job.mediaPath).catch(() => null);
    if (!approvedImage) return this.failBeforeShare(job, 'Approved media file is missing from uploads');
    if (createHash('sha256').update(approvedImage).digest('hex') !== job.mediaSha256) {
      return this.failBeforeShare(job, 'Media changed since approval (sha256 mismatch); create a new draft');
    }

    await this.prisma.androidJob.update({ where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 }, reason: null } });

    let staged: { remote: string } | null = null;
    try {
      // 1. Media staging (checksum verified against the device copy inside the stager).
      staged = await this.media.stage(this.serial, jobId, job.mediaPath);
      this.activity(job.account.workspaceId, job.accountId, jobId, 'stage', 'completed', { remote: staged.remote });

      // 2. Foreground Instagram and class the screen before doing anything else.
      await this.adapter.ensureInstagramForeground();
      await this.assertNoSecurityPrompt('foreground');

      // 3. Identity verification — only a MATCH may proceed.
      const detectedRaw = await this.adapter.readActiveUsername();
      if (!detectedRaw) {
        const evidence = await this.evidence(job, 'identity-unknown');
        await this.finish(jobId, 'NEEDS_ATTENTION', 'IDENTITY_UNKNOWN', 'Active Instagram account could not be determined from the UI; operator review required', null, evidence);
        return { status: 'NEEDS_ATTENTION', reason: 'Active Instagram account could not be determined; operator review required' };
      }
      const detected = detectedRaw.replace(/^@/, '');
      const expected = (account.androidVerifiedUsername || account.username || '').replace(/^@/, '');
      if (normalized(detected) !== normalized(expected)) {
        const error = new InstagramIdentityMismatchError(detected, expected);
        await this.prisma.socialAccount.update({ where: { id: account.id },
          data: { androidHealth: 'NEEDS_ATTENTION', androidHealthReason: clamp(error.message) } });
        const evidence = await this.evidence(job, 'identity-mismatch');
        await this.finish(jobId, 'NEEDS_ATTENTION', 'ACCOUNT_MISMATCH', error.message, null, evidence);
        this.activity(account.workspaceId, account.id, jobId, 'identity', 'mismatch', { detected, expected });
        return { status: 'NEEDS_ATTENTION', reason: error.message };
      }
      await this.prisma.socialAccount.update({ where: { id: account.id },
        data: { androidVerifiedUsername: detected, androidLastVerifiedAt: new Date(), androidHealth: 'HEALTHY', androidHealthReason: null } });
      this.activity(account.workspaceId, account.id, jobId, 'identity', 'completed', { detected });

      // 4. Build the post, checking for security surfaces after every navigation step.
      await this.adapter.openCreatePost();
      await this.assertNoSecurityPrompt('create-post');
      const selection = await this.adapter.selectStagedImage(staged.remote);
      await this.assertNoSecurityPrompt('select-image');
      this.activity(account.workspaceId, account.id, jobId, 'select-image', 'completed', {
        selectedTile: selection.selectedTile, selectedImageCount: selection.selectedImageCount,
      });
      await this.adapter.enterCaption(job.caption);
      await this.assertNoSecurityPrompt('caption');
      await this.adapter.reachPublishBoundary();
      await this.assertNoSecurityPrompt('share-screen');

      // 5. Preparation-only stop: the post is built up to the final Share screen and nothing is
      //    published. Share is a separate, explicitly approved decision.
      if (!this.publishApproved) {
        const prepared = await this.adapter.verifyPreparedState({ caption: job.caption });
        const preparedAt = new Date();
        const holdMinutes = Number(process.env.ANDROID_PREPARED_HOLD_MINUTES || process.env.ANDROID_IDLE_GRACE_MINUTES || 30);
        const result = {
          preparedAt: preparedAt.toISOString(),
          detectedUsername: detected,
          selectedImage: selection.selectedTile,
          selectedImageCount: selection.selectedImageCount,
          caption: job.caption,
          captionVerified: prepared.captionText === job.caption,
          shareSelector: prepared.shareSelector,
          shareInvocationCount: 0,
          publishApproved: false,
          hold: {
            until: new Date(preparedAt.getTime() + holdMinutes * 60000).toISOString(),
            minutes: holdMinutes,
            mechanism: 'device idle grace: the prepared screen is held while the AVD stays booted',
          },
          evidence: null as string | null,
        };
        if (!prepared.ok) {
          const evidence = await this.evidence(job, 'preparation-incomplete');
          result.evidence = evidence;
          await this.finish(jobId, 'NEEDS_ATTENTION', 'PREPARATION_INCOMPLETE',
            `Post preparation did not reach a verifiable final Share screen: ${prepared.detail}`, result, evidence);
          this.activity(account.workspaceId, account.id, jobId, 'prepare', 'incomplete', { detail: prepared.detail });
          return { status: 'NEEDS_ATTENTION', reason: prepared.detail, result };
        }
        const evidence = await this.evidence(job, 'ready-for-real-post');
        result.evidence = evidence;
        await this.finish(jobId, 'READY_FOR_REAL_POST', 'PREPARED',
          'Post prepared up to the final Share screen; publish approval not granted, Share was not pressed',
          result, evidence);
        this.activity(account.workspaceId, account.id, jobId, 'prepare', 'ready-for-real-post', {
          detectedUsername: detected, captionVerified: true, shareSelector: prepared.shareSelector, shareInvocationCount: 0,
        });
        return { status: 'READY_FOR_REAL_POST', result };
      }

      await this.prisma.androidJob.updateMany({ where: { id: jobId, publishBoundaryAt: null }, data: { status: 'READY_TO_PUBLISH' } });
      this.activity(account.workspaceId, account.id, jobId, 'publish-boundary', 'ready', {});

      // 6. Cross the boundary exactly once (atomic claim; losers never press Share).
      const crossedAt = new Date();
      const crossed = await this.prisma.androidJob.updateMany({ where: { id: jobId, publishBoundaryAt: null },
        data: { status: 'PUBLISHING', publishBoundaryAt: crossedAt } });
      if (!crossed.count) {
        return { status: 'AMBIGUOUS', reason: 'Another attempt crossed the publish boundary first; Share was not pressed again' };
      }
      this.activity(account.workspaceId, account.id, jobId, 'publish', 'boundary-crossed', { publishBoundaryAt: crossedAt.toISOString() });

      let shareError: Error | null = null;
      try { await this.adapter.pressShare(); } catch (error: any) { shareError = error; }

      // 7. Verify the result — the only source of SUCCESS.
      let verification: { published: boolean | null; detail?: string };
      try { verification = await this.adapter.verifyPublished(crossedAt); }
      catch (error: any) { verification = { published: null, detail: `verification failed: ${error.message}` }; }
      const evidence = await this.evidence(job, 'publish-result');
      const result = { publishBoundaryAt: crossedAt.toISOString(), detectedUsername: detected, evidence, verification: verification.detail || null };

      if (verification.published === true) {
        const reason = shareError ? `Share press reported an error but publication was confirmed: ${shareError.message}` : undefined;
        await this.finish(jobId, 'COMPLETED', 'SUCCESS', reason, result, evidence);
        this.activity(account.workspaceId, account.id, jobId, 'publish', 'success', { publishBoundaryAt: crossedAt.toISOString() });
        return { status: 'COMPLETED', result };
      }
      if (verification.published === false) {
        const reason = `Publication confirmed NOT on the account after the single Share attempt: ${verification.detail || 'no post found'}`;
        await this.finish(jobId, 'FAILED', 'FAILED_AFTER_SHARE', reason, result, evidence);
        this.activity(account.workspaceId, account.id, jobId, 'publish', 'failed-after-share', { reason });
        return { status: 'FAILED', reason, result };
      }
      const reason = shareError
        ? `Share was pressed but the result cannot be verified (${shareError.message}); operator review required`
        : `Publication could not be verified (${verification.detail || 'unknown'}); operator review required`;
      await this.finish(jobId, 'AMBIGUOUS', 'UNVERIFIED', reason, result, evidence);
      this.activity(account.workspaceId, account.id, jobId, 'publish', 'ambiguous', { reason });
      return { status: 'AMBIGUOUS', reason, result };
    } catch (error: any) {
      // Failure before the boundary is retryable per job semantics; it never reaches Share.
      if (error instanceof InstagramSecurityError) {
        await this.prisma.socialAccount.update({ where: { id: account.id },
          data: { androidHealth: 'NEEDS_ATTENTION', androidHealthReason: clamp(error.message) } });
        const evidence = await this.evidence(job, `security-${error.securityState.toLowerCase()}`);
        await this.finish(jobId, 'NEEDS_ATTENTION', `SECURITY_${error.securityState}`, error.message, null, evidence);
        this.activity(account.workspaceId, account.id, jobId, 'security', error.securityState.toLowerCase(), {});
        return { status: 'NEEDS_ATTENTION', reason: error.message };
      }
      if (error instanceof InstagramUiNotInspectedError) {
        // A RockBase gap, not an account problem: leave account health alone, fail closed.
        await this.finish(jobId, 'NEEDS_ATTENTION', 'IG_UI_INSPECTION_REQUIRED', error.message, null, null);
        return { status: 'NEEDS_ATTENTION', reason: error.message };
      }
      if (error instanceof InstagramScreenExpectationError) {
        // The device is not where the flow expects it (or a post-condition failed). Nothing was
        // published and the screen needs a human look — never blind-tapped, never retried.
        const evidence = await this.evidence(job, 'screen-expectation');
        await this.finish(jobId, 'NEEDS_ATTENTION', 'SCREEN_EXPECTATION_FAILED', error.message, null, evidence);
        this.activity(account.workspaceId, account.id, jobId, 'prepare', 'screen-expectation-failed', { reason: error.message });
        return { status: 'NEEDS_ATTENTION', reason: error.message };
      }
      if (error instanceof InstagramPublishNotApprovedError) {
        // Defensive: the preparation gate is checked before the boundary, so this can only happen
        // when someone forced publish approval without an implementation behind it.
        const evidence = await this.evidence(job, 'publish-not-approved');
        await this.finish(jobId, 'NEEDS_ATTENTION', 'PUBLISH_NOT_APPROVED', error.message, null, evidence);
        return { status: 'NEEDS_ATTENTION', reason: error.message };
      }
      return this.failBeforeShare(job, error?.message || String(error));
    } finally {
      if (staged) await this.media.cleanup(this.serial, jobId, staged.remote).catch(() => undefined);
    }
  }

  private async assertNoSecurityPrompt(step: string) {
    const state = await this.adapter.detectSecurityState();
    if (state !== 'OK') {
      throw new InstagramSecurityError(state,
        `Instagram shows ${state} at step "${step}"; finish it manually on the device — RockBase never bypasses login, checkpoints or 2FA`);
    }
  }

  private async failBeforeShare(job: { id: string; accountId: string; account: { id: string; workspaceId: string } }, reason: string): Promise<InstagramJobOutcome> {
    const evidence = await this.evidence(job, 'failure-before-share');
    await this.finish(job.id, 'FAILED', 'FAILED_BEFORE_SHARE', reason, null, evidence);
    this.activity(job.account.workspaceId, job.account.id, job.id, 'publish', 'failed-before-share', { reason });
    return { status: 'FAILED', reason };
  }

  private async finish(jobId: string, status: string, verificationResult: string, reason: string | undefined, result: Record<string, unknown> | null, evidence: string | null) {
    await this.prisma.androidJob.update({ where: { id: jobId }, data: {
      status, verificationResult, reason: reason ? clamp(reason) : null,
      result: result ? (result as any) : undefined, evidencePath: evidence || undefined, finishedAt: new Date(),
    } });
  }

  private async evidence(job: { id: string }, tag: string): Promise<string | null> {
    try { return await this.adapter.captureEvidence(`${tag}-${job.id}`); } catch { return null; }
  }

  private activity(workspaceId: string, accountId: string, entityId: string, action: string, status: string, metadata: unknown) {
    logActivity({ workspaceId, type: 'android', entityType: 'android_job', entityId,
      accountId: accountId || undefined, action, status, message: `Instagram Android ${action} ${status}`, metadata });
  }
}

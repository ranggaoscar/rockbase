/**
 * Instagram UI adapter boundary.
 *
 * The generic Android runtime (AndroidRuntimeService) stays app-agnostic: booting emulators,
 * tapping, swiping, typing, screenshotting — nothing about Instagram. Everything that requires
 * *Instagram UI knowledge* lives behind this interface, and the Instagram publish flow lives in
 * InstagramAndroidWorker — never in the Android runtime or scheduler.
 *
 * The production implementation (AdbInstagramUiAdapter) is built strictly from real on-device
 * observation of the officially installed app on the test AVD; the observed contract is recorded
 * in working/android-instagram-ui-notes.md. Surfaces that have never been observed (post-publish
 * confirmation, checkpoints) still fail closed instead of guessing, and pressing Share is gated
 * behind an explicit publish approval.
 */

export type InstagramSecurityState = 'OK' | 'LOGIN_REQUIRED' | 'CHECKPOINT' | 'UNKNOWN';

export interface InstagramPublishVerification {
  /** true = publication confirmed on the account, false = confirmed not published, null = cannot determine. */
  published: boolean | null;
  detail?: string;
}

/** Result of the single-image selection step (evidence for the prepared state). */
export interface InstagramImageSelection {
  /** content-desc of the tile that ended up selected. */
  selectedTile: string;
  /** Always 1 for a single-image post; anything else is refused before continuing. */
  selectedImageCount: number;
}

/** Evidence that the create-post flow really reached the final pre-Share screen. */
export interface InstagramPreparedState {
  ok: boolean;
  detail: string;
  /** Exact selector used to detect the final Share control (detected only, never pressed). */
  shareSelector: string | null;
  captionText: string | null;
  selectedImageCount: number;
}

export interface InstagramUiAdapter {
  /** Bring Instagram to the foreground (launch when needed) and confirm it is the focused app. */
  ensureInstagramForeground(): Promise<void>;
  /** Classify the current screen: normal UI vs login wall / checkpoint / unknown. */
  detectSecurityState(): Promise<InstagramSecurityState>;
  /** The username of the account currently signed in on the device, or null when undetectable. */
  readActiveUsername(): Promise<string | null>;
  openCreatePost(): Promise<void>;
  /** Select exactly the staged image; refuses anything that is not a single selected image. */
  selectStagedImage(remotePath: string): Promise<InstagramImageSelection>;
  enterCaption(caption: string): Promise<void>;
  /** Navigate until the final Share button is reachable — without pressing it. */
  reachPublishBoundary(): Promise<void>;
  /** Confirm the prepared screen: right screen, caption in place, one image, Share control visible. */
  verifyPreparedState(expected: { caption: string }): Promise<InstagramPreparedState>;
  /** Press Share. Callers enforce at-most-once via the persisted publish boundary. */
  pressShare(): Promise<void>;
  /** Verify whether the post made at the publish boundary actually exists on the account. */
  verifyPublished(publishBoundaryAt: Date): Promise<InstagramPublishVerification>;
  /** Save a screenshot artifact of the current device screen and return its absolute path. */
  captureEvidence(tag: string): Promise<string>;
}

/** Raised when an Instagram step has no observed implementation yet (fail closed, never guess). */
export class InstagramUiNotInspectedError extends Error {
  constructor(public readonly step: string) {
    super(`Instagram UI has not been inspected for "${step}" yet: complete the official-app inspection on the test AVD and implement this step in AdbInstagramUiAdapter (see working/android-instagram-ui-notes.md)`);
    this.name = 'InstagramUiNotInspectedError';
  }
}

/** Raised when Instagram shows a login wall, checkpoint or other security surface. Never bypassed. */
export class InstagramSecurityError extends Error {
  constructor(public readonly securityState: InstagramSecurityState, message: string) {
    super(message);
    this.name = 'InstagramSecurityError';
  }
}

/** Raised when the signed-in Instagram account is not the account this job is bound to. */
export class InstagramIdentityMismatchError extends Error {
  constructor(public readonly detected: string, public readonly expected: string) {
    super(`ACCOUNT_MISMATCH: device shows @${detected} but this account expects @${expected}`);
    this.name = 'InstagramIdentityMismatchError';
  }
}

/**
 * Raised when the device shows something other than the screen a step requires, or when a step's
 * post-condition cannot be confirmed. Never blindly retried: the operator must look at the device.
 */
export class InstagramScreenExpectationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramScreenExpectationError';
  }
}

/**
 * Raised by pressShare while RockBase is in preparation-only mode. Pressing Share is a deliberate
 * human decision: the code path that does it stays disabled until an explicit publish approval.
 */
export class InstagramPublishNotApprovedError extends Error {
  constructor(message = 'Publish is not approved: RockBase prepares the post and never presses Share without an explicit operator approval') {
    super(message);
    this.name = 'InstagramPublishNotApprovedError';
  }
}

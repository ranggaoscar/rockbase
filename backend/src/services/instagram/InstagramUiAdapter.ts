/**
 * Instagram UI adapter boundary.
 *
 * The generic Android runtime (AndroidRuntimeService) stays app-agnostic: booting emulators,
 * tapping, swiping, typing, screenshotting — nothing about Instagram. Everything that requires
 * *Instagram UI knowledge* lives behind this interface, and the Instagram publish flow lives in
 * InstagramAndroidWorker — never in the Android runtime or scheduler.
 *
 * The production implementation (AdbInstagramUiAdapter) is completed from a real on-device
 * inspection of the officially installed app. Its observed contract is recorded in
 * working/android-instagram-ui-notes.md. Until the app has been inspected and each step
 * implemented from observation, the Instagram-specific steps fail closed with
 * InstagramUiNotInspectedError — no guessed selectors, no blind taps.
 */

export type InstagramSecurityState = 'OK' | 'LOGIN_REQUIRED' | 'CHECKPOINT' | 'UNKNOWN';

export interface InstagramPublishVerification {
  /** true = publication confirmed on the account, false = confirmed not published, null = cannot determine. */
  published: boolean | null;
  detail?: string;
}

export interface InstagramUiAdapter {
  /** Bring Instagram to the foreground (launch when needed) and confirm it is the focused app. */
  ensureInstagramForeground(): Promise<void>;
  /** Classify the current screen: normal UI vs login wall / checkpoint / unknown. */
  detectSecurityState(): Promise<InstagramSecurityState>;
  /** The username of the account currently signed in on the device, or null when undetectable. */
  readActiveUsername(): Promise<string | null>;
  openCreatePost(): Promise<void>;
  selectStagedImage(remotePath: string): Promise<void>;
  enterCaption(caption: string): Promise<void>;
  /** Navigate until the final Share button is reachable — without pressing it. */
  reachPublishBoundary(): Promise<void>;
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

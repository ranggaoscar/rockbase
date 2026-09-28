# ROCKBASE ANDROID ENGINE — PHASE 3C PREPARATION REPORT

STATUS: **READY_FOR_REAL_POST** (preparation only; Share never pressed)

- Branch: `feat/android-engine-foundation` (no merge, no deploy, no push to main)
- Date: 2026-09-28, live AVD `Medium_Phone_API_36.1` (`emulator-5554`, Android 16)
- Test account: `@naspeny.jaya` (operator-approved exception; 2 existing Chromium records untouched)

## 1. Instagram adapter implementation

`AdbInstagramUiAdapter` implements every step from real on-device observation of Instagram
`447.0.0.55.81` (versionCode `385411990`, installer `com.android.vending`):

| Step | Implementation |
| --- | --- |
| `ensureInstagramForeground` | launch official app, then verify `mCurrentFocus` package |
| `detectSecurityState` | positive signals = observed resource-ids (feed/profile/gallery/editor/caption); sign-in wall = two independent observed login strings; anything else `UNKNOWN`, never `OK` |
| `readActiveUsername` | own profile via `profile_tab`, read `action_bar_title`, strict `^[A-Za-z0-9._]{1,30}$` |
| `openCreatePost` | `profile_header_create_button` → strictly the `Create new post` row (never reel/story/live) |
| `selectStagedImage` | device `ls -l` mtime of the staged file vs each tile's `created on …` text, ±2 min; exactly one selected tile required |
| `enterCaption` | `next_button_textview` (picker) → `media_thumbnail_tray_button` → `caption_input_text_view` → `input text` → `KEYCODE_BACK` commits → caption read back and compared |
| `verifyPreparedState` | screen title `New post` + media preview + `share_footer_button` + caption equality |
| `pressShare` | **not enabled** — always raises `InstagramPublishNotApprovedError` |
| `verifyPublished` | still `InstagramUiNotInspectedError` (post-publish signals unobserved) |

Device primitives are injected via `InstagramUiTransport` (production = ADB; tests replay the real
dumped hierarchies committed in `backend/src/scripts/fixtures/instagram-447/`). Instagram UI
knowledge stays out of `AndroidRuntimeService`. Every navigation step asserts both the screen it
starts from and the screen it must reach; missing/ambiguous controls raise
`InstagramScreenExpectationError` (operator review) instead of tapping lookalikes.

## 2. Live identity verification result

```
expected = naspeny.jaya
detected = naspeny.jaya
MATCH
```

`POST /api/accounts/e6f65120-2458-477b-81b4-c1db67812511/android/verify-identity` → `200`,
`androidVerifiedUsername=naspeny.jaya`, `androidLastVerifiedAt=2026-09-28T09:23:02.943Z`.
Independent proof of the fail-closed side: a fixture account logged against the same device answered
`409 ACCOUNT_MISMATCH: device shows @naspeny.jaya but this account expects @identity.wiring.test`.

## 3. Android account binding

- Account id `e6f65120-2458-477b-81b4-c1db67812511`, `platform=Instagram`, `executionEngine=android`,
  `homeDeviceId=8632c9e2-2a1a-419f-893a-f01a38cbdfe5` (`RockDroid-01`), `brandTag=android-test`.
- No password stored or submitted (`POST /api/accounts` rejects passwords for Android accounts).
- The two existing Chromium `naspeny.jaya` records were not modified, migrated or deleted.

## 4. Test account health state

`androidHealth=HEALTHY`, `androidHealthReason=null` — set **only** by the live on-device read
(created as `NEEDS_ATTENTION: Manual Instagram login and identity verification required`).

## 5. Test asset

`phase3c-live-test.png` (1080×1080, 37,076 bytes) — dark card reading `ROCKBASE ANDROID ENGINE TEST`
plus `Phase 3C preparation only` and the staging timestamp. Staged at
`/sdcard/Pictures/RockBase/77bb628b-a62f-4e10-b6e1-c67e6d631d0b.png` (device mtime `2026-09-28 16:22`,
which is the anchor the picker matched). The staged copy is cleaned up by the media service after the
run; Instagram had already imported it into the composer (the prepared screen still shows it).

## 6. Draft / job ID

`77bb628b-a62f-4e10-b6e1-c67e6d631d0b` (`ANDROID_IMAGE_POST`, one image, caption
`RockBase Android engine integration test.`, no hashtags, no mentions, no branding).

## 7. Idempotency key

`android-image:phase3c-prep-20260928-162303` — exactly one job exists for it; re-posting the same
project code with that key returns the same job instead of creating another.

## 8. Scheduler / lease result

Real path: approve → `QUEUED` → BullMQ `androidDeviceQueue` → `AndroidScheduler.run` → durable
`AndroidDeviceLease` → device claimed `BUSY` → worker. Timeline (job activity log):

```
16:23:03.894  stage completed      remote=/sdcard/Pictures/RockBase/77bb628b-….png
16:23:08.990  identity completed   detected=naspeny.jaya
16:23:29.567  select-image completed
16:23:59.016  prepare ready-for-real-post
16:23:59.090  image-post ready_for_real_post
```

Approve at 16:23:03, job finished 16:23:58 (≈55 s), `attempts=1`. Lease released and the device
returned to `READY` with `idleSince=NULL` — the prepared post holds the device for
`ANDROID_PREPARED_HOLD_MINUTES` (30 min, until `09:53:58Z`/16:53 WIB) via
`AndroidScheduler.sweepPreparedHolds()`; after that window the normal idle grace reclaims it, so a
prepared post can never reserve a device forever. Another job for the same device returns `WAITING`
during the hold instead of navigating away from the prepared screen.

## 9. Media selection result

Exactly one image selected, verified by the picker itself:

```
selectedTile = "Selected Photo thumbnail created on September 28, 2026 4:22 PM"
selectedImageCount = 1
```

Selection is matched by device timestamp (not "the newest photo"); a mismatching selection aborts
with `InstagramScreenExpectationError` and zero further taps. The multi-select control was never
touched.

## 10. Caption verification

Caption read back from the device after entry and compared to the approved caption:

```
caption = "RockBase Android engine integration test."
captionVerified = true
```

## 11. Final Share selector observed

```
com.instagram.android:id/share_footer_button (content-desc "Share", class android.widget.Button)
```

Detected only — never pressed. `media_preview_recycler_view` (content-desc `Photo thumbnail`) and
`action_bar_textview_title` text `New post` completed the screen assertion.

## 12. READY_FOR_REAL_POST state

`status=READY_FOR_REAL_POST`, `verificationResult=PREPARED`,
`reason="Post prepared up to the final Share screen; publish approval not granted, Share was not pressed"`,
`publishBoundaryAt=NULL`. Live device re-checked after the run: caption field holds the exact caption
text and the Share control is present on the same screen. An operator re-approve answered
`200 reused=true prepared=true` with no re-queue, `attempts` still `1`.

## 13. Screenshot / evidence path

- `backend/uploads/android-evidence/1790587438548-ready-for-real-post-77bb628b-a62f-4e10-b6e1-c67e6d631d0b.png`
  (gitignored; copy kept at `…/hermes/cache/scratch/phase3c-evidence-ready-for-real-post.png`).
  Visually verified: title `New post`, the test image preview, caption
  `RockBase Android engine integration test.`, blue `Share` button, no published-state indicator.

## 14. Share invocation count — MUST BE 0

`0`. Three independent guarantees: the worker only crosses the boundary when
`ANDROID_PUBLISH_APPROVED=true` (unset in this run), `pressShare()` always raises
`InstagramPublishNotApprovedError`, and `result.shareInvocationCount=0` / `publishBoundaryAt=NULL`.
The automated suite asserts the same with a scripted adapter (`sharePresses === 0`).

## 15. Chromium regression

- `executionEngine` counts in `backend/prisma/dev.db`: **chromium 62 (unchanged), android 1 (new)**.
- Both pre-existing `naspeny.jaya` Chromium rows keep their own state (`active`, session health
  `NEEDS_RELOGIN` / `HEALTHY`, `homeDeviceId=NULL`).
- `android-chromium-regression-test`, `session-integrity-p0`, `queue-runtime-safety` all exit 0;
  the Chromium worker/posting path was never enabled during this phase (`automationEnabled=false`).

## 16. Tests / build

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` (backend) | exit 0 |
| `npm run build` (frontend) | exit 0 (1908 modules, 22.5 s) |
| `npm run test:android-instagram-prep` (new) | **14 PASS**, exit 0 |
| `npm run test:android-instagram` (publish-approved path) | 11 PASS, exit 0 |
| `npm run test:android-scheduler` | exit 0 |
| `session-integrity-p0` | exit 0 |
| `queue-runtime-safety` | exit 0 |
| `android-identity-verify-test` | 3/3 PASS (live read + offline + fail-closed 409) |
| `android-account-binding-test` | exit 0 |
| `android-onboarding-draft-test` | exit 0 |
| `prisma validate` | valid |

New coverage: real captured hierarchies replayed through the real adapter (screen classification,
the whole create-post walk with every tap asserted against observed coordinates, single-image
selection and its fail-closed cases, caption entry, the informational sheet, `pressShare` refusal),
plus worker preparation-only semantics (idempotent re-delivery, unverifiable prepared screen,
unexpected screen) and the scheduler hold/expiry.

## 17. DB account counts

```
Chromium existing accounts: 62  (unchanged)
Android test accounts:       1  (@naspeny.jaya, expected +1 only)
Android jobs:                1  (READY_FOR_REAL_POST / PREPARED)
pragma integrity_check: ok    foreign_key_check: clean
```

## 18. Remaining blocker, if any

None for the preparation-only goal. Explicitly out of scope / not implemented:

- `pressShare()` and `verifyPublished()` (publishing and post-publish verification) — require a
  separate approval; the boundary-crossing code path stays reachable only with
  `ANDROID_PUBLISH_APPROVED=true`.
- Security/checkpoint resource-ids were never observed (none appeared while signed in) — those
  surfaces stay `LOGIN_REQUIRED`/`UNKNOWN` + operator handoff, by design.
- The device currently holds the prepared post until `16:53 WIB`; it is intentionally left booted.

Do not merge. Do not deploy. Do not push to main. Do not press Share.

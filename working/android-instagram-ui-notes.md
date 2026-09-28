# Instagram Android UI notes (Phase 3B)

**Phase 3B historical baseline below; Phase 3C observed update is appended at the end.**
Nothing in this file may be guessed: every selector/entry below gets filled only from a real,
observed screen of the officially installed app on the test AVD.

## Observed environment (verified 2026-09-28, live AVD)

- **Test AVD:** `Medium_Phone_API_36.1` (data folder `~/.android/avd/Medium_Phone.avd`, ini `Medium_Phone_API_36.1.ini`)
  - `image.sysdir.1 = system-images\android-36.1\google_apis_playstore\x86_64\` → **Play Store image** (official install route available)
  - `tag.id = google_apis_playstore`, `PlayStore.enabled = true`, `abi.type = x86_64` (Instagram ships x86_64 on Play Store)
  - `hw.ramSize = 2048`, `disk.dataPartition.size = 6G`, LCD `1080x2400`; RockBase boots it with `-memory 2048 -cores 2 -no-window`
- **Launcher renders correctly** — `NexusLauncherActivity` focused; screenshot shows a normal home screen
  - Evidence: `C:\Users\rangg\AppData\Local\hermes\cache\scratch\phase3b-launcher.png` (dark ratio 3.2 %, not a black frame)
- **Setup wizard already completed** (`user_setup_complete=1`); **no Google account is signed in** (`dumpsys account` → `Accounts: 0`)
- **Play Store present and launching** (`com.android.vending`). Without sign-in it shows:
  *"Sign in to find the latest Android apps, games, movies, music, & more"* + a **Sign in** button
  (`UnauthenticatedMainActivity`) → **a Google sign-in is required before any install**.
  - Evidence: `C:\Users\rangg\AppData\Local\hermes\cache\scratch\phase3b-playstore.png`
- **Storage:** `/data` 5.8 GB total, **4.4 GB available** (22 % used) — sufficient for Instagram
- **`com.instagram.android` is NOT installed** (249 packages checked)
- **ADB tooling verified:** `uiautomator dump` returns a real hierarchy (~14 KB XML); on API 36+
  `mCurrentFocus` is reported by `dumpsys window` (NOT `dumpsys window windows`)
- **UI mechanics proven end-to-end on the real AVD:** hierarchy dump → find node `Play Store` →
  tap its centre `(158, 1679)` → foreground becomes `com.android.vending`
  — `backend/src/scripts/android-ui-mechanics-test.ts` → `{"status":"PASS","nodes":34,"foregroundAfterTap":"com.android.vending"}`

## Official install route (verified)

1. Operator signs in with a Google account on the AVD (Play Store) — **manual, RockBase never
   handles Google credentials**.
2. Install **Instagram** (`com.instagram.android`) from Play Store.
3. Operator opens Instagram from Android Farm, logs in manually, completes any
   email/phone/2FA/checkpoint manually. RockBase never automates or bypasses verification.

## Instagram UI contract — Phase 3B baseline (filled from real observation in Phase 3C below)

| Item | Observed value |
| --- | --- |
| Package name | `com.instagram.android` (expected, verify) |
| Version / build | — pending — |
| Main activity | — pending — |
| Profile surface + how the active username is read | — pending — |
| Create-post entry point | — pending — |
| Gallery/media picker behavior (mounts `/sdcard/Pictures/RockBase/…`?) | — pending — |
| Caption surface | — pending — |
| Final Share boundary (button identity, disabled states) | — pending — |
| Observable completion signals (post appears, progress, toast) | — pending — |
| Observable security/checkpoint states (login wall, 2FA, challenge) | — pending — |
| Accessibility/resource-id anchors per step | — pending — |

The adapter (`backend/src/services/instagram/AdbInstagramUiAdapter.ts`) intentionally throws
`InstagramUiNotInspectedError` for every Instagram-specific step until this table is filled and
those steps are implemented from it.

## Phase 3C: real authenticated inspection

- Instagram installed via Google Play (`installerPackageName=com.android.vending`).
- Version `447.0.0.55.81`, versionCode `385411990`; firstInstallTime reported by Android: `2026-09-28 15:03:35`.
- Google login and Instagram login completed manually by the operator. No passwords or OTPs collected.
- Operator explicitly authorized `naspeny.jaya` as the test-account exception after discovering matching existing Chromium records. Do not modify or convert those existing records.
- **PERSISTENCE_PASS:** normal profile before shutdown; `adb emu kill` removed the ADB device and QEMU process; booted the same AVD with `-no-snapshot-load -no-snapshot-save` (userdata retained); authenticated home feed reappeared without login. Opening Profile then showed `naspeny.jaya` in `com.instagram.android:id/action_bar_title`.
- This is authenticated-session proof, not yet a successful RockBase identity endpoint or job execution.

### Observed anchors (Instagram 447.0.0.55.81, English)

| Surface | Observed anchor / behavior |
| --- | --- |
| Home | `com.instagram.android:id/title_logo`, content-desc `Instagram Home Feed`; `feed_tab` content-desc `Home` |
| Profile access | `com.instagram.android:id/profile_tab`, content-desc `Profile` |
| Active identity | On own profile, `com.instagram.android:id/action_bar_title`, text and content-desc `naspeny.jaya`; username confirmed after reopen/restart |
| Create entry | `com.instagram.android:id/profile_header_create_button`, content-desc `Create New` |
| Post choice | Creation sheet row content-desc `Create new post`; child `com.instagram.android:id/label`, text `Post` (do not choose Reel/Story) |
| Gallery | `new_post_title` text `New post`; `gallery_folder_menu_tv` text `Recents`; `gallery_grid_item_thumbnail` descriptions include selected/unselected status and creation time, NOT filename |
| Gallery Next | `com.instagram.android:id/next_button_textview`, text/content-desc `Next` |
| Single-selection controls | `multi_select_slide_button_alt`, content-desc `Select multiple button`; do not enable multiple selection |
| Editor Next | `com.instagram.android:id/media_thumbnail_tray_button`, content-desc `Next`; child `media_thumbnail_tray_button_text` |
| Editor selected media | `com.instagram.android:id/thumbnail_image`, content-desc `Selected photo` |
| Caption | `com.instagram.android:id/caption_input_text_view`, content-desc `Write a caption`, placeholder `Add a caption…`, class `android.widget.AutoCompleteTextView` |
| Final Share | `com.instagram.android:id/share_footer_button`, content-desc `Share`, class `android.widget.Button`; observed bounds `[42,2221][1038,2337]` are evidence only, not an automation selector |
| Caption-screen title | `com.instagram.android:id/action_bar_textview_title`, text `New post` |
| Informational popup | `Sharing posts`: public visibility and content reuse/remix/download explanation. Buttons text `OK` and `Manage settings`, resource-id `ig_text`; no settings changed, operator handoff |
| Caption screen media strip | `com.instagram.android:id/media_preview_recycler_view`, content-desc `Photo thumbnail` (present only on the caption screen, absent on the picker/editor) |
| Caption editor (in place) | Tapping `caption_input_text_view` opens Instagram's in-place caption editor inside the same `MediaCaptureActivity`; `adb shell input text` with `%s` for spaces lands in the field; `KEYCODE_BACK` commits the text and returns to the caption screen |
| Caption-screen top-right control | `next_button_textview` is labelled text `OK` on this screen (it is NOT the picker's `Next`); never tap it when looking for Next |

### Inspection limitations / safety

- The disposable inspection image is `p3c-inspection.png` under `/sdcard/Pictures/RockBase`, showing `ROCKBASE ANDROID ENGINE TEST / PHASE 3C - NO PUBLISH`. It is an inspection asset, not a queued RockBase job.
- Its preview was navigated through gallery and editor only to inspect the caption surface. No Share executed.
- Gallery tiles expose creation time, NOT a path: the staged image is identified by the device's own
  `ls -l` timestamp of the staged file and matched against the tile's `created on …` text within a
  two-minute window; the selection is only accepted when exactly one tile reports itself selected.
  The flow fails closed when the staged file cannot be identified — it never assumes the newest photo.
- Post-publish completion signals are UNOBSERVED because publishing is prohibited in Phase 3C.
- Security/checkpoint UI was not encountered during this authenticated inspection; do not invent resource IDs for unobserved security screens.
- Evidence XML in Hermes scratch: `p3c-after.xml`, `p3c-profile.xml`, `p3c-create.xml`, `p3c-gallery.xml`, `p3c-edit.xml`, `p3c-caption.xml`. Pre-restart screenshot: `p3c-before-restart.png`.
- Sign-in wall detection is text-based on purpose: its resource-ids were never dumped (inspection
  happened while signed in), so `detectSecurityState` needs two independent observed login strings
  before it reports `LOGIN_REQUIRED`, and reports `UNKNOWN` (never `OK`) for anything else.

## Phase 3C completion (real adapter implemented + live preparation run)

- Real adapter: `AdbInstagramUiAdapter` now implements every step from the anchors above, with
  device primitives injected through `InstagramUiTransport` (production = ADB, tests = replays of
  the dumped hierarchies committed under `backend/src/scripts/fixtures/instagram-447/`).
- Each navigation step asserts the screen it starts from and the screen it must reach; a missing or
  ambiguous control raises `InstagramScreenExpectationError` and stops the run for a human look
  instead of tapping something that merely looks close.
- `pressShare()` is not enabled: it always raises `InstagramPublishNotApprovedError`, and the worker
  only crosses the Share boundary when `ANDROID_PUBLISH_APPROVED=true`. Preparation-only is default.
- Live run (2026-09-28 16:23 WIB): `@naspeny.jaya` verified from the device (`expected=naspeny.jaya
  detected=naspeny.jaya MATCH` → account `HEALTHY`), one draft approved, and the real path
  QUEUED → RUNNING → `READY_FOR_REAL_POST|PREPARED` finished the post on the final Share screen with
  the approved caption. `publishBoundaryAt` stayed null, `shareInvocationCount` = 0, Share not pressed.
- The one-time `Sharing posts` sheet did not reappear during the automated run; the adapter still
  handles it (acknowledge label only, never `Manage settings`) if Instagram shows it again.

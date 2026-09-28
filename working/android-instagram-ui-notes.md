# Instagram Android UI notes (Phase 3B)

**Status: PENDING INSTAGRAM INSTALL + MANUAL LOGIN.** No Instagram screen has been inspected yet.
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

## Instagram UI contract — PENDING (fill ONLY from real observation after login)

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

# Android engine Phase 3 — operator boundary and blocked Instagram slice

Branch `feat/android-engine-foundation`. Phase 2 is committed separately. Do not merge/deploy or use a production Instagram account to complete this slice.

## Verified host reality

- `Medium_Phone_API_36.1` boots and ADB responds; on this host the launcher UI can take about 20 seconds *after* `sys.boot_completed=1` to render. An immediate screenshot may be black; refresh after settling.
- The AVD has `com.example.stonehubapps` but **not** `com.instagram.android`. `adb shell pm path com.instagram.android` confirms absence. No designated Instagram test account or manually approved login is provided. Therefore Instagram identity selectors, publish completion signal, persistent login, and real post cannot be tested honestly yet.
- `adb shell uiautomator dump /sdcard/window.xml` works after launcher settles. Prefer its resource IDs/accessibility text for the future worker; no Appium or UiAutomator2 driver is installed. Appium 3 + UiAutomator2 would introduce a second server/driver lifecycle; built-in UIAutomator hierarchy is the smaller first approach for one device, but **must** be evaluated against the real Instagram app before writing selectors. Avoid coordinate-only publishing.

## Implemented safe boundary

- Generic ADB control is in `AndroidRuntimeService` and is exposed only to Windows Local Mode Admin through a short-lived device lease. Control rejects BUSY/leased devices and out-of-screen coordinates; screenshot rendering is read-only. Passwords and verification codes are not stored by Android onboarding.
- New Android account/home binding starts `NEEDS_ATTENTION`, with `androidLastVerifiedAt`/`androidVerifiedUsername` nullable. An operator cannot mark it healthy through the account PATCH until identity evidence exists. Changing home device or username invalidates verification; existing Chromium cookies remain intact.
- Image draft upload stores one validated PNG/JPEG in RockBase `uploads/`. Unique idempotency key + image hash + caption + account ensure retries return the **same** `DRAFT`; a different payload with the same key is rejected. `approve` returns 409 by design: no unverified Instagram app/action is dispatched. The Android queue only picks `ANDROID_SMOKE`; unsupported image jobs never reach smoke or Playwright.
- `AndroidMediaService` can stage a local upload to `/sdcard/Pictures/RockBase/<job-uuid>`, verify a device-side SHA-256, request media scan, then delete only that job-owned staged file. The source file is not removed by device cleanup. This was proven with a harmless image and the real AVD.

## Gate before resuming the Instagram worker

1. ROCK identifies one **designated test Instagram account** and authorizes a single-image test post explicitly. Do not select among the existing 62 accounts.
2. Operator installs the official Instagram app on `Medium_Phone_API_36.1` through the official store and logs in manually through Android Farm, including any email/phone/2FA/checkpoint.
3. Inspect the installed app's actual profile, picker, composer, confirmation and security UI using UIAutomator hierarchy and operator screenshots; implement a fail-closed identity verifier against the expected `SocialAccount.username` and the active device. Never mark `HEALTHY` based on operator-provided username alone.
4. Only after identity is reliably verified: implement `InstagramAndroidWorker` over generic runtime, durable pre-Share `PUBLISHING` boundary, no automatic retry after boundary, conservative `AMBIGUOUS` on lost confirmation, and a proven profile-post verification signal. Connect explicit approval to BullMQ only then. Add test evidence for mismatch, challenges, media cleanup, lease release and Chromium regression.

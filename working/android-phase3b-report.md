# ROCKBASE ANDROID ENGINE — PHASE 3B REPORT

- **AGENT:** ROCK
- **PROJECT:** RockBase
- **BRANCH:** `feat/android-engine-foundation` — 4 commit ahead of `origin/main` (tidak merge / deploy / push)
- **STATUS:** **partial** — foundation publish-worker selesai & teruji; Instagram belum terpasang & belum ada login operator → `WAITING_FOR_OPERATOR_LOGIN`
- **Waktu laporan:** 2026-09-28 (Asia/Jakarta)

## Commit

| Fase | SHA | Subject |
| --- | --- | --- |
| Phase 1 | `417e0ad` | feat(android): establish persistent device foundation alongside Chromium |
| Phase 2 | `453395c` | feat(android): add durable device scheduling and account binding |
| Phase 3 (foundation) | `99e44843c1221a0010ea43241fa67f9492f2902c` | feat(android): add operator control and image-post draft pipeline |
| **Phase 3B** | **`17c0a1c8c27ee7443d6f7ccd2bb90cfce34f996d`** | feat(android): add Instagram identity verification and single-image publish worker |

Working tree bersih. Tidak ada push. `dev.db` tidak diubah isinya.

---

## Report (urutan sesuai brief)

**1. Failed Phase 3 UI patch — resolved.**
Dua patch atomik terakhir ke `frontend/src/components/farm/AndroidControlPanel.tsx` memang **gagal dan tidak menulis apa pun** (hunk ambigu: `if (sending) return` ×2, `releaseImage()` ×3). Yang hilang = stale-frame lock. Diperbaiki dengan anchor unik:
- `mountedRef` guard → tidak ada setState/leak object-URL setelah panel ditutup;
- kontrol tetap terkunci (`await 400ms` → refresh screenshot) sampai frame baru tiba, jadi tap berikutnya tidak pernah memakai screenshot lama.
Verifikasi: `npm run build` ✓ dan **34/34 UI smoke PASS** (tap CSS (77,343) → native `269,1199`; swipe `540,720⇒540,1920` 100 ms; 409 lease sticky; payload Android tanpa password/email/proxy).

**2. Phase 3 foundation commit:** `99e44843c1221a0010ea43241fa67f9492f2902c` (22 file, add operator control + draft pipeline).

**3. Instagram installation method/version:** **belum terpasang** (`com.instagram.android` tidak ada di 249 package). Jalur resmi **tersedia & terverifikasi**: AVD ini image Play Store (`google_apis_playstore`), Play Store terbuka, tapi menampilkan *"Sign in to find the latest Android apps, games, movies, music, & more"* (`UnauthenticatedMainActivity`, `dumpsys account → Accounts: 0`) → **install butuh Google sign-in manual operator**. Tidak ada sideload APK dari sumber tidak resmi. Version: n/a.

**4. Test AVD:** `Medium_Phone_API_36.1` (data folder `Medium_Phone.avd`).
`image.sysdir.1 = system-images\android-36.1\google_apis_playstore\x86_64\`, `tag.id=google_apis_playstore`, `PlayStore.enabled=true`, `abi.type=x86_64`, `hw.ramSize=2048`, LCD `1080x2400`, `disk.dataPartition.size=6G`. Layar render normal (launcher fokus, dark ratio 3.2 %) — "layar hitam" fase lalu ternyata capture sebelum wake/boot selesai.

**5. Manual login result:** **belum dijalankan** — belum ada satu akun Instagram test yang ditunjuk ROCK. RockBase tidak menerima/menyimpan password Instagram.

**6. Login persistence after AVD restart:** **belum diuji** (prasyarat login belum ada). Prosedur siap: login → stop AVD normal → boot ulang → buka Instagram → konfirmasi state persisten. Jika login hilang setelah restart, publish tidak akan dilanjutkan.

**7. Identity verifier — implementasi & hasil.**
- Worker: `verifyIdentity()` membaca akun aktif dari UI, dibandingkan dengan akun yang ter-bind; **hanya MATCH yang boleh lanjut**; mismatch → `ACCOUNT_MISMATCH` → `NEEDS_ATTENTION`, tanpa post.
- Endpoint operator: `POST /api/accounts/:id/android/verify-identity` (Admin, lewat device lease, set `androidVerifiedUsername` + `androidLastVerifiedAt` → `HEALTHY`; menolak jika device belum start atau masih di-lease job).
- Wiring test **PASS**: 400 (akun non-Android), 409 (device offline → "Start the home device…"), 409 (device online tanpa app Instagram → "not installed").
- Pembacaan username sebenarnya menunggu inspeksi app resmi (lihat item 8).

**8. Observed Instagram selectors/UI contract:** **nol selector dikarang.** `working/android-instagram-ui-notes.md` hanya berisi fakta observasi (AVD, Play Store, storage, mekanika UI yang terbukti) + tabel kontrak Instagram yang masih `— pending —`. `AdbInstagramUiAdapter` sengaja melempar `InstagramUiNotInspectedError` pada setiap langkah Instagram sampai tabel diisi dari layar nyata.

**9. InstagramAndroidWorker implementation.**
`backend/src/services/instagram/`:
- `InstagramUiAdapter.ts` — interface batas + error (`InstagramUiNotInspectedError`, `InstagramSecurityError`, `InstagramIdentityMismatchError`);
- `AdbInstagramUiAdapter.ts` — mekanika ADB/uiautomator generik (launch + verifikasi foreground, hierarchy dump + parser, evidence screenshot) + langkah Instagram yang fail-closed;
- `InstagramAndroidWorker.ts` — pipeline `verifyIdentity → stageSingleImage → openCreatePost → selectImage → enterCaption → reachPublishBoundary → publishOnce → verifyResult`.
Logika Instagram **tidak** ditaruh di `AndroidRuntimeService`. Scheduler hanya menjamin lease eksklusif + device `BUSY`, lalu menyerahkan job ke worker.

**10. Media/caption flow.** Staging ke `/sdcard/Pictures/RockBase/<jobId>` (push + verifikasi sha256 + media-scan, cleanup best-effort), worker **re-hash media yang di-approve** sebelum menyentuh device (file hilang/berubah → gagal sebelum Share). Caption tervalidasi 1–2200 char saat draft dibuat.

**11. Publish-boundary / idempotency behavior.** `READY_TO_PUBLISH` → claim atomik (`publishBoundaryAt IS NULL`) → `PUBLISHING` + `publishBoundaryAt` → **tepat satu** `pressShare`. Re-delivery setelah boundary → `AMBIGUOUS` **tanpa** menekan Share lagi. Dua eksekusi paralel → tepat 1 Share (test konkurensi: satu `COMPLETED`, satu `AMBIGUOUS`). Duplikat idempotency key tidak bisa menyeberang Share dua kali.

**12. Real post result:** **tidak ada post nyata.** Tidak ada akun, tidak ada Instagram, tidak ada Share nyata pada device.

**13. SUCCESS / AMBIGUOUS verification method.** `SUCCESS` hanya bila verifikasi pasca-Share eksplisit (`published === true`); `published === false` → `FAILED_AFTER_SHARE` (tanpa retry otomatis); `null` / error verifikasi → **`AMBIGUOUS`** (fail closed). Implementasi verifikasi di app asli masih pending inspeksi dan tidak diklaim.

**14. Needs-attention behavior.** Login wall / checkpoint / state tidak dikenal → stop, simpan **satu artefak evidence** (screenshot), set job `NEEDS_ATTENTION`, akun → `NEEDS_ATTENTION` + reason, **tanpa retry**, tanpa bypass. Mismatch identitas → `ACCOUNT_MISMATCH`. Gap RockBase sendiri (`IG_UI_INSPECTION_REQUIRED`) → job `NEEDS_ATTENTION` tanpa menghukum akun.

**15. Chromium regression.** **PASS** — konteks browser sintetis terbuka, assignment Android tidak bisa memakai/mereuse context Playwright. `dev.db`: integrity `ok`, **62/62 akun tetap chromium**, 0 akun android, 0 job, device `RockDroid-01` terdaftar (OFFLINE).

**16. Tests / build.** Semua hijau:
`prisma validate` · `tsc` backend · `session-integrity-p0-test` · `test:queue-runtime-safety` · `test:android-scheduler` (Phase 2: lease/konkurensi/binding/grace) · **`test:android-instagram` (baru, 12 assertion)** · binding API · onboarding/draft · identity wiring · **UI mechanics AVD nyata** (34 node → tap `(158,1679)` → foreground `com.android.vending`) · operator control AVD nyata (`bootMs 2612`, `leaseBlocked`, `outOfBoundsBlocked`) · frontend `npm run build` + 34/34 UI smoke.

**17. Resource observations.** Warm boot **2 612 ms**; working set emulator/QEMU **±3 110,6 MiB**; screenshot 1 389 910 byte (~1,39 MB); storage `/data` 5,8 GB total / **4,4 GB free** (22 % used); 249 package terpasang. Angka spesifik host ini, bukan patokan kapasitas global.

**18. Known limitations.**
- Instagram belum terpasang & belum login → identity read + selector nyata belum bisa diisi.
- Jalur approve bahagia belum diuji end-to-end (belum ada akun HEALTHY).
- Job image yang mati saat `RUNNING` (crash keras) belum auto-requeue — sweep hanya mengambil `QUEUED` orphan.
- Teramati satu `resolveSerial` transien miss; dimitigasi dengan memperlakukan "already running" sebagai jalur WAIT (retry), bukan FAILED.
- UI smoke frontend memakai API mock; kontrol device-nya diuji terpisah pada AVD nyata.

**19. Recommended next phase (`READY_FOR_OPERATOR_LOGIN` → `READY_FOR_REAL_POST`).**
1. Operator sign-in Google di Play Store pada AVD (manual, RockBase tidak menyentuh kredensial Google).
2. Install **Instagram** dari Play Store (resmi).
3. Android Farm → **Control Device** → **Open Instagram** → login manual + selesaikan verifikasi/2FA/checkpoint manual.
4. `POST /api/accounts/:id/android/verify-identity` sampai akun `HEALTHY` (identity terdeteksi cocok).
5. Buat 1 draft image + caption tidak berbahaya + idempotency key unik → **stop di `READY_FOR_REAL_POST`** (butuh approval eksplisit ROCK).
6. Setelah approval: isi kontrak UI Instagram dari inspeksi nyata, jalankan persistence proof (login tahan restart AVD), lalu **tepat satu** percobaan publish dan laporkan `SUCCESS` atau `AMBIGUOUS` apa adanya.

---

## Extras

- **Instagram package/version:** n/a (belum terpasang); target `com.instagram.android` via Play Store resmi.
- **Real post dibuat:** TIDAK.
- **Jumlah aksi Share nyata:** 0 pada device (semua Share berada di adapter palsu test).
- **Evidence paths:**
  - Launcher AVD (render normal): `C:\Users\rangg\AppData\Local\hermes\cache\scratch\phase3b-launcher.png`
  - Play Store sign-in wall: `C:\Users\rangg\AppData\Local\hermes\cache\scratch\phase3b-playstore.png`
  - Kontrak UI Instagram: `working/android-instagram-ui-notes.md`
  - Batas operator Phase 3 (sebelumnya): `working/android-phase3-operator-boundary.md`
- **Tidak** merge, **tidak** deploy, **tidak** push, **tidak** menyentuh 62 akun produksi.

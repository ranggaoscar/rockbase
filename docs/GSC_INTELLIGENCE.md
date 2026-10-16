# Google Search Console Intelligence — Phase 2

## Current status

Implemented on branch `feat/gsc-intelligence-phase2`, based on merged main `46776f7da2a0c99c5bbb653c7989cbe19a8b7bf5`. Owner Local Mode acceptance passed before PR publication. No merge or deployment. RockDroid branches/worktree and untracked `working/android-phase3e/` are preserved.

Google connection and report states in the product are real, not seeded. **Live Local Mode pilot is complete for Magrade via the existing Hermes service account.** OAuth Desktop remains available and is not required for this pilot. No new Google Cloud project or OAuth client was created. Other installations still supply their own credentials; the owner's key is not an open-source default.

## Connect Google (owner setup)

1. In [Google Cloud Console](https://console.cloud.google.com/), choose/create the project's own OAuth application. Enable **Google Search Console API**.
2. Configure Google Auth Platform Branding/Audience/Data Access. Request only `https://www.googleapis.com/auth/webmasters.readonly`. During External/Testing, add the intended owner account as a test user.
3. Under Clients, create **Desktop app** (not Web application, Android, or service account). Download its JSON or copy the client ID and client secret. A Desktop client cannot keep an application secret confidential; that client secret is not a substitute for PKCE.
4. In RockBase **SEO Intelligence → Google Search Console**, paste the Desktop JSON in the local setup control or enter Client ID/secret and click **Simpan konfigurasi**. Do not send Google passwords, refresh/access tokens, or the JSON through chat or Git.
5. Click **Hubungkan akun Google**. Consent runs in a separate browser window, not an embedded WebView. Choose the account that actually has Magrade/Brescia property access and grant readonly permission. The app uses a random-port loopback callback; no externally hosted redirect URL or manual authorization-code copying is needed.
6. Add/select an existing RockBase website/workspace, select a returned permitted property, then **Peta ke website**. Brand comes from that website record, never an arbitrary client-supplied brand. A domain property must cover its hostname; a URL-prefix property must cover its origin/path.
7. Choose 7 or 28 days and click **Sinkronkan sekarang**. The existing completed crawler's exact URLs are joined read-only to Page Performance. Missing crawl coverage is not evidence of deletion/indexing.
8. **Putuskan koneksi** for OAuth removes local tokens and Google-derived mapping/cache and attempts Google revocation. If Google revocation cannot be confirmed, the UI reports that distinction. For a service account, disconnect only deletes the RockBase OS-vault copy. It does not revoke the Google key, delete the source JSON, or change Hermes access. It does not erase crawler/social history.

## Existing service account (preferred when already authorized)

Do not create a new Google project or OAuth client before checking an existing authorized service account.

1. Keep the source JSON outside the RockBase repository. The UI accepts an absolute local Windows path only. Network paths and files inside the install root are rejected.
2. Import copies only `client_email` and `private_key` into Windows Credential Manager under `RockBase/GSC/v1/<install-hash>/service_account`. The source path, full JSON, project id, and access token are not stored. Access tokens stay in process memory.
3. Before the vault write, RockBase exchanges a one-hour RS256 JWT for scope `https://www.googleapis.com/auth/webmasters.readonly` at the fixed token endpoint and lists sites. User impersonation (`subject` / `sub`) is rejected.
4. Disconnect requires no current provider. Switching back to OAuth Desktop is possible only after that local disconnect.
5. Open-source copies do not receive this key. A new path/install hash does not inherit another install's vault entry.

Live verification covers the existing service account, OS-vault reuse, source preservation and local-only disconnect. Detailed property inventory, metrics, query rows, database identifiers and screenshots stay in private local evidence, not the repository or PR.

Owner acceptance uses the real owner social/workspace database and persistent SEO website registry, not the earlier scratch social fixture. Confirmed brand identities are registered idempotently in `website_brands`, scoped by workspace and case-insensitive key/name. No social account is inserted or modified to make a brand appear. Existing social brand tags remain available and are deduplicated against website brands.

The two Brescia domains remain separate website/property mappings under one brand. Reports, totals and previous periods are not merged. Browser acceptance reads all three owner-backed reports and verifies brand labels, established/low-volume candidates, and reload persistence with no interception.

Current and previous windows have equal inclusive length and do not overlap. The 7-day and 28-day reports are separate; reading one does not return the other. Source preservation and unchanged social/crawl/Android records are verified independently.

Google External/Testing refresh grants for this non-profile scope can expire after seven days. Production distribution can require Google's verification/consent requirements. Every installation must configure/authorize its own account. Never publish an owner's OAuth tokens as an open-source default.

## Architecture and trust boundaries

- Existing React `/seo` page, Express `/api/gsc` adapter. No standalone app/dashboard, no AI dependency, no crawler-engine modification.
- Local Mode remains passwordless. GSC requires the explicit local operator, loopback request, trusted Host/Origin, and `no-store` headers. All data/connection endpoints are **disabled in Server Mode**, including for Admin; disabled status does not read the local vault. There is no shared server token fallback.
- Desktop authorization code + PKCE S256, unpredictable state checked with timing-safe comparison, one-time bounded callback, five-minute expiry, loopback listener on `127.0.0.1` with OS-assigned port. Callback has no external resources, no-referrer, no-store, CSP, and no code/token logging.
- Fixed Google HTTPS OAuth/Search Console endpoints only. Tokens go in Authorization headers (or POST form bodies for token/revoke), never resource query strings or frontend responses.
- `WindowsCredentialVault.ts` calls the small standard-library Python `credential_vault.py` bridge through piped stdin/stdout, not secret-bearing arguments or temporary files. It uses native Windows Credential Manager (`CredWriteW/CredReadW/CredDeleteW`), scoped by current OS user and install-root hash. **No plaintext fallback** on failure or other OS. Python runtime is reused from Phase 1 `modules/seo/.venv`.
- Token writes/deletion are serialized and epoch-checked; a late refresh/callback cannot resurrect a disconnected credential. Desktop config is also in the OS vault. Browser localStorage/social encryption key are not used for Google credentials.
- Derived Google analytics (not OAuth secrets) are cached in `%LOCALAPPDATA%/RockBase/installations/<install-root-hash>/gsc.sqlite`, under the Windows user's profile. Separate from social Prisma and Phase 1 crawl SQLite. No social migration. Copying an install to a new path requires reconnect; it does not inherit another path's grant/cache.
- Explicit reconnect clears old Google-derived data. Disconnect/remap invalidate in-flight report saves. SQL is parameterized, and report persistence is atomic only after the complete bounded sync succeeds; previous data survives upstream errors.
- OS vault protects at-rest OAuth credentials, not against malware already running as the same Windows user. Derived data rely on OS profile permissions and are not represented as encrypted. Disconnect deletes active Google rows and checkpoints the WAL but is not a guarantee against prior OS backups/SSD forensic recovery.

## Metrics, freshness and limits

- Search type `web`, finalized data (`dataState=final`). Default end is today minus three days in `America/Los_Angeles`, not Windows/Jakarta date. Current and previous periods have equal inclusive length and do not overlap.
- Property totals are requested independently with no page/query dimensions and `aggregationType=byProperty`. Page rows use `auto` aggregation. CTR is clicks/impressions; API average position is preserved. Page/query rows are **not** summed to reconstruct property totals.
- Date series shows only returned dates; no-data and missing previous rows remain null/absent, not fabricated zero. The UI shows requested periods and last returned date without claiming Google has no newer data.
- Each detail dimension is paginated with `rowLimit=25000`, `startRow=0/25000`, capped at two pages (50,000 top rows per selected window). This is bounded interactive retrieval, **not exhaustive daily extraction**. Google itself exposes at most 50,000 rows per day/search type and may drop/anonymize rows. Exhausted pagination does not prove complete coverage; truncation and incomplete coverage are explicit.
- One active sync, sequential requests, 350ms paced admission, up to 14 analytical calls per sync, six-hour successful cache, bounded transient 5xx retries. Quota 429/quota-related 403 yields a 15-minute cooldown and stops dimension fan-out. Permission errors and revoked grants are separate safe UI messages; no raw upstream bodies are exposed.
- Page Performance includes period comparison and exact observed crawler status/title/indexability/issue count where available. Canonical Google URLs may not match requested crawl URLs.
- Keyword Opportunities: established rows have >=50 impressions and position 4–20. Low-volume niche rows have 8–49 impressions and the same position band, with confidence `low_volume`. Below 8 impressions stays observed-only. These are deterministic review candidates, **not AI scores, forecasts, or universal CTR benchmarks**.

## Verification

Executed focused tests, not a repeat of Phase 1's complete audit:

- Merged-main Local Mode smoke: readiness, SEO worker health and Accounts/Farm/Queue/Overview navigation; no real social actions, scratch social fixture only.
- `npx ts-node --files src/scripts/gsc-oauth-test.ts`: PASS — real loopback callback with injected Google responses; PKCE/state, readonly scope, refresh, revocation/deletion, quota, Server Mode isolation, late-refresh disconnect race. Actual Windows vault synthetic write/read/delete passes; no real Google token used.
- `npx ts-node --files src/scripts/gsc-service-account-test.ts`: PASS — synthetic RSA only. Readonly RS256 assertion, fixed token endpoint, minimum vault payload, source file unchanged, disconnect does not call revoke, Server Mode does not read the vault, Desktop OAuth still available after local disconnect.
- `npx ts-node --files src/scripts/gsc-analytics-test.ts`: PASS — period/metric math, cache, pagination cap, mapping isolation/remap, no-data, failure atomicity, disconnect/remap races and immediate quota stop.
- `npx ts-node --files src/scripts/gsc-routes-test.ts`: PASS — local owner/origin/Host/no-store, Server Mode block, permitted-property/domain/workspace mapping, actual-brand source, exact crawler joins, disconnected-cache access block.
- Backend TypeScript typecheck: PASS.
- Frontend `tsc -b` plus normal and `VITE_ROCKBASE_MODE=local` Vite production builds: PASS, existing bundle-size warning.
- Real disconnected browser state: no login needed, secure setup visible, Connect disabled until configured, no fabricated metrics. Synthetic UI-only interception separately verifies report tabs/filters and late-old-website response discard; it is **not live GSC acceptance**. Zero browser page errors.
- Scoped Gitleaks 8.30.1 scan of all 14 new/modified Phase 2 source/document files: **0 findings**. Source scanner evidence stays in Hermes scratch, not Git. No new npm/Python dependency or lockfile changes were needed.
- Final GSC setup screenshot inspected: controls and security explanations readable/reachable, no blocking GSC clipping. Report tables use 100-row UI pages rather than rendering up to 50,000 rows at once.
- Owner finalization: `tests/test_brand_registry.py` PASS (persistent registry, duplicate prevention, workspace isolation, existing website linkage). Backend typecheck PASS. Earlier OAuth/security/regressions were not repeated.
- Owner API/browser acceptance PASS, including read-back after backend restart. All original social table contents, crawl history and protected Android work compare unchanged. The shared Hermes credential file compares unchanged. Exact key-material comparison and redacted secret scans found no credential disclosure in the publication files or inspected logs.

## Live acceptance

Owner Local Mode acceptance passed for the three separate website/property mappings. Both brands persist independently of social accounts; all three 28-day reports can be read. Keyword confidence labels are checked against actual returned metrics. OAuth Desktop live consent was not required and is not claimed. Magrade crawler `robots.txt` HTTP 403 remains independent: GSC performance does not complete the crawl audit and was not bypassed.

## Run / scope

Standard installation: existing RockBase Local Mode launcher after `modules/seo/SETUP_SEO.bat`. No package dependencies or social database migrations. The SEO database gains the additive `website_brands` table. Use only one listener on 3010/5173/8765. `ROCKBASE_SEO_DB` optionally points the feature checkout at the owner's existing SEO database; back up first and do not run competing workers against it. Never copy secrets or a scratch social database over the owner database.

Owner acceptance mounted the existing production route handlers in passwordless loopback Local Mode against the real owner databases, with social automation/schedulers not started. No accounts, sessions or queues were changed. The Windows vault remains installation-path scoped to this feature checkout; another checkout needs its own explicit local connection. `POST /api/seo/brands?workspace_id=<existing-workspace>` registers confirmed website brand key/name in Local Mode, with existing-name/key deduplication. `PATCH /api/seo/websites/<id>/brand` accepts only a registered workspace brand.

Official contracts verified: [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [limits](https://developers.google.com/webmaster-tools/limits), [row completeness](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data), [sites list](https://developers.google.com/webmaster-tools/v1/sites/list).

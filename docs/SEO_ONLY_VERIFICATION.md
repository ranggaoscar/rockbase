# SEO-only branch verification

## Scope and ancestry

- Base: `origin/main` at `b11a63d05e4c1057eac734d07ba6730328698615`.
- Local branch: `feat/seo-intelligence-phase1-clean`.
- Separate worktree: `C:/AI PROJECTS/Dashboard_Sentral/RockBase-seo-only`.
- Cherry-picked source: `c3d8ac2639c72faea5205d83ee5a00c936362e72`.
- Resulting cherry-pick: `46edaf30538edb4da5f2566c33e6093071cfadc7`.
- The eight RockDroid commits between main and the source commit's parent are **not ancestors** of this clean branch.
- Exactly the source commit's 63 changed paths were carried by the cherry-pick. Comparison of every added/removed line against the source patch matched; only surrounding RockDroid context was excluded. Standard Git patch IDs differed because surrounding contexts differed.
- Two cherry-pick conflicts were resolved narrowly: keep `stopSeoWorker()` in backend shutdown and `/seo` in frontend routing; omit the surrounding Android worker shutdown and `android-farm` route.
- No changed Prisma schema/migrations, queue code, Android runtime files, or `working/` evidence. No added Android/RockDroid runtime references. Main's existing social/browser behavior remains the baseline.

## Clean-checkout adaptation

`server-default-guard-test.ts` previously assumed the operator's database existed and contained legacy credentials. It now tests only scratch fixture databases, including default-credential refusal, a clean credential, unavailable DB refusal, and Local Mode bypass with no accessible DB. The child uses Node directly with an argv array (no Windows shell/path-space ambiguity). This changes the regression test, not application authentication behavior.

A separate local follow-up commit records this portable regression and this verification document; the cherry-picked commit is not amended or rebased. Final diff: **64 files**, of which 63 are the original SEO/security paths and one is this report.

## Verification executed on this clean worktree

- Independent backend/frontend `npm ci --ignore-scripts --no-audit --no-fund`: PASS using their committed lockfiles; no active-worktree node_modules reused or modified.
- Prisma client generation only, no migration/database setup. Native SQLite prebuild verified through scratch tests.
- Backend `npx tsc --noEmit --pretty false`: PASS.
- Frontend `npm run build`: PASS (existing large-bundle warning only).
- SEO `uv sync --frozen` and `uv run --frozen pytest -q`: **11 PASS**, one upstream TestClient deprecation warning.
- `secret-access-regression-test.ts`: **22 PASS** (actual Express routes with synthetic in-memory identity/account data).
- `sensitive-data-redaction-test.ts`: PASS, console/file/read-path canaries in scratch storage.
- `seed-security-regression-test.ts`: PASS, fail-closed seed and owner password helper exercised only with scratch fixtures.
- `security-dependency-smoke-test.ts`: PASS, **8** installed/lock version checks plus multipart upload and Socket.IO polling/WebSocket compatibility.
- `server-default-guard-test.ts`: PASS against scratch fixtures, no operator DB dependency.
- `git diff --check`: PASS.

## Scoped secret scan

Gitleaks **8.30.1**, official Windows release artifact checked against its GitHub SHA-256 digest, scans only `origin/main..HEAD` with full redaction and no secret values printed. The raw scan reports one `generic-api-key` finding in `seed-security-regression-test.ts`: its deliberately synthetic canary passphrase used exclusively in VM/scratch fixtures. No other findings. This is explicitly classified, not hidden by a repository-wide allow rule. Scanner evidence is kept outside the repository under Hermes scratch. No tracked database, real `.env`, cookies, uploads, backups or private keys are introduced.

This is a scoped clean-diff check, not a repetition of the prior full security audit or proof about every secret pattern.

## Preserved boundaries and residual limitations

- Original branch/worktree remains at `c3d8ac2639c72faea5205d83ee5a00c936362e72`; its untracked `working/android-phase3e/` is not copied, staged or changed.
- No existing application databases, credentials, cookies, runtime secrets or queue data are copied or modified for this verification.
- Prior Magrade CDN/WAF block remains a documented limitation; no new production scan or protection bypass is attempted.
- Existing default-credential and historical n8n-key classifications are retained; no credential action is performed.
- No push, PR creation/edit/closure, merge, force push, history rewrite or deployment. PR #2 remains untouched. The local clean branch is ready for a separately approved publish/review step, not automatically approved for merge.

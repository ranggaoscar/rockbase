# RockBase public-release security gate (SEO Phase 1)

> Remediation implemented and tested: see `SECURITY_REMEDIATION.md`. Per the owner's product decision the gate is mode-scoped: **Local Mode (passwordless, primary experience) gate is PASS for local commit; Server Mode structurally refuses to start while shipped default credentials remain valid (fail-closed startup preflight on server and worker).** Public push remains an owner decision; no push/deploy/rotation/reset/deletion performed. Older classification/audit sections below are retained as historical evidence, not current remediation status.

> Focused follow-up classification: see `SEO_FOCUSED_CLASSIFICATION.md`. It supersedes the initial broad/unclassified statements below: the historical JWT is an n8n-format non-expiring key, rejected by RockBase and absent from the checked stopped local n8n registry; the default seed password **does match two existing local Admin users**. No revocation/reset/rotation was performed. Dependency graph totals are not automatically runtime exploitability; use the follow-up advisory reachability table.

**Status: BLOCKED for public push.** This is a read-only release-gate audit, not a remediation pass. No secrets were printed. No environment files were read. No credentials were rotated. No source, dependency, database, or history changes were made by the audit. The only intended write is this report.

## Scope and evidence

- Repository: `C:/AI PROJECTS/Dashboard_Sentral/RockBase`
- Branch: `feat/seo-intelligence-phase1`
- HEAD observed: `d386b6fa4bc5042b08998e5e4d787513e51fab00` (2026-10-01)
- Reachable Git history inspected by path-only / pattern-only scripts: 77 commits. The worktree had pre-existing modified/untracked SEO and Android files. `working/android-phase3e/` was not inspected or modified.
- Secret scans emitted categories, paths and line/commit locations only. Explicit `.env` contents and matching values were never rendered. Working `.env` files and ignored runtime data were not opened.
- `npm audit --json` run in both frontend and backend, plus `--omit=dev`; all use their existing package lockfiles. No audit fix was run.

## Release blockers

### 1. JWT-shaped value in reachable history — unresolved, treat as possible credential exposure

A JWT-shaped literal matched in `frontend/src/pages/Campaigns.tsx` at line 1954 in reachable commit `a09aa75ef114c7c858990727a9cb394da8e2c85b`. Parent verification independently confirmed one JWT-shaped match there; the second scout candidate `f8ce7f0f34e55f0fcdb23cac18f4342485f640f3` was not reproduced by the parent's stricter three-segment pattern and is not counted as confirmed. Its shape is not safely classifiable as a harmless example from pattern-only inspection. It is historical, not established as present/live in current tracked files. Do not push publicly until an authorized secret-handling review classifies it. If it was an active token, follow the owner's separate credential incident/rotation process before any history cleanup; this audit did not do either.

### 2. npm audit: production dependency-graph advisories (initial counts, not proven reachability)

Full install-tree results:

| Lockfile | Total | Critical | High | Moderate | Low |
|---|---:|---:|---:|---:|---:|
| backend | 16 | 1 | 11 | 3 | 1 |
| frontend | 20 | 0 | 15 | 3 | 2 |

Production-only (`npm audit --omit=dev`) results:

| Lockfile | Total | Critical | High | Moderate | Low |
|---|---:|---:|---:|---:|---:|
| backend | 10 | 1 | 5 | 3 | 1 |
| frontend | 7 | 0 | 5 | 1 | 1 |

The backend production graph includes a **critical** `proxy-addr` advisory and high advisories including `multer`, `engine.io`, `socket.io-parser`, and `ws`; direct production dependencies `multer` and `csv-parse` are also affected. The frontend production graph includes advisories in `axios`, `form-data`, `react-router`, `socket.io-parser`, and `ws`. **Superseded interpretation:** package presence and severity are not proof of a triggering app path. Follow-up confirmed upload/backend WebSocket paths, narrowed proxy-addr/CSV/Node-only client cases, and added Vite because the Windows launcher actually runs the dev server. The specific prerequisite/patch table in `SEO_FOCUSED_CLASSIFICATION.md` controls prioritization. Full package-level results are reproducible with native npm audit; no forced updates were applied.

## Findings and controls observed

- **Legacy default-credential paths need release cleanup:** candidate hardcoded admin-password examples remain in `README_SETUP.md`, `start.js`, `start.bat` and the older handoff documentation. `backend/src/scripts/seed.ts` contains both an environment-password path and a hardcoded-default candidate; the fallback must be reviewed before public distribution. These are not proof of the existing operator's live password and no values are reproduced here. Local Mode generates random configuration when missing and preserves existing configuration, but legacy seed/docs must not encourage reusable public defaults. No account, password or encryption key was changed.

- **No current live secret confirmed by the automated patterns.** The scanner found no private-key block, AWS access-key shape, or JWT-shaped literal in current worktree source. Other credential-assignment pattern hits were reviewed as mock/test/config-template patterns; `.env.example` files are templates. Pattern scanning is not proof of absence, and a live `.env` was intentionally not inspected.
- **SEO integration boundaries:** `backend/src/server.ts` mounts SEO after global `/api` authentication. `seoRoutes.ts` further requires local host/origin in local mode, uses workspace membership/admin filtering, restricts operations and write roles, and passes workspace ID to the worker. `SeoWorkerService.ts` binds RPC to `127.0.0.1`, creates an ephemeral random IPC token, and supplies a dedicated `rockbase-data/seo/seo.sqlite` path rather than the social DB. Python API validates loopback + token and scopes reads by workspace. These are positive design controls; this was code inspection, not a penetration test.
- **Per-install isolation is incomplete/unverified for the whole application.** SEO has an isolated local SQLite store, but the broader app uses its existing shared social Prisma database, account cookies/passwords, encryption key and logs. Release review must confirm all such state/config stays out of the published artifact and that deployment defaults are local-only; this audit did not inspect local database or log data.
- **Existing account credential APIs are sensitive:** `accountRoutes.ts` is behind `authenticateToken`; its credential and cookie-export endpoints decrypt and return stored passwords/cookies to authenticated callers. Cookie imports/exports are also authenticated and persisted encrypted. They do not appear in unauthenticated paths, but this is a high-impact single-install trust boundary. Confirm operator-only/owner authorization is appropriate for intended public self-hosting before release.
- **Potential account scope concern:** account routes fetch by account ID without visibly applying workspace/owner scoping in the inspected credential/cookie handlers. This may match the current single-owner product model; multi-user deployment authorization is not established by this audit.
- **Logging:** logger writes caller-supplied structured data to local files/console and exposes a recent-log API (documented in its source). Account routes use generic errors in most paths, but some catches log raw errors and bulk import returns exception messages. No cookie/token value leak was confirmed from code inspection; sensitive-field redaction and log access policy need explicit release verification.
- **Sample values are not automatically live secrets:** scanned matches in mock records, tests, setup/config code, and `.env.example` templates were classified as non-live examples by context. No matching value was copied to this report.

## Audit limitations / recommended gate closure

This gate did not alter code or dependencies, inspect `.env`, read local DB/logs, test live authentication, or validate every runtime path. It did not run application tests. Before public push: have the historical JWT-shaped value safely classified; remediate and re-run npm audits (especially backend critical/high production findings); verify installer defaults and ignored per-install data/artifacts; and review account credential/cookie access and log redaction under the intended single-user/local threat model. No history rewrite or credential rotation is authorized by this document.

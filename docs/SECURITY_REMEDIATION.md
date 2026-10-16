# RockBase focused security remediation

Branch: `feat/seo-intelligence-phase1`. No push/deploy, reset, credential rotation or history rewrite.

## Implemented P0
- Credential/cookie reveal/export require backend authenticated Admin + existing WorkspaceUser membership. Admin is not a global workspace bypass. Viewer/Operator denied. Single-user Local Mode retains its explicit loopback local-owner identity; sensitive routes reject foreign Origin/Host. No client-supplied role/workspace header controls permission.
- Cookie import/bulk and password updates receive the same sensitive role/workspace constraints. Plaintext responses and denied sensitive requests are no-store; authenticated API responses also no-store globally.
- Global log API requires Admin. Sensitive logger/console redaction uses a shared utility; existing log reads are sanitized without rewriting originals.
- Manual seed requires explicit email/passphrase before DB writes, no default fallback, bcrypt cost 12, no password logging, does not overwrite existing users. New seeded admin gets its workspace membership. Launcher/current setup guide no longer advertise a shared password.
- Owner-only affected account report: ignored `rockbase-data/seo/evidence/affected-admins-OWNER-ONLY.json` (IDs/emails only, no password/hash). Both affected dashboard Admins remain unchanged pending owner action.
- Manual change procedure `docs/ADMIN_PASSWORD_MAINTENANCE.md` and `scripts/change-admin-password.ps1`: secure prompts, explicit confirmation, stdin-only secret delivery, consistent verified recovery backup, atomic selected Admin password update, bcrypt read-back. Tested only on a scratch database, never run on existing operator accounts.

## n8n historical key
Read-only inspection of operational VPS `rockbase_n8n` (2.36.7) and its configured PostgreSQL database via `hermes-pc-ops` confirmed same network/database target, public key registry exists (3 current records), **0 exact/prefixed historical-key matches**, no owner matching the old key's subject. Earlier stopped local instance likewise had no matching record/owner. No key/token printed, no API call using the exposed credential, no workflow/execution mutation or container restart. Status: **inactive/unregistered on checked local and operational VPS instances**; unknown third-party/older issuers cannot be proven revoked from these inventories. No active key found to submit for revocation. If an original separate issuer is later identified, owner approval is required before deleting that specific key.

Ignored evidence: `vps-n8n-key-inventory.json`, read-only exact comparison, plus container DB target confirmation.

## Residual release gate
- The two existing default-password Admin accounts still need owner-directed password changes. Nothing changes them automatically. A password change does not invalidate already-issued stateless dashboard JWTs; incident-driven session invalidation is separate from ENCRYPTION_KEY.
- Do not publish until owner credential actions are complete and affected security regression/dependency gates pass. No assumption of blanket multi-tenant safety is introduced for unrelated legacy social APIs.
- Prior Magrade WAF block is unrelated and no production site change is part of this remediation.

## Verification
P0 actual Express router/auth/membership fixture tests: **22 cases PASS**, no real account decrypt or DB write. Seed fail-closed/logging/preservation and manual utility backup/update/read-back tests PASS in isolated fixture databases. Shared redaction canary tests PASS for nested objects, JSON/header text, Bearer/JWT, URL userinfo and encoded query keys, errors/circular objects, raw log-file output, read-time sanitization, direct console calls and printf-style secret arguments. Original log files are not rewritten.

### Effective dependency versions and compatibility
- Backend: Multer **2.4.0**, Engine.IO **6.6.11**, socket.io-parser **4.2.7**, ws **8.21.0** and nested **8.21.3**.
- Frontend: Vite **6.4.4**, socket.io-parser **4.2.7**, ws **8.21.0**.
- Native npm audit has **no findings for the five requested priority packages** in either tree. Other previously classified advisories are not claimed resolved by this scoped patch.
- Both independent npm lockfiles remain v3, their root dependency specs match the manifests, and clean `npm ci --ignore-scripts` succeeded with processes stopped. Overrides are supplied by manifests; npm lock v3 does not serialize them as root override fields. Effective installed versions match every relevant lock entry (8 checks).
- The worker's earlier in-place npm attempt left installed packages drifting from lockfiles, producing BullMQ IRedisClient type errors and native-binary file locks. Parent stopped only the task-owned preview, reinstalled from the existing scoped locks, generated Prisma client **without migration**, and restored the reviewed better-sqlite3 prebuild for its locked 12.9.0 version. Native in-memory SQLite probe and full backend typecheck PASS; no app typing workaround or unrelated dependency upgrade was needed.

### Executed acceptance
- Backend `npx tsc --noEmit`: PASS.
- Frontend `npm run build`: PASS (only existing large-bundle warning).
- `secret-access-regression-test.ts`: 22 authorization/origin/no-store cases PASS.
- `sensitive-data-redaction-test.ts`: PASS, no real credentials used.
- `seed-security-regression-test.ts`: PASS, including scratch-only owner password helper backup/read-back.
- `security-dependency-smoke-test.ts`: PASS, version floors/installed-lock parity, valid multipart upload and polling/WebSocket compatibility.
- Existing queue-runtime-safety, idempotency-foundation and account-engagement-hardening focused regressions: PASS.
- SEO focused suite: 11 PASS. Existing persisted SEO route renders with zero browser errors after the package repair; no new website scan or UI redesign.
- Social database **all 20 logical tables unchanged**, integrity ok, saved-session/config digests unchanged; original stopped persistent publishing-queue data archive byte hash unchanged. Protected Hermes containers and Redis identities/start states unchanged.

### Remaining operator actions / scope boundaries
**Release status: BLOCKED pending credential actions**, not because the implemented security tests failed. Both default-password Admins are still unchanged by design and must be updated manually using the secure owner helper. Existing WorkspaceUser membership count is zero: Local Mode owner access remains functional, but Server Mode reveal/export now intentionally fails closed until correct memberships are explicitly authorized (no automatic cross-workspace grants). No claim of blanket multi-tenant authorization cleanup of all unrelated legacy APIs is made.

Historical key is absent from checked registries; no revocation action was needed there. Original issuer beyond these known installations cannot be proven inactive. No credential/key reset, ENCRYPTION_KEY rotation, history rewrite, commit, push, deployment or REA configuration change occurred. Current work remains on `feat/seo-intelligence-phase1`; unrelated Android work and prior SEO changes remain uncommitted/preserved.

## Owner decision — mode-scoped release gate

Windows Local Mode is the primary RockBase experience and stays passwordless. Final gate separation:

- **Local Mode gate: PASS for local commit.** No dashboard account or password is required. All Local Mode protections remain: loopback-only binding, origin/host validation, sensitive endpoint guards and locally stored encrypted credentials. The two legacy default-password Admin accounts do not block Local Mode, and no existing account, password or database is changed for it.
- **Server Mode gate: enforced structurally, not by request.** A fail-closed default-credential preflight (`backend/src/utils/serverDefaultCredentialGuard.ts`) now runs before the HTTP server and the separate worker start whenever `ROCKBASE_MODE=server`. It read-only-compares all dashboard account hashes against the previously shipped defaults and exits with a refusal when any still matches; it also fails closed if the database cannot be verified. First-run bootstrap now requires a minimum 16-character password (setup script already generates 24). Server Mode container files no longer advertise a default login.
- **Fresh open-source installs.** Repository scan confirms zero tracked databases, cookies, uploads, backups, `.env` values or developer accounts; seed and bootstrap require explicit operator-provided secrets and never ship a shared password. Leftover default-login advertising was removed from `docker-compose.yml`, the historical handoff document was redacted, and an unused in-memory mock's default credential was replaced with a fixture value.

Verification: `backend/src/scripts/server-default-guard-test.ts` PASS — helper flags only shipped-default hashes; Server Mode refuses the operator's legacy database fail-closed (read-only); Local Mode is a no-op; a unique-credential fixture database passes the preflight.

# Owner-only administrator password maintenance

This is a manual owner procedure. No current credential is changed by setup, upgrade, tests or this documentation. It affects **RockBase dashboard User passwords**, not Instagram/TikTok passwords, saved cookies, encryption key or publishing data.

Scope: changing these credentials is required **only to run Server Mode or for account hygiene**. The primary Windows Local Mode experience is passwordless and does not require any dashboard password change to be used; Server Mode additionally refuses to start while a previously shipped default credential remains valid.

## Identify affected users

The owner-only report is local and ignored:
`rockbase-data/seo/evidence/affected-admins-OWNER-ONLY.json`.
It identifies both affected Admins by existing ID/name/email. It contains **no password or hash**. Do not copy that report into public docs/releases.

## Change one existing Admin, explicitly

Use a private local PowerShell terminal, not chat, scripts with plaintext values, command-line password flags, or a recording/transcript session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\change-admin-password.ps1 -UserId '<existing ID from owner-only report>'
```

1. Enter a unique 16+ character passphrase (up to 72 UTF-8 bytes for bcrypt), with upper/lowercase letters and digits; confirm it. Prefer a password manager.
2. The helper requires typing `CHANGE` before applying to the selected existing Admin.
3. The child receives the password through stdin, not command-line arguments or environment; neither password nor hash is printed.
4. Before a write, the Node helper makes a consistent new SQLite backup under ignored `backend/backups/`, verifies integrity, updates only the selected existing Admin password/updatedAt using an atomic old-hash predicate, then verifies the stored password via bcrypt.
5. Repeat for the second affected Admin. Do **not** run the seed or reset the DB to change existing passwords.

The helper was exercised only against a scratch fixture DB in this implementation. It has **not been invoked against the owner's database**. Canceling, omitting `--apply-owner-approved`, a mismatching confirmation, invalid target or weak password makes no credential change. No automatic password/key rotation is introduced.

## After changing

Verify each intended dashboard login privately in Server Mode. Local Mode intentionally does not require dashboard login. Preserve the DB recovery backup and the original ENCRYPTION_KEY. Avoid rolling back the entire production DB just to revert a password: that could discard newer operational data.

Password changes **do not invalidate previously issued stateless RockBase JWTs**. Sign out of operator clients and allow the configured expiry; if there is evidence of misuse, separately authorize targeted session invalidation or a RockBase JWT-signing-key change. Do not confuse JWT_SECRET with ENCRYPTION_KEY; no encryption-key rotation is appropriate for this password-maintenance operation.

## New installations

The manual seed now requires explicit `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, validates password length before DB writes, never overwrites an existing user password, and never prints credentials. Use the existing first-run bootstrap for normal installs. No common default password is supplied.
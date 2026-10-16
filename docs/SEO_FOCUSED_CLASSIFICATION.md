# Focused classification — Magrade 403 and release risks

Scope: diagnosis/classification only. No engine/dashboard rebuild, production change, DB reset, ENCRYPTION_KEY rotation, history rewrite, commit, push or deployment. REA was not installed, invoked or reconfigured.

## 1. Magrade root cause

**Confirmed:** the 403 is a Hostinger CDN (`server: hcdn`) browser challenge, not a robots exclusion or an application 403.
- HTTPX ordinary public requests to `/robots.txt`, `/sitemap.xml`, and `/` returned HTML `403` with title `Checking your browser before accessing. Just a moment...`, meta refresh and no-cache challenge headers.
- Source `robots.txt` explicitly permits `/`; the live same-UA curl control returned that real text with HTTP 200, `x-hcdn-cache-status: REVALIDATED` and `x-hcdn-upstream-rt: 0.002`.
- A diagnostic pair pinned to **one ordinary DNS-returned CDN destination** `153.92.12.5` with identical honest RockBaseSEO user agent reproduced HTTPX **403 challenge** vs curl/Schannel **200 robots**. This was attribution only: no crawler fallback, cookie reuse, challenge execution, identity spoofing or production crawl followed.
- Local Magrade `.htaccess:1–43` contains canonical/legacy redirects and scoped noindex headers, no robots deny or UA block. The file alone is not evidence of exact live origin configuration; the live 200 and CDN challenge provide stronger attribution.
- There are no configured HTTP(S) proxy environment variables or hosts-file Magrade override in the checked process. DNS answers rotate through the CDN; the same-destination comparison controls for that variation.

**Likely decision mechanism:** CDN anti-bot classification distinguishes HTTP/TLS/request characteristics (HTTPX/OpenSSL vs Windows curl/Schannel) rather than blocking the user-agent string or all IP traffic. Exact WAF rule, bot score and account-level setting cannot be confirmed without hPanel/security-event access. Do not call this a verified specific fingerprint or intentionally defeat it.

**Minimum owner-side remediation:** keep WAF enabled; ask Hostinger to match the recorded `x-hcdn-request-id`/UTC timestamp and permit the owner's internal crawler. Prefer a narrow exception for the operator's fixed egress IP + site/GET/HEAD and required public paths, retaining rate limits. If supported, exclude `/robots.txt` and sitemap documents from interactive browser challenges for all legitimate bots; scanning page HTML still needs the scoped crawler exception. User-agent alone is spoofable and not sufficient authorization. If hPanel lacks a selective rule, support should apply the scoped policy—do not disable CDN/WAF globally, weaken robots, change DNS, expose origin or switch transport to dodge protection.

Evidence (ignored local): `rockbase-data/seo/evidence/magrade-403-classification.json`, `magrade-same-destination-comparison.json`. Reference request ID: `423dbfe3772335756b95f1a0ab7952dd-dci-edge7` for HTTPX challenge; evidence records UTC time and comparisons. No site settings changed.

## 2. Historical JWT classification

Historical location: `frontend/src/pages/Campaigns.tsx:1954`, commit `a09aa75ef114c7c858990727a9cb394da8e2c85b`.
- It decodes as HS256 with n8n issuer and `public-api` audience, issued June 7, 2026. **No expiry claim**: it cannot be dismissed as expired.
- It is **not a valid RockBase login token**: signature fails current RockBase key and legacy fallback; claims also lack RockBase's required identity fields. Current key is not the old insecure fallback.
- Historical call site attached it to a local n8n simulation webhook. `Simulation` is not proof the credential was dummy. The key's source format is n8n public API, whose standard header is `X-N8N-API-KEY`; incorrect historical webhook usage does not neutralize a real leaked API key.
- The referenced local n8n instance is stopped; it was not started or probed with the credential. A read-only DB snapshot (including WAL) contains **no exact/prefixed API-key match, no matching jti and no matching owner sub**. n8n source stores and authorizes keys by DB registration. Thus it is **not an active registered key on that checked local instance**. A fresh instance, past revocation or a different issuer cannot be distinguished from these observations; do not claim globally revoked or cryptographically proven dummy.

**Action:** classify as a historical potentially real **non-expiring n8n key, inactive in the checked local registry**, not as an active RockBase token. Before public release, confirm original issuing instance ownership/key inventory. If registered on any original/current issuer, revoke **only that n8n API key** through Settings → n8n API → Delete, replace dependent integrations if needed, and verify old key rejected via a read-only API request. No ENCRYPTION_KEY rotation, social-cookie invalidation or history rewrite is warranted by this key alone. No revocation was performed.

## 3. Default credentials — active local risk, not documentation-only

A read-only bcrypt comparison of the seed's documented default against existing User password hashes found **2 matching users, both Admin; 1 known default email/password pair**. Values, hashes and email identities were never printed. No login attempt was sent.

This means the default remains a valid password under the current login implementation (`authRoutes.ts:35–49`), not merely a legacy README string. Local preview binds loopback and has no external exposure proven; Server Mode or accidental network exposure makes this a high-impact takeover risk. Local Mode bypasses dashboard login by design; that does not remove the stored default-login risk.

Minimum action: owner-directed password change for the two existing dashboard Admin users (not social platform passwords), keeping DB/ENCRYPTION_KEY/cookies. Remove hardcoded seed fallback (`seed.ts:10–11`), require operator-supplied strong bootstrap password or generated unique first-run secret; scrub misleading default-login examples. Do not reset/seed the existing DB. None of those changes were performed here.

## 4. Credential/cookie API boundary

**Confirmed code + isolated synthetic handler result, not extraction of real secrets:**
- Existing global authentication exists; ordinary account list uses `accountPublicSelect` and does not intentionally include encrypted cookies/accountPassword.
- `accountRoutes.ts:165–188` and `:614–641` decrypt and return passwords/cookies using account `id` only. They do **not** enforce role or workspace membership and do not set `Cache-Control: no-store`.
- With a synthetic authenticated Viewer and an unrelated-workspace synthetic account, both actual handlers returned HTTP **200** and decrypted canary. No real account/DB/encryption or network identity was used.
- In Local Mode all loopback requests become Admin (intended single-user boundary). That lowers remote exposure but does not excuse publishing Server Mode with cross-workspace credential export. System log endpoints likewise have authentication only, no explicit privileged role/workspace filtering.
- Related source issue: proxy listing uses full Prisma records (`proxyRoutes.ts:11–14`), and account notes can embed proxy credentials (`accountRoutes.ts:238–239`); that must be included in the same sensitive-response boundary rather than assuming only `/credentials` is sensitive.

Minimum action: restrict plaintext credential/cookie export to explicit Admin/owner capability + account workspace authorization (or disable these endpoints in Server Mode until supported); add no-store headers and an audited intentional reveal/export action. Apply same membership validation to cookie import/bulk account operations. Preserve the operator's Local Mode session workflow. Never log returned secrets. No production boundary changed in this task.

## 5. Logging classification

`logger.ts:50–70` serializes message/data directly to console and file; no recursive redaction. An isolated VM executed the real logger function with fake password/cookie/Authorization/query-token canaries and confirmed **all remained unredacted**, with zero real log writes. Raw exception messages are logged/returned by several account and global error paths; `/api/system/logs` returns raw recent log lines plus local directory.

Bounded inspection of 4 existing structured log files (540,451 bytes) found no JWT-shaped value, no exact historical key and no populated sensitive structured field in the scanned sample. **No actual secret log leak established**; the unredacted sink is a confirmed preventive/security-boundary gap, not proof of an incident or reason for blanket rotation.

Minimum action: one shared recursive sensitive-key + URL/query/header scrubber before both console/file serialization and error responses; use allowlisted error fields, Admin-only log API, no raw account request bodies. Add synthetic canary tests; avoid collecting raw secrets merely to test redaction.

## 6. Dependencies

Classification is complete. Parent independently checked native npm audit entries/lock versions, source callsites, and official advisory descriptions. Old npm audit totals are dependency-graph counts, not distinct exploitable runtime paths. Two findings in the scout's initial table required narrowing (CSV prerequisites and actual Vite launcher use).

| Installed package | Actual risk in this product | Minimum remediation target |
|---|---|---|
| Multer 2.1.1 | **Runtime reachable:** authenticated multipart upload middleware is mounted for account/media imports. Crafted-field parsing/DoS classes apply; ordinary file-size limits do not fix parser errors. Async-fileFilter race is not separately demonstrated because inspected filters are synchronous. Local loopback limits remote exposure; network Server Mode increases it. | 2.3.0, within current major/range. |
| Engine.IO 6.6.7 | **Runtime reachable:** Socket.IO server uses default polling/WebSocket upgrade behavior. Protocol-revision mismatch DoS is transport-level; Socket.IO namespace JWT middleware is not a complete defense for earlier transport parsing. No crash payload was sent. | 6.6.10+. |
| socket.io-parser 4.2.6 | **Runtime reachable on backend protocol path:** attachment buffering/memory exhaustion advisory. Parser also exists in browser client but the server-side attacker path is the priority. | 4.2.7+ in server/client trees. |
| ws 8.18.3 | **Runtime reachable on backend WebSocket:** tiny-fragment memory-exhaustion DoS. Separate TypedArray-close memory disclosure not shown because no triggering callsite found. Browser client uses native WebSocket, not the npm ws server implementation. | 8.21.0 clears both currently listed advisories. |
| proxy-addr 2.0.7 (npm critical) | **Not presently triggered:** official advisory requires incorrectly configured trust subnets. No `trust proxy`, direct proxy-addr call or app `req.ip` security gate found. Local boundary uses socket remoteAddress, not X-Forwarded-For. Do not label this an existing critical auth bypass. | 2.0.8, range-compatible dependency hygiene; retain safe proxy-trust invariant. |
| Axios 1.16.0 | Browser runtime is used, **but Node proxy/HTTP2/redirect adapter high-severity findings do not apply to the observed browser adapter**. Browser prototype-gadget findings require a separate pollution primitive; none established. Raw audit count overstates proven exposure. | 1.20.0+ within current major; low-regression maintenance after server priorities. |
| form-data 4.0.5 | Node adapter dependency, **not the native browser FormData used by RockBase**. No invocation of the vulnerable Node package in shipped browser path demonstrated. Not an active browser exploit blocker. | 4.0.6 when refreshing transitive tree. |
| React Router 7.15.0 | Declarative BrowserRouter, no Framework Mode/SSR/RSC. Official Framework manifest route-DoS, RSC actions and SSR findings are **not applicable to this architecture**. Browser open-redirect is conditional on attacker-controlled navigation; reviewed routes use fixed internal paths/encoded IDs, no triggering source established. | 7.18.2+ covers current advisory set without major change. |
| csv-parse 6.2.1 | Actual import sets `columns:true`, but **not `group_columns_by_name:true`**, which this particular prototype-replacement advisory also requires. An isolated installed-parser canary reproduced prototype replacement only with grouping enabled; with exact current options it did not. Thus this advisory is not currently triggered. Do not force a major upgrade solely from the initial broad classification. | Keep grouping disabled/documented; 7.0.2+ only as separately reviewed major upgrade (current npm suggested 7.0.3). |
| Vite 6.4.2 | **Relevant to actual Windows product Local Mode:** `start-rockbase.ps1:59` runs Vite continuously. It is not shipped in a dist-only browser deployment, but it *is* part of the normal current desktop runtime. Windows UNC launch-editor credential-disclosure condition is relevant when a hostile page can reach editor middleware and OS NTLM/SMB conditions hold; no such payload/network action was tested. NTFS fs.deny bypass additionally requires reachable sensitive paths/network exposure. Loopback reduces remote access, not all hostile-browser/local-process risk. | **6.4.3**, same supported v6 line, fixes both listed Vite Windows advisories; no need to jump to Vite 8. |

Other PostCSS/build-tool advisories require attacker-controlled source/CSS/build input; that input path was not established for regular app use. Keep build-chain maintenance separate from confirmed upload/WebSocket runtime findings. The Windows Vite exception above must not be lost by using only `npm audit --omit=dev`.

### Minimum release-gate closure, in order

1. **Active default dashboard passwords:** owner changes passwords of the two affected Admin users through an approved local path; remove public seed fallback and legacy default-login instructions for new installs. Preserve existing DB and ENCRYPTION_KEY. Password changes alone do not invalidate already-issued stateless JWTs; if misuse is suspected, separately plan targeted session invalidation or an explicitly approved RockBase JWT-signing-key change, never social encryption-key rotation.
2. **Sensitive response boundary + logger:** Admin/owner capability plus per-workspace account lookup; no-store on plaintext reveal/export; scope cookie imports and logs; shared recursive secret/header/query redaction with canary regressions. No need to replace auth architecture or migrate social data.
3. **Small dependency patch set:** Multer 2.3.0; Engine.IO 6.6.10; socket.io-parser 4.2.7; ws 8.21.0; Vite 6.4.3. Update existing lockfiles within ranges, without forced audit remediation. Proxy-addr 2.0.8, Axios 1.20.0, form-data 4.0.6 and Router 7.18.2 can ride a controlled range-compatible refresh, while preserving the applicability distinctions above. No csv-parse major upgrade needed to close this specific currently-untriggered advisory.
4. **Historical n8n key:** original issuer inventory confirmation; revoke only the exact key if still registered anywhere. The stopped local instance check is not proof for a different/VPS issuer. No history rewrite needed to make a revoked key unusable; publication/history handling is a separate explicit decision.
5. **Owner website access:** narrow Hostinger challenge exception for the real internal crawler, then one real bounded Magrade scan. This is a pilot functional gate, separate from public-source security remediation. Do not implement a stealth/browser challenge bypass.

After those small changes, rerun only affected permission/redaction/upload/socket smoke plus native audits and the single real pilot. No full MVP rebuild or repetition of unrelated passing gates is needed. This classification task applied **none** of the remediation updates.

Official sources checked: [proxy-addr trust-subnet prerequisites](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [Multer 2.3.0](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm), [Engine.IO upgrades](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv), [Socket.IO parser](https://github.com/advisories/GHSA-2m8v-j782-fhvr), [ws fragmentation](https://github.com/advisories/GHSA-96hv-2xvq-fx4p), [Router Framework-only DoS](https://github.com/advisories/GHSA-chx6-hx7r-mcp5), [CSV required options](https://github.com/advisories/GHSA-8cw4-87c7-c6xx), [Vite Windows fs.deny](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), [Windows launch-editor](https://github.com/advisories/GHSA-v6wh-96g9-6wx3).

## Preservation

Full logical comparison against pre-SEO backup still reports all **20 social SQLite tables unchanged**. Only ignored diagnostic scripts/evidence and these documentation updates are part of this task. No authenticated social session action, credential rotation, production change or REA configuration change occurred.

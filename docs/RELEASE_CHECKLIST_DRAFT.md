# ROCK BASE v0.1.0-alpha release checklist (draft)

This is a preparation checklist only. It does not publish a release or approve production deployment.

## Release framing

Recommended first public pre-release: **v0.1.0-alpha**.

Reason: core campaign operations, sessions, queue visibility, backup safety, and Docker onboarding exist, but production upgrade rehearsal and some execution reliability limitations still need field validation.

## Before tagging

- [ ] Owner selects a software license. No LICENSE file currently exists.
- [ ] Run backend regression suites and typecheck.
- [ ] Run frontend production build.
- [ ] Run `git diff --check`.
- [ ] Review `docs/PRODUCTION_DATA_CONTRACT.md` and `docs/UPGRADE.md`.
- [ ] Verify Windows Docker setup in a disposable fresh environment.
- [ ] Rehearse existing-install upgrade with a copied/staging database and the original `ENCRYPTION_KEY`.
- [ ] Confirm backup and off-machine media backup procedures.
- [ ] Confirm first-login bootstrap works only on an empty database.
- [ ] Confirm no default credentials or shared secrets remain in public docs.

## Proposed release notes

### Highlights

- Windows-first Docker setup with generated local secrets and readiness checks.
- Explicit split between fresh install and existing-install upgrade guidance.
- Persistent-session protection: encrypted cookie sessions require the original database plus `ENCRYPTION_KEY`.
- Campaign operator workflow: Overview → Accounts → Sessions → Campaigns → Queue → Activity.
- Execution safety improvements: fail-closed queue behavior, no blind repost after ambiguous delivery, bounded pending-verification reconciliation, and durable recovery helpers.

### Known limitations

- Docker setup has not yet been runtime-validated on this development laptop because Docker is unavailable here.
- Current session persistence is encrypted cookies, not full persistent browser profiles.
- Platform UI changes, login challenges, and verification still need human session control.
- Pending verification defaults to safe operator review when no durable platform evidence is available.
- Cross-process `Post.results` write coordination remains a future hardening area.
- Analytics is not a trustworthy product metric source and remains hidden from the primary workflow.

## Production rehearsal gate

Do not deploy this release to an installation with important sessions until a staging/clone rehearsal verifies:

```text
backup
+ original backend/.env / ENCRYPTION_KEY
+ docker compose up -d --build
+ account count check
+ one non-critical session check
+ no mass relogin
```

## License decision

Release blocker: **owner must choose a license**.

Options to consider:

- **Apache-2.0** — permissive adoption; suitable if broad reuse is preferred.
- **AGPL-3.0** — network-served modified versions must remain open; suitable if reciprocal self-hosted distribution is preferred.

Do not add a LICENSE file until the owner selects one.

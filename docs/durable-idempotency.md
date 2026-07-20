# Durable idempotency foundation

## Purpose

Durable idempotency prevents a repeated logical operation from creating duplicate work across requests or process restarts. It does not execute campaigns and does not change posting, scheduling, retry, pacing, account distribution, or human-behavior semantics.

Hermes Social continues to prepare and submit campaigns to RockBase. RockBase remains the only execution engine for queues, scheduling, pacing, browser/session work, posting, and retry.

## Why a database record

A BullMQ job ID deduplicates one queue insertion while that job identity remains in Redis. It does not represent the full lifecycle or uncertain result of a logical operation.

The legacy JavaScript Map only suppresses near-simultaneous requests inside one process for 15 seconds. It disappears on restart and is not shared across processes. It remains temporarily for route compatibility, but it is deprecated and is not the durable source of truth.

`IdempotencyRecord` stores:

- `scope` and `key`, unique as a pair;
- canonical SHA-256 `requestHash`;
- `status`;
- optional safe resource and result references;
- optional safe error category and metadata;
- timestamps and optional expiry.

`Post.idempotencyKey` remains nullable and unique for existing posting behavior. It is narrower than the generic record and is not removed in this sub-batch.

## Scope and key

Scope identifies the operation type, such as `campaign.submit`. Key identifies one caller-selected logical operation within that scope. Both use a restricted printable identifier format and bounded length.

A duplicate with the same scope, key, and request hash returns the existing record and does not acquire ownership. A duplicate with a different request hash raises a conflict and leaves the original record unchanged.

## Canonical request hash

The caller selects only the non-secret fields necessary to identify the operation. Object keys are sorted recursively, array order is preserved, and SHA-256 is applied to canonical JSON.

Rules are explicit:

- `null` is preserved and differs from a missing field;
- undefined object fields are omitted;
- undefined array entries are rejected;
- non-finite numbers, BigInt, functions, symbols, class instances, dates, and binary objects are rejected;
- fields whose names indicate passwords, cookies, tokens, authorization, API keys, encryption keys, or secrets are rejected;
- media must be represented by a stable reference or checksum, never binary content.

## Lifecycle

- `IN_PROGRESS`: one caller created and owns the operation.
- `COMPLETED`: a safe resource/result reference is durable. Repeating the same completion is idempotent; a different result conflicts.
- `FAILED`: the operation ended in a classified failure. It is not automatically re-executable.
- `UNKNOWN`: the external outcome cannot be proven. It is not treated as failed and must not be retried automatically.

Terminal records do not transition back to `IN_PROGRESS`. Transitions from `FAILED` or `UNKNOWN` to another terminal state are rejected by the foundation service.

## Concurrency

The database unique constraint on `[scope, key]` is the authority. Concurrent creates explicitly handle Prisma `P2002`: exactly one caller acquires ownership, while the other reads the committed record and validates its hash. No process-local lock is used by the new service.

## Privacy and retention

Only the hash and small safe references/metadata are accepted. Raw request bodies, media, passwords, cookies, bearer tokens, JWTs, API keys, encryption keys, credentials, messages, and stack traces must not be stored. Safe JSON is size-limited.

`expiresAt` and its index prepare for a later retention policy. Sub-batch 4B1 does not delete records automatically; retention and cleanup require a separately reviewed policy.

## Migration

Migration `20260720062000_add_durable_idempotency_foundation` is additive:

1. add nullable `Post.idempotencyKey`;
2. add its unique index (legacy NULL rows remain valid);
3. create `IdempotencyRecord`;
4. create the compound unique constraint and observation/retention indexes.

Use `prisma migrate deploy` only against an isolated test database and staging after a verified backup. Do not use `prisma db push`, reset, or development/production databases for this sub-batch.

## Schema drift audit

Before this migration, `Post.idempotencyKey` was present in `schema.prisma` and referenced by:

- `src/routes/postRoutes.ts` for posting record creation and duplicate handling;
- `src/controllers/rockSocialController.ts` for Rock Social post creation;
- `src/queue/postingWorker.ts` for successful-post duplicate checks.

None of the seven existing migrations created the column, and the active staging `Post` table did not contain it. This proves the schema changed without a matching migration. Runtime code using the field could fail because Prisma expected a column absent from SQLite.

Legacy Map call sites still present:

- `src/routes/postRoutes.ts`;
- `src/controllers/rockSocialController.ts`.

They remain unchanged in 4B1 to avoid production route behavior changes.

## Post submission integration

`POST /api/posts` and `POST /api/posts/bulk` use the durable service when the optional `Idempotency-Key` header is present. The same key and payload return the existing operation; the same key with a different payload returns HTTP 409. Requests without the header retain their previous behavior.

The bulk hash stores only a media SHA-256 checksum and request references, never media bytes. Existing queue timing, BullMQ IDs, worker behavior, campaign execution, posting lifecycle, and `PENDING_VERIFY` remain unchanged.

Integration for `bulk-multi`, Rock Social routes, workers, schedulers, campaign submission, retry handling, observability endpoints, and retention execution remains deferred. Distributed account locks, rate budgets, scheduler consumers, campaign recovery, and posting result recovery remain outside this integration.

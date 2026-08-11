# 007 — REST API and API keys

Status: creation, status, and runtime OpenAPI routes are implemented; external
availability and the remaining contract gaps below are unverified.

## User problem

Founders and agents need the same Next Move contract programmatically without a
generic raw-provider API or exposure of cloud credentials.

## Scope

`POST /v1/next-move`, `GET /v1/next-moves/{id}`, async status, idempotency,
design-partner API keys, scopes, project/rate/cost controls, and OpenAPI.

## Non-goals

MCP, CLI, SDK, raw source resale, bulk endpoints, OAuth, self-service key
management, or customer organization/team auth.

## Product contract

Only `product_url` is required. Return `200` for a suitable fresh ready result or
`202` plus status URL for work. States are `QUEUED`, `RUNNING`,
`REVIEW_REQUIRED`, `READY`, `FAILED`; ready data includes evidence/limitations,
review status, and `auto_publish=false`.

## API contract

Bearer shape: `tf_test_<prefix>.<secret>` or `tf_live_<prefix>.<secret>`.
Require `Idempotency-Key` on creation; same key/body returns one resource and
conflicting body is rejected. Errors are stable and reveal no secret/tenant data.
Creation requires `next_move:write`; status reads require `next_move:read`.

## Data model

Store visible prefix, safe secret hash, environment, scopes, optional project,
status, created/last-used/revoked times, rate/cost limits, request-level API cost
reservation, and auth audit. Raw secret is shown once.

## Provider/legal constraints

One TrendsFast key never delegates provider ownership or data-resale rights.
Terms/privacy/retention must cover API processing before external users.

## Security considerations

CSPRNG secrets, peppered secure hashing, constant-time compare, bounded request
bodies, process-local in-flight protection plus PostgreSQL-backed cross-instance
admission before scrypt, tenant-filtered repositories, generic failures,
log/header redaction, atomic rolling-hour cost admission, and no key in
URLs/browser storage.

## Tests written first

- Key format/generation, show once, hash/pepper, revoke, scope/environment.
- Missing/invalid/expired/cross-project auth and audit.
- Same/conflicting idempotency replay and concurrency.
- Per-key/request/provider-cost limits, exact micro-USD boundaries, parallel
  first-request races, idempotent reuse, and retained crash reservations.
- `200`/`202`/status schemas and evidence binding.
- OpenAPI generation matches runtime validation.

## Implementation

Define Zod schemas once and generate OpenAPI. Before any partner issuance, add a
reviewed server-only administrative procedure around the issuance repository and
record the event; no issuance UI/CLI is currently provided. The public free scan
uses no reusable key.

### Current implementation truth

- `POST /v1/next-move`, `GET /v1/next-moves/{id}`, and
  `GET /v1/openapi.json` are mounted through the Next.js/Hono application.
- Bearer authentication records an audit event and enforces scope, environment,
  optional project ownership, hourly authentication usage, and a projected
  provider-cost ceiling.
- Syntactically valid attempts enter durable fixed-cardinality admission before
  expensive secret verification. Defaults are 12 per fingerprint and 120
  globally per one-minute window, in addition to the process-local in-flight
  bound. The deployment must verify the trusted-proxy/fingerprint boundary.
- A raw key is returned only by the server-side issuance repository. There is no
  self-service issuance/revocation UI or documented public issuance route.
- Keys support optional expiry plus active/revoked state, and expired
  authentication attempts are rejected and audited. There is no automated
  rotation or self-service lifecycle.
- Status reads are filtered to the authenticated API key and its optional
  project restriction. Ready results require a persisted founder-reviewed,
  non-auto-published move.
- The database persists a canonical request digest and distinguishes exact
  repeats from payload conflicts, including the unique-index race. The v1
  service returns `409` for conflicts found before creation or during a raced
  create.
- Creation then enters one transaction that locks the API-key row, rechecks
  idempotency, and counts every request in the preceding hour as the greater of
  its persisted reservation or summed run `GREATEST(estimated, actual)` cost.
  The proposed reservation is compared to the key ceiling in exact integer
  micro-USD units before insert. Concurrent requests cannot each spend the same
  remainder.
- Fixture requests reserve `$0`; non-fixture requests reserve the configured
  per-scan maximum. The reservation remains for one hour if processing crashes,
  and exact replays do not reserve twice. Generic request creation rejects API
  origin so internal callers cannot bypass the atomic path.
- The creation body is stream-counted before JSON parsing, so missing or false
  `Content-Length` does not bypass the bound.

The OpenAPI document describes the mounted paths and reuses runtime Zod schemas,
but it does not yet enumerate the runtime's full 400/401/403/409/413/422/429/500
response matrix. Spec/runtime parity and a production-hosted read-back remain
release gates.

## Verification

Run unit/integration/concurrency tests, inspect generated spec diff, and exercise
only implemented routes in a production-like environment.

A 2026-08-11 manual local HTTP exercise fetched `/v1/openapi.json`, created a
fixture request, replayed the same idempotency key, received the same resource
ID, and read its scoped `REVIEW_REQUIRED` status. This is local pre-release
evidence only; see the
[dated record](../operations/LOCAL_VERIFICATION_2026-08-11.md).
Post-`0007` real-PostgreSQL race and web/orchestration tests cover the atomic
cost-admission boundary; immutable-SHA and deployed checks remain open.

## Limitations

Temporary founder ops is not general customer identity. Contract may evolve
during alpha with explicit changelog/versioning. Durable admission is an abuse
bound, not proof of deployed proxy correctness or customer-grade identity. A
crash can conservatively consume the key allowance for the rest of the hour;
that false rejection is intentional fail-safe behavior. One lower-priority
internal type still permits `apiKeyId` on a non-API-origin request, although no
current or external call path constructs that combination; tighten it before
adding new repository callers.

## Rollout

Issue revocable test/design-partner keys manually with low limits before any
public key onboarding.

## Rollback

Revoke affected keys or disable creation while preserving existing result/status
access and audit history.

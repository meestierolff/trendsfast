# 007 — REST API and API keys

Status: creation, status, runtime OpenAPI, and protected founder key-management
routes are implemented; deployed availability and release-SHA acceptance remain
unverified.

## User problem

Founders and agents need the same Next Move contract programmatically without a
generic raw-provider API or exposure of cloud credentials.

## Scope

`POST /v1/next-move`, `GET /v1/next-moves/{id}`, async status, idempotency,
approved-user API keys, scopes, project/rate/cost controls, founder issuance,
rotation/revocation, audit, and OpenAPI.

## Non-goals

MCP, CLI, SDK, raw source resale, bulk endpoints, OAuth, customer self-service
key management, or organization/team auth.

## Product contract

Only `product_url` is required. Return `200` for a suitable fresh ready result or
`202` plus status URL and `poll_after_seconds: 30` for work. States are `QUEUED`, `RUNNING`,
`REVIEW_REQUIRED`, `READY`, `FAILED`; ready data includes evidence/limitations,
review status, and `auto_publish=false`.

## API contract

Bearer shape: `tf_test_<prefix>.<secret>` or `tf_live_<prefix>.<secret>`.
Require `Idempotency-Key` on creation; same key/body returns one resource and
conflicting body is rejected. Errors are stable and reveal no secret/tenant data.
Creation requires `next_move:write`; status reads require `next_move:read`.
Clients should wait at least 30 seconds, then use exponential backoff. Every
`429` includes `Retry-After`.

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

Define Zod schemas once and generate OpenAPI. Founder operations owns the
server-side administrative boundary; the public free scan uses no reusable key.

### Current implementation truth

- `POST /v1/next-move`, `GET /v1/next-moves/{id}`, and
  `GET /v1/openapi.json` are mounted through the Next.js/Hono application.
- Bearer authentication records an audit event and enforces scope, environment,
  optional project ownership, separate rolling-hour creation/status usage, and a projected
  provider-cost ceiling.
- Syntactically valid attempts enter durable fixed-cardinality admission before
  expensive secret verification. Defaults are 12 per fingerprint and 120
  globally per one-minute window, in addition to the process-local in-flight
  bound. The deployment must verify the trusted-proxy/fingerprint boundary.
- Successful `POST /v1/next-move` authentication is counted against the create
  limit (default 20/hour); successful `GET /v1/next-moves/{id}` authentication
  is counted against the status limit (default 300/hour). Durable invalid,
  revoked, and expired outcomes feed a separate 20/hour fingerprint failure
  budget. Status polling never records an on-demand research acceptance.
- Protected `/ops/keys` and CSRF-bound ops routes list, issue, rotate, reissue,
  and revoke project-scoped keys with a management audit. A raw secret appears
  once; customers still have no self-service issuance route.
- Founder ops can issue one audited, revocable `FOUNDER_GRANT` /
  `DESIGN_PARTNER` entitlement for one active project for at most 30 days. It is
  not a Stripe subscription. Live key issuance and on-demand requests accept
  either an active paid entitlement or this grant, while per-key request/cost
  limits and the ten-run entitlement-window allowance still apply.
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

The OpenAPI document describes the mounted paths and reuses runtime Zod schemas.
Spec/runtime parity and a production-hosted read-back remain release gates and
must be checked against the exact release SHA.

## Verification

Run unit/integration/concurrency tests, inspect generated spec diff, and exercise
only implemented routes in a production-like environment.

The database-enabled run for implementation candidate
`73297a6cfdc99b025990b001b39cef399f4d235e` passed 98 files/512 tests across the
API's unit, repository, race, entitlement, admission, and orchestration
boundaries. The final non-database run passed 78 files/455 tests with 20 files/57
tests skipped. Branch CI passed at `4ec9510f610001285c54947326c65cb79a075f37`;
an authenticated deployed spec/runtime read-back remains open. See the
[integrated record](../operations/LOCAL_VERIFICATION_2026-08-12.md); its counts
are immutable code-local evidence, not a hosted API claim.

## Limitations

Temporary founder ops is not general customer identity. Contract changes require
an explicit changelog/versioning decision. Durable admission is an abuse
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

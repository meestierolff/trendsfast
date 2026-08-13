# 007 — REST API and API keys

Status: legacy and claimed-project creation, status, runtime OpenAPI, founder
operations, and owner self-service key management are implemented locally;
deployed availability and release-SHA acceptance remain unverified.

## User problem

Founders and agents need the same Next Move contract programmatically without a
generic raw-provider API or exposure of cloud credentials.

## Scope

`POST /v1/next-move`, preferred
`POST /v1/projects/{project_id}/next-move`, `GET /v1/next-moves/{id}`, async
status, idempotency, project-scoped API keys, scopes, project/rate/cost
controls, founder and owner issuance, reissue/revocation, audit, and OpenAPI.

## Non-goals

MCP, CLI, SDK, raw source resale, bulk endpoints, API OAuth, automated key
rotation, or organization/team auth.

## Product contract

For the legacy route, only `product_url` is required. The preferred claimed-
project route accepts the objective, preferred channels, content capabilities,
and generation level while loading the saved project URL and current context
server-side. Return `200` for a suitable fresh ready result or `202` plus status
URL and `poll_after_seconds: 30` for work. States are `QUEUED`, `RUNNING`,
`REVIEW_REQUIRED`, `READY`, `FAILED`; ready data uses strict `next-move-v1` and
includes action details, timing, evidence/limitations, freshness, review state,
and `auto_publish=false`.

## API contract

Bearer shape: `tf_test_<prefix>.<secret>` or `tf_live_<prefix>.<secret>`.
Require `Idempotency-Key` on creation; same key/body returns one resource and
conflicting body is rejected. Errors are stable and reveal no secret/tenant data.
Creation requires `next_move:write`; status reads require `next_move:read`.
Clients should wait at least 30 seconds, then use exponential backoff. Every
`429` includes `Retry-After`.

Preferred request example:

```http
POST /v1/projects/1bbbcaf1-cec3-46c7-a45a-dabb896fb65d/next-move HTTP/1.1
Authorization: Bearer tf_test_example.secret-shown-once
Idempotency-Key: 4a2d1201-9666-4ef0-90a9-e5aa47786c8e
Content-Type: application/json

{
  "objective": "Grow among technical founders",
  "preferred_channels": ["x", "linkedin", "reddit"],
  "content_capabilities": ["founder_text", "screen_recording"],
  "generation_level": "brief"
}
```

The key must be restricted to the path project. Requesting a capability outside
the saved profile is rejected rather than silently expanding what the founder
can produce.

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

- Key format/generation, show once, hash/pepper, owner issue/reissue/revoke,
  scope/environment, and project isolation.
- Missing/invalid/expired/cross-project auth and audit.
- Same/conflicting idempotency replay and concurrency.
- Per-key/request/provider-cost limits, exact micro-USD boundaries, parallel
  first-request races, idempotent reuse, and retained crash reservations.
- `200`/`202`/status schemas and evidence binding.
- Runtime OpenAPI projection matches mounted validation and examples.

## Implementation

Define each request/response once with Zod and project the same schemas into the
runtime OpenAPI document. Founder operations retains an administrative path;
verified, entitled owners also manage their own project keys through the member
repository. The public free scan uses no reusable key.

### Current implementation truth

- `POST /v1/next-move`, `POST /v1/projects/{project_id}/next-move`,
  `GET /v1/next-moves/{id}`, and `GET /v1/openapi.json` are mounted through the
  Next.js/Hono application.
- Bearer authentication records an audit event and enforces scope, environment,
  optional project ownership, separate rolling-hour creation/status usage, and a projected
  provider-cost ceiling.
- Syntactically valid attempts enter durable fixed-cardinality admission before
  expensive secret verification. Defaults are 12 per fingerprint and 120
  globally per one-minute window, in addition to the process-local in-flight
  bound. The deployment must verify the trusted-proxy/fingerprint boundary.
- Successful `POST /v1/next-move` and `GET /v1/next-moves/{id}` authentication
  use distinct operator-supplied private limits. Durable invalid, revoked, and
  expired outcomes feed a separate private fingerprint failure budget. Status
  polling never records an on-demand research acceptance.
- Protected `/ops/keys` and CSRF-bound ops routes list, issue, rotate, reissue,
  and revoke project-scoped keys with a management audit. Verified entitled
  owners can separately name, issue, reissue, and revoke keys in
  `/dashboard/agents`. A raw secret appears once in either flow.
- Founder ops can issue one audited, revocable `FOUNDER_GRANT` /
  `DESIGN_PARTNER` entitlement for one active project for at most 30 days. It is
  not a Stripe subscription. Live key issuance and on-demand requests accept
  either an active paid entitlement or this grant, while per-key request/cost
  limits and the ten-run entitlement-window allowance still apply.
- Keys support optional expiry plus active/revoked state, and expired
  authentication attempts are rejected and audited. Reissue atomically revokes
  the replaced key; there is no automated rotation.
- Multiple keys do not multiply an entitlement: the ten on-demand allowances
  and monitoring state remain project-level.
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

Run unit/integration/concurrency tests, inspect the runtime OpenAPI document,
and exercise only implemented routes in a production-like environment.

The latest local PostgreSQL run completed 710 active tests with 5 skipped and no
failures; separate runtime-role access passed 5/5 tests. The non-database suite
passed 640 tests with 73 skipped. These mutable-tree results have no release SHA
or remote CI attached. See the
[2026-08-13 local record](../operations/LOCAL_VERIFICATION_2026-08-13.md).
Authenticated hosted spec/runtime and owner-journey read-backs remain open.

## Limitations

Supabase Auth proves identity, while membership remains application-managed.
Contract changes require an explicit changelog/versioning decision. Durable
admission is an abuse bound, not proof of deployed proxy correctness. A crash
can conservatively consume the key allowance for the rest of the hour; that
false rejection is intentional fail-safe behavior.

## Rollout

Exercise owner issuance with revocable test/design-partner keys and low limits
in preview before enabling the claimed-project API for a founder cohort.

## Rollback

Revoke affected keys or disable creation while preserving existing result/status
access and audit history.

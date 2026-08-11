# Architecture overview

## Goals

TrendsFast must produce one trustworthy decision from bounded work, preserve
original evidence, survive retries, run locally without paid credentials, and
stay portable across standard PostgreSQL hosting.

## Runtime shape

The alpha is one deployable Next.js 16 / React 19 application. Hono exposes
versioned REST endpoints. Shared TypeScript packages separate contracts without
creating microservices:

| Boundary        | Responsibility                                                  |
| --------------- | --------------------------------------------------------------- |
| `core`          | product types, truth classes, action quality floors             |
| `schemas`       | Zod runtime schemas and OpenAPI generation                      |
| `database`      | Drizzle schema, SQL migrations, repositories, transactions      |
| `providers`     | fixtures, bounded adapters, normalization, cost/provenance      |
| `scoring`       | deterministic dedupe, clustering inputs, ranking, `WAIT` gates  |
| `evidence`      | canonical receipts, source independence, binding/validation     |
| `orchestration` | resumable state transitions and step execution                  |
| `billing`       | disabled-by-default Stripe boundary and entitlement projection  |
| `analytics`     | first-party event ledger and privacy-filtered optional adapters |
| `config`        | validated server configuration and credential modes             |
| `observability` | structured, redacted logs and provider/run telemetry            |

## Request-to-result flow

1. A public form or authenticated API validates a product URL and idempotency.
   API creation atomically locks its key, rechecks idempotency, and reserves the
   rolling-hour provider-cost allowance before inserting work.
2. PostgreSQL atomically applies the public fingerprint count/duplicate/insert
   decision and stores a 256-bit public scan capability. A separate 256-bit,
   hashed, expiring delivery token is issued only after founder approval.
3. The orchestrator claims the scan, persists its hard deadline, rotates its
   processing fence, and records its bounded plan.
4. Safe website ingestion validates every DNS/redirect hop and pins the outbound
   Node connection to an approved address while deriving bounded context.
5. Each enabled provider receives a role-specific bounded query plan.
6. Provider outputs normalize to canonical signals with provenance and cost.
7. Deterministic logic removes duplicates, evaluates independence, clusters,
   scores opportunities, and filters the candidate set.
8. Optional bounded structured synthesis can refine prose but must preserve the
   deterministic decision and exact evidence-ID set; it cannot supply evidence
   facts.
9. The system binds stored receipts, enforces the truth/quality floor, and can
   convert an unsafe proposal to `WAIT`.
10. Founder review verifies/rejects evidence, approves or converts the result to
    `WAIT`, creating audit events.
11. An authenticated delivery action issues one private result capability;
    feedback and outcomes are append-only.

## Trust boundaries

- **Browser to application:** untrusted inputs; stream-bound mutation bodies,
  apply atomic/durable admission and CSRF, verify the deployed proxy boundary,
  and never expose reusable keys in the free form.
- **Application to website:** hostile network/content; defend against SSRF,
  rebinding, redirect escape, oversized bodies, and prompt injection.
- **Application to providers:** external availability, billing, terms, and
  schema boundary; cap and record calls, time, retries, quota, and cost.
- **Model boundary:** untrusted inference; strict schema, input/response/output
  caps, one repair retry, exact deterministic evidence membership, no accepted
  URLs/metrics/source claims, and conservative pre-call cost reservation.
- **Database:** tenant/privacy boundary and durable truth; parameterized access,
  least privilege, retention, and audited state changes.
- **Ops:** privileged temporary founder surface; server-only token, secure
  cookie, CSRF, audit, and preferably network access control.
- **Stripe/webhooks:** target external money/state boundary; verified signatures
  and idempotent local projection are required before enablement. The current web
  app exposes no billing or webhook route.

## Data shape

Lifecycle/filterable facts remain relational. JSONB is limited to bounded raw
fragments and versioned model data. Key entities include requests, projects,
context versions, runs, source runs, signals and metric snapshots, clusters,
opportunities, Next Moves, evidence receipts, review/delivery/feedback/outcome
events, API keys, provider costs, analytics events, and future Stripe records.

Raw provider content is not an archive. Store hashes or minimal excerpts where
possible and delete according to configured retention.

The database package implements exact-project deletion and a `pnpm db:purge`
operation for eligible retained terminal and nonterminal scans, expired delivery
tokens, linked analytics, and eligible orphan projects. Scheduling that purge,
authenticating privacy requests, export, backup expiry, and legal-hold handling
are deployment responsibilities and are not callable product routes in this
alpha.

All processing mutations are guarded by the current deadline/fence. Recovery
checks a provider left `RUNNING` before deadline expiry and fails with
`PROVIDER_OUTCOME_UNKNOWN` rather than replaying it. The broader explicit ops
retry still requires upstream effect/cost reconciliation before non-fixture use.

## Deployment boundary

The hosted target is Vercel plus standard hosted PostgreSQL (Supabase is allowed
as PostgreSQL). Migrations run as a controlled release step, not concurrently in
every request instance. The alpha executor may run inside a bounded server
function; orchestration can later move to a durable worker without changing the
domain/API contracts.

This document describes design. It does not assert that Vercel, Supabase, or any
provider has been configured or read back successfully.

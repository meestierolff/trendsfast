# Changelog

All notable changes will be documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use
semantic versioning once its public contracts stabilize.

## [Unreleased]

### Added

- Independent TrendsFast alpha repository scaffold.
- Fixture-first product, provider, evidence, scoring, orchestration, database,
  billing, analytics, configuration, and observability package boundaries.
- PostgreSQL-backed scan processing through founder review, evidence
  verification, approval, expiring private delivery, feedback, public-share
  consent, failure marking, and explicit failed-scan retry.
- Authenticated `POST /v1/next-move`, `GET /v1/next-moves/{id}`, and runtime
  `GET /v1/openapi.json` routes with scoped API-key, rate, cost, and ownership
  checks.
- Optional API-key expiry with auditable expired-auth rejection, plus canonical
  request digests for idempotency conflict detection at the database boundary.
- Atomic per-API-key rolling-hour cost admission with a persisted request
  reservation, API-key row lock, in-transaction idempotency recheck, exact
  micro-USD comparison, and fail-safe one-hour reservation after a crash.
- Persisted hard deadlines and rotating processing fences that reject stale
  worker mutations; interrupted provider effects fail closed as
  `PROVIDER_OUTCOME_UNKNOWN` without automatic replay, even when the deadline is
  also expired.
- 256-bit public scan capabilities, byte-bounded mutation bodies, atomic public
  admission, and bounded PostgreSQL-backed API/ops authentication admission.
- DNS-rebinding-resistant pinned website transport, abortable provider/model
  deadlines, exact deterministic evidence-set enforcement, and rising-only,
  query-isolated measurement truth.
- Conservative atomic model-cost reservations using explicit operator-supplied
  input/output prices. Actual model usage settlement remains follow-up work.
- Exact-project deletion and retained-scan expiry repository operations plus a
  `pnpm db:purge` CLI. A
  scheduled retention job and public privacy-request workflow remain deployment
  work, not repository claims.
- Open-source governance, architecture decisions, feature contracts, security
  threat model, provider/billing guides, runbooks, legal-review templates, and
  distribution assets.
- CI and contribution templates.

### Security

- Documented SSRF, prompt-injection, secret, authorization, evidence,
  idempotency, webhook, abuse, and retention boundaries.

### Known limitations

- Only fixture behavior may be claimed without a production provider read-back.
- Reddit automation is held at `LEGAL_REVIEW`.
- Billing is disabled and no live Stripe setup is claimed.
- The Stripe package is an internal disabled/test-mode boundary; no application
  Checkout, Portal, or webhook route is exposed.
- Ops retries a whole failed scan rather than only the failed source/synthesis
  step. Explicit retry after an uncertain provider effect remains gated against
  duplicate provider cost.
- Model reservations do not yet reconcile provider-reported actual token usage,
  and operator-supplied price metadata requires release review.
- Public scan capability lookups rely on 256-bit bearer secrecy and retention;
  independent durable lookup throttling/deployed edge verification remains
  defense-in-depth work.
- No public deployment, legal approval, security audit, customer result, or
  traction metric is claimed.

## [0.1.0-alpha.0] - unreleased

Initial founder-reviewed alpha under active construction. A release date will
be added only when a tag is actually published.

# Changelog

All notable changes will be documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to use
semantic versioning once its public contracts stabilize.

## [Unreleased]

### Changed

- Intentionally upgraded the pre-launch v1 Next Move contract in place. Ready
  results now carry strict action-specific PUBLISH/REPLY/REMIX/WAIT detail,
  rounded `TrendWindow`, categorical (non-probability) `BreakoutPotential`,
  freshness truth, and `generation_level=brief|draft`. Factual reply/remix
  targets remain bound to exact stored evidence and `auto_publish=false`.
- The preferred API creation route is now
  `POST /v1/projects/{project_id}/next-move`. It loads the claimed project's
  saved URL, current context, voice, and content-capability ceiling server-side;
  the legacy `POST /v1/next-move` remains compatible for project-bound callers.

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
- Supabase Auth identity with Google PKCE and browser-bound e-mail magic links,
  plus a hashed, single-use, delivery-bound project claim that is consumed
  after verified sign-in without placing private capabilities in OAuth state or
  e-mail.
- Owner-authorized `/dashboard`, `/dashboard/today`, `/dashboard/projects`,
  `/dashboard/history`, `/dashboard/agents`, and `/dashboard/billing` surfaces.
  The Agents screen issues named project keys with one-time secret display,
  revoke/reissue, last-use visibility, scopes, and shared project allowances.
- `POST /v1/projects/{project_id}/next-move` with saved-context/capability
  enforcement and runtime OpenAPI 3.1 coverage.
- Bounded same-origin product-site context reading, observed/inferred
  provenance, entity type, voice profile, and content-capability persistence.
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
  input/output prices, with settlement only from valid provider-reported token
  usage and conservative unsettled state when usage is missing or invalid.
- Exact-project deletion and retained-scan expiry repository operations, a
  `pnpm db:purge` CLI, and an authenticated ops-only scheduled-retention route.
  Scheduler deployment and operator privacy-request acceptance remain external
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
- Stripe Checkout, signed-webhook, one-time claim, project-key issuance, and
  hosted-Portal application boundaries exist but remain disabled by default;
  no hosted sandbox or live customer journey is claimed.
- Ops retries a whole failed scan rather than only the failed source/synthesis
  step. Explicit retry after an uncertain provider effect remains gated against
  duplicate provider cost.
- Model reservations settle valid provider-reported token usage; missing or
  invalid usage remains conservative and unsettled. Operator-supplied price
  metadata and invoice reconciliation still require release review.
- Public scan capability lookups rely on 256-bit bearer secrecy and retention;
  independent durable lookup throttling/deployed edge verification remains
  defense-in-depth work.
- No public deployment, legal approval, security audit, customer result, or
  traction metric is claimed.

## [0.1.0-alpha.0] - unreleased

Initial founder-reviewed alpha under active construction. A release date will
be added only when a tag is actually published.

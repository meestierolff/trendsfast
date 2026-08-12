# 014 — First-party analytics and open metrics

Status: privacy-constrained ledger/purge exists; the expanded launch-event path
is work in progress. External analytics, public aggregates, and operational
privacy workflows remain gated.

## User problem

The founder needs to learn whether recommendations are useful and sustainable
without surveillance, fake metrics, or dependence on an external analytics tool.

## Scope

PostgreSQL event ledger, first/current-touch UTM/ref attribution, allowlisted
funnel/outcome events, optional DataFast adapter off by default, denominator-
backed open aggregates, tracked launch URLs.

## Non-goals

Session replay, behavioral profiling, private-content analytics, customer
dashboard zoo, or treating GitHub stars/signups as product success.

## Product contract

Measure submitted/delivered/useful/used/repeat outcomes, evidence validity,
provider cost, review time, `WAIT`, and estimated research time. Show “Not enough
verified data yet” before a disclosed minimum denominator.

## API contract

Server accepts an allowlisted event name/schema and derives sensitive IDs;
optional adapter receives only a privacy-filtered subset when enabled.

## Data model

Append event name/version/time, pseudonymous actor/session/project reference,
approved properties, ref/UTMs, first/current touch, and consent where required.

## Provider/legal constraints

Privacy/cookie review precedes external analytics. DataFast configuration does
not prove an active account or permission.

## Security considerations

Never send private scan URLs/tokens, emails, submitted URL query strings, keys,
evidence text, prompts/payloads, or free text. Retention/deletion applies.

## Tests written first

- Event allowlist/schema and rejection of extra/sensitive fields.
- First-touch immutability/current-touch update.
- DataFast disabled causes no external call.
- Privacy filter catches token/email/query/payload fixtures.
- Aggregate definitions/denominators/median and insufficient-data state.

## Implementation

Write first-party events transactionally near product effects; adapters are
best-effort and cannot block scans.

### Current implementation truth

The committed application writes allowlisted first-party events for accepted
scans, API requests, result views, feedback, used/repeat outcomes, and processing
states. The active development tree expands the fixed event vocabulary and adds
a bounded same-origin browser-event route, privacy-separated HMAC session
identity, dedupe keys, and durable admission. The historical database event name
`beta_waitlist_joined` may remain for compatibility while public copy says
founder launch list.

This work is not yet a completed analytics release or monitoring claim. The
optional analytics adapter remains disabled by default, and the public
open-metrics page must report insufficient data until a reproducible,
denominator-backed query is reviewed. No external cohort metric is claimed.

The database-enabled run for implementation candidate
`73297a6cfdc99b025990b001b39cef399f4d235e` passed 98 files/512 tests. The final
production-artifact browser run passed 58 checks with two intentional mobile
skips, including 24 desktop/mobile axe checks. This is local implementation
evidence only: final remote CI, deployment, scheduler operation, external
analytics, and real denominator-backed metrics remain unverified.

Exact-project deletion removes linked request, key, authentication, analytics,
and related cascaded records. `pnpm db:purge` removes eligible retained terminal
and nonterminal (`QUEUED`, `RUNNING`, and `REVIEW_REQUIRED`) scans, expired
delivery tokens, linked analytics, and eligible orphan projects. No
authenticated privacy-request route, export flow, retention scheduler/alerts,
backup-expiry proof, or legal-hold policy is implemented, so configuration and
the CLI must not be described as automatic retention enforcement.

## Verification

Inspect database events and outbound payloads in fixture/e2e tests; reconcile
published weekly metrics to a reproducible query.

## Limitations

Research time is self-reported/estimated and must be labeled; attribution is not
causality.

## Rollout

Ledger first, optional external adapter only after privacy approval.

## Rollback

Disable adapter, preserve lawful ledger records, correct metrics with an
append-only note rather than rewriting published history.

# Launch checklist

Every item starts unchecked. Link immutable evidence (release SHA, CI run,
redacted read-back, screenshot, or review record) before checking it. “Works on
my machine,” fixture success, and code presence are not production proof.

## Current integrated local evidence

Implementation candidate `73297a6cfdc99b025990b001b39cef399f4d235e`
has `LOCAL_PASS` evidence. Every production box below remains unchecked until
its own immutable remote or external evidence exists:

- PostgreSQL 16 replayed all 18 migration files through `0019`, with intentional
  `0009`/`0010` gaps and all hashes matched. The strict verifier matched 37/37
  public tables plus expected columns, enums, indexes, constraints, effective
  grants, and default ACL denial for `PUBLIC`, `anon`, and `authenticated`.
- The fixture seed completed twice and the disposable-database purge reported
  zero remaining eligible records and zero backlog.
  `RUN_DATABASE_INTEGRATION=1 pnpm test` completed 98 files/512 tests with no
  failures or skips.
- Typecheck, lint, Drizzle schema check, and the optimized webpack production
  build passed; webpack emitted 37 route/page entries. The standard Turbopack
  build hit a local sandbox port-binding `EPERM`; branch commit
  `4ec9510f610001285c54947326c65cb79a075f37` subsequently passed the verify/build
  and critical-browser jobs in [CI run 31585349262](https://github.com/meestierolff/trendsfast/actions/runs/31585349262).
- The final non-database run passed 78 files/455 tests with 20 files/57 tests
  skipped (512 tests total). The final production-artifact browser run passed 58
  checks with two intentional mobile skips, including 24 desktop/mobile axe
  checks. The local deployment verifier passed 26 routes plus two private
  unknown-capability `404` probes.
- Code-local founder review now supports audited evidence verification,
  immutable-action edit-and-approve, context correction, stored-evidence-only
  recomputation, and redacted JSON/Markdown bundle export.
- Public free scans have requester and database-atomic global count/cost
  admission. API creation/polling/auth-failure rates are separate. Audited,
  one-project, maximum-30-day design-partner grants remain usage/cost bounded
  and are not represented as Stripe subscriptions.
- Stripe subscription Checkout/webhook/claim/key/Portal code and deterministic
  tests exist using Stripe Node `^22.4.0` / API `2026-07-29.dahlia`, but no
  current catalog ID or application journey is recorded. The compromised
  sandbox credential must be rotated before any Stripe API verification.
- No TrendsFast Supabase project, Vercel project/deployment, commercial Vercel
  plan verification, DNS/TLS, production source/model read-back, hosted API,
  three-product dogfood result, monitoring run, or legal/tax approval exists.

This is `LOCAL_PASS` for the immutable implementation candidate, not production
proof. See the
[2026-08-12 local record](LOCAL_VERIFICATION_2026-08-12.md). Launch remains
blocked on every applicable external, operational, provider, Stripe, dogfood,
legal, and deployed-edge gate.

## Ownership and truth

- [ ] Founder approves the [product constitution](../PRODUCT_CONSTITUTION.md),
      ICP, claims, exclusions, and founder-review workload.
- [ ] Independent repository, fresh history, public remote ownership, license,
      trademark boundary, and third-party provenance are reviewed.
- [ ] README, `/sources`, `/open`, API docs, launch copy, and UI show the same
      source/billing/build truth; no fake logos, users, testimonials, results, or
      denominator-free metrics exist.
- [ ] Current legal/privacy/terms documents are founder/counsel approved; drafting
      templates are not deployed as approved policies.
- [ ] Reddit automation remains `LEGAL_REVIEW` and no automated Reddit path is
      present or described as authorized.

## Repository acceptance gates

- [ ] Clean Node 22 / pnpm 9 install succeeds with frozen lockfile.
- [ ] Fixture mode completes without paid/provider credentials or unexpected
      provider network calls.
- [ ] PostgreSQL 15+ migrations replay from zero and seed succeeds.
- [ ] `pnpm lint` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes, including provider contract tests.
- [ ] `pnpm build` passes with production-like environment validation.
- [ ] Critical `pnpm test:e2e` browser flows pass on desktop/mobile.
- [ ] Accessibility checks and reduced-motion/manual keyboard review pass.
- [ ] No P0 or P1 issue is open.

## Product integrity

- [ ] `PUBLISH`, `REPLY`, `REMIX`, and `WAIT` each satisfy their quality floor.
- [ ] `WAIT` passes with weak, dependent, stale, saturated, and inadequate
      coverage fixtures.
- [ ] Deterministic filtering precedes synthesis; weights/prompt/schema versions
      are stored.
- [ ] External measurement is rising-only and isolated to the candidate query;
      internal velocity requires increasing snapshots of the same signal.
- [ ] Model-assisted synthesis preserves the deterministic action and exact
      evidence-ID set; additions, drops, and duplicates are rejected.
- [ ] Every rendered evidence URL comes from a stored provider/manual record.
- [ ] Model-proposed URL, metric, and source claims are rejected.
- [ ] Source independence, disappeared evidence, partial failure, validity
      windows, limitations, and confidence are visible.
- [ ] No result is public before founder approval and explicit sharing consent.
- [ ] Feedback and “used/published” outcomes are auditable.

## Security and reliability

- [ ] SSRF tests cover private/loopback/link-local/metadata/reserved IPv4/IPv6,
      redirects, rebinding/pinned transport, ports, abort, size, type, and time
      limits; controlled-socket and target-network read-backs pass.
- [ ] Prompt-injection boundary tests use hostile site/provider fixtures.
- [ ] API keys use show-once secret, safe hash/pepper, constant-time verification,
      scopes, environment, restriction, rate/cost limits, revoke, and audit.
- [ ] PostgreSQL-backed pre-verification auth admission passes cross-instance
      API (12/fingerprint, 120/global per minute) and ops (5/fingerprint,
      100/global per five minutes) tests behind the deployed trusted proxy.
- [ ] API-key expiry/revocation rejection and audit pass; a reviewed issuance,
      rotation, and pepper/key-reissue procedure exists.
- [ ] API idempotency rejects reuse of a key with a conflicting canonical
      payload and passes concurrency tests.
- [ ] API cost admission locks the key, rechecks idempotency, counts each
      rolling-hour request as `max(reservation, summed committed run cost)`, and
      passes exact micro-USD boundary/race/crash-reservation tests.
- [ ] `/v1/openapi.json` matches all mounted validation, auth, error, and status
      responses at the release SHA.
- [ ] Public scan and private delivery capabilities each use 256 CSPRNG bits;
      delivery tokens are hashed/expire, errors are generic, and bearer
      retention/log/referrer controls pass.
- [ ] Public capability lookup routes have an independently verified deployed
      edge throttle; entropy alone is not treated as request-volume control.
- [ ] Browser mutations have secure cookies, origin/CSRF protection, and ops
      token/session tests; all mutation bodies reject actual streamed bytes over
      their cap even with missing/false `Content-Length`.
- [ ] Public count/duplicate/insert admission remains atomic under concurrent
      requests sharing a fingerprint, and replay attempts consume the durable
      daily cap.
- [ ] Ops login has explicit origin enforcement and durable admission; network
      restriction is verified until stronger identity exists.
- [ ] Request/provider/delivery idempotency and concurrent claim tests pass.
- [ ] Persisted hard deadlines, rotating processing fences, stale-worker
      rejection, bounded retry, timeout/abort, circuit breaker, duration, and
      cost ceilings pass.
- [ ] Interrupted `RUNNING` providers fail as `PROVIDER_OUTCOME_UNKNOWN` without
      automatic replay, even when the deadline is also expired; explicit
      non-fixture retry remains blocked until an operator can reconcile the
      upstream effect and charge.
- [ ] Model input/response/output/call caps and atomic conservative pre-call cost
      reservations pass. Provider-reported actual usage is settled and the dated
      operator price schedule is reviewed before any cost claim.
- [ ] Secret-pattern/log/browser-bundle checks find no credentials or private
      payloads.
- [ ] The Stripe test key exposed in local CLI output is revoked/rotated, and
      only redacted rotation evidence is retained.
- [ ] Exact-project deletion and `pnpm db:purge` (including eligible nonterminal
      scans, expired tokens, linked analytics, and orphan cleanup) are exercised
      against PostgreSQL; authenticated request intake, scheduling, alerts,
      backup expiry, legal holds, and completion audit are evidenced.
- [ ] Backup restoration and non-destructive rollback are rehearsed.
- [ ] Security threat-model review is signed; no claim calls it an external audit.

## Production source minimum

Each check needs the production read-back record described in
[provider setup](../providers/SETUP_CHECKLIST.md).

- [ ] Product website safe ingestion read-back passes.
- [ ] Google Trends through the accurately labeled DataForSEO surface passes.
- [ ] Hacker News through Algolia passes.
- [ ] At least one of xAI X Search or Tavily passes.
- [ ] Founder review, evidence binding, and `WAIT` pass in production.
- [ ] Callable manual-source entry and its rights/audit contract pass; its
      supplemental-only behavior and missing recompute/rebind path are disclosed.
- [ ] Missing providers display **Limited**, **Coming soon**, **Unavailable**, or
      **Permission required** publicly while exact technical states remain in
      operations; no “all social platforms” claim exists.
- [ ] GitHub and YouTube are verified or honestly deferred for the same v0.1
      week without blocking the minimum panel.

Until those boxes are checked, this repository is **at most fixture-scoped**.
Fixture verification has `LOCAL_PASS` evidence at
`73297a6cfdc99b025990b001b39cef399f4d235e` and green branch CI at
`4ec9510f610001285c54947326c65cb79a075f37`, but every external
source/deployment gate remains separate. It must not be
declared launch-ready.

## Infrastructure and operations

- [ ] Founder owns Vercel project, Supabase/PostgreSQL project, domain, provider
      accounts, GitHub repository, monitoring, and on-call contacts.
- [ ] Commercial Vercel plan/runtime limits are suitable for bounded execution.
- [ ] Production and preview databases/secrets are separate; browser variables
      contain no server secrets.
- [ ] Migrations run once from a controlled job using a direct database
      connection; connection pooling and capacity are reviewed.
- [ ] Paid monitoring remains disabled until the deployment verifies
      `lease >= scan deadline + 30s` and
      `scan deadline * sequential batch + 30s <= 300s` against the actual
      scheduler/function limits.
- [ ] Canonical HTTPS domain, redirects, cookies, CSP/security headers, DNS, and
      observability are verified from outside the founder's session.
- [ ] Alert paths cover scan backlog/failure, provider degradation, cost ceiling,
      auth abuse, evidence/takedown, deletion failure, and secret exposure.
- [ ] Operator runbook and incident exercise have named owners.

## Billing-disabled launch state

- [ ] `BILLING_ENABLED=false`, `PAID_MONITORING_ENABLED=false`, and
      `STRIPE_MODE=test` in every launch environment until the live gate passes.
- [ ] `FOUNDING_100_ENABLED=false` and `CLOUD_TRIAL_ENABLED=false`; no promotion,
      coupon, trial, or alternate plan is presented as a current offer.
- [ ] No active paid promise, live price, or dead checkout CTA appears.
- [ ] Test webhook/entitlement code, if present, cannot grant production access.
- [ ] [Live billing gate](../billing/LIVE_ENABLEMENT_GATE.md) remains separately
      blocked until explicit founder/legal/tax/security approval.

## Dogfood and distribution

- [ ] Authorized production-equivalent live API scans are completed, in order,
      for TrendsFast, Halio, and ShipToUsers; each has redacted JSON/Markdown
      review bundles, outputs differ materially, and generic repetition is a
      blocker.
- [ ] External review approves all three bundles with
      `DOGFOOD_EXTERNAL_REVIEW_APPROVED=YES`, and every correction is resolved
      before public production or live Checkout.
- [ ] Costs are measured from ledgers; unknowns remain unknown and fixtures are
      excluded from provider-cost claims.
- [ ] Every distribution asset is edited to replace placeholders with real,
      permissioned facts and tracked links.
- [ ] A public case study has explicit subject permission and a removal path.
- [ ] Weekly open metrics show window, definitions, denominators, and “not enough
      verified data yet” instead of invented zeroes.

## Go/no-go record

```text
Release SHA/tag:
CI evidence:
Production URL:
Database migration version:
Provider read-back records:
Security reviewer/date:
Legal reviewer/date and scope:
Founder go/no-go decision and timestamp:
Known limitations accepted:
Rollback owner:
```

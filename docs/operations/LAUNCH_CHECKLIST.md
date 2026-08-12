# Launch checklist

Every item starts unchecked. Link immutable evidence (release SHA, CI run,
redacted read-back, screenshot, or review record) before checking it. “Works on
my machine,” fixture success, and code presence are not production proof.

## Current integrated local evidence

The current working tree has a completed `LOCAL_PASS`, but it is not yet tied to
an immutable release SHA. The locally tested implementation baseline is
`a8b09b1`; the docs reconciliation is uncommitted and remote CI for that commit
is still pending:

- PostgreSQL 16 replayed all 15 migration files, `0000` through latest `0016`,
  with intentional `0009`/`0010` numbering gaps and all 15 migration hashes
  matched exactly. The strict hosted-schema verifier matched 34/34 public tables
  plus the exact expected enums, indexes, and constraints, including effective
  and default ACL denial for `PUBLIC`, `anon`, and `authenticated`.
- The fixture seed completed twice.
- `RUN_DATABASE_INTEGRATION=1` completed 85 test files and 449 tests with no
  failures. Workspace typecheck, lint, Drizzle schema check, and the final
  optimized webpack production build passed. The standard Turbopack build was
  locally blocked by sandbox port restrictions; current-tree remote CI remains
  pending.
- The actual `next start` production artifact completed 60 browser checks: 58
  passed and two mobile checks were intentionally skipped. Coverage included 24
  desktop/mobile axe checks and a complete API submit → `REVIEW_REQUIRED` →
  founder verify/approve/deliver → `READY` → idempotent replay/conflict journey.
- The local HTTP production-artifact verifier returned `ok: true` for 26 public
  route/status/content-type checks, security-header and secret-marker checks,
  private ops behavior, and two unknown-capability `404` privacy probes.
- A manual local curl matrix confirmed the dynamic/static cache boundaries,
  expected text/XML/RSS content types, private ops and unknown-scan behavior,
  unauthenticated API `401`, and `/api/sources`: every automated source and
  manual evidence remained **Coming soon**/`UNVERIFIED`; Reddit remained
  **Permission required**/`LEGAL_REVIEW`.
- Provider/model attempts reserve durably before I/O and settle valid
  provider-reported usage; missing usage stays conservative and unsettled.
  Public replay attempts consume the durable daily cap.
- The redacted Stripe test-mode verifier passed for product
  `prod_V3SAWlzw4po9Vw`, recurring `$39` price
  `price_1U3LGBDzHjCqsazv1xkoxKhA`, coupon
  `trendsfast_founding_100_12_months`, and disabled promotion
  `promo_1U3LHgDzHjCqsazvf4vgUGB9`. No application checkout/webhook/charge or
  live-mode journey was exercised. A test key exposed in local CLI output must
  be rotated; its value is intentionally omitted.
- No TrendsFast Supabase or Vercel project exists, and `trendsfast.com` was
  observed as `NXDOMAIN`.
- The real local product capture shows both the in-card example-data limitation
  and the visible “Product demo using example data” footer.

This proves a coherent local working tree only. It does not prove an immutable
release, final remote CI, deployment, live sources, a scheduler, Stripe test/live
application journeys, legal approval, or customer outcomes. Every box below
therefore remains unchecked.

Launch remains blocked on final remote CI, live provider/model read-backs,
external deployment, legal approval, billing/monitoring, manual privacy
scheduling/request operations, safe explicit retry after an uncertain provider
effect/charge, missing-usage/operator-price reconciliation, Stripe test-key
rotation, and the remaining P2 deployed-edge throttle for public capability
lookups.

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
Fixture behavior has current working-tree `LOCAL_PASS`, but lacks immutable
release-SHA CI and every external source/deployment gate. It must not be
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
- [ ] `FOUNDING_100_ENABLED=false` and `CLOUD_TRIAL_ENABLED=false`; neither the
      prepared promotion nor a later trial is presented as a current offer.
- [ ] No active paid promise, live price, or dead checkout CTA appears.
- [ ] Test webhook/entitlement code, if present, cannot grant production access.
- [ ] [Live billing gate](../billing/LIVE_ENABLEMENT_GATE.md) remains separately
      blocked until explicit founder/legal/tax/security approval.

## Dogfood and distribution

- [ ] Fixture and authorized live scans are run for all eight dogfood products;
      outputs differ materially and generic repetition is treated as a blocker.
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

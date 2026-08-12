# Integrated local verification record — 2026-08-12

Status: **`LOCAL_PASS` for the implementation candidate; launch blocked.** This
record describes immutable implementation commit
`73297a6cfdc99b025990b001b39cef399f4d235e`. Nothing in this local record proves
remote CI, a hosted deployment, provider/model read-back, a Stripe customer
journey, legal approval, or a customer outcome.

The repository started this work from
`21b13b8dff528f70a175a785da309ad38c67fd73`. Remote CI for the final branch
commit is pending, remains separate release evidence, and is not claimed by this
record.
Public package/OpenAPI versions remain prerelease; no `v0.1.0` tag or release is
authorized while these gates are open.

## Observed local results

| Area                           | Observed result                                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database replay                | A fresh disposable PostgreSQL 16 database applied all 18 migration files through `0019`; the `0009` and `0010` numbering gaps are intentional. All 18 applied hashes matched the repository ledger exactly.                                                                      |
| Strict schema/ACL verification | `STRICT_HOSTED_SCHEMA=1 pnpm db:verify-hosted` matched 37/37 public tables plus the expected columns, enums, indexes, constraints, effective grants, and default ACL denial for `PUBLIC`, `anon`, and `authenticated`. This was a local PostgreSQL check, not Supabase evidence. |
| Fixture seed and purge         | The deterministic fixture seed completed twice. The disposable-database purge completed with zero remaining eligible records and zero backlog, including zero expired founder launch-interest records.                                                                           |
| Database integration           | `RUN_DATABASE_INTEGRATION=1 pnpm test` completed 98 test files and 512 passing tests with no failures or skips.                                                                                                                                                                  |
| Unit suite                     | The final non-database run completed 78 passing files / 455 passing tests and 20 skipped files / 57 skipped tests (512 tests total), with no failures. Database-gated coverage ran in the full database suite above.                                                             |
| Static/schema checks           | Workspace typecheck, lint, Drizzle schema check, and the hosted-schema verifier passed for the implementation candidate.                                                                                                                                                         |
| Production build               | The optimized Next.js webpack production build passed and emitted 37 route/page entries. The default Turbopack build could not bind its compiler helper port in the local sandbox (`EPERM`); remote CI must run the standard build before release.                               |
| Browser suite                  | The final production-artifact run completed 58 passing Playwright checks and two intentional mobile skips, including 24 desktop/mobile axe checks, with no failures.                                                                                                             |
| Local deployment verifier      | The production artifact passed 26 route/status/content/security checks plus two private unknown-capability `404` probes. This was a local HTTP check, not an external deployment check.                                                                                          |

These results establish `LOCAL_PASS` for the immutable implementation candidate,
not remote CI, a hosted release, or production readiness. Every applicable
external, operational, billing, provider, dogfood, and legal gate remains open.

## Implemented code-local boundaries

- Founder review can verify/reject evidence, approve unchanged, convert to
  `WAIT`, edit and approve an immutable-action recommendation, correct context,
  and recompute deterministically from stored evidence. Context correction
  creates a new immutable version, marks the old proposal stale, records
  before/after/reviewer/version audit data, and requires renewed evidence review.
  Stored-only recomputation does not call a provider or model.
- Founder-only JSON and Markdown review bundles include bounded provenance,
  costs, evidence, scoring, proposal, and audit data while automated tests
  exclude credentials, delivery/API capabilities, customer e-mail, database
  URLs, raw IP addresses, and raw provider/model payloads.
- Public free-scan admission enforces one request per anonymous requester by
  default plus database-atomic UTC-day global defaults of 20 scans and a $5
  reserved/actual budget. Capacity exhaustion returns
  `TODAYS_FOUNDER_REVIEW_CAPACITY_REACHED` and presents the launch-interest form.
- API creation and polling use separate defaults of 20 and 300 requests per
  rolling hour; authentication failures default to 20 per fingerprint/hour.
  Polling does not consume an on-demand research allowance, `202` responses
  include `poll_after_seconds: 30`, and `429` responses include `Retry-After`.
- Founder operations can issue an audited, revocable, one-project
  `FOUNDER_GRANT` / `DESIGN_PARTNER` entitlement for at most 30 days. It is not
  represented as a Stripe subscription; usage and cost limits still apply.
- Managed and BYOK provider/model cost estimates are explicit server-side
  configuration. Managed mode fails closed when an applicable price or ceiling
  is absent; fixture cost is $0; provider-reported actuals are preferred and
  unknown actuals remain conservatively unsettled.
- The disabled-by-default Stripe implementation uses Stripe Node `^22.4.0` and
  API version `2026-07-29.dahlia`, hosted subscription Checkout, verified
  webhooks, a hashed one-time checkout claim, exactly-once project key issuance,
  and Stripe-hosted Portal access. Production rejects test-mode billing, and
  non-production rejects live mode.

## External status and blockers

- **Stripe:** no current catalog Product or Price ID is recorded. No Stripe API
  mutation was run because the previously used sandbox credential is treated as
  compromised. The founder must rotate it and reauthenticate the CLI before
  sandbox bootstrap/verification:
  `FOUNDER_ACTION_REQUIRED: rotate the compromised Stripe sandbox key and run stripe login`.
  Checkout, webhook, Portal, entitlement, cancellation, and live-mode journeys
  are unverified.
- **Supabase:** no TrendsFast Supabase project exists. No hosted migration,
  strict schema/ACL read-back, pooled runtime connection, concurrency check,
  backup policy, or restore rehearsal is verified. Founder action: create the
  project and securely provide separate preview/production `DATABASE_URL` and
  `DIRECT_DATABASE_URL` values.
- **Vercel:** no TrendsFast project or deployment exists, and the authenticated
  team `clarios-projects-05f6a57e` was observed on a Hobby plan. Founder action:
  upgrade that team to Pro. The exact preview/production deployment must then be
  verified before launch.
- **Domain:** `trendsfast.com` was observed as `NXDOMAIN`. No Vercel-assigned DNS
  record, TLS, apex/www redirect, canonical metadata, or hosted Stripe URL is
  verified.
- **Sources and model:** no production website, Hacker News, Google Trends,
  Tavily, xAI, GitHub, YouTube, or model read-back is recorded. Public labels
  must remain unverified/coming soon, and Reddit automation remains absent and
  permission-gated.
- **Dogfood/API:** no production-equivalent TrendsFast, Halio, or ShipToUsers
  dogfood scan, review bundle, measured real cost, or external dogfood approval
  exists. No hosted live API call is verified.
- **Monitoring/legal/operations:** no deployed scheduler, paid monitoring run,
  alerting exercise, privacy-request workflow, backup restore, external security
  review, or legal/tax/refund/terms approval is recorded.

## Release carry-forward

Preserve implementation candidate
`73297a6cfdc99b025990b001b39cef399f4d235e` as the local evidence baseline and
attach green remote CI for the final branch commit. Then repeat the applicable
database, source, API, Stripe, monitoring, domain, and security checks against
the exact hosted release. Keep every corresponding launch-checklist item
unchecked until its own immutable or external evidence is linked.

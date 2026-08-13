# Integrated local verification record — 2026-08-12

Status: **`LOCAL_PASS` for the implementation candidate; launch blocked.** This
record describes immutable implementation commit
`73297a6cfdc99b025990b001b39cef399f4d235e`. Nothing in these local commands proves
a hosted deployment, provider/model read-back, a Stripe customer
journey, legal approval, or a customer outcome.

This is a historical baseline. The later working tree contains 23 migration
files through `0024` (with intentional `0009`/`0010` gaps), 44-table
expectations, scoped runtime roles, Supabase Auth/project claims, and retention
scheduling; none of the `0019`/37-table/full-suite results below are evidence
for those changes. A separate
[2026-08-13 mutable-tree record](LOCAL_VERIFICATION_2026-08-13.md) captures newer
local checks without changing or upgrading this immutable historical evidence.

The repository started this work from
`21b13b8dff528f70a175a785da309ad38c67fd73`. Separate remote evidence is now
attached: branch commit `4ec9510f610001285c54947326c65cb79a075f37`
passed the verify/build and critical-browser jobs in
[CI run 31585349262](https://github.com/meestierolff/trendsfast/actions/runs/31585349262).
Public package/OpenAPI versions remain prerelease; no `v0.1.0` tag or release is
authorized while these gates are open.

## Observed local results

| Area                           | Observed result                                                                                                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database replay                | A fresh disposable PostgreSQL 16 database applied all 18 migration files through `0019`; the `0009` and `0010` numbering gaps are intentional. All 18 applied hashes matched the repository ledger exactly.                                                                              |
| Strict schema/ACL verification | `STRICT_HOSTED_SCHEMA=1 pnpm db:verify-hosted` matched 37/37 public tables plus the expected columns, enums, indexes, constraints, effective grants, and default ACL denial for `PUBLIC`, `anon`, and `authenticated`. This was a local PostgreSQL check, not Supabase evidence.         |
| Fixture seed and purge         | The deterministic fixture seed completed twice. The disposable-database purge completed with zero remaining eligible records and zero backlog, including zero expired founder launch-interest records.                                                                                   |
| Database integration           | `RUN_DATABASE_INTEGRATION=1 pnpm test` completed 98 test files and 512 passing tests with no failures or skips.                                                                                                                                                                          |
| Unit suite                     | The final non-database run completed 78 passing files / 455 passing tests and 20 skipped files / 57 skipped tests (512 tests total), with no failures. Database-gated coverage ran in the full database suite above.                                                                     |
| Static/schema checks           | Workspace typecheck, lint, Drizzle schema check, and the hosted-schema verifier passed for the implementation candidate.                                                                                                                                                                 |
| Production build               | The optimized Next.js webpack production build passed and emitted 37 route/page entries. The default Turbopack build could not bind its compiler helper port in the local sandbox (`EPERM`); CI run 31585349262 subsequently passed the standard verify/build and critical-browser jobs. |
| Browser suite                  | The final production-artifact run completed 58 passing Playwright checks and two intentional mobile skips, including 24 desktop/mobile axe checks, with no failures.                                                                                                                     |
| Local deployment verifier      | The production artifact passed 26 route/status/content/security checks plus two private unknown-capability `404` probes. This was a local HTTP check, not an external deployment check.                                                                                                  |

These results establish `LOCAL_PASS` for the immutable implementation candidate,
not a hosted release or production readiness. The separate exact branch CI run
linked above is green; every applicable
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
- Public free-scan admission enforces the operator's private requester,
  database-atomic global, and spend policy. Capacity exhaustion returns
  `TODAYS_FOUNDER_REVIEW_CAPACITY_REACHED` and presents the launch-interest form.
- API creation, polling, and authentication failures use separately configured
  private limits.
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
- **Supabase:** isolated Free preview project `auxienkuufejeakaczlq` exists in
  `eu-central-1` on PostgreSQL 17.6. SSL enforcement and CA-verified TLS 1.3 to
  its transaction pooler were read back. No hosted migration, seed, strict
  schema/runtime-role read-back, backup, or restore rehearsal is verified. Its
  direct endpoint is IPv6-only and unreachable from this runner; a direct-capable
  runner is required. Production still requires a founder-approved Pro project.
- **Vercel:** protected-dogfood project
  `prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC` exists on authenticated Hobby team
  `Finnie` (`team_UVAUfp4G8CmlSNPI9w5FasKj`), with effects disabled. No deployment, alias,
  custom domain, or active cron exists. Founder action: upgrade the team to Pro
  before commercial production and then verify the exact reviewed deployment.
- **Domain:** founder ownership of registered `trendsfast.com` at Spaceship is
  recorded. No Vercel-assigned DNS record, public-resolution read-back, TLS,
  apex/www redirect, canonical deployment, or hosted Stripe URL is verified.
- **Sources and model:** no production website, Hacker News, Google Trends,
  Tavily, xAI, GitHub, YouTube, or model read-back is recorded. Public labels
  must remain unverified/coming soon, and Reddit automation remains absent and
  permission-gated.
- **Dogfood/API:** no production-equivalent Halio or ShipToUsers
  dogfood scan, review bundle, measured real cost, or external dogfood approval
  exists. No hosted live API call is verified.
- **Monitoring/legal/operations:** no deployed scheduler, paid monitoring run,
  alerting exercise, privacy-request workflow, backup restore, external security
  review, or legal/tax/refund/terms approval is recorded.

## Release carry-forward

Preserve implementation candidate
`73297a6cfdc99b025990b001b39cef399f4d235e` as the local evidence baseline and
CI run 31585349262 as its remote branch evidence. Then repeat the applicable
database, source, API, Stripe, monitoring, domain, and security checks against
the exact hosted release. Keep every corresponding launch-checklist item
unchecked until its own immutable or external evidence is linked.

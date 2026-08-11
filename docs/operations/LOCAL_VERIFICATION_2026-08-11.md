# Integrated local verification record — 2026-08-11, refreshed 2026-08-12

Status: **`LOCAL_PASS` for the current working tree.** This evidence is not yet
tied to an immutable final commit. It is not final remote CI, an external
deployment, a live provider/model read-back, an application Stripe
Checkout/Portal/webhook/charge/entitlement journey, or legal approval.

The locally tested implementation baseline is commit `a8b09b1`. The docs
reconciliation remains uncommitted, and remote CI for `a8b09b1` is not claimed.

A Stripe test-mode catalog was created idempotently and reverified separately;
the exact safe identifiers are recorded below. That narrower external fact is
not a Checkout, webhook, charge, entitlement, deployment, or live-mode journey.

Launch status: **blocked**. Public/live checkout and paid monitoring remain
disabled. Scheduler operation, deployed infrastructure/DNS, live sources,
provider permission, customer outcomes, and every approval named in the launch
checklist remain unverified. A test key exposed in local Stripe CLI output must
also be rotated before further Stripe work; its value is intentionally omitted.

## Integrated results

| Area                        | Observed local result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database replay             | Isolated PostgreSQL 16 applied all 15 migration files from `0000` through latest `0016`; the missing `0009` and `0010` numbers are intentional. All 15 applied migration hashes matched the repository ledger exactly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Hosted-schema verifier      | The repository's strict hosted-schema verifier matched 34/34 public tables plus the exact expected enums, indexes, and constraints. It also verified effective and default ACL denial for `PUBLIC`, `anon`, and `authenticated`. This ran against the isolated database, not a hosted provider.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Fixture seed                | The deterministic fixture seed completed twice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Full suite                  | `RUN_DATABASE_INTEGRATION=1` completed 85 test files and 449 passing tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Static/schema checks        | Workspace typecheck, lint, Drizzle schema check, and Prettier documentation checks passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Production build            | The final optimized webpack production build passed. The standard Turbopack build was locally blocked by sandbox port restrictions; current-tree remote CI remains pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Production-artifact browser | The actual `next start` artifact ran 60 checks: 58 passed and two mobile checks were intentionally skipped. Coverage included 24 desktop/mobile axe checks and a complete API submit → `REVIEW_REQUIRED` → founder verify/approve/deliver → `READY` → idempotent replay/conflict journey.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Local HTTP verifier         | The verifier returned `ok: true` across 26 public routes and their expected status/content types; CSP, no-sniff, frame denial, the HSTS condition, and absence of secret markers passed. Ops responses were private/no-store/noindex. Two unknown scan-capability probes returned `404` with private no-store/noindex behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Manual local HTTP exercise  | Against the exact `next start` artifact, `/`, `/sources`, `/agents`, `/channels`, `/pricing`, `/blog`, `/news`, `/docs`, and `/open-source` returned `200`; dynamic `/` and `/sources` were private/no-store while static marketing pages were cacheable. `/api/sources` returned `200` JSON private/no-store. `/robots.txt`, `/sitemap.xml`, `/llms.txt`, and both RSS routes returned the expected text/XML/RSS content types. `/ops` returned `200` private/no-store/noindex; unknown `/scan/does-not-exist` returned private `404`; unauthenticated `/v1/next-move/nonexistent` returned `401` JSON no-store. The source payload kept Website, X, Google Trends, Hacker News, GitHub, Tavily/Open web, YouTube, and Manual evidence at `Coming soon`/`UNVERIFIED`, and Reddit at `Permission required`/`LEGAL_REVIEW`. |
| Durable spend/admission     | Provider and model attempts reserve before I/O and settle valid provider-reported usage; missing usage remains conservative and unsettled. Public replay attempts consume the durable daily cap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Stripe test catalog         | The redacted verifier passed for product `prod_V3SAWlzw4po9Vw`, recurring `$39` price `price_1U3LGBDzHjCqsazv1xkoxKhA`, 50%-for-12-months/max-100 coupon `trendsfast_founding_100_12_months`, and disabled promotion `promo_1U3LHgDzHjCqsazvf4vgUGB9`. Public exposure remains forbidden while `$19` versus `$19.50` is unresolved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Product proof capture       | [`docs/assets/trendsfast-next-move-example.png`](../assets/trendsfast-next-move-example.png) is a real local production-artifact capture. The card visibly says “Example data does not represent current source coverage or customer traction,” and the footer says “Product demo using example data.”                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

The browser and HTTP checks exercised a locally served production artifact.
They are stronger than a development-server screenshot but still do not prove a
Vercel deployment, independent-network behavior, DNS/TLS, a deployed proxy or
edge throttle, or production alerting.

The aggregate test count demonstrates one coherent local tree. It does not, by
itself, check off every provider, billing, legal, privacy, accessibility, or
operational item. Route-specific and external gates remain independently
evidenced requirements.

## Current external and operational gaps

- Final remote CI for the current tree and an immutable release SHA are pending.
- No TrendsFast Supabase or Vercel project exists, and `trendsfast.com` was
  observed as `NXDOMAIN`. No external deployment, DNS/TLS,
  independent-network header check, deployed trusted-proxy boundary, or
  public-capability edge throttle is verified.
- No live website/provider/model read-back, provider permission, or measured
  non-fixture provider/model cost is recorded.
- Public/live checkout and paid monitoring remain disabled. The Stripe
  test-mode catalog and redacted verifier above are the only external Stripe
  evidence. No application Checkout/Portal journey, real webhook delivery,
  deployed scheduler run, live catalog, charge, or entitlement test is claimed.
- Rotate the Stripe test key exposed in local CLI output and record only
  redacted rotation evidence before further Stripe work.
- The monitoring configuration fails closed unless its lease and sequential
  batch fit the documented 300-second route budget, but no scheduler is deployed
  or observed.
- No authenticated privacy-request intake, scheduled purge/alert, export,
  backup-expiry proof, or legal-hold workflow is verified.
- Explicit non-fixture retry after an uncertain provider effect or charge still
  requires operator reconciliation.
- Valid provider-reported model usage is settled when supplied; missing usage
  remains conservative and unsettled. The operator-supplied price schedule has
  not been independently verified against a provider invoice or console.
- Manual keyboard/screen-reader review, backup/restore rehearsal, incident
  exercise, and external security/legal/tax/privacy/provider-rights approval
  remain open.
- No real dogfood/customer outcome, public case study, traction, or
  denominator-backed open metric is claimed.

## Release carry-forward

Freeze the final commit, rerun the complete local matrix, attach the remote CI
and artifact links, and record environment/reviewer identities without secrets.
Repeat database and HTTP verification against the intended deployment. Keep
every launch-checklist item unchecked until its immutable or external evidence
exists.

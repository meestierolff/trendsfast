# 013 — Stripe readiness

Status: test-mode billing, founder usage, and paid-monitoring implementation is
in progress; billing and paid monitoring remain disabled. A Stripe test catalog
and its redacted verifier exist, but no application checkout/webhook/entitlement
journey or live-mode flow has been externally verified.

## User problem

Future recurring monitoring needs a simple entitlement without making the
open-source engine dependent on payment infrastructure.

## Scope

Target scope: one test product/price, founder-authorized Checkout/Portal,
signed/idempotent webhooks, Customer Portal, conservative local subscription
projection, `founder_cloud`, durable plan usage, one bounded daily monitoring
claim, disabled state, and deterministic/integration tests.

## Non-goals

Live charges, credits/tokens, multiple plans, usage billing, another billing
provider, tax/legal automation, or a paid promise before operations work.

## Product contract

Future hypothesis: Founder at $39/month for one monitored product, one scheduled
research run per day, ten on-demand refreshes per billing month, up to one new
delivered Next Move per day, a project-scoped API key, unlimited agents/clients
using that key, result polling that does not consume a research run, 30-day
history, and managed provider accounts. Next Moves are delivered only when the
quality floor passes; scheduled `WAIT` results are valid and included. An
accepted on-demand request consumes one refresh regardless of its outcome. This
is not an active offer, and “unlimited” never describes scan creation. When
disabled, there is no checkout call or dead paid CTA.

## API contract

Authenticated server creates allowlisted sessions; browser cannot choose price,
customer, entitlement, or redirect. Webhook verifies raw-body signature and
deduplicates event ID.

## Data model

Store Stripe customer/subscription IDs, local account mapping, status/period/
cancel fields, processed event IDs, and entitlement projection—no card details.

## Provider/legal constraints

Founder owns Stripe and must approve VAT/tax, invoicing, refunds, cancellation,
renewal, consumer rights, privacy, terms, and live catalog.

## Security considerations

Test/live separation, secret redaction, webhook signatures, idempotency,
out-of-order events, tenant authorization, server-derived catalog.

## Tests written first

All tests listed in `docs/billing/STRIPE_SETUP.md`, especially disabled state,
signature/replay/order, cross-tenant, and entitlement revocation.

## Implementation

Keep Stripe behind `packages/billing` and `BILLING_ENABLED=false`; follow the
test setup without creating live resources automatically.

### Current implementation truth

The active development tree contains fail-closed work for founder-authorized
test Checkout/Portal routes, a bounded raw-body webhook route, Stripe event
normalization and idempotent PostgreSQL projection, founder-plan usage records,
current-period entitlement checks, durable duplicate-Checkout guards, and a
secret-protected bounded monitoring cron. Availability requires both
`BILLING_ENABLED=true` and `PAID_MONITORING_ENABLED=true`.

Paid-monitoring configuration also rejects a lease shorter than the scan
deadline plus 30 seconds, or a worst-case sequential batch where
`MAX_SCAN_DURATION_SECONDS * MONITORING_CRON_BATCH_SIZE + 30 > 300`. The default
`240 * 1 + 30` fits. This fail-closed arithmetic is not evidence that scheduling
has been deployed or that a production run completes in time.

The integrated local working tree passed its clean 15-file migration replay
through `0016` with all 15 hashes matched, strict 34/34-table and ACL
verification, full database-enabled 449-test suite, typecheck, lint, Drizzle
check, final optimized webpack production build, and 60-check browser suite as
recorded in the
[launch checklist](../operations/LAUNCH_CHECKLIST.md). That is `LOCAL_PASS`, not
release evidence. The Stripe test verifier passed for product
`prod_V3SAWlzw4po9Vw`, price `price_1U3LGBDzHjCqsazv1xkoxKhA`, coupon
`trendsfast_founding_100_12_months`, and disabled promotion
`promo_1U3LHgDzHjCqsazvf4vgUGB9`. A test key exposed in local CLI output must be
rotated and is intentionally not recorded. No immutable final SHA/remote CI,
external webhook delivery, application Checkout/Portal journey, deployed
scheduled run, live charge, or paid customer journey is claimed.

## Verification

Keep deterministic fixtures/test clock and Stripe test mode only, then require
explicit live-gate approval. The verified test catalog does not replace an
application-level Checkout/Portal/webhook/entitlement journey or any
deployed/live verification.

## Limitations

Pricing is a hypothesis; tax/legal/support behavior is unresolved until reviewed.

## Rollout

Free founder scans first. Test partners only after the free path and all test
gates pass.

## Rollback

Disable new Checkout without deleting subscriptions/events; reconcile through
signed provider state.

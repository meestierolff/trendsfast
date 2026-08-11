# 013 — Stripe readiness

Status: deferred until free scan is launch-ready; billing disabled.

## User problem

Future recurring monitoring needs a simple entitlement without making the alpha
or open-source engine dependent on payment infrastructure.

## Scope

Target scope: one test product/price, Checkout, success/cancel,
signed/idempotent webhooks, Customer Portal, conservative local subscription
projection, `founder_cloud`, disabled state, and deterministic tests.

## Non-goals

Live charges, credits/tokens, multiple plans, usage billing, another billing
provider, tax/legal automation, or a paid promise before operations work.

## Product contract

Future hypothesis: Founder Cloud Beta at $39/month for one monitored product.
When disabled, there is no checkout call or dead paid CTA.

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

`packages/billing` currently contains a disabled/test-mode availability gate,
conservative entitlement projection, and an internal Stripe client wrapper for
Checkout, Portal, and signature parsing. The web application exposes no billing
route, success/cancel page, webhook handler, customer authorization flow, or
event-to-database projection. Only the disabled state and basic entitlement
projection have deterministic tests. Therefore no test Checkout or webhook
journey is claimed.

## Verification

Deterministic fixtures/test clock and Stripe test mode only, then explicit live
gate approval. No current live verification is claimed.

## Limitations

Pricing is a hypothesis; tax/legal/support behavior is unresolved until reviewed.

## Rollout

Free alpha first. Test partners only after the free path and all test gates pass.

## Rollback

Disable new Checkout without deleting subscriptions/events; reconcile through
signed provider state.

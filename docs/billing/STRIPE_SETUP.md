# Stripe test-mode setup

> **Status: billing and paid monitoring are disabled.** Test-mode implementation
> is in progress. This guide does not authorize live charges or represent an
> active offer.

The active development tree contains fail-closed Checkout/Portal, signed webhook
projection, founder usage, and monitoring work. The integrated local migration,
test, build, and browser results are recorded in the
[launch checklist](../operations/LAUNCH_CHECKLIST.md), but they are not tied to
an immutable release SHA and do not include a deployed scheduled or application
Checkout/webhook/entitlement journey. A redacted Stripe test-mode catalog
verifier has passed; that narrower evidence is recorded below.

The only permitted billing provider is Stripe. Do not add RevenueCat, Paddle,
Lemon Squeezy, Polar, or a separate entitlement abstraction.

## Intended catalog

- Product: `TrendsFast Founder`
- Recurring hypothesis: `$39 USD / month`
- Verified test product: `prod_V3SAWlzw4po9Vw`
- Verified test recurring price: `price_1U3LGBDzHjCqsazv1xkoxKhA`
- Verified test coupon: `trendsfast_founding_100_12_months`
- Verified disabled test promotion: `promo_1U3LHgDzHjCqsazvf4vgUGB9`
- Internal entitlement: `founder_cloud`
- Quantity: one project / monitored product
- Lookup key: `trendsfast_founder_monthly`
- Limits: one scheduled research run/day, ten accepted on-demand
  refreshes/billing month, up to one new delivered Next Move/day, a
  project-scoped API key, unlimited agents/clients on that key, result polling
  that does not consume a research run, 30-day history, and managed provider
  accounts

Scheduled `WAIT` results are valid and included. An accepted on-demand request
consumes one refresh regardless of its outcome. “Unlimited” never describes
scan creation, projects, provider fan-out, or model usage.

The disabled Founding 100 test setup is 50% off for 12 months with at most 100
redemptions: `$19.50/month` on the `$39` price. The product brief also contains
`$19/month` language. That discrepancy is an unresolved founder catalog/copy
decision; do not round, change, or expose either amount until it is resolved and
the disabled catalog is deliberately updated. This is preparation, not a public
offer.

The amount and terms require founder/legal/tax review before they appear as an
active offer. Price IDs and amounts must be resolved server-side; never trust a
browser-supplied product, price, customer, or entitlement.

The test bootstrap ran idempotently and the test verifier passed for the safe
identifiers above. The coupon is 50% for 12 months with at most 100 redemptions,
which is `$19.50` against `$39`; the separate `$19` brief language remains an
unresolved founder decision. Both `FOUNDING_100_ENABLED` and
`CLOUD_TRIAL_ENABLED` remain false, so neither amount is public. A local Stripe
test key appeared in CLI output and must be revoked/rotated before further
Stripe work. Never copy its value into this document, an issue, or a log.

## Test-mode account steps

The founder must complete or reverify these in the correct Stripe test
workspace. The catalog bootstrap/verifier has run, but the remaining account and
application journey gates are still open:

1. Confirm account ownership, team access, MFA, statement descriptor, business
   details, and test-mode separation.
2. Revoke/rotate the test key exposed in local CLI output and retain only
   redacted evidence of the rotation.
3. Before rerunning `pnpm stripe:bootstrap-test`, review the script and current
   Stripe CLI account. It idempotently creates/verifies the test product, monthly
   price, coupon, and inactive promotion. Record only safe IDs; put any runtime
   price configuration in the deployment secret store, not browser code.
4. Rerun `pnpm stripe:verify-test` after rotation and retain its redacted output.
5. **After** the application webhook route and projection pass locally,
   configure a test webhook endpoint. Subscribe only to
   events that implementation actually handles, normally:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, and
   relevant invoice payment outcomes.
6. Configure Customer Portal cancellation/update behavior to match the reviewed
   terms. Do not expose unsupported plan switching.
7. Use Stripe CLI forwarding or deterministic signed fixtures locally. Never
   commit CLI webhook secrets.

## Environment

```env
BILLING_ENABLED=false
PAID_MONITORING_ENABLED=false
FOUNDING_100_ENABLED=false
CLOUD_TRIAL_ENABLED=false
STRIPE_MODE=test
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_FOUNDER_CLOUD_PRICE_ID=
CRON_SECRET=
```

Keep all four feature flags false during setup. Checkout is available only when
the billing and paid-monitoring flags are both true and the remaining
configuration is valid. The prepared promotion and later no-card trial remain
separately disabled. Public pricing CTAs must remain the paid launch list while
disabled—no dead checkout button.

## Server-side flow

Target contract; implementation must still pass the complete release matrix:

1. Authenticate/authorize the project owner before creating Checkout or Portal
   sessions.
2. Select the allowlisted server-side price and include a stable internal
   account/project reference in Stripe metadata.
3. Reuse or create the server-mapped Stripe customer; never accept a customer ID
   from the browser.
4. Use idempotency keys for Stripe mutations.
5. Redirect only to allowlisted canonical success/cancel URLs.
6. Verify every webhook from the unmodified raw body before parsing.
7. Insert the Stripe event ID under a unique constraint before applying it.
8. Project subscription state locally and compute entitlements server-side.
9. Treat browser success pages as informational; webhooks are authoritative.
10. Portal sessions are short-lived and created only after authorization.

Do not store card details. Store only provider IDs, status, relevant periods,
cancellation flags, price mapping, entitlement projection, and audit times.

## Tests required before review

- Billing-disabled UI/API has no checkout call or broken CTA.
- Test secret and price ID cannot run under `STRIPE_MODE=live`, and vice versa.
- Checkout/portal creation rejects unauthenticated and cross-account requests.
- Browser-supplied price/customer/return URL is ignored or rejected.
- Valid webhook verifies; bad, missing, replayed, or wrong-secret signature fails.
- Duplicate/out-of-order events converge idempotently.
- Active/trialing/past-due/canceled/incomplete states project conservatively.
- Entitlement activates only for a paid current subscription period; stale or
  mismatched invoice periods fail closed.
- Concurrent duplicate Checkout creation converges to one durable open
  reservation or an explicit reconciliation error before another provider call.
- Cancellation and renewal boundaries match reviewed terms.
- Logs and analytics contain no secret, raw signature, or payment details.
- Deterministic fixtures or a Stripe test clock cover renewal and cancellation.

The completed integrated local run is evidence for the working tree, and the
redacted catalog verifier is evidence only for the four Stripe test resources
listed above. Keep the route-specific matrix open until the final release SHA,
post-rotation verifier, signed endpoint delivery, Checkout/Portal/entitlement
journey, scheduled run, and end-to-end result are attached. Do not infer an item
from file presence, catalog presence, or the aggregate test count alone.

## Verification evidence

Record test account/workspace identifier (non-secret), build SHA, product/price
IDs (safe identifiers only if policy allows), webhook events, fixture/test-clock
scenario, test result, and reviewer. A successful test-mode flow is still not
live enablement. Continue with [LIVE_ENABLEMENT_GATE.md](LIVE_ENABLEMENT_GATE.md).

`scripts/stripe/bootstrap-live.sh` must never run automatically. It requires the
explicit `I_UNDERSTAND_LIVE_STRIPE=YES` acknowledgement and every live gate.

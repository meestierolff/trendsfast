# Stripe test-mode setup

> **Status: billing is disabled.** This guide prepares a test integration; it
> does not authorize live charges or represent an active offer.

The repository currently has only an internal Stripe wrapper and conservative
entitlement helper. It has no application Checkout, Portal, success/cancel, or
webhook route and no webhook-to-database projection. The steps below are a
future integration procedure, not instructions for connecting the current app.

The only permitted billing provider is Stripe. Do not add RevenueCat, Paddle,
Lemon Squeezy, Polar, or a separate entitlement abstraction.

## Intended catalog

- Product: `TrendsFast Founder Cloud Beta`
- Recurring hypothesis: `$39 USD / month`
- Internal entitlement: `founder_cloud`
- Quantity: one monitored product

The amount and terms require founder/legal/tax review before they appear as an
active offer. Price IDs and amounts must be resolved server-side; never trust a
browser-supplied product, price, customer, or entitlement.

## Test-mode account steps

The founder must complete these in the correct Stripe test workspace:

1. Confirm account ownership, team access, MFA, statement descriptor, business
   details, and test-mode separation.
2. Create exactly one test product and one recurring monthly test price matching
   the catalog above. Record the resulting price ID in the deployment secret
   store, not source control.
3. **After** an authenticated application webhook route and projection are
   implemented and tested, configure a test webhook endpoint. Subscribe only to
   events that implementation actually handles, normally:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, and
   relevant invoice payment outcomes.
4. Configure Customer Portal cancellation/update behavior to match the reviewed
   terms. Do not expose unsupported plan switching.
5. Use Stripe CLI forwarding or deterministic signed fixtures locally. Never
   commit CLI webhook secrets.

## Environment

```env
BILLING_ENABLED=false
STRIPE_MODE=test
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_FOUNDER_CLOUD_PRICE_ID=
```

Keep `BILLING_ENABLED=false` during setup. Config validation must fail closed if
billing is enabled with test/live mismatch, missing secrets, or an invalid
catalog. Public pricing CTAs must be informational or absent when disabled—no
dead checkout button.

## Server-side flow

Target contract; not yet exposed by the application:

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
- Cancellation and renewal boundaries match reviewed terms.
- Logs and analytics contain no secret, raw signature, or payment details.
- Deterministic fixtures or a Stripe test clock cover renewal and cancellation.

Current test coverage proves only that disabled billing exposes no checkout
availability and that `active`/`trialing` project the internal
`founder_cloud` entitlement. Every other item above is unchecked.

## Verification evidence

Record test account/workspace identifier (non-secret), build SHA, product/price
IDs (safe identifiers only if policy allows), webhook events, fixture/test-clock
scenario, test result, and reviewer. A successful test-mode flow is still not
live enablement. Continue with [LIVE_ENABLEMENT_GATE.md](LIVE_ENABLEMENT_GATE.md).

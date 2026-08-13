# Stripe sandbox-to-live setup

> **Fail-closed status:** billing and paid monitoring remain disabled. The previously used sandbox
> credential is compromised until the founder confirms revocation and rotation. Do not use it for
> verification or API calls.

The only supported billing provider is Stripe. TrendsFast uses Stripe Billing, hosted Checkout
Sessions, one recurring Price, signed webhooks, and Stripe Customer Portal. Redirects never grant
entitlement, and TrendsFast does not store card data.

The code-local integration uses Stripe Node `^22.4.0` with explicit API version
`2026-07-29.dahlia`. No current sandbox/live Product ID or Price ID is recorded, and no Stripe API
mutation or application customer journey was run on 2026-08-12 because credential rotation is a
hard prerequisite.

## Catalog

- Product: `TrendsFast Founder`
- Price: `€39 EUR / month`
- Lookup key: `trendsfast_founder_monthly_eur`
- Tax behavior: `exclusive` (tax collection remains disabled until registrations are approved)
- Internal entitlement: `founder_cloud`
- Quantity/project limit: one
- Scheduled runs: one per UTC day
- Accepted on-demand runs: ten per billing period
- Newly delivered Next Moves: at most one per UTC day
- API: project-scoped read/write access; Checkout issues one initial key, while
  owner-created keys share the same project allowance; polling does not consume
  research allowance
- History: 30 days

Promotion codes, coupons, trials, and alternate plans are disabled. Prices and limits remain
server-authoritative.

## Environment

```env
BILLING_ENABLED=false
PAID_MONITORING_ENABLED=false
FOUNDING_100_ENABLED=false
CLOUD_TRIAL_ENABLED=false
STRIPE_MODE=test
STRIPE_SANDBOX_KEY_ROTATED=
I_UNDERSTAND_LIVE_STRIPE=
STRIPE_LIVE_CATALOG_APPROVED=
STRIPE_LIVE_ENABLEMENT_APPROVED=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_FOUNDER_CLOUD_PRICE_ID=
STRIPE_PORTAL_LOGIN_URL=
API_PROVIDER_COST_LIMIT_USD_PER_HOUR=
CRON_SECRET=
```

`STRIPE_SECRET_KEY`, webhook secret, and the API provider-cost budget are server-only. The Customer
Portal URL must be the Stripe-hosted no-code login URL at
`https://billing.stripe.com/p/login/...`; arbitrary customer IDs are never accepted from a public
route.

## Sandbox operator sequence

1. In Stripe Dashboard, revoke the exposed sandbox key, create a replacement with the least
   permissions needed, remove the old CLI login, and run `stripe login` for the intended sandbox
   account.
2. Set `STRIPE_SANDBOX_KEY_ROTATED=YES` only after confirming that rotation. Every sandbox helper
   exits before identity/API access without this exact acknowledgement.
3. Run `stripe --version` locally. The expected reviewed CLI version is `1.45.2` or a compatible
   newer stable version.
4. Run `pnpm stripe:bootstrap-sandbox`. It checks account identity without printing it, searches by
   stable catalog metadata, creates or reuses exactly one Product and Price with idempotency keys,
   and prints safe IDs only.
5. Run `pnpm stripe:verify-sandbox` and store only redacted evidence.
6. Set `STRIPE_WEBHOOK_SECRET_FILE` to a new file in an existing secure directory outside the
   repository, then run `pnpm stripe:test-webhook`. One listener both forwards supported events and
   supplies the captured signing secret; terminal output is redacted. Move the value into the local
   secret store and delete the temporary file when no longer needed.
7. Complete the entire sandbox journey: successful Checkout, duplicate and out-of-order events,
   wrong mode/Price, failed invoice, cancellation, success replay, missing/expired claim, duplicate
   Checkout, exactly-once key issuance, entitlement loss, monitoring pause, and Portal login.

The listener forwards only:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

CLI forwarding is local verification, never a deployed webhook configuration. Preview and
production each need their own registered endpoint and signing secret.

## Customer Portal

Activate Stripe’s no-code Portal login and enable only reviewed functionality: payment-method
updates, invoice history, subscription status, and cancellation. Do not expose unsupported plan
switching. Customer-facing users authenticate through Stripe’s e-mailed login link. Founder
operations may create a Portal Session only for the Stripe customer already bound to the authorized
project.

## Tax and terms

Do not enable `automatic_tax`, collect tax, or claim tax readiness until the founder and tax adviser
confirm registrations and the founder approves VAT/sales-tax treatment, invoices, refunds,
cancellation, renewal, consumer rights, privacy, and terms. Stripe Tax configuration cannot decide
whether TrendsFast is legally registered where required.

## Live catalog and runtime gates

`pnpm stripe:bootstrap-live` and `pnpm stripe:verify-live` require both exact acknowledgements:

```env
I_UNDERSTAND_LIVE_STRIPE=YES
STRIPE_LIVE_CATALOG_APPROVED=YES
```

They can create/verify only the live Product and Price and stop before Checkout or a charge.
`STRIPE_LIVE_ENABLEMENT_APPROVED=YES` is a separate runtime acknowledgement and does not authorize
catalog mutation. Application configuration separately rejects live billing unless production mode
and both runtime acknowledgements are present; it also rejects test-mode billing in production and live mode outside
production. Sandbox Checkout is additionally fixture-only and can issue only a `tf_test_` key;
managed/BYOK provider modes keep it closed, so test cards can never authorize paid upstream calls.
Live production Checkout requires a non-fixture provider mode and is the only path that can issue a
`tf_live_` key. Keep runtime billing flags false until sandbox/deployed webhook,
dogfood review, legal/refund/tax, monitoring, and controlled-payment gates have passed.

## Verification evidence

Record only the account/workspace identifier, environment, release SHA, safe Product/Price IDs,
webhook event IDs, redacted fixture/test-clock scenario, result, timestamp, and reviewer. Never
record secret keys, webhook secrets, raw Checkout claims, customer e-mail, private delivery tokens,
or raw API keys. A passing catalog verifier is narrower than an application-level
Checkout/webhook/entitlement/Portal journey and is never evidence of live enablement.

# 013 — Delivered-result Stripe conversion

Status: code-local implementation and deterministic tests are present. Billing and paid
monitoring remain disabled; the previously exposed sandbox credential must be revoked and replaced
before any Stripe CLI/API verification. No live Stripe resource, charge, or customer journey is
claimed by this document.

## User problem

A founder who has already received a useful private result can buy one bounded monitoring plan,
receive one project-scoped API key, and manage billing through Stripe without creating a general
TrendsFast customer dashboard.

## Product contract

The single launch catalog entry is `TrendsFast Founder` at `$39 USD/month`: one monitored product,
one scheduled run per UTC day, ten accepted on-demand runs per billing period, at most one newly
delivered Next Move per UTC day, read/write Next Move API access, polling outside research
allowances, and 30-day history. No coupon, promotion code, trial, alternate plan, or “unlimited
scans” claim is enabled.

The exact delivered-result CTA is `Monitor this product — $39/month`. It is rendered only when
both billing and paid monitoring are enabled; live mode additionally requires both explicit live
acknowledgements.

## Authoritative Stripe choices

The implementation follows the installed repository skills:

- `.agents/skills/stripe-best-practices/SKILL.md` and its billing, payments, security, and tax
  references;
- `.agents/skills/stripe-docs/SKILL.md`;
- `.agents/skills/upgrade-stripe/SKILL.md`.

Stripe Node is pinned compatibly to `^22.4.0`, with API version
`2026-07-29.dahlia`. Subscriptions use Stripe Billing and hosted Checkout Sessions with Prices,
not Plans or hand-built recurring PaymentIntents. Payment methods are left to Stripe Dashboard
configuration. `automatic_tax` remains off until the founder and tax adviser confirm every
required registration; code readiness is not tax approval.

## Checkout ownership and recovery

Checkout starts only from an active, unexpired private delivery capability and resolves its exact
local project. TrendsFast generates a random 256-bit claim, stores only its SHA-256 hash on the
unique checkout reservation, and sets the raw capability in a Secure, HttpOnly, SameSite=Lax
cookie. The private result token is never sent to Stripe.

The Stripe request uses one allowlisted recurring Price, quantity one, `mode=subscription`, a
non-secret project client reference, stable project/reservation/plan metadata, and a stable
idempotency key. Its integration identifier has the required random eight-letter installation
suffix. Neither `payment_method_types` nor automatic tax is forced in code.

The claim remains usable for a bounded 30-minute webhook/redirect grace after the Stripe Session
expires, while the complete claim lifetime stays within 24 hours. Checkout fails before a Stripe
mutation unless the verified delivery capability covers that full window. An unbound local
reservation is deliberately recoverable. A retry presents the same claim cookie,
searches Stripe by the non-secret reservation metadata, binds an already-created remote Session,
and therefore does not create a duplicate after an unknown provider effect or local bind failure.
The cancel URL contains no result token. The no-store/no-referrer cancel page returns through local
browser history to the private result without disclosing the capability to Stripe or a referrer.

## Webhook authority and one-time key

The success redirect never grants access or calls the checkout “paid.” It binds the returned
Session ID to the hashed local claim and waits until signed, raw-body webhooks project an active
subscription and paid invoice for the exact current period and allowlisted Price.

Only then can one transaction insert the project-scoped live key, append its redacted management
audit, and consume/bind the claim. The raw key is returned once and never stored or e-mailed.
Refresh, replay, concurrent issuance, or transaction failure cannot create a second durable key.
The claim cookie is cleared after successful issuance and in the already-consumed terminal state,
but retained while webhook projection is still recoverable.

The key has read/write Next Move scopes, one project, the paid create limit, the explicitly
configured `API_PROVIDER_COST_LIMIT_USD_PER_HOUR`, and an expiry at the authoritative entitlement
period end. A signed active and
paid renewal extends only that claim-issued key. A terminal subscription end revokes only that key
with a management audit. A temporary invoice failure makes entitlement inactive without
irreversibly revoking a key that may recover. Founder-grant or unrelated keys are never selected by
this lifecycle.

## Customer Portal

Founder operations can create a short-lived Portal Session only after founder authentication and
only for the Stripe customer already bound to the authorized local project. The customer-facing
path is Stripe’s hosted no-code Portal login URL, configured server-side and validated to the
`https://billing.stripe.com/p/login/...` origin/path. There is no unauthenticated local endpoint
that accepts a customer ID.

## Operator scripts and safety gates

The supported commands are:

```text
pnpm stripe:bootstrap-sandbox
pnpm stripe:verify-sandbox
pnpm stripe:test-webhook
pnpm stripe:bootstrap-live
pnpm stripe:verify-live
```

All sandbox helpers fail before identity or API access unless
`STRIPE_SANDBOX_KEY_ROTATED=YES`. They use the non-secret `stripe whoami --format json` identity
check without printing its response. Catalog bootstrap uses stable metadata, lookup key, and
idempotency keys; it creates or reuses only Product and Price and prints only safe resource IDs.

The webhook helper starts one CLI listener. A streaming redaction filter captures that same
listener’s signing secret into a new mode-0600 file outside the repository and redacts it from
terminal output. It never assumes a secret from a different listener invocation.

Live bootstrap and verification additionally require both
`I_UNDERSTAND_LIVE_STRIPE=YES` and `STRIPE_LIVE_ENABLEMENT_APPROVED=YES`. Catalog bootstrap stops
without creating a Checkout or charge. Runtime live Checkout remains a separate gated decision.

## Verification

Unit coverage includes SDK/API request shape, live fail-closed behavior, token-bound claim cookies,
unknown-effect Checkout recovery, success replay, cookie clearing, and operator-script gates. A
real-PostgreSQL test injects failure between key insertion and claim binding, then checks rollback,
concurrent refresh, renewal extension, temporary payment failure, terminal revocation, and audits.

External verification remains blocked until the sandbox key is rotated. After rotation, the
sandbox matrix must cover hosted Checkout, signed duplicate/out-of-order events, wrong price/mode,
failed invoice, cancellation, one-time issuance/replay, monitoring pause, and both Portal identity
paths. Production webhooks require a separately configured endpoint and secret; CLI forwarding is
never production configuration.

## Rollout and rollback

Keep `BILLING_ENABLED=false` and `PAID_MONITORING_ENABLED=false` until the sandbox journey,
deployed webhooks, customer Portal, legal/refund terms, and tax-registration review all pass. Roll
back by disabling new Checkout while retaining subscriptions, webhook receipts, entitlements, and
audits for reconciliation.

# Stripe live enablement gate

> **FOUNDER AND QUALIFIED LEGAL/TAX REVIEW REQUIRED.** All boxes are unchecked by
> default. Codex, CI, and a passing test integration cannot authorize charges.

Live billing remains disabled until the founder explicitly approves the exact
deployment, catalog, policies, and rollback after reviewing this evidence.
The current application does not expose Checkout, Portal, success/cancel, or a
webhook route, so this gate cannot yet advance beyond design review.

## Product and customer promise

- [ ] Founder approves product name, `$39/month` price, currency, interval,
      included monitored product, checks, history, API access, support, and what
      “daily” means operationally.
- [ ] Product can actually provide every paid promise; `WAIT`, provider outages,
      review delays, limits, and beta status are disclosed.
- [ ] Checkout, success, cancel, portal, downgrade/cancel, failed payment, and
      deletion journeys have been manually verified in a production-like test.
- [ ] No credit/token/provider-unit or guaranteed-volume language appears.

## Legal, tax, and policy

- [ ] Qualified review approves entity/legal name, address, jurisdiction,
      governing law, contact, privacy notice, terms, acceptable use, provider
      disclosures, subprocessors, retention/deletion, and data roles.
- [ ] VAT/sales-tax registration, calculation, evidence, invoicing, and remittance
      responsibilities are decided for every launch geography.
- [ ] Refund, cancellation, renewal, cooling-off/consumer rights, trial, and
      failed-payment policies are configured and match checkout copy.
- [ ] Stripe business verification, prohibited-business, sanctions, and account
      requirements are complete.
- [ ] The templates under `docs/legal/` have been replaced with approved public
      policies; placeholders and warnings are absent from the deployed pages.

## Security and operations

- [ ] Production secrets are in the correct scoped secret manager and differ
      from test; MFA and least-privilege team access are enabled.
- [ ] Exact canonical webhook URL and raw-body signature verification pass in
      production with a harmless test event.
- [ ] Event-ID idempotency, out-of-order convergence, entitlement revocation,
      retry/dead-letter inspection, and alerts pass.
- [ ] Database backup/restore, incident response, support/refund escalation, and
      Stripe outage behavior have named owners.
- [ ] No P0/P1 security issue is open; focused auth/webhook/tenant review is
      complete.

## Evidence and observability

- [ ] Test-mode matrix in `STRIPE_SETUP.md` passes at the release SHA.
- [ ] Production configuration validation proves `STRIPE_MODE=live`; test keys
      and test price IDs are rejected.
- [ ] First-party events exclude payment details and secrets.
- [ ] Dashboards/alerts cover checkout errors, webhook signature failures,
      backlog, projection lag, entitlement conflicts, and refund/support cases.
- [ ] Rollback has been rehearsed: set `BILLING_ENABLED=false` to stop new
      checkout without deleting customers or subscriptions.

## Approval record

Complete outside source control if it contains sensitive identifiers, then link
the redacted evidence in the release record:

```text
Release SHA:
Production environment:
Founder approver and timestamp:
Legal reviewer and scope/date:
Tax reviewer and scope/date:
Security/operations reviewer and timestamp:
Stripe account/catalog evidence:
Rollback owner:
Known limitations accepted:
```

## Enablement

Only after approval, set reviewed production secrets, deploy with
`STRIPE_MODE=live`, perform the harmless signed webhook health check, and then
set `BILLING_ENABLED=true` through a controlled deployment. Monitor the first
checkout and entitlement projection. Do not create a live product, price, or
charge automatically from CI.

If any evidence becomes stale or an incident occurs, disable new checkout first
and preserve provider/audit state for reconciliation.

# Commercial boundary

TrendsFast is an honest open-source decision engine, not a public copy of the
hosted operator's accounts or business records. A self-hoster can run the real
bounded research, ranking, `WAIT`, synthesis, founder-review, and API workflow
with fixture data or credentials they control.

## What this repository contains

- Customer-facing plan and usage limits, API schemas, quality floors, provider
  interfaces, admission algorithms, and the PostgreSQL cost ledger.
- Fixture mode, which needs no provider prices and makes no paid provider calls.
- Stripe sandbox Checkout is confined to fixture mode and issues only test-scoped API keys; a test
  payment can never unlock managed or BYOK provider effects.
- Managed and BYOK configuration contracts. No live mode silently invents an
  upstream price or a total provider-cost ceiling.
- BYOK configuration requires the self-hoster's own current prices and ceilings.
  The repository deliberately ships no dollar samples.

## What cloud operations add

The hosted service adds operator-controlled credentials, deployment and abuse
controls, database capacity, founder review, incident response, provider/legal
approvals, monitoring, and commercial billing. Managed mode requires explicit
positive provider/model prices, a per-scan ceiling, and a rolling-hour API-key
provider-cost limit. Provider-reported actual cost replaces estimates when
known; unknown actual cost stays conservatively reserved.

Free hosted scans are bounded by private requester, global-admission, and spend
policy. Exact requester+URL replays consume the requester allowance but reuse
existing work and do not reserve global cost twice. When a boundary is full the
service returns `TODAYS_FOUNDER_REVIEW_CAPACITY_REACHED` and displays the
launch-interest form.

## What stays private

Managed production credentials, provider invoices and negotiated prices,
production margins and internal budgets, production cost-ledger records,
shared historical signals, customer/outcome data, and internal alerts or
incident records do not belong in this repository or `.env.example`. Local
operators keep them under ignored, permission-restricted `.var/private/` state.

The AGPL license is the repository's current license. License compliance,
provider terms, privacy duties, and any hosted commercial use require qualified
legal review; this document is not legal advice.

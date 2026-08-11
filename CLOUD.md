# TrendsFast Cloud model

TrendsFast Cloud is the planned managed counterpart to the same open-source
engine. This document describes a product model, not a currently verified
service or availability promise.

## Operator-owned upstream accounts

In managed mode, the TrendsFast operator owns and pays for provider accounts.
Customers should receive one TrendsFast API key; they should not need xAI,
DataForSEO, Tavily, Google, or GitHub credentials. Managed keys remain
server-side, are separated by environment, and are never returned to tenants.

## Managed value

Cloud differentiation may include scheduling, provider maintenance, bounded
retries and fallbacks, shared historical snapshots and baselines, cost controls,
operations, uptime, deletion workflows, and support. The recommendation engine
and contracts remain in the public repository.

Cloud does not promise virality, customers, revenue, guaranteed content volume,
or a daily recommendation. `WAIT` remains a valid result.

## Alpha offer

The intended public alpha is one free founder-reviewed scan with no card and no
account required before value. No auto-posting is offered.

The future hypothesis—behind `BILLING_ENABLED=false`—is **Founder Cloud Beta**,
`$39/month`, one monitored product, daily checks, quality-gated Next Moves, API
access, and 30-day history. It is not an active offer until every item in the
[live enablement gate](docs/billing/LIVE_ENABLEMENT_GATE.md) is approved.

## Data responsibilities

The operator must publish accurate privacy/terms documents, subprocessor and
retention information, deletion/export paths, incident contacts, geographic
scope, and controller/processor roles before accepting real customer data.
Alpha legal templates in `docs/legal/` require founder and legal review.

## Status

No deployment, upstream production read-back, live billing, SLA, support level,
or customer availability is asserted by this repository. The repository has a
working local fixture path and managed/BYOK adapter code, but neither is evidence
that a TrendsFast Cloud environment exists or that an external provider is
healthy there.

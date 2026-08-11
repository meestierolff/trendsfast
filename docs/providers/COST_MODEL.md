# Provider cost model

The default hard ceiling is:

```env
MAX_PROVIDER_COST_USD_PER_SCAN=0.25
```

This is a product hypothesis and safety limit, not a claim about current
provider pricing or measured scans. Pricing and quota schedules are external,
mutable facts; the account owner must record the schedule used for each release.

## Ledger contract

The provider ledger contract records:

- scan, source run, provider, operation, and environment;
- attempt number and provider request ID when safe;
- started/completed time and duration;
- requested/result item counts;
- billable units (requests, credits, quota, tokens, or provider-specific units);
- estimated/reserved cost before the call and actual cost after it when known;
- currency, pricing-version/effective-date reference, and calculation method;
- cache/fixture flag, status, and failure class.

Do not write credentials, full payloads, private URLs, or personal content to
the cost ledger. “Free tier” is not the same as zero economic cost; record quota
units and keep actual cost explicitly unknown when it cannot be known.

For synthesis, the current implementation requires explicit non-fixture input
and output prices per million tokens. It computes a conservative pre-call upper
bound from input bytes, an allowance, and the configured maximum output tokens,
then atomically reserves that amount under a unique ledger key. A duplicate
reservation refuses another model call. The entry is labeled
`conservative_pre_call_reservation` with `unknown_not_settled`; actual provider
token usage and cost are not yet reconciled. The current model ledger keeps its
actual-cost numeric field at `$0` alongside that unknown status; the zero is not
a verified free/actual call. The operator-supplied price schedule is also not
independently trusted.

## Admission control

Before each external step:

```text
remaining = scan_ceiling - sum(actual_cost or reserved_estimate)
admit only when operation_worst_case_estimate <= remaining
```

Reserve worst-case cost atomically before the call. Reconcile to actual cost
when known; synthesis does not yet perform that reconciliation. A classified
in-attempt provider retry consumes its own bounded cost path, and the model has
at most one repair covered by its conservative reservation. When remaining
budget is inadequate, skip the source with `COST_CEILING` and evaluate whether
disclosed partial coverage can still return a valid move; otherwise return
`WAIT` or fail safely.

Automatic recovery does not replay a provider left `RUNNING`: it records
`PROVIDER_OUTCOME_UNKNOWN` and stops. The explicit ops action can still retry a
whole failed scan. Until the operator can determine whether the uncertain
upstream effect or charge occurred, enabling that manual retry for non-fixture
work can duplicate cost and remains a launch blocker.

Tenant/API-key ceilings and provider account ceilings may be lower than the
global scan ceiling. The strictest applicable limit wins.

## API-key rolling-hour admission

Authenticated creation has a separate atomic admission boundary. While holding
the API-key row lock, PostgreSQL rechecks the idempotency key, gathers requests
and runs from the preceding hour, and counts each logical request once as:

```text
max(persisted request reservation, sum(run max(estimated cost, actual cost)))
```

It then adds the proposed request reservation and compares the result with the
key ceiling in integer micro-USD units. Exact repeats are reused without another
reservation; conflicting repeats fail; parallel first requests cannot each
spend the same remainder. Fixture creation reserves `$0`; non-fixture creation
reserves `MAX_PROVIDER_COST_USD_PER_SCAN`. The reservation intentionally remains
for the full rolling hour if a crash prevents later run cost, favoring temporary
false rejection over unbounded spend. The generic request-creation repository
rejects API-origin callers so they cannot bypass this transaction.

## Bounded launch policy

| Provider            | Per-scan work cap                       | Billable unit to record             |
| ------------------- | --------------------------------------- | ----------------------------------- |
| Product website     | redirect, byte, and time caps           | fetches/egress estimate             |
| xAI X Search        | 1–2 tool calls                          | tool calls plus input/output tokens |
| DataForSEO          | one bounded task, max five keywords     | task/API units and billed amount    |
| Hacker News Algolia | max five queries, 30 stored items       | requests (cost may be unknown/zero) |
| GitHub              | max three query groups, 20 stored items | REST/GraphQL rate units             |
| Tavily              | max two searches                        | credits and billed amount           |
| YouTube             | max two searches plus batched stats     | quota units                         |
| Synthesis model     | one call plus one repair maximum        | input/output/cache tokens           |

No adapter may fan out recursively. Cache use must retain provenance and
freshness; it is not permission to violate provider retention terms.

## Reporting

Internal dashboards should distinguish provider estimate, actual/unknown,
conservative model reservation, unsettled model usage, retries, and unverified
price metadata. Weekly public metrics may show median provider cost only when
denominator, currency, included providers, time window, fixture exclusion, and
unknown-cost handling are disclosed. Conservative model reservations must not be
published as invoice-equivalent actual cost.

No actual dogfood or production provider cost has been measured or claimed in
this repository snapshot.

# 003 — Google Trends through DataForSEO

Status: intended `LIVE` only after a recorded production read-back; currently
unverified by repository documentation.

## User problem

Founders need a genuine first-scan demand time series, not “trending” inferred
from one popular item.

## Scope

At most five product-specific keywords, on-demand live mode, 7/30-day direction,
regional interest, related rising queries, normalized series, cost/provenance.

## Non-goals

Keyword mega-lists, SEO rank tracking, silent use of a different proprietary
Trends product, or invented velocity.

## Product contract

A genuine multi-point series may yield `MEASURED_EXTERNAL_SERIES` only when its
last point is later and higher than its first point for the candidate's query.
Flat, declining, or unrelated series do not. Label the exact upstream surface;
use `DATAFORSEO_TRENDS` if it is not Google Trends.

## API contract

Adapter accepts a bounded query plan/market/language/time window and returns
canonical signals/series, provider metadata, cost, quota, status, and limitation.

## Data model

Store source run, query/version, series points, related queries, observed time,
provenance/request ID where safe, cost ledger, and failure class.

## Provider/legal constraints

Founder owns/funds credentials and must review current DataForSEO rights,
Google-derived labeling, storage, display, attribution, and commercial terms.

## Security considerations

Server-only basic credentials, redacted logs, bounded response, schema validation,
timeouts, retries, circuit breaker, and no query content in optional analytics.

## Tests written first

- Fixture contract and exact label selection.
- Five-keyword cap and provider-mode validation.
- Valid/partial/malformed/empty/rate-limited responses.
- Rising real series accepted; flat/declining/unrelated and model-derived
  velocity rejected.
- Estimate/reservation/actual cost and ceiling exhaustion.

## Implementation

Keep translation inside the provider adapter and preserve provider/source
provenance through evidence binding.

## Verification

Fixture suite, then one bounded dev and one production read-back recorded under
the provider checklist. Verify actual cost and original API surface.

## Limitations

Interest is normalized demand, not sales or absolute search volume; regions and
low-volume terms can be sparse.

## Rollout

Expose as `UNVERIFIED` until read-back; then enable gradually under the scan cap.

## Rollback

Disable adapter, mark degraded, and require corroborated evidence or `WAIT`.

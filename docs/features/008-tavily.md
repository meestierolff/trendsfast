# 008 — Tavily open web/news evidence

Status: intended `BETA`; currently `BETA_UNVERIFIED`.

## User problem

Founders need recent launch/news/competitor triggers and independent supporting
context beyond platform feeds.

## Scope

Basic search by default, at most two searches per scan, raw results, original
URLs/publication metadata, credits/cost, and canonical normalization.

## Non-goals

Generated-answer-as-evidence, broad crawling, paywall bypass, publisher archive,
or unbounded follow-up search.

## Product contract

Web/news may corroborate why now but each result must support the move itself.
Copied coverage from one origin is one evidence lineage.

## API contract

Adapter accepts two bounded role-specific queries and returns canonical results,
provenance, credits/cost, and explicit empty/degraded status.

## Data model

Store canonical URL, title/minimal excerpt, publisher/publication and observation
times, query/request metadata, source lineage, and cost ledger.

## Provider/legal constraints

Founder owns/funds Tavily and reviews search retention/display/commercial terms;
publisher copyright and site terms still apply to returned pages.

## Security considerations

Server-only key; validate result URLs and sizes; treat excerpts as hostile; do
not automatically fetch links outside the guarded website boundary.

## Tests written first

- Two-search cap and raw-result mode.
- Canonical URL/dedup/source-lineage handling.
- Missing publication date, malformed URL, timeout/rate limit, partial results.
- Credits/cost reservation and ceiling.
- Generated answer cannot become receipt.

## Implementation

Normalize raw results without recursive retrieval and preserve publisher/source
identity for evidence independence.

## Verification

Fixture/contract tests, then bounded dev and production read-back with canonical
URL and actual credits/cost.

## Limitations

Search indexes may be stale or incomplete; snippets may not support the full
publisher article.

## Rollout

Small beta cohort with manual evidence review.

## Rollback

Disable adapter, mark degraded, and invalidate unsupported clusters.

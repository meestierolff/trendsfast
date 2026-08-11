# 006 — X Search through xAI

Status: intended `BETA`; currently `BETA_UNVERIFIED`.

## User problem

Founders need current narratives, terminology, and high-value reply opportunities
without an unbounded social agent.

## Scope

One or two xAI X Search tool invocations, 72-hour default lookback, explicit
query plan, at most 20 stored candidates, original URLs/metadata, token/tool cost.

## Non-goals

Firehose access, account OAuth, posting, following, full-content archive,
influencer CRM, or treating a model summary as evidence.

## Product contract

One exceptional item may support `REPLY`; `PUBLISH` needs corroboration. X stays
visibly beta with freshness, coverage, and source limitations.

## API contract

Adapter receives only bounded queries/tool cap and returns canonical stored
records, usage/cost/provenance, and explicit failure/partial status.

## Data model

Store canonical post/source ID/URL, minimal returned text and metadata,
published/observed times, query/tool request provenance, and cost ledger.

## Provider/legal constraints

Founder owns/funds xAI account and must confirm current xAI/X commercial use,
display, attribution, caching, deletion, and downstream model terms.

## Security considerations

Server-only key; source content is prompt-hostile. Hard tool/token/result caps,
no model-generated receipts, schema/URL validation, timeouts, redaction.

## Tests written first

- Tool-call and stored-result caps.
- Lookback/query-plan validation and original URL binding.
- Model summary cannot become evidence.
- Malformed tool output, missing URL, timeout/rate limit, and cost ceiling.
- Dependent reposts do not count as independent corroboration.

## Implementation

Separate search acquisition from synthesis even when the same vendor/model is
used. Persist provider records before downstream model work.

## Verification

Fixture/contract suite plus bounded dev and production read-back with usage/cost
and canonical X URL. No record means no status upgrade.

## Limitations

Search coverage and ranking are provider-dependent; 72 hours may miss slower
narratives and returned metadata may change.

## Rollout

Enable beta for a small reviewed cohort under strict spend and failure alerts.

## Rollback

Disable X calls, revoke key if needed, mark degraded, and rely on another
verified source or `WAIT`.

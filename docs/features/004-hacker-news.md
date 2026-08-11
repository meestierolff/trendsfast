# 004 — Hacker News evidence

Status: intended `LIVE` after production read-back; currently unverified.

## User problem

Technical founders need current developer pain, objections, launch narratives,
and early-adopter discussion with original receipts.

## Scope

Algolia HN search, at most five seven-day queries and 30 stored candidates,
including IDs, authors, dates, points/comments, titles/excerpts, and URLs.

## Non-goals

Full HN archive, user profiling, comment crawling without bounds, sentiment
dashboard, or cross-platform raw engagement comparison.

## Product contract

One exceptional current item may support `REPLY`; `PUBLISH` still needs
independent evidence and the normal quality floor.

## API contract

Provider input is a role-specific bounded query plan. Output is canonical
signals, usage/status/provenance, and explicit empty/degraded outcome.

## Data model

Store HN object ID as source ID, canonical URL, minimal content/metadata,
observed/published times, metrics snapshot, query, source run, and cost/quota.

## Provider/legal constraints

Review current Algolia/HN usage and story/comment copyright/attribution. Original
URLs and authorship stay visible; excerpts remain minimal.

## Security considerations

Treat titles/comments as hostile prompt data; validate URLs/schema/size, encode
output, bound time/retry, and redact provider diagnostics.

## Tests written first

- Query/result caps and seven-day default.
- Canonical item/story URL mapping and missing fields.
- Dedupe of multiple queries returning one object.
- Malformed/rate-limit/timeout/empty responses.
- One item never misclassified as measured velocity.

## Implementation

Normalize in one adapter and snapshot metrics without comparing raw HN values to
other platforms.

## Verification

Pass fixture/contract tests and record a target-environment production read-back
with an original HN URL before status changes.

## Limitations

HN represents a narrow technical community; points/comments are context, not a
universal demand measure.

## Rollout

Start bounded and inspect relevance/duplication in founder review.

## Rollback

Disable adapter and mark degraded; retain receipts already delivered with their
observed time.

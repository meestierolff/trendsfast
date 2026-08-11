# 009 — YouTube public video evidence

Status: intended `BETA`; currently `BETA_UNVERIFIED`.

## User problem

Founders need topic traction and working formats outside text feeds, normalized
for video age and audience relevance.

## Scope

Public `search.list`, batched `videos.list`, at most two searches/20 videos,
titles/hooks/metadata, view/comment statistics, language/region, quota accounting.

## Non-goals

Customer OAuth, uploads, transcripts, full comment crawl, downloads, or direct
comparison of raw video views with other platforms.

## Product contract

YouTube may support a product-specific `REMIX` without copying; format evidence
must include age/context and original video URL.

## API contract

Adapter accepts bounded query/language/region and returns canonical video
signals, batched public stats, provenance/quota, and degraded status.

## Data model

Store video ID/URL, minimal title/channel metadata, publish/observe times,
statistics snapshot, query/source run, and quota units.

## Provider/legal constraints

Founder configures a restricted server API key and reviews current YouTube API
Services terms, attribution, storage/refresh, deletion, quota, and privacy.

## Security considerations

Key never reaches browser; treat titles/descriptions as hostile; validate
IDs/URLs/schema and cap pagination/body/time.

## Tests written first

- Two-search/20-result cap and batched stats.
- Search result missing from videos response.
- Age-normalized inputs and no cross-platform raw comparison.
- Quota reservation, exhaustion, timeout/rate limit, malformed response.
- No transcript/comment/OAuth operation exists.

## Implementation

Keep acquisition read-only and record quota independently of known monetary cost.

## Verification

Fixture/contract tests and bounded target-production read-back with canonical
video URL and quota units.

## Limitations

Views/comments are noisy and may update; no retention beyond approved provider
rules and no performance causality claim.

## Rollout

Beta after terms/read-back; refresh stored metrics only within policy.

## Rollback

Disable/revoke key, mark degraded, and keep historical receipts qualified by
observation time.

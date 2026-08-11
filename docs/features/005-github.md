# 005 — GitHub public metadata evidence

Status: intended `LIVE` after production read-back; currently unverified.

## User problem

Developer-tool founders need releases, repository activity, issues, and ecosystem
adoption signals tied to original GitHub pages.

## Scope

Official API, at most three query groups and 20 candidates, read-only public
repository/release/issue metadata, optional authenticated token.

## Non-goals

Private repositories, code ingestion, write operations, contribution automation,
or star-velocity claims from a single snapshot.

## Product contract

GitHub evidence supports developer relevance and adoption.
`MEASURED_INTERNAL_VELOCITY` requires at least two time-separated snapshots of
the same canonical signal and an increasing metric.

## API contract

Adapter accepts bounded repo/entity/query groups and returns canonical signals,
rate/quota state, provenance, and graceful unauthenticated degradation.

## Data model

Store stable repository/release/issue source ID, canonical URL, allowed public
metadata, observed/published time, metric snapshots, query, and rate units.

## Provider/legal constraints

Review current GitHub API terms, acceptable use, privacy, repository/content
licenses, caching, and attribution. A token is server-only and read-only.

## Security considerations

Never fetch/execute repository code. Treat names/descriptions/issues as hostile
text. Validate pagination/caps, redact token and rate headers as needed.

## Tests written first

- Authenticated and unauthenticated fixture contracts.
- Query/result/pagination caps and canonical URL mapping.
- Rate-limit, deleted/renamed repo, malformed response, and partial failure.
- First snapshot cannot produce star velocity; second valid snapshot can.
- No write scope/call exists.

## Implementation

Use the official public API boundary, batch where possible, and snapshot only
metrics allowed by the provider/retention policy.

## Verification

Run without a token, with a dev read-only token if needed, and a bounded
production read-back. Record rate units and canonical URL.

## Limitations

Stars are not customers; public activity can be gamed and varies by project.

## Rollout

Keep optional and degrade gracefully until production verified.

## Rollback

Revoke token/disable adapter, mark degraded, and suppress unsupported velocity.

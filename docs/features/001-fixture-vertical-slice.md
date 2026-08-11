# 001 — Fixture vertical slice

Status: implemented; integrated database/suite/build/browser/HTTP verification
passed on the current local working tree. Final release-SHA CI and
external/manual acceptance remain required. Passing fixtures prove local
behavior only.

## User problem

Contributors need to experience and test the whole product without paid accounts
or a fake UI-only mock.

## Scope

URL submission, context, provider-shaped fixtures, canonical signals, clustering,
quality gate, one proposed move, founder review, private delivery, and feedback.

## Non-goals

Live connectivity, provider permission, production deployment, result-quality
claims, posting, scheduling, and billing.

## Product contract

Fixture mode follows real contracts and returns one of `PUBLISH`, `REPLY`,
`REMIX`, or `WAIT`. Public surfaces label it **Product demo** / **example data**;
engineering records retain the exact `FIXTURE` state. It includes limitations,
provenance, review state, and `auto_publish=false`.

## API contract

Fixture requests use the same validated request/status/ready schemas and
idempotency behavior as other modes. No reusable key is exposed by the public
form.

## Data model

Persist requests, project/context version, scan/source runs, signals, snapshots,
clusters/members, opportunity, move, evidence, review, delivery, feedback, cost,
and analytics records. Fixtures are explicitly flagged.

## Provider/legal constraints

Fixtures must be synthetic or redistributable, contain no customer/provider
payload, and never resemble permission for live use.

## Security considerations

Exercise hostile URLs/content as data; no external provider network call; private
tokens and ops auth use production-shaped security.

## Tests written first

- Full happy path plus all four actions.
- `WAIT`, stale/dependent evidence, partial failure, duplicate retry/delivery.
- Missing all provider keys still completes.
- Network provider clients fail the test if invoked.
- Feedback persists and private result stays non-public.

## Implementation

Keep fixtures behind provider adapters and seed deterministic data through the
database path. Do not branch around evidence/scoring/review contracts in the UI.

## Verification

Run clean install, database migrate/seed, `pnpm test`, production build, and
critical browser path with `PROVIDER_CREDENTIAL_MODE=fixture` and empty keys.

On 2026-08-12, the integrated current working tree replayed all 15 migration
files through `0016` on isolated PostgreSQL 16, matched all 15 migration hashes,
seeded the fixture twice, and matched 34/34 public tables plus exact
enums/indexes/constraints and effective/default ACL denial for `PUBLIC`, `anon`,
and `authenticated`. With database integration enabled, 85 files/449 tests
passed; workspace typecheck, lint, Drizzle check, and the final optimized webpack
production build also passed. The standard Turbopack build was locally blocked
by sandbox port restrictions. The actual `next start` artifact ran 60 browser
checks: 58 passed and two mobile checks were intentionally skipped, including 24
desktop/mobile axe checks and the complete API review/delivery/idempotency
journey. A local HTTP verifier passed 26 public route/status/content-type checks,
security-header/secret-marker checks, ops privacy, and two unknown-capability
privacy probes. A separate manual curl exercise confirmed source projection kept
all automated sources and manual evidence at **Coming soon**/`UNVERIFIED`, with
Reddit **Permission required**/`LEGAL_REVIEW`. See the
[integrated local record](../operations/LOCAL_VERIFICATION_2026-08-11.md).
These results are `LOCAL_PASS`, not immutable release-SHA, remote-CI, deployed,
or provider-read-back evidence.

## Limitations

Fixtures cannot prove live schemas, costs, rights, outages, model quality, or
deployment behavior.

## Rollout

Fixture mode is the default for local/demo environments and remains available
when live adapters arrive.

## Rollback

Revert fixture data/version while preserving schema compatibility; never remove
the last complete credential-free demo.

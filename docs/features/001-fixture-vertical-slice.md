# 001 — Fixture vertical slice

Status: implemented; database integration, static checks, and the webpack build
passed on the current local working tree. Final clean browser/axe verification,
release-SHA CI, and external/manual acceptance remain required. Passing
fixtures prove local behavior only.

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

On 2026-08-12, implementation candidate
`73297a6cfdc99b025990b001b39cef399f4d235e` replayed all 18 migrations through
`0019` on isolated PostgreSQL 16, matched every hash, seeded the fixture twice,
and matched 37/37 public tables plus expected columns, enums, indexes,
constraints, and browser/default ACL denial. The database-enabled run passed 98
files/512 tests; the non-database run passed 78 files/455 tests with 20 files/57
tests skipped. Typecheck, lint, Drizzle check, the 37-entry optimized webpack
build, 58-pass/two-intentional-skip browser run with 24 axe checks, and 26-route
plus two-private-probe local deployment verification also passed. The standard
Turbopack build was locally blocked by sandbox port restrictions. See the
[integrated local record](../operations/LOCAL_VERIFICATION_2026-08-12.md).
This is immutable code-local evidence, not deployed or provider-read-back
evidence. Separate branch CI passed at `4ec9510f610001285c54947326c65cb79a075f37`
in [run 31585349262](https://github.com/meestierolff/trendsfast/actions/runs/31585349262).

## Limitations

Fixtures cannot prove live schemas, costs, rights, outages, model quality, or
deployment behavior.

## Rollout

Fixture mode is the default for local/demo environments and remains available
when live adapters arrive.

## Rollback

Revert fixture data/version while preserving schema compatibility; never remove
the last complete credential-free demo.

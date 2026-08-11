# 001 — Fixture vertical slice

Status: implemented; database/suite/build/browser/HTTP replay passed at local
commit `072d5fc`. Remote CI and external/manual acceptance remain required.
Passing fixtures prove local behavior only.

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
`REMIX`, or `WAIT`, visibly labeled “Fixture.” It includes limitations,
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

On 2026-08-11, the current hardened local replay completed a frozen install, all
eight PostgreSQL migrations (`0000`–`0007`), two deterministic fixture seeds,
and `pnpm db:purge` with zero eligible rows. The integration-enabled full suite
passed 277 tests in 55 files with no skips or failures; repository-wide lint,
all 12 typechecks, and the Drizzle schema check also passed. See the
[local verification record](../operations/LOCAL_VERIFICATION_2026-08-11.md).
The candidate's optimized Next.js production build completed, and all 28 serialized
desktop/mobile browser checks passed with no skips/failures, including eight axe
checks and the persisted ops/private journeys. Manual direct requests passed the
known/unknown route and private-cache/security-header matrix. These results all
target local commit `072d5fc`; the remote-CI/manual/external matrix remains
required.

## Limitations

Fixtures cannot prove live schemas, costs, rights, outages, model quality, or
deployment behavior.

## Rollout

Fixture mode is the default for local/demo environments and remains available
when live adapters arrive.

## Rollback

Revert fixture data/version while preserving schema compatibility; never remove
the last complete credential-free demo.

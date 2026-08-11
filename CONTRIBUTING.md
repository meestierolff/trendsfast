# Contributing to TrendsFast

Thanks for helping build trustworthy distribution intelligence. Contributions
should strengthen one product path, preserve evidence provenance, and keep the
alpha honest.

## Before coding

1. Read the [product constitution](docs/PRODUCT_CONSTITUTION.md), relevant
   [architecture decisions](docs/adr/README.md), and
   [threat model](docs/security/THREAT_MODEL.md).
2. Search existing issues. Propose a focused issue before a large change.
3. For a product feature, create or update exactly one file under
   `docs/features/` with all required sections.
4. Write the failing test first. Capture provider/legal constraints before
   integrating a new source.

Provider additions require an explicit user need, rights/terms review, bounded
cost model, fixture, contract tests, health check, and failure behavior. Reddit
automation is not an acceptable contribution while its status is
`LEGAL_REVIEW`.

## Local setup

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Keep `PROVIDER_CREDENTIAL_MODE=fixture`. Never put real credentials in tests,
fixtures, issues, screenshots, or commits.

## Development rules

- Keep strict TypeScript and runtime validation at boundaries.
- Keep PostgreSQL migrations committed, forward-only, and replayable from zero.
- Treat all fetched or model-generated text as untrusted data.
- Bind evidence from stored records; model synthesis must preserve the exact
  deterministic evidence set and may not invent URLs, metrics, or source claims.
- Emit measured momentum only for a rising series tied to the candidate query or
  an increasing time-separated metric for the same canonical signal.
- Preserve `WAIT` and partial-failure paths.
- Persist scan state before and after external steps; preserve hard-deadline and
  processing-fence checks on every processing mutation.
- Never automatically replay an interrupted provider with an unknown effect;
  require operator reconciliation before broader non-fixture retry.
- Keep calls, time, retries, and cost bounded.
- Keep model input/output bounds and conservative pre-call reservations; do not
  label unsettled usage or operator-supplied prices as actual trusted cost.
- Do not add posting, scheduling, customer social OAuth, or a provider mega-pack.
- Never upgrade a source status without a dated production read-back record.

## Verification

Run the narrowest test while iterating, then:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm test:e2e` when browser dependencies are installed and your change
touches a user flow. Migration changes must also be replayed against a clean
PostgreSQL database. With that database migrated, run the persisted lifecycle
integration explicitly:

```bash
RUN_DATABASE_INTEGRATION=1 pnpm exec vitest run packages/orchestration/tests/database-flow.integration.test.ts
```

## Pull requests

Keep changes small enough to review. Explain the user problem, contract,
security impact, tests-first evidence, manual verification, limitations,
rollout, and rollback. Include screenshots for visual work and migration notes
for schema changes. Do not include secrets or customer data.

By submitting a contribution, you agree that it is licensed under the
repository's AGPL-3.0-only license and that you have the right to contribute it.

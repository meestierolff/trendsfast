## User problem and outcome

<!-- What user problem changes, and what is the smallest observable outcome? -->

## Contract and scope

- Feature document: `docs/features/NNN-...md`
- Included:
- Deliberately not included:
- API/data/migration impact:

## Tests first

<!-- Name the test(s) that failed before implementation, then passed. -->

- [ ] Targeted tests added before implementation
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Browser/accessibility checks when relevant
- [ ] Migration replay from zero when relevant
- [ ] Persisted PostgreSQL integration with `RUN_DATABASE_INTEGRATION=1` when relevant

## Trust, security, rights, and cost

- Threats/data affected:
- Provider/legal/attribution/retention review:
- Call/result/time/retry/cost bounds:
- Processing fence/unknown-effect/manual-retry impact:
- Model reservation, price metadata, and actual-usage impact:
- Capability entropy, bounded-body, and auth/admission impact:
- Secret and private-data handling:
- Evidence provenance/independence impact:
- Retention/deletion/purge impact:

## Verification

<!-- Commands, environment/mode, screenshots or artifacts, and observed result. -->

## Limitations, rollout, and rollback

- Known limitations:
- Rollout/flags/status labels:
- Non-destructive rollback:

## Truth checklist

- [ ] No secret, customer data, private token, or provider payload is included.
- [ ] Fixture success is not described as production provider verification.
- [ ] Source status changes include a dated production read-back record.
- [ ] Reddit automation remains `LEGAL_REVIEW` unless separately approved.
- [ ] Billing stays disabled unless the explicit live gate is approved.
- [ ] No fake traction, deployment, legal, security, or coverage claim is added.
- [ ] Public case-study material has explicit consent.

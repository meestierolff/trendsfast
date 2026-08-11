# Supabase PostgreSQL setup

TrendsFast uses Supabase only as hosted PostgreSQL. It does not depend on
Supabase Auth, Storage, Realtime, Edge Functions, or the browser Data API.

## Connections

Create separate preview and production projects. Store two server-only URLs per
environment:

- `DATABASE_URL`: the transaction-pooled runtime connection for short-lived
  serverless requests.
- `DIRECT_DATABASE_URL`: the direct connection used only by controlled
  migrations, verification, backup, and restore work.

Require TLS. Do not expose either URL through a `NEXT_PUBLIC_*` variable. The
Supabase transaction pooler does not support prepared statements; validate the
selected driver configuration against the chosen pooler before production.

## Provisioning

1. Create founder-owned preview and production projects with MFA.
2. Record the region, PostgreSQL major version, backup/PITR policy, and recovery
   owner.
3. Configure network restrictions where the deployment topology permits them.
4. Put the pooled URL in the Vercel runtime environment and retain the direct URL
   only in the controlled release/migration environment.
5. From the exact release SHA, run `pnpm install --frozen-lockfile` and then
   `DIRECT_DATABASE_URL=... DATABASE_URL=... pnpm db:migrate`.
6. Never run `pnpm db:seed` against hosted preview or production.
7. Run `pnpm db:verify-hosted` with `DIRECT_DATABASE_URL` set. Save the redacted
   JSON result with the release record.

The verifier reads catalog metadata only: PostgreSQL version, the Drizzle
migration ledger, public table names, enum names, index names, and constraint
names. It never selects application rows or secret values. Use
`STRICT_HOSTED_SCHEMA=1` when any extra public table should fail verification.

## Backup and rollback

- Enable and monitor the provider backup policy before live traffic.
- Rehearse a restore into a disposable project; do not treat “backup enabled” as
  proof that restore works.
- Prefer forward-compatible migrations. Never automatically reverse a migration
  that could discard rows.
- Before migration, capture the exact release SHA, current migration count,
  backup timestamp, operator, and rollback decision point.
- On failure, stop new scans/monitoring first, preserve audit data, and restore or
  roll forward only under the named database owner.

## Hosted verification record

Record without credentials or row values:

```text
Environment:
Release SHA:
Supabase project reference (non-secret):
PostgreSQL version:
Migration count/latest timestamp:
Missing/extra tables:
Missing enums/indexes/constraints:
Backup/restore evidence:
Operator and UTC timestamp:
```

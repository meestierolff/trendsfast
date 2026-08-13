# Supabase PostgreSQL setup

TrendsFast uses Supabase for hosted PostgreSQL and passwordless founder
authentication. It does not use Storage, Realtime, Edge Functions, or the
browser Data API. Supabase Auth establishes identity only; every TrendsFast
business-table query runs server-side through a scoped database runtime.

Observed state on 2026-08-12: an isolated Free preview organization and project
exist: `TrendsFast Preview` (`yylqvbwxoixwzouhnmgo`) and
`trendsfast-preview` (`auxienkuufejeakaczlq`) in `eu-central-1`, PostgreSQL
17.6. SSL enforcement and a CA-verified TLS 1.3 transaction-pooler connection
were read back. No migration or seed has run: the direct host is IPv6-only and
this release runner has no IPv6 route, and the transaction pooler must not be
substituted for the controlled direct path. No production project exists; the
founder still must upgrade or create a Pro organization for production. This is
infrastructure inventory, not hosted-database acceptance.

The earlier immutable local baseline at
`73297a6cfdc99b025990b001b39cef399f4d235e` replayed 18 migrations through
`0019` and matched 37/37 tables. That is historical evidence only. The current
tree contains 23 migration files through `0024` (with intentional `0009`/`0010`
gaps) and expects 44 TrendsFast tables. A fresh isolated local PostgreSQL 16.14
database applied 23/23 files and seeded; the initial strict verifier matched
44/44 tables, and the full integration suite passed 710 tests with 5 skipped.
The role provisioner created the migrator and all seven runtimes, all 7/7
runtime connections passed catalog-only verification without reading row
values, and the separate runtime-role suite passed 5/5 tests. This is mutable
local evidence only: the expanded snapshot-manifest verifier still needs a
final rerun, and no hosted application/runtime-role verification has been
performed. Repeat all checks against each hosted environment; do not copy
either local result forward as hosted proof. See the
[current local record](LOCAL_VERIFICATION_2026-08-13.md).

## Connections

Create separate preview and production projects. Store server-only URLs per
environment:

- `DATABASE_URL`, `MEMBER_DATABASE_URL`, `OPS_DATABASE_URL`, `WORKER_DATABASE_URL`,
  `BILLING_DATABASE_URL`, `AUTH_DATABASE_URL`, and `RETENTION_DATABASE_URL`:
  independently credentialed transaction-pooled connections for the server-side
  anonymous public application, authenticated founder dashboard, founder ops,
  worker/reconciliation, billing, API-key auth, and function-only purge runtimes
  respectively.
- `DIRECT_DATABASE_URL`: the direct connection used only by controlled
  migrations, verification, backup, and restore work.
- `ROLE_ADMIN_DATABASE_URL`: an optional separate direct administrative
  connection for role provisioning/catalog verification; it is never deployed
  to an application runtime.

Require `DATABASE_SSL_CA` and certificate verification for every non-loopback
URL. Do not expose any URL through a `NEXT_PUBLIC_*` variable. The
Supabase transaction pooler does not support prepared statements; validate the
selected driver configuration against the chosen pooler before production.

## Provisioning

1. Create founder-owned preview and production projects with MFA.
2. Record the region, PostgreSQL major version, backup/PITR policy, and recovery
   owner.
3. Configure network restrictions where the deployment topology permits them.
4. Put only the relevant scoped pooled URL(s) in each Vercel surface; retain the
   direct/admin URLs only in the controlled release environment.
5. From the exact release SHA, run `pnpm install --frozen-lockfile` and then run
   `pnpm db:migrate` with both URLs set; migration must select
   `DIRECT_DATABASE_URL`, never the transaction pooler.
6. After migration, create a mode-`0600` private secrets file containing the
   eight generated 32+ character role passwords (migrator plus seven runtimes), set
   `RUNTIME_ROLE_SECRETS_FILE`, and run `pnpm db:provision-roles` through the
   direct administrative connection. Never pass or print passwords in argv or
   output.
7. Construct the seven pooled runtime URLs privately, including the dedicated
   member/dashboard URL, then run
   `pnpm db:verify-roles` with all role URLs, the admin/direct URL, and
   `DATABASE_SSL_CA`. It verifies exact grants/denials, identities, TLS,
   attributes, memberships, ownership, search paths, and DDL/TEMP denial without
   reading row values.
8. Never run `pnpm db:seed` against hosted preview or production.
9. Run `STRICT_HOSTED_SCHEMA=1 pnpm db:verify-hosted` with
   `DIRECT_DATABASE_URL` set. Save the redacted JSON result with the release
   record.

Configure Supabase Auth only after the database/runtime-role read-back is clean;
the exact redirect, SMTP, Google-provider, cookie, and claim-consumption contract
is in [SUPABASE_AUTH.md](SUPABASE_AUTH.md). Keep `anon` and `authenticated` at
zero privileges on TrendsFast business tables.

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
Migration count/latest migration/hash:
Missing/extra tables:
Missing enums/indexes/constraints:
Backup/restore evidence:
Operator and UTC timestamp:
```

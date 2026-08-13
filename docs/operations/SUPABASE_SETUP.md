# Supabase PostgreSQL setup

TrendsFast uses Supabase for hosted PostgreSQL and passwordless founder
authentication. It does not use Storage, Realtime, Edge Functions, or the
browser Data API. Supabase Auth establishes identity only; every TrendsFast
business-table query runs server-side through a scoped database runtime.

Observed state on 2026-08-13: the isolated Free project
`trendsfast-preview` (`auxienkuufejeakaczlq`) in `eu-central-1` runs PostgreSQL
17.6. At exact release SHA `91374fcb357f576de7a35bbbac4f684c1e9a5317`,
the controlled session-pooler path applied and hash-verified 23/23 migrations
through `0024` without a fixture seed. Strict verification matched 44 tables,
560 columns, 30 enums, 119 indexes, and 177 foreign-key/check constraints with
zero application drift. Eight roles and all seven CA-verified TLS 1.3 runtime
identities passed the catalog-only ownership/grant/denial checks, including zero
application access for the Supabase Data API roles. Managed policy remains
unsynchronized because `SCAN_RETENTION_DAYS` is not approved.

The project is preview-only. No production project, backup/restore rehearsal,
or production database acceptance exists; the founder still must upgrade or
create a Pro organization for production. See the
[hosted preview record](HOSTED_PREVIEW_VERIFICATION_2026-08-13.md) and keep its
result separate from the
[local product-completion record](LOCAL_VERIFICATION_2026-08-13.md).

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
  migrations, verification, backup, and restore work. Bootstrap migration may
  use the managed operator; after role provisioning, it must authenticate as
  `trendsfast_migrator` so future migrations can alter migrator-owned objects.
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
   `DIRECT_DATABASE_URL`, never the transaction pooler. For bootstrap, use the
   managed operator URL; after step 6, replace the controlled migration URL with
   the generated `trendsfast_migrator` direct/session-mode URL.
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
   `DIRECT_DATABASE_URL` set to the migrator identity. Save the redacted JSON
   result with the release record; the admin identity intentionally cannot read
   the migrator-owned Drizzle ledger.

Configure Supabase Auth only after the database/runtime-role read-back is clean;
the exact redirect, SMTP, Google-provider, cookie, and claim-consumption contract
is in [SUPABASE_AUTH.md](SUPABASE_AUTH.md). Keep `anon`, `authenticated`, and
`service_role` at zero privileges on TrendsFast business tables; application
runtimes never use Supabase Data API roles.

Supabase retains provider-owned `supabase_admin` defaults for platform-created
objects. TrendsFast does not represent those as removed: hosted acceptance
checks zero effective access on every current TrendsFast object and zero
`PUBLIC`/Data API defaults owned by `trendsfast_migrator`, the only identity
authorized to create future TrendsFast objects.

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

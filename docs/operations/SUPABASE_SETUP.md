# Supabase PostgreSQL setup

TrendsFast uses exactly one Supabase project for production PostgreSQL and
passwordless founder authentication:

- project ref: `auxienkuufejeakaczlq`
- organization: `yylqvbwxoixwzouhnmgo`
- region: `eu-central-1`
- PostgreSQL: 17.6 at the latest recorded read-back

The project's historical display label is `trendsfast-preview`, but the ref is
now the sole production database. Do not create a preview project, production
clone, database branch, or second restore-test project. Rename the display name
to `trendsfast-prod` only if the current Supabase API provides a safe supported
rename; a label mismatch does not block use of the immutable ref.

TrendsFast does not use Storage, Realtime, Edge Functions, or the browser Data
API for business data. Supabase Auth establishes identity only; every
application-table query runs server-side through a scoped database role.

## Current hosted acceptance

The unseeded project has the 23/23 Drizzle migration ledger through `0024`.
Strict verification matches 44 tables, 560 columns, 30 enums, 119 indexes, and
177 foreign-key/check constraints with no missing or extra application object.
Application objects are migrator-owned, TrendsFast default ACLs are clean, and
`PUBLIC`, `anon`, `authenticated`, and `service_role` have zero effective
application-table access. All seven runtime identities have passed a
catalog-only CA-verified TLS 1.3 connection check without reading row values.

A pre-mutation custom-format logical backup was streamed directly into GPG
AES-256 encryption under `.var/private/backups/`. Its artifact and passphrase
are mode `0600`, and decrypt-to-`pg_restore --list` verified readability without
writing a plaintext dump. This is backup readability evidence, not a claim that
a full restore into another hosted project was rehearsed.

## Roles and connections

Maintain these least-privilege identities inside the one project:

| Identity                       | Purpose                                     | Deployment boundary                             |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------- |
| `trendsfast_public_runtime`    | anonymous public application                | public Vercel only                              |
| `trendsfast_member_runtime`    | founder dashboard and membership            | public Vercel only                              |
| `trendsfast_auth_runtime`      | project API-key authentication/admission    | public Vercel only                              |
| `trendsfast_worker_runtime`    | scan execution and reconciliation           | public Vercel only                              |
| `trendsfast_ops_runtime`       | founder control plane                       | ops Vercel only                                 |
| `trendsfast_billing_runtime`   | billing projection                          | not deployed in Hobby launch                    |
| `trendsfast_retention_runtime` | function-only purge                         | controlled/manual; not deployed in Hobby launch |
| `trendsfast_migrator`          | Drizzle migration and application ownership | controlled release environment only             |
| restricted operator            | role/catalog administration                 | controlled release environment only             |

Never use `postgres`, a database owner, `trendsfast_migrator`, Supabase
`service_role`, or the restricted operator for normal runtime traffic.

The runtime variables are pooled, independently credentialed URLs:
`DATABASE_URL`, `MEMBER_DATABASE_URL`, `AUTH_DATABASE_URL`,
`WORKER_DATABASE_URL`, `OPS_DATABASE_URL`, `BILLING_DATABASE_URL`, and
`RETENTION_DATABASE_URL`. The public Hobby importer accepts only the first four;
the ops importer accepts only `OPS_DATABASE_URL`. Billing and retention URLs
remain private until an explicitly approved surface needs them.

`DIRECT_DATABASE_URL` is the controlled migration/verification/backup
connection and must authenticate as `trendsfast_migrator` after bootstrap.
`ROLE_ADMIN_DATABASE_URL` is the optional restricted administrative connection
for role/catalog work. Neither may be uploaded to Vercel. No database URL may
be exposed through `NEXT_PUBLIC_*`.

Require the tracked, pinned `DATABASE_SSL_CA` bundle and certificate
verification for every non-loopback URL. Validate the driver against the chosen
Supabase pooler and do not assume prepared-statement support.

## Provisioning and verification

Link only the exact project:

```bash
supabase link --project-ref auxienkuufejeakaczlq
```

Before mutation, capture the encrypted backup:

```bash
pnpm db:backup
```

Then run idempotently from the accepted release SHA:

```bash
pnpm db:migrate
pnpm db:verify-hosted
pnpm db:provision-runtime-roles
pnpm db:verify-runtime-roles
```

Role secrets live only in a mode-`0600` ignored private file and never appear in
argv or output. `db:verify-hosted` checks the exact migration/schema manifest,
ownership, default ACLs, and Data API denial. `db:verify-runtime-roles` checks
role identity, TLS, attributes, managed membership, grants/denials, search
paths, and DDL/TEMP denial without selecting application rows. Never run
`pnpm db:seed` against this hosted project.

Supabase may retain provider-owned `supabase_admin` defaults for
platform-created objects. Acceptance does not misrepresent those as removed;
it requires zero effective Data API access to every current TrendsFast object
and zero unsafe defaults owned by `trendsfast_migrator`.

## Auth and legacy-key shutdown

Configure Supabase Auth only after schema/runtime-role verification. Exact
redirect, SMTP, Google-provider, cookie, and claim behavior is in
[SUPABASE_AUTH.md](SUPABASE_AUTH.md). Vercel receives the exact project URL and
only the modern `sb_publishable_...` browser key; application data still travels
through server-side member/auth roles.

Treat the previously surfaced legacy `service_role` key as exposed. It must:

- remain absent from Git history, Vercel environments, logs, screenshots, and
  release artifacts;
- never be used for application, migration, backup, or operator work;
- be disabled/rotated through Supabase's supported legacy-key migration path
  when the account control is available; and
- never trigger a database reset or project replacement.

The paired legacy key state must be read back after shutdown. The modern
publishable Auth key and scoped PostgreSQL roles are the migration target.

## Backup and rollback

- Use `pnpm db:backup` before controlled schema mutation and verify the encrypted
  artifact can be listed/read.
- Monitor the provider's own backup policy separately; an enabled toggle is not
  restore proof.
- Do not create another hosted project solely to satisfy restore testing during
  this launch.
- Prefer forward-compatible migrations. Never automatically reverse a migration
  that can discard rows.
- On failure, disable new scans and monitoring first, preserve audit data, then
  restore or roll forward only under the named database owner.

Record the non-secret project ref, accepted SHA, PostgreSQL version, migration
ledger, schema counts, runtime-role/TLS result, backup filename/readability,
operator, and UTC timestamp. Never record URLs, passwords, row values, CA
private material, or key contents.

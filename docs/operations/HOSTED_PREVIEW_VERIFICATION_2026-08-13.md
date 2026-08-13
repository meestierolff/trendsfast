# Hosted preview verification — 2026-08-13

Status: **verified protected preview at
`91374fcb357f576de7a35bbbac4f684c1e9a5317`; launch blocked.** This record is
preview evidence only. It does not prove production readiness, provider access,
billing, monitoring, legal approval, customer outcomes, or dogfood quality.

## Release and CI identity

- Release SHA: `91374fcb357f576de7a35bbbac4f684c1e9a5317`.
- [CI run 31689585041](https://github.com/meestierolff/trendsfast/actions/runs/31689585041),
  [CodeQL run 31689585090](https://github.com/meestierolff/trendsfast/actions/runs/31689585090)
  (aggregate CodeQL check `94413864261`),
  [dependency-review run 31689585158](https://github.com/meestierolff/trendsfast/actions/runs/31689585158),
  and
  [secret-history run 31689585026](https://github.com/meestierolff/trendsfast/actions/runs/31689585026)
  passed for that SHA.

## Supabase preview

- Project `trendsfast-preview` (`auxienkuufejeakaczlq`) is PostgreSQL 17.6.
- The controlled migration path applied and hash-verified 23/23 migration files
  through `0024`. No fixture seed was run.
- Strict catalog verification matched 44 tables, 560 columns, 30 enums, 119
  indexes, and 177 foreign-key/check constraints with zero application drift.
- Eight TrendsFast roles exist (migrator plus seven scoped runtimes). All seven
  runtime identities passed TLS 1.3, identity, grant/denial, ownership, and
  catalog-only verification without reading application row values.
- Current TrendsFast objects grant no effective access to `PUBLIC`, `anon`,
  `authenticated`, or `service_role`; all application objects are
  migrator-owned. Provider-managed `supabase_admin` default ACLs are reported
  separately and do not apply to migrator-owned future objects.
- Managed policy was deliberately not synchronized because
  `SCAN_RETENTION_DAYS` has not been approved. No revision or retention value was
  invented.

Supabase Auth uses `https://trendsfast-preview.vercel.app` as its Site URL and
has only these preview redirects allow-listed:

```text
https://trendsfast-preview.vercel.app/auth/callback**
https://trendsfast-preview.vercel.app/auth/confirm**
```

Google and e-mail sign-in remain disabled. No Google OAuth credentials or
custom SMTP exist. The reviewed magic-link template could not be applied on the
Free project while using Supabase's default sender, so no template change was
claimed.

## Protected Vercel preview

- Deployment `dpl_8vpd6yDUSVxn9oNH5SobuJWXuN6q` reached `READY` with exact SHA
  provenance and the stable protected alias
  `https://trendsfast-preview.vercel.app`.
- The public, member, and Auth database roles, verified CA, session secret, API
  key pepper, and Supabase publishable Auth configuration were supplied without
  recording their values here.
- Every customer-effect gate remains false, including public scans, provider
  calls, live API creation, billing, monitoring, and paid monitoring.
- Authenticated deployment probes observed `/` and `/login` as `200`,
  `/dashboard` as a `307` redirect to login, and `/ops` as `404`. OpenAPI returned
  `200` with three paths; `/api/sources` returned `200` with the safe nine-source
  projection; a disabled scan `POST` returned `503` with `no-store`.
- Deployment error-log read-back returned zero errors. Vercel Deployment
  Protection remains enabled, so this is not an anonymous public-origin
  acceptance result.

## Remaining blockers

No production or ops deployment, Vercel Pro plan, production Supabase project,
custom domain/DNS/TLS acceptance, backup/restore rehearsal, SMTP, Google OAuth,
provider/model credential read-back, Stripe journey, managed-policy sync,
monitoring run, or legal/tax approval is recorded. Production provider calls and
all customer-effect gates remain disabled.

Dogfood has not run or been exported because the required external provider
credentials and approvals are absent. External dogfood review has therefore not
been reached; this record does not claim `AWAITING_EXTERNAL_DOGFOOD_REVIEW`.

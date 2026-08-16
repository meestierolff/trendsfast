# Staged production preparation — 2026-08-13

Status: `BLOCKED_EXTERNAL`; this is a redacted preparation record, not a
deployment, production acceptance, or launch record.

## Frozen inputs

- Starting `main`: `2e719a6fbe4fc66629b24caf3daeccff462d2e7e`.
- Preparation branch: `sol/prepare-staged-production`.
- PR #3 was squash-merged at the starting SHA after its PR-head CI, CodeQL,
  dependency-review, secret-history, and Vercel checks passed.
- The squash changed the commit component of eight reviewed synthetic Gitleaks
  fingerprints. Current `main` therefore failed the full-history scan until the
  matching immutable squash fingerprints were added on this branch. This is
  fixture/example allowlisting, not evidence of a production credential.

## Private inventory

`.env.production.local` is ignored, a regular non-symlink file, and mode `0600`.
It was parsed only as inert data. Duplicate names, malformed assignments,
placeholders, incomplete pairs, and Phase 1 gate mismatches were checked without
printing or copying values. Independent 48-byte values replaced unresolved
`SESSION_SECRET` and `API_KEY_PEPPER` placeholders. The exact generated Vercel
origin was stored for both `APP_URL` and `PUBLIC_APP_URL` without printing it.

The tracked importer has an explicit public-project allowlist. It passes values
to Vercel only on standard input and withholds all command output that can carry
plain values. It rejects operator/admin URLs, database passwords, `OPS_TOKEN`,
Supabase service-role credentials, alert/cron secrets, stale remote variables,
and incomplete configuration. No inventory value is stored in this record.

## Supabase blocker

The intended founder-owned organization is in an EU region but remains on Free
and already has its maximum two active projects. Creation of exactly
`trendsfast-prod` was rejected before a project, password, or URL was created.
Stripe Projects preflight also reported the account ineligible to provision the
resource. No existing project was paused, deleted, or repurposed.

Consequently there is no production project reference, plan acceptance,
migration replay, runtime-role provisioning, Data API denial, TLS identity
read-back, Auth configuration, backup policy, or restore evidence. Production
was not seeded. The Vercel importer was intentionally not applied.

Founder action required: approve production-capable Supabase capacity in the
founder-owned organization, then create one `trendsfast-prod` project in
`eu-central-1` and execute the unseeded 23-migration/eight-role/seven-runtime
verification procedure in [SUPABASE_SETUP.md](SUPABASE_SETUP.md).

## Vercel read-back

- Existing project: `trendsfast` (`prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC`), owned by
  the founder's `Finnie` team; no duplicate was created.
- Framework/root/branch/runtime: Next.js, `apps/web`, `main`, Node 22.x.
- Stable generated production origin: `https://trendsfast.vercel.app`.
- The origin currently returns `DEPLOYMENT_NOT_FOUND`; no Current production
  deployment was accepted.
- Current plan: Hobby. Commercial production remains blocked on an appropriate
  paid plan; no monitoring or retention cron was configured.
- Deployment Protection already has one Automation Bypass entry. Only its
  scope/count/creation metadata was read; the token was never printed or stored.
  The founder script requires that pre-existing entry before deployment so its
  protected staged smoke cannot create a bypass as a hidden side effect.
- The tracked no-cron config prevents Git-triggered `main` deployments and pins
  Functions to `fra1` for the intended `eu-central-1` database. PR previews and
  explicit founder CLI deployments remain available.

The remote Production environment currently has only these user-configured
names (Vercel's generated system variables are outside this inventory):

```text
APP_URL
BILLING_CHECKOUT_ENABLED
BILLING_ENABLED
LIVE_API_CREATION_ENABLED
MONITORING_ENABLED
PAID_MONITORING_ENABLED
PROVIDER_CALLS_ENABLED
PROVIDER_CREDENTIAL_MODE
PUBLIC_SCANS_ENABLED
PUBLIC_SCAN_PROCESSING
TRENDSFAST_SURFACE
```

Production database URLs/CA, member/auth identities, session/pepper, Supabase
pair, `PUBLIC_APP_URL`, `STRIPE_MODE`, and managed policy are not yet configured.
The forbidden public names `OPS_TOKEN`, `OPS_DATABASE_URL`,
`RETENTION_DATABASE_URL`, `DIRECT_DATABASE_URL`, and
`ROLE_ADMIN_DATABASE_URL` were absent. Values were not copied into evidence;
the final deploy fence must perform the exact Phase 1 read-back after import.

A mode-`0600` temporary pull compared only the inert effect fields and was then
deleted. Provider calls, public scans, API creation, billing, Checkout, paid
monitoring, and monitoring each matched `false`, and the surface matched
`public`. `STRIPE_MODE`, `FOUNDING_100_ENABLED`, and `CLOUD_TRIAL_ENABLED` were
missing or mismatched, so the remote Phase 1 contract is not complete and the
deploy script would correctly refuse to proceed. No value was printed.

## Founder-controlled release contract

The release script must be run from clean, accepted `main` with explicit
`EXPECTED_RELEASE_SHA` and `EXPECTED_STABLE_PRODUCTION_ORIGIN` values. It creates
a staged Production deployment with the cron-free config, safely smokes the
immutable deployment, checks error logs, and only then promotes it to the stable
origin and repeats the stable-origin checks. The Vercel `--skip-domain` option
does not itself promote a deployment. Because this historical flow deliberately
uses the cron-free profile on the public project, its command carries the
non-secret `staged` selector into hosted compilation as a per-deployment build
value; it does not alter the project's stored Production environment.

```bash
bash scripts/deploy-staged-production.sh
```

No deploy, promotion, domain association, dogfood scan, provider work, public
scan, API creation, billing, monitoring, cron, or Stripe live mutation occurred
during this preparation record.

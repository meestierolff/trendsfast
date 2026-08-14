# Hobby launch and dogfood runbook — 2026-08-13

Status: **pre-deploy preparation**. The database and repository gates described
below are the launch contract, but this document is not deployment evidence.
The `sol/hobby-launch-dogfood` release has not yet been deployed, the new
`trendsfast-ops` project has no Production deployment, and
`trendsfast.com`/`www.trendsfast.com` have not been associated or moved.

This is a free, pre-revenue validation release on Vercel Hobby. It may serve the
website, perform bounded internal API/provider dogfood, and later offer a free
Turnstile-protected scan. It must not accept a real payment, enable Checkout,
run paid monitoring, or be marketed as a paid hosted service. Upgrade Vercel to
Pro immediately before the first real paid subscription.

## Fixed topology

Use exactly one Supabase project as the sole production database:

- project ref: `auxienkuufejeakaczlq`
- organization: `yylqvbwxoixwzouhnmgo`
- region: `eu-central-1`
- canonical operational meaning: TrendsFast production

The current Supabase display label may still say `trendsfast-preview`. That
historical label does not create a preview environment and must not cause a
clone, branch, second database, or destructive reset. Rename the display label
to `trendsfast-prod` only if the current Supabase API supports a safe rename;
the immutable project ref is authoritative.

The Vercel Hobby account has two separate surfaces:

| Surface     | Project                                               | Root / region       | Current launch contract                                                                                                    |
| ----------- | ----------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Public      | `trendsfast` (`prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC`)     | `apps/web` / `fra1` | Generated origin `https://trendsfast.vercel.app`; one monitoring cron                                                      |
| Founder ops | `trendsfast-ops` (`prj_EYAjX2Nyd1jUXSjfWVTVoI320nnU`) | `apps/web` / `fra1` | Generated alias `https://trendsfast-ops.vercel.app`; application-enforced founder authentication; no cron or custom domain |

Both projects retain Fluid Compute and the verified 300-second default
Function duration. `apps/web/vercel.pro.json` stays unchanged for the later Pro
upgrade.

Vercel Standard Authentication on Hobby does not protect Production domains or
aliases. The ops generated alias must therefore be treated as network-public;
the Vercel project setting is defense in depth for the targets it covers, not
the founder-access boundary. Session creation first verifies the high-entropy
`OPS_TOKEN` with a bounded, constant-time check and durable admission control.
All private ops pages and handlers then require a signed application session
and the exact `TRENDSFAST_SURFACE=ops` deployment surface. The unauthenticated
login/session-entry routes disclose no private operations data. Keep the ops
project limited to its generated Vercel alias and never attach a custom domain.

## Initial effect state

Both surfaces use these managed-provider and effect flags for bounded internal
read-backs while customer and commercial effects remain closed:

```env
PROVIDER_CREDENTIAL_MODE=managed
PROVIDER_CALLS_ENABLED=true
LIVE_API_CREATION_ENABLED=true
PUBLIC_SCANS_ENABLED=false
PUBLIC_SCAN_PROCESSING=inline
BILLING_ENABLED=false
BILLING_CHECKOUT_ENABLED=false
PAID_MONITORING_ENABLED=false
MONITORING_ENABLED=false
FOUNDING_100_ENABLED=false
CLOUD_TRIAL_ENABLED=false
STRIPE_MODE=test
```

The public surface additionally sets `TURNSTILE_ENABLED=true` and receives the
dedicated widget keys; the ops surface receives no Turnstile variable. Do not
upload a live Stripe runtime key. Creating or reusing the live Stripe Product
and Price through the Stripe CLI is a separate catalog-only operation and does
not enable billing.

## Database, roles, TLS, and backup

Drizzle migrations are the schema authority. Hosted production remains
unseeded. The current acceptance shape is 23/23 migration files through `0024`,
44 tables, 560 columns, 30 enums, 119 indexes, and 177 foreign-key/check
constraints, with zero unexpected application objects.

Keep the following database identities distinct inside the sole project:
`trendsfast_public_runtime`, `trendsfast_member_runtime`,
`trendsfast_auth_runtime`, `trendsfast_worker_runtime`,
`trendsfast_ops_runtime`, `trendsfast_billing_runtime`,
`trendsfast_retention_runtime`, and `trendsfast_migrator`, plus the restricted
operator used only for controlled administration. Normal application traffic
must never use `postgres`, a database owner, `trendsfast_migrator`, Supabase
`service_role`, or the restricted operator.

Every non-loopback connection uses the pinned Supabase CA bundle and
certificate verification. Production runtime connections are pooled and
role-scoped. Direct migration/operator URLs remain in the mode-`0600` private
release environment and are never uploaded to Vercel. The Supabase Data API
roles (`anon`, `authenticated`, and `service_role`) must retain zero effective
access to TrendsFast application objects.

Before database mutation, run:

```bash
pnpm db:backup
```

The backup command streams a custom-format `pg_dump` directly into GPG AES-256
encryption under `.var/private/backups/`, keeps both artifact and passphrase
mode `0600`, and verifies readability by decrypting into `pg_restore --list`
without writing a plaintext dump. The 2026-08-13 pre-mutation backup passed
that listing/readability check. Do not create a second hosted project merely to
test restore.

Then run idempotently, without hosted seed data:

```bash
pnpm db:migrate
pnpm db:verify-hosted
pnpm db:provision-runtime-roles
pnpm db:verify-runtime-roles
```

The legacy Supabase `service_role` key previously surfaced outside the new key
contract is treated as exposed. It must remain absent from Git and both Vercel
projects, must never be used by the runtime, and must be disabled/rotated
through Supabase's supported legacy-key migration path when account controls
allow it. That shutdown is a release gate; it does not justify resetting this
database. Vercel receives only the modern `sb_publishable_...` Auth key.

## Historical preview source exposure and rotation

The historical preview deployment
`dpl_8vpd6yDUSVxn9oNH5SobuJWXuN6q` crossed the intended source boundary. Its
uploaded source included these private launch bundles:

- `.var/private/migrator-database-url.env`
- `.var/private/runtime-role-secrets.env`
- `.var/private/runtime-role-urls.env`
- `.var/private/preview-app-secrets.env`
- `.var/private/managed-policy.env` and `.var/private/provider-prices.env`
- local release/tool metadata in `supabase/.temp`, `.projects/cache`, `.agents`,
  `.env.example`, and `test-results`

The upload did **not** contain `.var/private/backup-passphrase` or an encrypted
or plaintext database dump. That narrower fact does not make the uploaded
credentials acceptable: all eight PostgreSQL passwords (migrator plus the seven
runtime roles) were rotated, the preview-era `SESSION_SECRET` and
`API_KEY_PEPPER` are no longer current, and the launch `CRON_SECRET` was
independently replaced with a fresh 48-byte value. The current redacted hosted
runtime-role verifier passes after the rotation, and both Vercel Production
allowlists were re-imported and value-bound attested without printing secret
values. The obsolete raw local preview-secret bundle was removed. After a V13
read-back proved that the historical preview was non-Production and had no
manual or automatic aliases, that exact deployment was deleted and a second
inspect confirmed it no longer exists. Disabling the separately exposed legacy
Supabase keys remains an external release gate.

The tracked root `.vercelignore` now excludes all local environment inventories,
`.var`, tool state, caches, test output, database files, key material, and
backups. `pnpm vercel:verify-source` applies the same effective ignore boundary
to sensitive and required source sentinels, rejects negated rules, and fails if
the ignore file is not tracked in the accepted release. A local Vercel CLI dry
run currently finds no protected sentinel in the upload set; this remains
pre-deploy evidence and must pass again for the clean accepted SHA.

## Strict environment boundary

`.env.production.local` is ignored, mode `0600`, and parsed as inert input. The
Hobby importers reject partial configuration, duplicate names, unknown remote
names, forbidden roles, weak secrets, wrong origins, wrong project metadata,
and wrong environment types. They send values to Vercel only on standard input
and read back the exact name/type set without printing values:

```bash
pnpm env:prepare-hobby
pnpm env:import-production --check
pnpm env:import-production --apply
pnpm env:import-ops --check
pnpm env:import-ops --apply
```

`SOL_HOBBY_ENVIRONMENT_PHASE` is the local-only transition control in the
ignored `.env.production.local` inventory. It is not uploaded to Vercel.
`pnpm env:prepare-hobby` derives both surfaces' origins and
`PUBLIC_SCANS_ENABLED` from this marker, so directly editing those derived
values without advancing the marker is ineffective: the preparation command
will replace them with the selected phase.

Advance through only these reviewed phases:

| `SOL_HOBBY_ENVIRONMENT_PHASE` | Entry gate                                     | Public `APP_URL` / `PUBLIC_APP_URL` | Ops `APP_URL`                       | Ops `PUBLIC_APP_URL`            | `PUBLIC_SCANS_ENABLED` |
| ----------------------------- | ---------------------------------------------- | ----------------------------------- | ----------------------------------- | ------------------------------- | ---------------------- |
| `generated-origin-scans-off`  | Initial deploy; also the default when absent   | `https://trendsfast.vercel.app`     | `https://trendsfast-ops.vercel.app` | `https://trendsfast.vercel.app` | `false`                |
| `canonical-origin-scans-off`  | DNS, trusted TLS, redirect, and hostname pass  | `https://trendsfast.com`            | `https://trendsfast-ops.vercel.app` | `https://trendsfast.com`        | `false`                |
| `canonical-origin-scans-on`   | Dogfood and the complete Turnstile matrix pass | `https://trendsfast.com`            | `https://trendsfast-ops.vercel.app` | `https://trendsfast.com`        | `true`                 |

The scans-on phase additionally requires ignored, regular mode-`0600`
`.var/private/hobby-scan-enablement.json`. The importer rejects scans-on before
any Vercel mutation unless that exact founder-approved contract contains:

- schema version `1` and the accepted 40-character release SHA;
- the immutable public deployment hostname and `dpl_...` ID actually tested;
- the site-key hash (SHA-256 of the exact `NEXT_PUBLIC_TURNSTILE_SITE_KEY`), action `public_scan`,
  and the ordered hostnames `trendsfast.vercel.app`, `trendsfast.com`, and
  `www.trendsfast.com`;
- `PASS` for `valid`, `missing`, `forged`, `replayed`, `expired`,
  `wrongAction`, and `wrongHostname` in `turnstileMatrix`;
- `PASS` for both `halio` and `shipToUsers` in `dogfood`; and
- `founderApproved: true`.

The ignored mode-`0600` `.var/private/hobby-release.json` must identify the
same accepted SHA and tested public deployment. `pnpm env:prepare-hobby` and
`pnpm env:import-production --check` both fail closed when either private
contract is absent, malformed, not ignored, too broadly readable, or disagrees
with the current site key or evidence. Preparing the phase marker alone cannot
enable public scans. Never record the Turnstile secret, widget response, API
key, private cost, or scan content in this contract.

For every phase change, set the exact marker first, run
`pnpm env:prepare-hobby`, then repeat both strict `--check` and `--apply`
imports above. Have the founder deploy both accepted surfaces so their
value-bound attestations and public provenance agree. Smoke the new immutable
public deployment before making that exact deployment Current, repeat the
public smoke at its stable origin, and repeat the application-authenticated ops
acceptance. A rollback uses the same sequence with the previous exact phase;
never toggle `PUBLIC_SCANS_ENABLED` independently.

The public surface receives only the public, member, auth, and worker pooled
database URLs; the CA; its own `SESSION_SECRET`; `API_KEY_PEPPER`; public
Supabase Auth values; Turnstile values; the public-only `CRON_SECRET`; bounded
provider/model policy; and the exact effect flags. It must not receive any ops,
billing, retention, direct, admin, owner, or `service_role` credential.

The ops surface receives only `OPS_DATABASE_URL`; the CA; a distinct
`SESSION_SECRET`; `OPS_TOKEN`; provider verification inputs; public deployment
provenance; policy/rate controls; and the exact effect flags. It must not
receive public/member/auth/worker/billing/retention database URLs,
`CRON_SECRET`, Supabase browser values, Turnstile values, direct/admin URLs, or
alert secrets.

`API_KEY_PEPPER` is the sole deliberate cryptographic cross-surface exception:
ops hashes the project-scoped keys it issues and the public API verifies those
hashes. Rotate it only with an API-key reissue plan. Public and ops session
secrets are independent; `OPS_TOKEN` never crosses to public, and
`CRON_SECRET` never crosses to ops.

## Hobby cron

The only Hobby cron is on the public project:

```text
path: /api/cron/monitoring
schedule: 0 7 * * *
invocation window: 07:00–07:59 UTC each day
```

Hobby may invoke a daily cron at any point in that UTC hour. The route has a
300-second Function budget, authenticates a fresh 48-byte `CRON_SECRET`, and
uses `WORKER_DATABASE_URL`. With `MONITORING_ENABLED=false` and
`PAID_MONITORING_ENABLED=false`, it must claim no project scan; only bounded
operational reconciliation may run. Halio and ShipToUsers scans are started
manually through the API. Do not add a billing bypass.

The deployed acceptance test is: no Authorization returns `401`, an incorrect
Bearer returns `401`, the correct Bearer returns `200`, no monitoring scan is
claimed, reconciliation is bounded, and neither secrets nor private costs
appear in logs. The ops project is deliberately cron-free on Hobby; retention
remains a controlled manual/recovery operation until a separately approved
scheduler exists.

## xAI cost settlement

xAI's canonical reported cost field is `usage.cost_in_usd_ticks`, where
`10,000,000,000` ticks equals USD 1. Only a non-negative safe integer or a
digit-only integer string is accepted. Valid ticks take precedence over legacy
USD fields for X Search and over token-price reconstruction for xAI synthesis.
If ticks are missing or malformed, the bounded legacy/token-price fallback is
used; if no valid actual is available, the conservative reservation remains
unsettled. Cost values stay private.

## Turnstile gate

Use a dedicated TrendsFast widget with the exact server action `public_scan`
and only these hostnames:

- `trendsfast.vercel.app`
- `trendsfast.com`
- `www.trendsfast.com`

Before `PUBLIC_SCANS_ENABLED=true`, prove valid, missing, forged, replayed,
expired, wrong-action, and wrong-hostname behavior. A credential health check
is not hostname-configuration proof.

## Accepted release and founder deploy

The two deployment scripts require a clean local and remote accepted SHA on
either `main` or `sol/hobby-launch-dogfood`. They also require the ignored
`.var/private/hobby-release.json` to be a regular mode-`0600` file:

```json
{
  "version": 1,
  "acceptedBranch": "sol/hobby-launch-dogfood",
  "acceptedSha": "<exact-lowercase-40-character-SHA>"
}
```

The public script verifies the pinned project/team/root, Fluid Compute,
300-second duration, exact environment name set, config, and release
provenance. It deploys with `--skip-domain`, then atomically records only the
safe public deployment host and `dpl_...` ID into the private release contract.
The ops script requires that provenance, temporarily links the exact ops
project, verifies its exact environment/config and accepted SHA, deploys only
to generated Vercel hosts, and restores the public repository link
byte-for-byte. Neither script mutates Stripe or a custom domain, and neither may
be run with `bash -x`.

Only the founder runs these exact commands, in this order:

```bash
bash scripts/deploy-hobby-production.sh
bash scripts/deploy-hobby-ops.sh
```

The first safe handoff marker is `FOUNDER_HOBBY_DEPLOY_REQUIRED`. Resume only
with both safe deployment URLs after the founder runs the commands. At the time
this document was written, neither command had been run for this release.

## Post-deploy acceptance

Smoke the immutable public deployment before changing the stable generated
origin:

| Probe                                       | Required result                       |
| ------------------------------------------- | ------------------------------------- |
| `/`                                         | `200`                                 |
| `/login`                                    | `200`                                 |
| `/dashboard`                                | same-origin redirect to `/login`      |
| `/ops`                                      | `404`                                 |
| `/v1/openapi.json`                          | `200`                                 |
| `/api/sources`                              | `200`                                 |
| `POST /api/scan-requests`                   | `503` while public scans are disabled |
| `/api/cron/monitoring` without/wrong bearer | `401`                                 |
| error/fatal log read-back                   | no unexpected errors                  |

Only after the immutable smoke succeeds, make that exact deployment Current at
`https://trendsfast.vercel.app` and repeat the smoke. Verify the app-protected
ops deployment separately: unauthenticated requests disclose no private data;
invalid `OPS_TOKEN` admission fails; founder login establishes a signed
session; review queue, edit-and-approve, grants, show-once API-key issuance, and
private bundle export work; and indexing and public cross-origin access remain
denied. Do not record Vercel Authentication as the Production access proof. A
healthy deploy alone does not mark any provider Connected; each provider still
needs one bounded read-back with deployment provenance, canonical source URL,
latency, quota, private cost, no-result/timeout behavior, and a secret-redaction
check.

## Domain gate

Only after the generated origin is stable may the operator associate:

```bash
vercel domains add trendsfast.com trendsfast
vercel domains add www.trendsfast.com trendsfast
vercel domains inspect trendsfast.com
vercel domains inspect www.trendsfast.com
```

Return `DNS_ACTION_REQUIRED` with the exact Vercel-assigned Spaceship records;
do not substitute generic DNS instructions. After the founder reports
`DNS_APPLIED=YES`, verify public DNS, trusted TLS, one permanent
`www` → apex redirect, Turnstile hostname acceptance, and no mixed content.
Then change both public `APP_URL` and `PUBLIC_APP_URL` to
`https://trendsfast.com` by setting
`SOL_HOBBY_ENVIRONMENT_PHASE=canonical-origin-scans-off`, then run the full
prepare, strict import/read-back, founder deploy, and immutable-smoke sequence
above. Make that exact deployment Current, repeat the stable smoke, and verify
canonical metadata against the accepted canonical-origin deployment. The ops
`APP_URL` remains its generated Vercel origin; its `PUBLIC_APP_URL` becomes the
canonical public origin, and no custom domain is attached to ops.

## Completion boundary

Internal API acceptance creates one founder-owned TrendsFast project, one
time-bounded founder grant, and one show-once project-scoped API key whose hash
alone is stored. Prove create `202`, polling, `REVIEW_REQUIRED`, founder
edit/approval, delivery, and final `READY`, including project isolation,
idempotency, canonical evidence URLs, `founder_reviewed=true`, and
`auto_publish=false`.

That infrastructure loop permits the final marker
`READY_FOR_HALIO_AND_SHIPTOUSERS_DOGFOOD`. It is not paid-launch readiness.
Halio and ShipToUsers recommendation-quality dogfood remains a separate next
step, and `PUBLIC_SCANS_ENABLED` stays `false` until that dogfood and the full
Turnstile matrix pass. Only then set
`SOL_HOBBY_ENVIRONMENT_PHASE=canonical-origin-scans-on` and repeat the complete
phase-change sequence; do not toggle the derived scan flag directly.

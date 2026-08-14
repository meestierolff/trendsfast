# Reproducible Vercel setup

This procedure implements the free, pre-revenue Hobby topology. It does not
make an unaudited deployment a launch and does not authorize paid customers.
The canonical current contract is the
[2026-08-13 Hobby launch runbook](HOBBY_LAUNCH_2026-08-13.md).

## Pinned projects and current state

The founder-owned `Finnie` team (`team_UVAUfp4G8CmlSNPI9w5FasKj`) is on Hobby.

| Surface     | Project          | Project ID                         | Root       | Region |
| ----------- | ---------------- | ---------------------------------- | ---------- | ------ |
| Public      | `trendsfast`     | `prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC` | `apps/web` | `fra1` |
| Founder ops | `trendsfast-ops` | `prj_EYAjX2Nyd1jUXSjfWVTVoI320nnU` | `apps/web` | `fra1` |

Both projects use Next.js, production branch `main`, Fluid Compute, and a
300-second default Function duration. The public generated origin is
`https://trendsfast.vercel.app`. The ops project keeps only the generated
`https://trendsfast-ops.vercel.app` alias and receives no custom domain.

Vercel Standard Authentication does not protect Production domains or aliases
on Hobby. The ops alias is therefore network-public even though the project
retains its Vercel Authentication setting. Founder access is enforced by the
application: session issuance requires the high-entropy `OPS_TOKEN`, a bounded
constant-time check, and durable admission control; every private ops page and
handler requires a signed session and the exact ops deployment surface. The
unauthenticated login/session-entry routes expose no private ops data. Treat the
Vercel setting only as defense in depth for targets it covers.

The new `sol/hobby-launch-dogfood` release has not yet been deployed. The ops
project has no Production deployment, and neither custom domain has been added
or moved. A historical protected preview remains evidence for its own SHA only;
it is not acceptance for this release.

## Deployment configurations

The root `.vercelignore` is part of the release boundary. It excludes `.env*`,
`.var`, local tool state, caches, test artifacts, database files, key material,
and backups from both public and ops uploads. Before either founder script can
run, `pnpm vercel:verify-source` must prove that the file is tracked in the
accepted SHA, contains no negated rule, excludes every protected sentinel, and
still includes the required application/workspace sources. A Vercel CLI dry run
is supporting evidence, not a substitute for that accepted-SHA check.

This closes a real historical gap: preview deployment
`dpl_8vpd6yDUSVxn9oNH5SobuJWXuN6q` uploaded `.var/private` migrator URL,
runtime-role password/URL, preview-app-secret, policy, and provider-price
bundles, plus local release/tool metadata. It did not upload the backup
passphrase or an encrypted/plaintext database dump. All eight database-role
passwords, the preview-era `SESSION_SECRET` and `API_KEY_PEPPER`, and the launch
cron secret were rotated; the current redacted hosted role verifier passes. The
retired raw local preview-secret bundle was removed. A V13 read-back proved the
historical deployment had no aliases and was not Production, after which that
exact deployment was deleted and confirmed absent. The separate legacy
Supabase-key shutdown remains a release gate.

- `apps/web/vercel.ts` remains the automatic Git/default no-cron config and
  selects a reviewed founder profile only from the local deploy-script selector.
- A later Pro deploy using `apps/web/vercel.pro.json` must set
  `TRENDSFAST_VERCEL_CONFIG_PROFILE=pro`; the Hobby scripts set only `public`
  or `ops`.
- `apps/web/vercel.hobby.json` disables Git deployment from `main`, pins `fra1`,
  and registers the sole Hobby cron: `/api/cron/monitoring` at `0 7 * * *`.
- `apps/web/vercel.ops.json` disables Git deployment from `main`, pins `fra1`,
  and is deliberately cron-free.
- `apps/web/vercel.pro.json` remains unchanged for the later Pro upgrade and
  must not be selected during this Hobby phase.

Hobby may invoke the daily public cron at any time from 07:00 through 07:59
UTC. Retaining the 300-second route budget depends on the verified Fluid
Compute project setting; do not infer it from the plan name alone.

## Strict environments

Prepare and validate the ignored mode-`0600` inventory, then import each exact
Production allowlist through standard input:

```bash
pnpm env:prepare-hobby
pnpm env:import-production --check
pnpm env:import-production --apply
pnpm env:import-ops --check
pnpm env:import-ops --apply
```

The importers reject an unpinned project, wrong root/scope, wrong protection or
Fluid setting, unknown remote variable, missing allowlisted value, forbidden
role URL, weak secret, wrong Supabase project, and wrong launch effect. They
never print values and require an exact name/type read-back before deployment.

The public surface receives only public/member/auth/worker pooled database
roles, the verified CA, its own session secret, the shared API-key pepper,
Supabase publishable Auth values, Turnstile, the public cron secret,
provider/model policy, and the exact launch flags. It never receives ops,
billing, retention, direct/admin/owner, or Supabase `service_role` credentials.

The ops surface receives only its ops database role, the verified CA, a unique
session secret, `OPS_TOKEN`, the shared API-key pepper, bounded provider
verification inputs, public deployment provenance, and exact launch flags. It
never receives the public/member/auth/worker/billing/retention roles,
`CRON_SECRET`, Supabase browser values, Turnstile, direct/admin URLs, or alert
secrets. The shared pepper is necessary because ops issues hashed project keys
that the public API verifies; all other session/control credentials remain
surface-specific.

Keep these values closed on both surfaces:

```env
PUBLIC_SCANS_ENABLED=false
BILLING_ENABLED=false
BILLING_CHECKOUT_ENABLED=false
PAID_MONITORING_ENABLED=false
MONITORING_ENABLED=false
STRIPE_MODE=test
```

Managed provider calls and internal API creation are enabled only for bounded
dogfood. No live Stripe runtime key belongs in either Vercel project.

## Accepted release fence

The founder scripts require a clean local/remote accepted SHA and a regular
mode-`0600` `.var/private/hobby-release.json`:

```json
{
  "version": 1,
  "acceptedBranch": "sol/hobby-launch-dogfood",
  "acceptedSha": "<exact-lowercase-40-character-SHA>"
}
```

Run from the monorepo root, without `bash -x`, in this order:

```bash
bash scripts/deploy-hobby-production.sh
bash scripts/deploy-hobby-ops.sh
```

The public script executes:

```bash
vercel deploy --prod --skip-domain --yes -A apps/web/vercel.hobby.json
```

It verifies the immutable deployment's project, target, region, config, READY
state, and Git SHA, then stores only the safe host and deployment ID in the
private release contract. `--skip-domain` means this does not change
`trendsfast.vercel.app` or a custom domain.

The ops script consumes that public provenance, safely relinks to the exact ops
project, executes:

```bash
vercel deploy --prod --yes -A apps/web/vercel.ops.json
```

It verifies the accepted SHA/config, generated-domain-only inventory, and
defense-in-depth project setting, then restores the public Vercel link
byte-for-byte. It does not claim that Vercel Authentication protects the
Production alias. Each successful script prints only a safe deployment URL and
`dpl_...` ID. Neither script mutates Stripe or domain configuration.

## Post-deploy acceptance

After the founder returns both URLs, smoke the immutable public deployment
before promotion:

- `/` and `/login` return `200`;
- `/dashboard` redirects same-origin to `/login`;
- `/ops` returns `404`;
- `/v1/openapi.json` and `/api/sources` return `200`;
- `POST /api/scan-requests` returns `503` while public scans are disabled;
- the monitoring cron returns `401` without or with the wrong Bearer and `200`
  with the correct secret, while claiming no monitoring scan;
- error/fatal logs have no unexpected entries.

Only then make that exact deployment Current at the generated public origin and
repeat the smoke. Separately verify that the ops Production alias exposes no
private data without an application session, rejects an invalid `OPS_TOKEN`,
establishes a signed founder session after valid admission, and enforces the ops
surface on review/edit-and-approve, grants, API-key issuance, and private bundle
export. Verify no indexing and no public cross-origin access. Vercel
Authentication is not the Production access proof on Hobby.

## Domain and rollback

Follow [DOMAIN_CHECKLIST.md](DOMAIN_CHECKLIST.md) only after the generated
origin passes. Vercel association is not DNS proof: return the exact assigned
records for founder application at Spaceship, then verify public DNS, TLS,
canonical metadata, Turnstile hostname, and the `www` → apex redirect.

To roll back, first disable public scan creation, monitoring, and Checkout.
Promote or redeploy only a schema-compatible known-good SHA, preserve database
and Stripe audit state, and record the incident. A deployment timeout after an
external effect is indeterminate until Vercel Current state is read back.

# Production deployment procedure

The current production target is a deliberately limited, pre-revenue Vercel
Hobby release. Follow the exact dated contract in
[HOBBY_LAUNCH_2026-08-13.md](HOBBY_LAUNCH_2026-08-13.md). This runbook does not
authorize paid Checkout, a customer charge, paid monitoring, or a public scan
until their independent gates pass.

Current pre-deploy truth: the sole Supabase production project is
`auxienkuufejeakaczlq`; the public Vercel project is `trendsfast`; the cron-free
founder project is `trendsfast-ops`. The new release has not been deployed, the
ops project has no Production deployment, and the custom domains have not been
associated or moved. The ops project has only its generated Vercel alias; on
Hobby that Production alias is not protected by Standard Vercel Authentication.

## 1. Release preflight

1. Start from the accepted branch/SHA with a clean worktree and matching remote
   SHA. Keep protected GitHub checks active.
2. Verify Vercel, Supabase, Stripe CLI, and GitHub identities without printing
   tokens. Confirm `.env.production.local` is ignored, regular, and mode `0600`.
3. Confirm both Vercel projects are in the founder team, use `apps/web`, `fra1`,
   Fluid Compute, and a 300-second default Function duration. Confirm the ops
   project has only its generated alias and no custom domain. Retain the Vercel
   Authentication setting as defense in depth, but do not count it as
   Production access control on Hobby.
4. Keep the effect state exact: managed providers and internal API creation on;
   public scans, Checkout, billing, monitoring, and paid monitoring off;
   `STRIPE_MODE=test`.
5. Do not reopen the topology: use one Supabase project, two Vercel surfaces,
   and one public daily cron.
6. Run `pnpm vercel:verify-source` against the accepted SHA. It must prove the
   tracked root `.vercelignore` excludes local environments, `.var`, tool state,
   caches, test output, database files, keys, and backups while preserving
   required application/workspace sources.

## 2. Database acceptance

The single project ref `auxienkuufejeakaczlq` is production regardless of its
historical display label. Do not create a production clone, preview database,
branch, or second restore-test project.

Before mutation, create and list/read an encrypted logical backup:

```bash
pnpm db:backup
```

Then run the unseeded idempotent sequence:

```bash
pnpm db:migrate
pnpm db:verify-hosted
pnpm db:provision-runtime-roles
pnpm db:verify-runtime-roles
```

Acceptance requires the exact migration ledger and current 44-table manifest;
pinned CA verification; migrator ownership; clean default ACLs; isolated
public, member, auth, worker, ops, billing, and retention runtime roles; and zero
application-object access for `anon`, `authenticated`, and `service_role`.
Every runtime URL is pooled and role-scoped. Direct migrator and restricted
operator URLs remain in the controlled release environment and never reach
Vercel.

A historical preview source upload nevertheless included private migrator,
runtime-role URL/password, and preview-application-secret bundles plus policy,
provider-price, release, and local-tool metadata. It did not include the backup
passphrase or any encrypted/plaintext dump. Treating that boundary crossing as
exposure, all eight PostgreSQL role passwords, the preview-era application
secrets (`SESSION_SECRET` and `API_KEY_PEPPER`), and the launch cron secret were
rotated. The current redacted hosted runtime-role verifier passes after
rotation. The retired raw local preview-secret bundle was removed, and the
unaliased non-Production historical deployment was deleted after the sanitized
path inventory was retained. This is credential-remediation evidence, not
deployment acceptance; legacy Supabase-key shutdown remains open.

Treat the previously surfaced legacy Supabase `service_role` key as exposed.
Prove it is absent from Git and both Vercel environments, never use it, and
disable/rotate it through the supported Supabase legacy-key migration path
without resetting the project. Vercel may receive only the modern Auth
publishable key.

## 3. Environment import

Use the strict allowlisted importers; do not manually copy a broad environment:

```bash
pnpm env:prepare-hobby
pnpm env:import-production --check
pnpm env:import-production --apply
pnpm env:import-ops --check
pnpm env:import-ops --apply
```

The public surface receives only the public/member/auth/worker roles, CA,
public session, shared API-key pepper, Supabase publishable pair, Turnstile,
public cron secret, provider/model policy, and launch flags. Ops receives only
the ops role, CA, its unique session, ops token, shared pepper, provider
verification inputs, public deployment provenance, and launch flags. Direct,
admin, owner, billing, retention, and `service_role` credentials are forbidden
from both current Vercel allowlists. `OPS_TOKEN` is forbidden from public and
`CRON_SECRET` is forbidden from ops.

## 4. Founder-controlled deployment

Create the ignored mode-`0600` accepted-release contract documented in
[VERCEL_SETUP.md](VERCEL_SETUP.md). After every code/config/env gate is green,
stop for the founder with `FOUNDER_HOBBY_DEPLOY_REQUIRED` and exactly:

```bash
bash scripts/deploy-hobby-production.sh
bash scripts/deploy-hobby-ops.sh
```

Do not run `vercel deploy --prod` on the founder's behalf. The public script
creates an immutable Production deployment with `--skip-domain`; it does not
promote or attach a domain. The ops script deploys the cron-free,
application-protected surface to generated Vercel hosts only and restores the
repository's public Vercel link. Both verify the exact accepted SHA and print
only a safe URL and deployment ID.

## 5. Immutable and stable-origin verification

On resume, verify the immutable public URL before making it Current. Required
results are `/` and `/login` `200`; same-origin `/dashboard` redirect to
`/login`; `/ops` `404`; `/v1/openapi.json` and `/api/sources` `200`; public scan
creation `503`; monitoring cron no/wrong bearer `401`; correct bearer `200` with
no project scan claimed; and no unexpected error/fatal logs.

Verify ops independently at its edge-public Production alias: no private data
without an application session, invalid `OPS_TOKEN` rejection, valid founder
admission and signed session, exact ops-surface guards, review queue,
edit-and-approve, grants, show-once project API-key issuance, private bundle
export, no indexing, and no public cross-origin access. Do not use the Vercel
Authentication setting as this Production access proof.

Only after those checks should the exact immutable public deployment become
Current at `https://trendsfast.vercel.app`. Repeat the public checks against the
stable generated origin.

## 6. Providers, Stripe catalog, and API dogfood

Exercise providers in the fixed order: website, Hacker News, Google Trends via
DataForSEO, Tavily, X via xAI, GitHub, YouTube, and manual evidence. Each source
needs a bounded deployed read-back with release/deployment provenance,
canonical source URL, latency, quota, private cost, timeout/no-result behavior,
and secret-redaction proof. Credential health alone does not mark a source
Connected.

xAI actual-cost settlement accepts canonical `usage.cost_in_usd_ticks` at
10,000,000,000 ticks per USD. Missing or malformed ticks use the bounded legacy
or token-price fallback; cost remains conservative and unsettled when no valid
actual exists.

The Stripe CLI may idempotently create/reuse only Product `TrendsFast Founder`
and the exclusive-tax recurring EUR 39/month Price with lookup key
`trendsfast_founder_monthly_eur`. Verify it created no customer, subscription,
Checkout Session, PaymentIntent, or charge. Record only safe `prod_...` and
`price_...` IDs. Do not install a live Stripe key, webhook, Checkout button, or
paid entitlement on Hobby.

For internal API acceptance, issue one show-once project-scoped key under a
founder grant, storing only its hash. Prove create → poll →
`REVIEW_REQUIRED` → founder review/edit-and-approve → delivery → `READY`, with
project isolation, idempotency, canonical evidence, a valid action enum,
`founder_reviewed=true`, and `auto_publish=false`.

## 7. Domain and public-scan gate

After the generated origin passes, associate `trendsfast.com` and
`www.trendsfast.com`, inspect both, and return the exact Vercel-assigned records
under `DNS_ACTION_REQUIRED`. The founder applies them at Spaceship. After
`DNS_APPLIED=YES`, verify DNS, trusted TLS, apex canonical metadata, one
permanent `www` → apex redirect, no mixed content, and the dedicated Turnstile
widget on all three allowed hostnames.

The redirect is application-owned in `apps/web/next.config.ts`: an exact
`www.trendsfast.com` host condition permanently redirects the shared
`/:path*` to `https://trendsfast.com/:path*`. Next.js preserves the incoming
query because the destination does not replace it. The exact host condition
keeps the generated public and ops aliases outside this rule.

Update public `APP_URL`/`PUBLIC_APP_URL` and ops `PUBLIC_APP_URL` to
`https://trendsfast.com` by setting the local inventory marker
`SOL_HOBBY_ENVIRONMENT_PHASE=canonical-origin-scans-off`. Run
`pnpm env:prepare-hobby`, repeat both strict check/apply imports, founder-deploy
both accepted surfaces, smoke the new immutable public deployment, make that
exact deployment Current, and repeat the stable-origin and ops acceptance.
Keep this phase until Halio and ShipToUsers recommendation-quality dogfood and
the complete Turnstile valid/missing/forged/replayed/expired/wrong-host matrix
pass. Only then set
`SOL_HOBBY_ENVIRONMENT_PHASE=canonical-origin-scans-on` and repeat the same
prepare/import/deploy/smoke/Current sequence. Never edit the derived
`APP_URL`, `PUBLIC_APP_URL`, or `PUBLIC_SCANS_ENABLED` values independently;
the preparation command replaces them from the marker.

Before selecting scans-on, record the results in ignored regular mode-`0600`
`.var/private/hobby-scan-enablement.json`. Its exact schema and required
deployment/SHA, site-key hash, `public_scan`, three-hostname, seven-outcome,
Halio, ShipToUsers, and founder-approval fields are defined in the Hobby launch
runbook. Both prepare and the strict public importer validate this private
contract against `.var/private/hobby-release.json`; the phase marker by itself
is never sufficient.

## 8. Rollback

Disable public scan creation, monitoring, and Checkout first when integrity or
spend is at risk. Promote or redeploy only a schema-compatible known-good SHA.
Prefer forward repair over a destructive reverse migration. Preserve result,
cost, access, review, and Stripe audit history, and record the owner, time,
reason, data impact, and follow-up.

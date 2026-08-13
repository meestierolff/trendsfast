# Reproducible Vercel setup

This procedure is executable only after the release SHA, remote CI, database,
and secret inventory are approved. It does not make an unaudited deployment a
public launch.

Observed project configuration on 2026-08-13: the founder-owned team `Finnie`
(`team_UVAUfp4G8CmlSNPI9w5FasKj`) is on Hobby. One linked, protected-dogfood public
project exists: `trendsfast` (`prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC`). Its verified
Root Directory is `apps/web` and its production branch is `main`. The latest
deployment inventory has no accepted deployment, alias, custom domain, or active
cron. Upgrade the team to Pro before commercial production. This inventory is
not deployment evidence. No separate `trendsfast-ops` project exists. Creating
it on an approved plan, protecting it, and reading back its private
deployment/cron are founder blockers.

## Preflight and existing-project check

```bash
vercel --version
vercel whoami
vercel project ls
```

Do not create a duplicate with a similar name. From the repository root, verify
the existing link before any deployment:

```bash
vercel link --yes --project trendsfast
vercel git connect --yes
vercel project inspect trendsfast
```

The verified remote configuration uses `apps/web` as its Root Directory, so
automatic Git deployments discover `apps/web/vercel.json`. It uses Next.js,
Node 22, production branch `main`, a frozen pnpm install, and the web workspace
build. Preserve monorepo workspace-package access and do not run migrations in
the build.

`apps/web/vercel.json` is deliberately the no-cron default, making automatic
Git previews and Hobby deployments safe. `apps/web/vercel.pro.json` is the
explicit Pro-only public configuration containing the ten-minute monitoring
cron. `apps/web/vercel.hobby.json` remains a no-cron compatibility config, but
the default is preferred. For reviewed CLI deployments from the repository
root, select `-A apps/web/vercel.json` on Hobby and only after Pro and monitoring
approval select `-A apps/web/vercel.pro.json`. A deployment is not accepted
until its inspect/read-back proves the intended config was applied.

The founder control plane must be a separate Vercel project, not another domain
on the public deployment. After Pro/Deployment Protection approval, create or
link the exact `trendsfast-ops` project from the repository root, set its Root
Directory to `apps/web`, and verify it before deployment:

```bash
vercel link --yes --project trendsfast-ops
vercel project inspect trendsfast-ops
```

Set `TRENDSFAST_SURFACE=ops`, its private `APP_URL`, the exact public project's
canonical origin as `PUBLIC_APP_URL`, `OPS_TOKEN`,
`SESSION_SECRET`, `API_KEY_PEPPER`, `CRON_SECRET`, `DATABASE_SSL_CA`, and only
the scoped URLs it executes (`OPS_DATABASE_URL` and `RETENTION_DATABASE_URL`,
plus `WORKER_DATABASE_URL`/other role URLs only when an enabled route actually
requires them). Configure Vercel Deployment Protection/account access and
verify unauthenticated requests are blocked before founder route authentication.
Do not copy the public project's domain or public traffic configuration.
The ops `APP_URL` must remain the protected ops origin; delivery responses use
`PUBLIC_APP_URL` so private founder links open only on the public deployment.

Never set `OPS_TOKEN` on the public project. Generate a different
`SESSION_SECRET` for the public and ops projects and verify their environment
fingerprints differ without printing either value. The shared `API_KEY_PEPPER`
is the deliberate exception: ops issues keys whose hashes the public API must
verify, so rotate it only through the documented cross-surface key-rotation
procedure.

## Secret-safe environment setup

Set every server variable separately for preview and production. Pipe values
from the founder's secret manager so they do not appear in shell history:

```bash
printf '%s' "$VALUE" | vercel env add VARIABLE preview --sensitive
printf '%s' "$VALUE" | vercel env add VARIABLE production --sensitive
```

Review names/scopes with `vercel env ls`; never print values. Keep billing,
trials, promotions/coupons, and paid monitoring disabled until their gates pass.
Preview and production must use different databases, salts, sessions, provider
credentials where available, and Stripe webhook secrets.

## Preview-first deployment

```bash
vercel deploy -A apps/web/vercel.json
vercel curl / --deployment <preview-url>
vercel logs --deployment <deployment-id> --level error
DEPLOYMENT_URL=<preview-url> pnpm verify:deployment
```

Run the URL-first scan, status, ops review/delivery, evidence, feedback, API
idempotency/limits, source status, mobile, accessibility, and security-header
checks against the preview. Run provider read-backs separately and record them;
a successful deploy does not mark sources Connected.

Only after preview acceptance, deploy the same reviewed tree with the no-cron
default while the team remains on Hobby and paid monitoring remains disabled:

```bash
vercel deploy --prod -A apps/web/vercel.json
```

Then repeat the deployment verifier and an independent browser/API smoke. Check
logs for errors without emitting request bodies, capability tokens, API keys,
model payloads, evidence text, or payment data.

Only after the team is on Pro and every paid-monitoring gate passes, opt in to
the monitoring schedule with the same accepted release SHA:

```bash
vercel deploy --prod -A apps/web/vercel.pro.json
```

Deploy the separately linked private control plane only after its gates pass:

```bash
vercel deploy --prod -A apps/web/vercel.ops.json
vercel inspect <ops-deployment-url>
```

The inspect/read-back must show project `trendsfast-ops`, Root Directory
`apps/web`, Deployment Protection, `TRENDSFAST_SURFACE=ops`, and the daily
`/api/cron/retention` schedule. Exercise the exact cron bearer and verify the
aggregate health result without logging secret values or deleted rows.

## Domain and rollback

Follow [DOMAIN_CHECKLIST.md](DOMAIN_CHECKLIST.md). A domain command can add a
project association; the registrar may still require manual DNS changes.

To roll back, first disable new scans, monitoring, and checkout. Promote or
redeploy only a schema-compatible known-good SHA. Preserve database and Stripe
audit state.

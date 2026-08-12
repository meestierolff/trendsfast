# Reproducible Vercel setup

This procedure is executable only after the release SHA, remote CI, database,
and secret inventory are approved. It does not make an unaudited deployment a
public launch.

Observed state on 2026-08-12: no TrendsFast Vercel project exists, and the
authenticated team `clarios-projects-05f6a57e` is on a Hobby plan. Upgrade that
founder-owned team to Pro before commercial production. Treat every step below
as unexecuted provisioning, not an existing-project or deployment claim.

## Preflight and existing-project check

```bash
vercel --version
vercel whoami
vercel project ls
```

First confirm whether a founder-owned `trendsfast` project has since been
created; do not create a duplicate with a similar name. From the repository
root, only after that ownership check:

```bash
vercel link --yes --project trendsfast
vercel git connect --yes
vercel project inspect trendsfast
```

Configure the project as Next.js with `apps/web` as its Root Directory,
production branch `main`, and source outside the Root Directory included so the
workspace packages resolve. Prefer workspace auto-detection, a frozen pnpm
install, and the default application build; override only when a preview proves
the defaults fail. Do not run migrations in the build.

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
vercel deploy
vercel curl / --deployment <preview-url>
vercel logs --deployment <deployment-id> --level error
DEPLOYMENT_URL=<preview-url> pnpm verify:deployment
```

Run the URL-first scan, status, ops review/delivery, evidence, feedback, API
idempotency/limits, source status, mobile, accessibility, and security-header
checks against the preview. Run provider read-backs separately and record them;
a successful deploy does not mark sources Connected.

Only after preview acceptance, deploy the same reviewed tree:

```bash
vercel deploy --prod
```

Then repeat the deployment verifier and an independent browser/API smoke. Check
logs for errors without emitting request bodies, capability tokens, API keys,
model payloads, evidence text, or payment data.

## Domain and rollback

Follow [DOMAIN_CHECKLIST.md](DOMAIN_CHECKLIST.md). A domain command can add a
project association; the registrar may still require manual DNS changes.

To roll back, first disable new scans, monitoring, and checkout. Promote or
redeploy only a schema-compatible known-good SHA. Preserve database and Stripe
audit state.

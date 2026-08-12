# Production deployment procedure

This is an unexecuted runbook for the intended Vercel + hosted PostgreSQL
deployment. It does not prove that accounts, DNS, credentials, migrations,
providers, or `trendsfast.com` are configured.

Observed external state on 2026-08-12: no TrendsFast Supabase or Vercel project
exists, the authenticated Vercel team `clarios-projects-05f6a57e` is on a Hobby
plan, and `trendsfast.com` returns `NXDOMAIN`. The founder must upgrade that team
to Pro, create the database/project, and later apply only Vercel's exact assigned
DNS records. These are launch blockers, not permission to infer infrastructure.

Do not execute this as a public launch while the current known gates remain
open: live website/provider/model read-backs, scheduled retention and an
authenticated privacy-request workflow, a reviewed policy for explicit retry
after an uncertain provider effect or charge, model actual-usage reconciliation
and operator price verification, release browser/accessibility/security
acceptance, deployed public-capability lookup throttling, and approved legal
documents. Manual evidence and API-key founder operations exist, but require
release-SHA acceptance. Billing, usage, monitoring, and expanded analytics work
is in progress and must remain disabled/unclaimed until its separate matrix
passes.

## 1. Preflight

1. Choose and record the exact release SHA; require green CI and all applicable
   unchecked items in [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md).
2. Founder creates/owns the GitHub repository, Vercel project with a suitable
   commercial plan, Supabase project used only as PostgreSQL, provider accounts,
   and monitoring/error-reporting project.
3. Create separate preview and production databases/secrets. Restrict team
   access, enable MFA, backups, point-in-time recovery if available, and alerts.
4. Confirm a direct PostgreSQL connection for controlled migrations and a
   runtime connection appropriate for serverless pooling. Use the URL format
   the application/driver actually supports; never expose it to the browser.
5. Verify the platform overwrites untrusted forwarding headers and document the
   trusted-proxy boundary. Public admission and auth-abuse fingerprints use
   request network metadata; application-level controls do not make a spoofable
   proxy chain trustworthy.
6. Put public scan/status/result capability lookups behind an independently
   verified edge throttle. The 256-bit tokens make guessing impractical but do
   not supply request-volume control by themselves.

## 2. Environment

Set every variable in `.env.example` explicitly in Vercel's correct environment.
For the first deployment keep:

```env
APP_URL=https://trendsfast.com
PROVIDER_CREDENTIAL_MODE=managed
PUBLIC_SCAN_PROCESSING=inline
BILLING_ENABLED=false
PAID_MONITORING_ENABLED=false
FOUNDING_100_ENABLED=false
CLOUD_TRIAL_ENABLED=false
STRIPE_MODE=test
DATAFAST_ENABLED=false
```

Fixture mode is for local deterministic verification and must not be made
available on a hosted origin. Configure only the reviewed managed providers,
their explicit prices, and all cost ceilings before a hosted real scan; missing
configuration must fail closed.

Generate production `OPS_TOKEN`, `SESSION_SECRET`, and `API_KEY_PEPPER` with at
least 32 random characters in a secret manager. Set pooled `DATABASE_URL` only
in the runtime and keep `DIRECT_DATABASE_URL` in the controlled migration and
verification environment. Leave unverified provider credentials empty. Do not place secrets in
`NEXT_PUBLIC_*`, build arguments, CI output, or shell history.

Before enabling a non-fixture synthesis provider, set both
`LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS` and
`LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS` from a dated, operator-reviewed price
schedule. These values drive conservative pre-call reservations; they are not
provider-verified usage or invoice reconciliation.

## 3. Database

From a controlled release environment with the production direct and pooled
connections set separately:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
STRICT_HOSTED_SCHEMA=1 pnpm db:verify-hosted
```

Load both URLs from the secret manager before these commands without echoing
them. Controlled migrate/verify work must resolve `DIRECT_DATABASE_URL`; do not
substitute the transaction pooler.

Do not seed synthetic demo/customer data into production unless the seed command
has an explicit production-safe fixture contract and has been reviewed. Record
migration version and output with credentials redacted. Verify the new schema
using read-only checks and application health before traffic.

The current local working tree contains 18 migration files through latest
`0019`, with intentional `0009`/`0010` numbering gaps. An isolated PostgreSQL 16
replay passed with all 18 migration hashes matched, the fixture seed passed
twice, and the strict hosted-schema verifier matched 37/37 public tables plus
its exact columns, enums, indexes, constraints, and effective/default ACL denial
for `PUBLIC`, `anon`, and `authenticated`. That is local evidence, not a hosted
database read-back. Freeze the release, repeat the full replay and verifier at
its immutable SHA using `DIRECT_DATABASE_URL`, record the exact ledger/version,
and verify pooled runtime connectivity before traffic. Never seed preview or
production. Run
`pnpm db:purge` only from a reviewed, single-owner scheduled job with alerts and
retained aggregate counts; the web application does not schedule retention
itself.

## 4. Vercel deployment

Import the verified GitHub repository into one founder-owned `trendsfast`
project with `apps/web` as the Vercel Root Directory while retaining monorepo
workspace access, a frozen pnpm install, and the application build. Confirm the
team is on a suitable commercial plan and that Node/runtime/function limits
match the bounded scan design. Never run migrations from a Vercel build.

Deploy the release SHA to preview first. Run fixture smoke, security headers,
private-token, durable API/ops admission, processing-fence/unknown-provider
recovery, concurrent API cost-admission/idempotency races, public lookup edge
throttling, model-budget, and mobile checks. Promote/deploy the same SHA to
production; do not rebuild from a different commit.

## 5. Domain and post-deploy

Founder configures `trendsfast.com`/`www` DNS using the exact Vercel instructions
shown for the project, waits for TLS, chooses one canonical host, and verifies
redirects and secure cookies. From an independent network/session:

- open homepage, sources, open metrics, docs, and open-source pages;
- run a fixture scan through review/delivery/feedback;
- verify no provider call, secret, fake metric, checkout, or public result;
- verify logs, cost ledger, audit events, rate limiting, and alerts;
- verify public count/duplicate/insert admission and auth fingerprints behind
  the deployed proxy, including cross-instance limits;
- verify concurrent API creations cannot each consume the same per-key
  rolling-hour budget, exact boundary comparisons behave as documented, and a
  crashed request reservation remains effective for the full hour;
- exercise retention in a disposable production-shaped database and verify the
  privacy-request operating procedure without exposing row data;
- run the production read-back checklist separately for each provider intended
  for launch, including the pinned website transport and abort behavior, then
  update source status;
- confirm non-fixture model reservations use the approved dated input/output
  prices and remain labeled unknown until actual usage can be reconciled.

## 6. Rollback

Disable new scans/provider adapters first when integrity or spend is at risk.
Redeploy the prior known-good SHA only if its schema is compatible. Prefer a
forward migration repair; never automatically reverse or delete production
schema/data. Keep result access and audit history where safe. Record rollback
reason, owner, time, data impact, and follow-up.

# Production deployment procedure

This is an unexecuted runbook for the intended Vercel + hosted PostgreSQL
deployment. It does not prove that accounts, DNS, credentials, migrations,
providers, or `trendsfast.com` are configured.

Do not execute this as a public launch while the current known gates remain
open: live website/provider/model read-backs, scheduled retention and an
authenticated privacy-request workflow, a reviewed policy for explicit retry
after an uncertain provider effect or charge, model actual-usage reconciliation
and operator price verification, release browser/accessibility/security
acceptance, deployed public-capability lookup throttling, and approved legal
documents. Billing routes are absent and must remain disabled. The
manual-evidence adapter also has no callable entry surface.

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
PROVIDER_CREDENTIAL_MODE=fixture
PUBLIC_SCAN_PROCESSING=inline
BILLING_ENABLED=false
STRIPE_MODE=test
DATAFAST_ENABLED=false
```

Generate production `OPS_TOKEN`, `SESSION_SECRET`, and `API_KEY_PEPPER` with at
least 32 random characters in a secret manager. Set `DATABASE_URL`. Leave
unverified provider credentials empty. Do not place secrets in
`NEXT_PUBLIC_*`, build arguments, CI output, or shell history.

Before enabling a non-fixture synthesis provider, set both
`LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS` and
`LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS` from a dated, operator-reviewed price
schedule. These values drive conservative pre-call reservations; they are not
provider-verified usage or invoice reconciliation.

## 3. Database

From a controlled release environment with the production `DATABASE_URL`:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
```

Do not seed synthetic demo/customer data into production unless the seed command
has an explicit production-safe fixture contract and has been reviewed. Record
migration version and output with credentials redacted. Verify the new schema
using read-only checks and application health before traffic.

The current schema has eight ordered migrations, `0000` through `0007`,
including processing fences, PostgreSQL-backed authentication-admission buckets,
and persisted API request cost reservations. Migration `0007` backfills existing
rows with reservation `0`. If production already has queued API work, drain it
or operationally backfill conservative reservations before enabling concurrent
traffic; otherwise old queued work is absent from the new fail-safe reservation
total. Run `pnpm db:purge` only from a reviewed, single-owner scheduled job with
alerts and retained aggregate counts; the web application does not schedule
retention itself.

## 4. Vercel deployment

Import the verified GitHub repository into Vercel with repository root as the
project root, pnpm install based on the lockfile, and `pnpm build`. Confirm the
Node runtime and server-function duration match the repository requirements and
bounded scan design.

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

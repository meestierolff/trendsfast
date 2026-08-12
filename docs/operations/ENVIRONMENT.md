# Environment reference

`.env.example` is the machine-adjacent template; this file explains purpose and
gates. Empty provider variables mean “not configured,” never “verified.” Never
commit values or paste them into support, issues, logs, or screenshots.

## Runtime and database

| Variable                               | Default/example         | Purpose                                                    |
| -------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `NODE_ENV`                             | `development`           | Runtime environment; managed production uses `production`. |
| `APP_URL`                              | `http://localhost:3000` | Exact canonical origin; managed mode requires HTTPS.       |
| `DATABASE_URL`                         | local PostgreSQL URL    | Server-only pooled/runtime PostgreSQL 15+ connection.      |
| `DIRECT_DATABASE_URL`                  | local PostgreSQL URL    | Direct connection required for controlled migrate/verify.  |
| `PROVIDER_CREDENTIAL_MODE`             | `fixture`               | `fixture`, `managed`, or `byok`.                           |
| `PUBLIC_SCAN_PROCESSING`               | `inline`                | Scan executor policy (`inline` or `manual`).               |
| `PUBLIC_SCAN_DAILY_LIMIT`              | `1`                     | Accepted submissions per fingerprint/rolling 24 hours.     |
| `PUBLIC_SCAN_GLOBAL_DAILY_LIMIT`       | `20`                    | New free scans admitted per UTC day across all instances.  |
| `PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD`  | `5`                     | UTC-day reserved/actual free-scan budget.                  |
| `API_CREATE_RATE_LIMIT_PER_HOUR`       | `20`                    | Expensive create authentications per key/rolling hour.     |
| `API_STATUS_RATE_LIMIT_PER_HOUR`       | `300`                   | Status reads per key/rolling hour.                         |
| `API_AUTH_FAILURE_LIMIT_PER_HOUR`      | `20`                    | Failed auth outcomes per fingerprint/rolling hour.         |
| `API_PROVIDER_COST_LIMIT_USD_PER_HOUR` | empty                   | Required live rolling-hour key cost ceiling.               |
| `SCAN_RETENTION_DAYS`                  | `90` in template        | Cutoff used by `pnpm db:purge`; no scheduler is included.  |
| `MAX_SCAN_DURATION_SECONDS`            | `240`                   | Hard scan duration budget.                                 |
| `PROVIDER_TIMEOUT_MS`                  | `15000`                 | Per-provider attempt timeout.                              |
| `MAX_PROVIDER_COST_USD_PER_SCAN`       | empty                   | Required live admission ceiling; zero only in fixture.     |

## Founder/auth/abuse secrets

| Variable                         | Exposure             | Rule                                                                                  |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `OPS_TOKEN`                      | server secret        | 32+ random characters; managed mode requires it.                                      |
| `SESSION_SECRET`                 | server secret        | 32+ random characters; managed mode requires it.                                      |
| `API_KEY_PEPPER`                 | server secret        | 32+ random characters; managed mode requires it; rotation needs key-reissue planning. |
| `TURNSTILE_ENABLED`              | server config        | `false` by default.                                                                   |
| `TURNSTILE_SECRET_KEY`           | server secret        | Required with site key when Turnstile is enabled.                                     |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | intentionally public | The only provider-adjacent value intended for browser exposure.                       |

Authentication-admission limits are currently code defaults, not environment
variables: syntactically valid `/v1` attempts are bounded to 12 per fingerprint
and 120 globally per one-minute window; ops login is bounded to 5 per
fingerprint and 100 globally per five-minute window. PostgreSQL shares these
buckets across instances before expensive verification, with an additional
process-local in-flight bound. Verify that the deployment replaces untrusted
forwarding headers and supplies the intended client address; environment
validation cannot establish that proxy boundary.

Each API key also has a persisted `providerCostLimitUsd` rolling-hour ceiling.
For creation, fixture mode reserves `$0`; non-fixture mode reserves
`MAX_PROVIDER_COST_USD_PER_SCAN`. The database locks the API-key row, rechecks
idempotency, totals the greater of each recent request reservation or its summed
run `GREATEST(estimated, actual)` cost, and compares exact integer micro-USD
values. A reservation remains in the rolling window for one hour even if the
worker crashes. The default live-key ceiling is copied explicitly from
`API_PROVIDER_COST_LIMIT_USD_PER_HOUR`; it is never derived from the per-scan
ceiling or a committed managed-production constant.

Public form admission is also durable: duplicate/replay attempts consume the
configured `PUBLIC_SCAN_DAILY_LIMIT` instead of bypassing the requester cap.
New work additionally reserves cost inside one PostgreSQL global admission
lock and must fit both UTC-day global limits. Exact duplicate work is reused and
does not reserve global cost twice.

## Evidence/model providers

| Variable                                   | Rule                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `XAI_API_KEY`                              | Server secret for xAI/X Search and optionally synthesis.                  |
| `XAI_MODEL`                                | Explicit approved xAI model; required for configured X where applicable.  |
| `XAI_ESTIMATED_COST_USD_PER_SEARCH`        | Positive explicit estimate when X Search is configured.                   |
| `XAI_MAX_TOOL_CALLS_PER_SCAN`              | Integer 0–2; default 2.                                                   |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | Server credential pair; configure both or neither.                        |
| `DATAFORSEO_GOOGLE_TRENDS_MODE`            | `live` for on-demand scans; `standard` only for reviewed scheduled use.   |
| `DATAFORSEO_ESTIMATED_COST_USD_PER_TASK`   | Positive explicit task estimate.                                          |
| `TAVILY_API_KEY`                           | Server secret.                                                            |
| `TAVILY_ESTIMATED_COST_USD_PER_CREDIT`     | Positive explicit estimate when Tavily is configured.                     |
| `TAVILY_MAX_CREDITS_PER_SCAN`              | Integer 0–2; default 2.                                                   |
| `YOUTUBE_API_KEY`                          | Restricted server API key.                                                |
| `YOUTUBE_INTERNAL_QUOTA_VALUE_USD`         | Explicit nonnegative internal quota valuation when configured.            |
| `YOUTUBE_MAX_SEARCHES_PER_SCAN`            | Integer 0–2; default 2.                                                   |
| `GITHUB_TOKEN`                             | Optional read-only server token; public API path must degrade without it. |
| `LLM_PROVIDER`                             | Explicit `xai` or `openai`; default `xai`.                                |
| `LLM_MODEL`                                | Explicit synthesis model where required.                                  |
| `OPENAI_API_KEY`                           | Server secret when `LLM_PROVIDER=openai`.                                 |
| `LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS`   | Explicit dated operator price; required outside fixture mode.             |
| `LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS`  | Explicit dated operator price; required outside fixture mode.             |

Non-fixture modes require DataForSEO plus at least X or Tavily launch-minimum
coverage and a complete configured synthesis provider. That configuration is
still not a production read-back.

`managed` fails closed without all applicable prices and ceilings. `byok` does
the same unless the self-hoster explicitly sets
`BYOK_ACCEPT_CONSERVATIVE_COST_ESTIMATES=YES`, which selects documented public
samples that must be checked against the self-hoster's own invoices. See
[the commercial boundary](../COMMERCIAL_BOUNDARY.md).

The model client bounds input at 65,536 bytes, response bytes at 262,144,
configured output at no more than 8,192 tokens, and calls at one initial attempt
plus at most one repair. Provider and model attempts durably reserve their
conservative cost before I/O; duplicate reservation refuses a replay. When the
provider supplies valid usage, accounting settles the reservation with that
provider-reported usage. Missing or invalid usage remains conservative and
`unknown_not_settled`; a zero numeric actual field must never be described as
verified free usage. Review the operator price source/effective date privately
for every release and never describe these variables or a local settlement as
independently trusted billing facts.

## Billing and paid monitoring

These variables describe a code-local implementation, not a verified paid
journey. Keep both enablement flags false until the frozen release passes the
complete billing/monitoring gate.

| Variable                        | Current gate                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `BILLING_ENABLED`               | Must remain `false` until the explicit live gate.                                                         |
| `PAID_MONITORING_ENABLED`       | Must remain `false` until durable scheduled runs pass deployment checks.                                  |
| `FOUNDING_100_ENABLED`          | Must remain `false`; no promotion/coupon is part of the launch catalog.                                   |
| `CLOUD_TRIAL_ENABLED`           | Must remain `false` until monitoring and ownership are self-service.                                      |
| `STRIPE_MODE`                   | `test` until live approval.                                                                               |
| `STRIPE_SECRET_KEY`             | Server secret; required only when billing is enabled.                                                     |
| `STRIPE_WEBHOOK_SECRET`         | Server secret; paired with Stripe secret.                                                                 |
| `STRIPE_FOUNDER_CLOUD_PRICE_ID` | Server-side allowlisted price ID; never browser-selected.                                                 |
| `STRIPE_PORTAL_LOGIN_URL`       | Stripe-hosted `/p/login/...` URL; never a local arbitrary-customer route.                                 |
| `CRON_SECRET`                   | 32+ character server secret required for paid monitoring.                                                 |
| `MONITORING_CRON_BATCH_SIZE`    | Sequential due-work batch; default 1, schema maximum 10, and constrained by the 300s route formula below. |
| `MONITORING_LEASE_SECONDS`      | Durable claim lease; must be at least `MAX_SCAN_DURATION_SECONDS + 30`.                                   |

When paid monitoring is enabled, configuration fails closed unless both
constraints hold:

```text
MONITORING_LEASE_SECONDS >= MAX_SCAN_DURATION_SECONDS + 30
MAX_SCAN_DURATION_SECONDS * MONITORING_CRON_BATCH_SIZE + 30 <= 300
```

The defaults satisfy the second constraint (`240 * 1 + 30 = 270`). Increasing
the sequential batch requires lowering the per-scan deadline; the schema's
standalone maximum of 10 is not an independently valid production setting.
These checks encode the current cron-route budget but do not prove that a
scheduler is deployed, configured, or completing within that budget.

## Optional analytics

`DATAFAST_ENABLED=false` by default. `DATAFAST_WEBSITE_ID` is required only when
enabled after privacy review. It is not a substitute for the PostgreSQL event
ledger.

## Fixture baseline

Use the committed `.env.example`, keep all provider/Stripe secrets empty, and
replace the three placeholder local secrets before testing privileged paths.
Fixture mode must never call upstream providers.

## Production checks

Validate the entire environment at process start; fail closed on partial secret
pairs, production/test or non-production/live Stripe mismatch, insecure managed
origin, or missing managed secrets. `pnpm db:migrate` and
`pnpm db:verify-hosted` must receive `DIRECT_DATABASE_URL` in controlled hosted
release work; the application runtime receives the scoped pooled
`DATABASE_URL`. Inspect built client assets for server variables, then perform
provider-specific read-backs without printing values.

Run `pnpm db:purge` from one authenticated, observable, single-owner scheduled
job before accepting real data. The operation applies the cutoff to eligible
terminal and nonterminal (`QUEUED`, `RUNNING`, and `REVIEW_REQUIRED`) scans and
removes expired delivery tokens, linked analytics, and eligible orphan projects.
The current web app does not schedule it. Separately define privacy-request
authentication, exact-target deletion invocation, dry-run/review expectations,
backup expiry, legal holds, and completion audit; do not infer those workflows
from the variable or CLI.

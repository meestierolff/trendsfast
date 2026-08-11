# Environment reference

`.env.example` is the machine-adjacent template; this file explains purpose and
gates. Empty provider variables mean “not configured,” never “verified.” Never
commit values or paste them into support, issues, logs, or screenshots.

## Runtime and database

| Variable                         | Default/example         | Purpose                                                    |
| -------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `NODE_ENV`                       | `development`           | Runtime environment; managed production uses `production`. |
| `APP_URL`                        | `http://localhost:3000` | Exact canonical origin; managed mode requires HTTPS.       |
| `DATABASE_URL`                   | local PostgreSQL URL    | Server-side standard PostgreSQL 15+ connection.            |
| `PROVIDER_CREDENTIAL_MODE`       | `fixture`               | `fixture`, `managed`, or `byok`.                           |
| `PUBLIC_SCAN_PROCESSING`         | `inline`                | Alpha executor policy (`inline` or `manual`).              |
| `PUBLIC_SCAN_DAILY_LIMIT`        | `20`                    | Abuse-bound submissions per fingerprint/day.               |
| `SCAN_RETENTION_DAYS`            | `90` in template        | Cutoff used by `pnpm db:purge`; no scheduler is included.  |
| `MAX_SCAN_DURATION_SECONDS`      | `240`                   | Hard scan duration budget.                                 |
| `PROVIDER_TIMEOUT_MS`            | `15000`                 | Per-provider attempt timeout.                              |
| `MAX_PROVIDER_COST_USD_PER_SCAN` | `0.25`                  | Admission/reconciliation ceiling, not a measured cost.     |

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
worker crashes. These are database contracts, not additional environment
variables.

## Evidence/model providers

| Variable                                   | Rule                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `XAI_API_KEY`                              | Server secret for xAI/X Search and optionally synthesis.                  |
| `XAI_MODEL`                                | Explicit approved xAI model; required for configured X where applicable.  |
| `XAI_MAX_TOOL_CALLS_PER_SCAN`              | Integer 0–2; default 2.                                                   |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | Server credential pair; configure both or neither.                        |
| `DATAFORSEO_GOOGLE_TRENDS_MODE`            | `live` for on-demand alpha; `standard` only for reviewed scheduled use.   |
| `TAVILY_API_KEY`                           | Server secret.                                                            |
| `TAVILY_MAX_CREDITS_PER_SCAN`              | Integer 0–2; default 2.                                                   |
| `YOUTUBE_API_KEY`                          | Restricted server API key.                                                |
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

The model client bounds input at 65,536 bytes, response bytes at 262,144,
configured output at no more than 8,192 tokens, and calls at one initial attempt
plus at most one repair. Before a non-fixture call, the database atomically
reserves a conservative upper-bound cost from the operator-supplied input/output
prices. Duplicate reservation refuses a replay. Current accounting records that
reservation as `conservative_pre_call_reservation` and usage as
`unknown_not_settled`; its model actual-cost numeric field remains `$0`, but that
zero is not verified actual/free usage. It does not yet replace the estimate
with provider-reported token usage. Review the price source/effective date
privately for every release and never describe these variables as trusted
billing facts.

## Billing

| Variable                        | Alpha rule                                                |
| ------------------------------- | --------------------------------------------------------- |
| `BILLING_ENABLED`               | Must remain `false` until the explicit live gate.         |
| `STRIPE_MODE`                   | `test` during alpha.                                      |
| `STRIPE_SECRET_KEY`             | Server secret; required only when billing is enabled.     |
| `STRIPE_WEBHOOK_SECRET`         | Server secret; paired with Stripe secret.                 |
| `STRIPE_FOUNDER_CLOUD_PRICE_ID` | Server-side allowlisted price ID; never browser-selected. |

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
pairs, live/test Stripe mismatch, insecure managed origin, or missing managed
secrets. Inspect built client assets for server variables, then perform
provider-specific read-backs without printing values.

Run `pnpm db:purge` from one authenticated, observable, single-owner scheduled
job before accepting real data. The operation applies the cutoff to eligible
terminal and nonterminal (`QUEUED`, `RUNNING`, and `REVIEW_REQUIRED`) scans and
removes expired delivery tokens, linked analytics, and eligible orphan projects.
The current web app does not schedule it. Separately define privacy-request
authentication, exact-target deletion invocation, dry-run/review expectations,
backup expiry, legal holds, and completion audit; do not infer those workflows
from the variable or CLI.

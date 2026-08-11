# Self-hosting TrendsFast

Self-hosting is for operators who want the real decision engine and accept
responsibility for infrastructure, provider accounts, provider terms, costs,
security, backups, retention, and upgrades. This alpha has no support or uptime
guarantee.

## Fast fixture install

Requirements: Node.js 22+, pnpm 9+, Docker Compose, PostgreSQL 15+ (the Compose
file uses 16), and at least 32 random characters for each local secret.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:3000`. Fixture mode needs no paid keys. It is the only
mode this repository claims without an operator-supplied read-back.

The repository includes exact-project deletion and `pnpm db:purge`. The purge
applies the configured cutoff to eligible terminal and nonterminal scans and
removes expired delivery tokens, linked analytics, and eligible orphan projects.
It does **not** currently expose a customer privacy-request endpoint, an export
flow, or a scheduled retention worker. A production self-hoster must wrap those
operations in an authenticated, reviewed procedure and schedule/monitor the
purge.

## Required local configuration

At minimum set:

```env
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://trendsfast:trendsfast_local@localhost:54329/trendsfast
PROVIDER_CREDENTIAL_MODE=fixture
OPS_TOKEN=<32-or-more-random-characters>
SESSION_SECRET=<32-or-more-random-characters>
API_KEY_PEPPER=<32-or-more-random-characters>
BILLING_ENABLED=false
STRIPE_MODE=test
```

Generate secrets with your platform's cryptographically secure secret manager.
Do not paste generated values into chat, issues, logs, or source control.

## BYOK mode

Change `PROVIDER_CREDENTIAL_MODE=byok` only after completing the
[provider setup checklist](docs/providers/SETUP_CHECKLIST.md). Provider keys are
server-side environment variables in v0.1 and must not be stored in PostgreSQL.
Use separate development and production credentials.

Non-fixture synthesis also requires explicit dated operator prices in
`LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS` and
`LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS`. They fund a conservative pre-call
reservation; current code does not reconcile provider-reported actual model
usage, so do not treat the reservation as invoice truth.

See the [environment reference](docs/operations/ENVIRONMENT.md) for every
variable and fail-closed dependency.

An adapter being present does not mean the provider permits your intended use.
You must review current terms, quotas, attribution, retention, display, and
commercial-use rules. Reddit automation remains prohibited pending legal review
and permission.

## Database and upgrades

The core targets ordinary PostgreSQL 15+ and does not require Supabase Auth,
Realtime, Storage, Edge Functions, RLS, or client-side database access.

Before upgrading:

1. read `CHANGELOG.md` and migration notes;
2. back up PostgreSQL and test restoration;
3. deploy code with billing still disabled;
4. run `pnpm db:migrate` once from a controlled release job;
5. run fixture smoke tests and inspect scan-state recovery;
6. roll back application code only when the migration is backward-compatible.

Never automatically roll back a destructive migration. See the
[operations runbook](docs/operations/RUNBOOK.md).

## Production baseline

Use TLS, a managed secret store, least-privilege database credentials, encrypted
backups, log redaction, bounded egress, rate limits, CSRF protection, secure
cookies, monitoring, and retention/deletion jobs. Keep `/ops` behind a strong
server-only token and additional network/access controls; the alpha auth is a
temporary founder control, not customer authentication.

Set `APP_URL` to the exact canonical HTTPS origin. Run migrations separately
from horizontally scaled request handlers. Do not run multiple scan workers
unless the claimed-step/idempotency controls have been verified under
concurrency.

Current processing claims persist a hard deadline and rotating fence, and stale
workers cannot mutate the run. Recovery refuses to replay a provider left
`RUNNING`; it records `PROVIDER_OUTCOME_UNKNOWN` before considering an expired
deadline. Before using the explicit ops whole-scan retry for non-fixture work,
reconcile whether the upstream effect or charge already occurred.

The current ops surface can verify/reject evidence, approve, convert to `WAIT`,
deliver, mark failed, and retry an entire failed persisted scan. It does not yet
offer a source-only or synthesis-only rerun, manual evidence entry, or move-copy
editing UI. Durable PostgreSQL admission bounds syntactically valid API-key
attempts to 12 per fingerprint and 120 globally per minute, and ops-login
attempts to 5 per fingerprint and 100 globally per five minutes before expensive
verification. Verify the trusted-proxy/fingerprint boundary and capacity in the
deployed environment; keep intake small and treat the missing workflow surfaces
as operational limitations.

API creation atomically locks the API-key row and admits projected rolling-hour
cost in exact micro-USD units. Each request contributes the greater of its
persisted reservation or summed run estimates/actuals; a new non-fixture request
keeps its reservation for one hour if processing never commits. During an
upgrade to migration `0007`, drain preexisting queued API work or operationally
backfill its zero-valued reservations before enabling concurrent traffic.

Public scan lookup capabilities use 256 random bits but have no independent
durable lookup throttle. Put those routes behind verified edge/proxy abuse
controls rather than treating entropy alone as the deployed defense.

## What self-hosting does not include

It does not include TrendsFast Cloud provider keys, shared historical baselines,
provider contracts, customer data, production configuration, support, or an
authorization to use third-party data. See [CLOUD.md](CLOUD.md).

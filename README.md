# TrendsFast

[![CI](https://github.com/meestierolff/trendsfast/actions/workflows/ci.yml/badge.svg)](https://github.com/meestierolff/trendsfast/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-C8FF4D.svg)](LICENSE)

> **The social and search trend intelligence API for founders and their AI
> agents.**

## Spot the trends your users care about. Know what to distribute next.

Paste a product URL. TrendsFast turns bounded social conversations, search
demand, developer adoption, news, video, and product-site signals into one
evidence-backed **Next Move**: a topic, angle, format, and channel your founder
or agent can act on.

**Replace hours of manual distribution research with one relevant,
evidence-backed action a founder can actually take.** Reach the right users
before the moment passes—without chasing irrelevant hype.

[Run the fixture locally](#fixture-quick-start) ·
[Read the developer contract](docs/features/007-rest-api-and-api-keys.md) ·
[View the source ledger](docs/providers/SOURCE_RIGHTS_MATRIX.md)

> **Hosted scan CTA pending.** DNS and deployment are not verified, so this
> README does not link a public scan URL. Add it only when the current
> [release report](docs/operations/RELEASE_REPORT_TEMPLATE.md) records the
> verified canonical deployment.

![TrendsFast product demo showing a founder-reviewed Next Move with visible example-data limitations](docs/assets/trendsfast-next-move-example.png)

_Real local production-artifact capture. The card and footer visibly identify
example data; this is not live-source, deployment, customer, or traction proof._

Social listening gives you a feed. Trend dashboards give you charts. Raw APIs
give you JSON. **TrendsFast gives your agents the next move.**

Every completed scan returns exactly one founder-reviewed action:

- `PUBLISH` — make a product-credible contribution backed by sufficient evidence;
- `REPLY` — join one unusually relevant conversation while it is still useful;
- `REMIX` — translate a working topic or format without copying it;
- `WAIT` — protect credibility when the evidence does not clear the quality floor.

Founder-reviewed. No auto-posting. No card for the free scan. Private by
default. Open source.

## Fixture quick start

Prerequisites: Node.js 22+, pnpm 9+, Docker with Compose, and ports `3000` and
`54329` available.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and keep
`PROVIDER_CREDENTIAL_MODE=fixture`. Fixture mode exercises the product contract
without paid credentials or provider network calls. It is example behavior, not
a live-source read-back.

Stop the app with `Ctrl-C`; stop PostgreSQL with `docker compose down`. Add `-v`
only when you intentionally want to delete local database data. See
[self-hosting](SELF_HOSTING.md) and the
[environment reference](docs/operations/ENVIRONMENT.md) for the full setup.

## API example

Approved users receive a show-once, project-scoped key from founder operations.
Anonymous free scans do not receive a reusable API key. Keep the endpoint local
until a deployment is verified, and use the public product URL assigned to that
key:

```bash
export APP_URL=http://localhost:3000
export PROJECT_URL=https://your-public-product.example
export TRENDSFAST_API_KEY=replace-with-your-project-scoped-key

curl -sS "$APP_URL/v1/next-move" \
  -H "Authorization: Bearer $TRENDSFAST_API_KEY" \
  -H "Idempotency-Key: 4a2d1201-9666-4ef0-90a9-e5aa47786c8e" \
  -H "Content-Type: application/json" \
  --data "{
    \"product_url\": \"$PROJECT_URL\",
    \"goal\": \"qualified_signups\",
    \"market\": \"US\",
    \"language\": \"en\",
    \"preferred_channels\": [\"x\", \"linkedin\"],
    \"available_formats\": [\"founder_text\", \"screen_recording\"]
  }"
```

A newly accepted scan returns `202` and a status URL:

```json
{
  "id": "scan_<opaque-capability>",
  "status": "QUEUED",
  "status_url": "http://localhost:3000/v1/next-moves/scan_<opaque-capability>",
  "poll_after_seconds": 30
}
```

Poll with the same key after `poll_after_seconds`; use exponential backoff and
honor `Retry-After` on `429`:

```bash
export SCAN_ID=replace-with-id-from-the-create-response

curl -sS "$APP_URL/v1/next-moves/$SCAN_ID" \
  -H "Authorization: Bearer $TRENDSFAST_API_KEY"
```

Creation returns `200` when a suitable fresh result is already ready or `202`
when work is accepted. Polling returns `200` with `QUEUED`, `RUNNING`,
`REVIEW_REQUIRED`, `READY`, or `FAILED` in the body. The runtime OpenAPI 3.1
document is at `$APP_URL/v1/openapi.json`. The seeded fixture key is deliberately
bound to its seeded project, so substituting it for a different `PROJECT_URL`
correctly returns `403`.

## What a Next Move contains

A result includes the relevant trend/topic, recommended distribution channel,
content angle, hook, format, outline, why now, evidence URLs, signal truth class,
freshness, confidence, limitations, and validity window. It is one distribution
action that can power a post, reply, thread, article, short video, tutorial, or
content brief—not a promise of one finished asset.

```json
{
  "id": "scan_example",
  "status": "READY",
  "project": {
    "name": "Example",
    "url": "https://example.com",
    "audience": "Technical founders",
    "problem": "Distribution research is fragmented",
    "credible_topics": ["evidence-led distribution"],
    "assumptions": ["Example context only"]
  },
  "next_move": {
    "action": "WAIT",
    "channel": "none",
    "topic": "No opportunity clears the quality floor",
    "angle": "Hold the draft until an independent signal appears.",
    "format": "none",
    "hook": "Do not force a post from thin evidence.",
    "outline": ["Recheck the strongest query in 72 hours."],
    "priority": 0,
    "confidence": 0.74,
    "valid_until": "2026-08-14T10:00:00.000Z"
  },
  "why_now": {
    "summary": "Available example signals share one origin.",
    "signal_class": "INSUFFICIENT_SIGNAL",
    "independent_source_count": 1,
    "saturation": "unknown"
  },
  "evidence": [],
  "limitations": ["Example data only"],
  "founder_reviewed": true,
  "auto_publish": false
}
```

`WAIT` is a trustworthy result, not an error. A recent popular post is not called
a trend unless the evidence meets the explicit truth model.

## Architecture at a glance

```text
URL/request
  -> product context
  -> bounded provider adapters (fixture | managed | byok)
  -> canonical signals and immutable evidence receipts
  -> deterministic clustering/ranking and WAIT gates
  -> constrained synthesis
  -> founder review
  -> private delivery and feedback
```

The model may refine language, but it may not change the deterministic action or
evidence set, or invent URLs, metrics, or source claims. Flat, declining, or
unrelated measurements cannot become measured momentum. See the
[architecture](docs/architecture/OVERVIEW.md),
[product constitution](docs/PRODUCT_CONSTITUTION.md), and
[threat model](docs/security/THREAT_MODEL.md).

## Repository map

```text
apps/web/               web product, founder operations, and REST API
packages/core/          product and lifecycle contracts
packages/schemas/       runtime validation and OpenAPI schemas
packages/database/      PostgreSQL schema, migrations, and repositories
packages/providers/     bounded provider adapters and fixtures
packages/scoring/       deterministic ranking and quality floors
packages/evidence/      evidence binding and validation
packages/orchestration/ resumable scan execution
packages/billing/       disabled-by-default Stripe boundary
packages/analytics/     first-party event contracts
docs/                   architecture, features, operations, and launch assets
```

## Credential modes

| Mode      | Intended use                       | Credential owner |
| --------- | ---------------------------------- | ---------------- |
| `fixture` | Local demo and deterministic tests | None             |
| `managed` | TrendsFast Cloud                   | Cloud operator   |
| `byok`    | Self-hosting                       | Self-hoster      |

Managed credentials must never reach browser code, tenants, logs, or database
rows. Self-hosted keys are server environment variables. Missing optional
sources must degrade coverage instead of fabricating results.

## Source truth

The adapter panel includes product-site context, X through xAI, Google Trends
through DataForSEO, Hacker News through Algolia, GitHub's public API, Tavily,
YouTube, and founder-entered public evidence. That is not a claim that a source
has passed a deployed read-back.

| Evidence path            | Public label until deployed proof | Engineering truth                    |
| ------------------------ | --------------------------------- | ------------------------------------ |
| Repository example data  | Product demo                      | Deterministic fixture path           |
| External source adapters | Coming soon                       | No production read-back committed    |
| Manual founder evidence  | Coming soon                       | Callable supplemental ops entry      |
| Reddit automation        | Permission required               | No automated ingestion; legal review |

The public product uses only **Connected**, **Limited**, **Coming soon**,
**Unavailable**, and **Permission required**; operations retain the exact
technical state and read-back record.

Only a dated production record with release and deployment identity, a bounded
source read-back, canonical URL, cost/quota, and limitations may upgrade an
external source to **Connected**. See the
[source-rights matrix](docs/providers/SOURCE_RIGHTS_MATRIX.md) and
[setup checklist](docs/providers/SETUP_CHECKLIST.md).

## Current release truth

- No production provider/model read-back, deployment verification, legal
  approval, customer result, dogfood outcome, or traction metric is claimed by
  this README.
- Founder review now includes evidence verification/rejection, immutable-action
  edit-and-approve, context correction, stored-evidence recomputation, delivery,
  and redacted JSON/Markdown review bundles. Stored-only recomputation makes no
  provider/model call and renewed evidence review is required after correction.
- Public scan admission defaults to one request per anonymous requester plus
  database-atomic UTC-day global limits of 20 scans and $5 reserved/actual
  provider cost. API creation and polling use separate 20/hour and 300/hour
  limits; polling does not consume a research allowance.
- Protected founder operations can issue a revocable, audited, one-project
  design-partner grant for at most 30 days. It is explicitly not a Stripe
  subscription, and normal usage/cost limits still apply.
- Managed/provider/model prices and cost ceilings are server configuration, not
  committed TrendsFast economics. Managed mode fails closed when an applicable
  value is missing; fixture cost is $0; unknown actual usage stays conservatively
  unsettled. See the [commercial boundary](docs/COMMERCIAL_BOUNDARY.md).
- Billing and paid monitoring remain disabled unless every code, sandbox,
  hosted, monitoring, legal, tax, and founder-approval gate is verified. The
  code-local boundary uses Stripe Node `^22.4.0`, API version
  `2026-07-29.dahlia`, hosted subscription Checkout, verified webhooks, a hashed
  one-time checkout claim, exactly-once project key issuance, and Stripe-hosted
  Portal access. No current Stripe Product or Price ID, application journey, or
  live-mode result is claimed: the previously used sandbox key must first be
  rotated and the CLI reauthenticated.
- The first-party ledger is the intended analytics truth. Public/open metrics
  stay placeholder-only until a reproducible denominator-backed report exists.
- Implementation candidate `73297a6cfdc99b025990b001b39cef399f4d235e`
  replayed all 18 migration files through `0019` (intentional `0009`/`0010`
  gaps), matched every hash, seeded twice, and passed strict verification for
  37/37 public tables plus columns, enums, indexes, constraints, and denied
  browser/default grants. The database-enabled suite passed 98 files/512 tests;
  the non-database run passed 78 files/455 tests with 20 files/57 tests skipped.
- Typecheck, lint, Drizzle check, and the optimized webpack production build
  passed; the build emitted 37 route/page entries. The production artifact
  passed 58 Playwright checks with two intentional mobile skips, including 24
  desktop/mobile axe checks. The local deployment verifier passed 26 routes and
  two private unknown-capability `404` probes, and the retention purge finished
  with zero eligible backlog. The default Turbopack build was blocked locally by
  sandbox port restrictions, so the standard build still requires remote CI
  evidence.
- Provider and model attempts reserve their bounded cost durably before I/O.
  Valid provider-reported usage settles the reservation; missing usage remains
  conservative and unsettled. Public replay attempts consume the durable daily
  admission cap.
- No TrendsFast Supabase or Vercel project exists, and `trendsfast.com` was
  observed as `NXDOMAIN`. No hosted database, deployment, DNS/TLS, source,
  API/dogfood, monitoring, or release claim follows from local checks. The
  authenticated Vercel team also requires a suitable commercial plan.
- Retention and privacy operations still require authenticated scheduling,
  backup-expiry/legal-hold decisions, and deployment evidence.
- Explicit non-fixture retry after an uncertain provider effect or charge
  requires operator reconciliation; no broad retry-safety claim is made.

These are `LOCAL_PASS` results for immutable implementation candidate
`73297a6cfdc99b025990b001b39cef399f4d235e`, not hosted or production proof. The
CI badge reports `main`; remote branch CI and every applicable external gate
remain separate release evidence. The full
[integrated local verification record](docs/operations/LOCAL_VERIFICATION_2026-08-12.md)
and [launch checklist](docs/operations/LAUNCH_CHECKLIST.md) keep every release
gate unchecked until its immutable remote or external evidence exists.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# Browser dependencies are required before:
pnpm test:e2e
```

`pnpm verify` runs lint, typecheck, unit/contract tests, and the production build.
Database integration tests require migrated PostgreSQL and
`RUN_DATABASE_INTEGRATION=1`. These commands do not prove deployment, live
provider health, legal permission, customer outcomes, or paid-billing readiness.

## Self-hosted and cloud

The self-hosted build contains the decision engine and works with standard
PostgreSQL. Self-hosters supply upstream credentials and accept each provider's
terms. TrendsFast Cloud is intended to add managed credentials, monitoring,
history, operations, cost control, and support—not a hidden replacement engine.
Read [SELF_HOSTING.md](SELF_HOSTING.md) and [CLOUD.md](CLOUD.md).

## Contributing, security, license, and marks

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately
under [SECURITY.md](SECURITY.md); never open a public issue with a usable secret
or exploit. By participating, you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

Code is licensed under the [GNU Affero General Public License v3.0 only](LICENSE),
unless a file says otherwise. The license does not grant permission to use the
TrendsFast name, logo, or brand; see [TRADEMARK.md](TRADEMARK.md).

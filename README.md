# TrendsFast

> The distribution intelligence API for founders and their agents.

TrendsFast turns a product URL and bounded evidence into one **Next Move**:
`PUBLISH`, `REPLY`, `REMIX`, or `WAIT`. The goal is not to build another feed
or auto-poster. It is to answer what to say, where to say it, why now, and
which source receipts support the decision.

TrendsFast is an early, founder-reviewed, open-source alpha. Do not rely on it
for unattended publishing or business-critical decisions.

## Current build truth

- The repository is at `0.1.0-alpha.0` and is not declared production-ready.
- Fixture mode is the only credential mode claimed as locally testable here.
- No external provider has a recorded production read-back in this repository.
- Reddit automation is `LEGAL_REVIEW` and is intentionally absent.
- Billing is disabled by default; no live Stripe product or price is claimed.
- No production deployment, provider approval, legal approval, dogfood result,
  customer result, or traction metric is claimed.
- Public scan/status capabilities and separately issued delivery tokens now use
  256 bits of CSPRNG entropy; delivery tokens are hashed at rest. API and ops
  authentication attempts also pass through bounded PostgreSQL-backed,
  cross-instance admission before expensive secret verification.
- Authenticated API creation also uses atomic per-key rolling-hour cost
  admission. The transaction locks the API-key row, rechecks idempotency, and
  counts the greater of each request reservation or its committed run costs
  using exact micro-USD comparison. A newly accepted non-fixture request retains
  its conservative reservation for one hour even if processing crashes.
- Website ingestion revalidates every redirect hop and connects to a validated
  numeric address while retaining the original Host/SNI. Provider/model calls
  receive abortable deadlines and bounded request/response contracts. These are
  implementation controls, not live-provider proof.
- Scan attempts persist a hard deadline and rotating processing fence. Stale
  workers cannot commit, and an interrupted `RUNNING` provider is failed as
  `PROVIDER_OUTCOME_UNKNOWN` rather than replayed automatically. That unknown
  outcome classification wins even when the persisted deadline has also
  expired.
- Ops can explicitly requeue a whole failed scan, but source-only/synthesis-only
  retry and post-charge reconciliation are not implemented. Keep non-fixture
  manual retry disabled or tightly gated where an upstream effect is uncertain.
- Non-fixture model calls require operator-supplied input/output pricing and an
  atomic conservative pre-call reservation. Provider-reported actual model
  usage is not settled yet, and the repository cannot verify that an operator's
  price schedule is current.
- `pnpm db:purge` can apply configured retention to old terminal and
  nonterminal scans, expired delivery tokens, linked analytics, and eligible
  orphan projects. No scheduler, authenticated privacy-request workflow,
  export, backup-expiry proof, or legal-hold workflow exists.
- Public scan capabilities have 256 random bits, but their lookup routes do not
  have an independent durable throttle. Deployed edge/proxy controls and
  verification remain a lower-priority defense-in-depth launch gate.

The committed local candidate
`072d5fcceab9a131ff7b2772bb6e38821aec462d` completed a frozen-lockfile
install, all eight migrations (`0000` through `0007`) against a brand-new
isolated PostgreSQL database, repeat fixture seed, a zero-deletion retention CLI
exercise, and the full integration-enabled suite: 55 files and 277 tests passed
with no skips or failures. Repository-wide lint and all 12 typechecks, broad
Prettier, and the Drizzle schema check passed. Its optimized production build,
all 28 desktop/mobile browser checks, and manual route/header matrix also passed.
See the
[dated verification record](docs/operations/LOCAL_VERIFICATION_2026-08-11.md).
This is an exact local-commit record, not remote CI, a live provider read-back,
an external deployment check, legal approval, or a published release.

The source-status UI distinguishes fixture availability from production
verification. See [the source-rights matrix](docs/providers/SOURCE_RIGHTS_MATRIX.md)
and [launch checklist](docs/operations/LAUNCH_CHECKLIST.md) before changing any
status or public claim.

## Fixture quick start

Prerequisites: Node.js 22+, pnpm 9+, Docker with Compose, and ports `3000` and
`54329` available.

From this checkout, the one-command-ish path is:

```bash
cp .env.example .env && pnpm install --frozen-lockfile && docker compose up -d postgres && pnpm db:migrate && pnpm db:seed && pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000). Keep
`PROVIDER_CREDENTIAL_MODE=fixture`. The fixture experience must not make network
provider calls or require paid credentials. Stop the app with `Ctrl-C`; stop
PostgreSQL with `docker compose down` (add `-v` only if you deliberately want to
delete local database data).

If any command fails, follow [self-hosting](SELF_HOSTING.md) rather than adding
provider keys. A green local run demonstrates fixture behavior only.
The complete variable contract is in the
[environment reference](docs/operations/ENVIRONMENT.md).

## Product contract

Each successful scan returns exactly one action and its evidence:

```json
{
  "id": "move_fixture_wait",
  "status": "READY",
  "project": {
    "name": "Example",
    "url": "https://example.com",
    "audience": "Technical founders",
    "problem": "Distribution research is fragmented",
    "credible_topics": ["evidence-led distribution"],
    "assumptions": ["Fixture context only"]
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
    "summary": "Available fixture signals share one origin.",
    "signal_class": "INSUFFICIENT_SIGNAL",
    "independent_source_count": 1,
    "saturation": "unknown"
  },
  "evidence": [],
  "limitations": ["Fixture data only"],
  "founder_reviewed": true,
  "auto_publish": false
}
```

`WAIT` is a valid result, not an error. A recent popular post is not called a
trend unless the evidence meets the explicit truth model.

## Architecture at a glance

```text
URL/request
  -> product context
  -> bounded provider adapters (fixture | managed | byok)
  -> canonical signals and immutable evidence receipts
  -> deterministic clustering/ranking
  -> constrained synthesis
  -> founder review
  -> private delivery and feedback
```

The alpha targets one deployable Next.js application with shared TypeScript
packages. Its architecture requires PostgreSQL as durable truth, fenced
transactional scan transitions, and visible provider failures/costs. The model
may refine language, but it may not change the deterministic action or exact
evidence set, or invent URLs, metrics, or source claims. Flat, declining, or
unrelated measurements cannot become measured momentum. See
[architecture](docs/architecture/OVERVIEW.md) and the
[threat model](docs/security/THREAT_MODEL.md).

## Repository map

```text
apps/web/              web product, ops surface, and REST API
packages/core/         product and lifecycle contracts
packages/schemas/      runtime validation and OpenAPI schemas
packages/database/     PostgreSQL schema and committed migrations
packages/providers/    bounded provider adapters and fixtures
packages/scoring/      deterministic ranking and quality floors
packages/evidence/     evidence binding and validation
packages/orchestration/ resumable scan execution
packages/billing/      partial Stripe boundary, disabled by default
packages/analytics/    first-party event ledger and optional adapters
docs/                  architecture, decisions, features, operations, launch
```

## Credential modes

| Mode      | Intended use                       | Credential owner |
| --------- | ---------------------------------- | ---------------- |
| `fixture` | Local demo and deterministic tests | None             |
| `managed` | TrendsFast Cloud                   | Cloud operator   |
| `byok`    | Self-hosting                       | Self-hoster      |

Managed credentials must never reach browser code, tenants, logs, or database
rows. Self-hosted keys are environment variables in v0.1. Missing optional keys
must degrade coverage instead of silently fabricating results.

## Source truth

The launch design includes product-site context, X via xAI, Google Trends via
DataForSEO, Hacker News via Algolia, GitHub's public API, Tavily, YouTube, and
manual founder evidence. That design is not a claim that those live adapters
have passed production read-back.

| Source                     | Policy status     | Repository verification                                    |
| -------------------------- | ----------------- | ---------------------------------------------------------- |
| Fixture panel              | `FIXTURE`         | `FIXTURE_VERIFIED` locally at `072d5fc`; remote CI pending |
| Product website            | `UNVERIFIED`      | No production read-back recorded                           |
| X / xAI                    | `BETA_UNVERIFIED` | No production read-back recorded                           |
| Google Trends / DataForSEO | `UNVERIFIED`      | No production read-back recorded                           |
| Hacker News / Algolia      | `UNVERIFIED`      | No production read-back recorded                           |
| GitHub API                 | `UNVERIFIED`      | No production read-back recorded                           |
| Tavily web/news            | `BETA_UNVERIFIED` | No production read-back recorded                           |
| YouTube Data API           | `BETA_UNVERIFIED` | No production read-back recorded                           |
| Manual founder evidence    | `ADAPTER_ONLY`    | No callable founder entry route                            |
| Reddit automation          | `LEGAL_REVIEW`    | Prohibited before permission/review                        |

Only a dated, production-environment health/read-back record may upgrade an
external source. Configuration, mocks, fixture tests, and successful builds are
not read-backs.

## API shape

The implemented authenticated creation endpoint is:

```http
POST /v1/next-move
Authorization: Bearer tf_live_<prefix>.<secret>
Idempotency-Key: <uuid>
Content-Type: application/json

{"product_url":"https://example.com"}
```

New work returns `202` plus a status URL; a founder-reviewed ready result returns
`200`. Poll an owned resource with `GET /v1/next-moves/{id}`. The runtime serves
its current OpenAPI 3.1 document at `GET /v1/openapi.json`. API keys are issued
through the server-side repository boundary; there is no self-service key UI.
The public free-scan form never exposes a reusable API key. Current alpha
limitations—including manual key issuance and OpenAPI error parity—are recorded in
[feature 007](docs/features/007-rest-api-and-api-keys.md).

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# With migrated PostgreSQL available:
RUN_DATABASE_INTEGRATION=1 pnpm exec vitest run packages/orchestration/tests/database-flow.integration.test.ts
# Browser dependencies are required before: pnpm test:e2e
```

`pnpm verify` runs lint, typecheck, unit/contract tests, and the production
build. The PostgreSQL integration test is opt-in locally and enabled separately
in CI through `RUN_DATABASE_INTEGRATION=1`. Neither command proves deployment,
live provider health, security approval, legal permission, or paid billing
readiness.

## Self-hosted and cloud

The self-hosted build contains the real decision engine and works with ordinary
PostgreSQL. Self-hosters supply their own upstream credentials and accept each
provider's terms. TrendsFast Cloud is intended to add managed credentials,
scheduling, shared baselines, retries, operations, and support—never a hidden
replacement engine. Read [SELF_HOSTING.md](SELF_HOSTING.md) and
[CLOUD.md](CLOUD.md).

## Contributing and security

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately
under [SECURITY.md](SECURITY.md); never open a public issue with a usable secret
or exploit. By participating, you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License and marks

Code in this repository is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE), unless a file says
otherwise. The license does not grant permission to use the TrendsFast name,
logo, or brand; see [TRADEMARK.md](TRADEMARK.md).

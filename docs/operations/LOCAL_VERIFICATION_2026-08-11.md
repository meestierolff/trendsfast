# Local verification record — 2026-08-11

Status: **committed local application-candidate evidence only** at
`072d5fcceab9a131ff7b2772bb6e38821aec462d` (`072d5fc`). This is not a remote
CI run, production environment, external deployment, or provider read-back.
Every result in the current table targets that exact local commit. Older
mutation-flow HTTP observations are explicitly superseded.

Launch status: **blocked**. The final local read-only audit found no open P0/P1,
but external provider/model read-backs, deployment, legal approval, billing,
manual privacy scheduling/workflow, manual-source entry, safe explicit retry
after an uncertain provider effect/charge, settled model usage/price trust, and
the public-capability lookup/deployed-edge P2 remain open.

## Current hardened replay

| Area                             | Command/path                                                                                                                        | Observed result                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Dependency install               | `CI=1 pnpm install --frozen-lockfile`                                                                                               | exit 0                                                                                                                          |
| Database                         | `pnpm db:migrate` against brand-new isolated database `trendsfast_release_e9fc6e3_20260811`                                         | all eight migrations, `0000` through `0007`, applied; 23 public tables                                                          |
| Fixture seed                     | `pnpm db:seed`, run twice                                                                                                           | both runs returned `Fixture scan seeded: scan_fixture_trendsfast`                                                               |
| Retention CLI                    | `pnpm db:purge`                                                                                                                     | exit 0; all deletion counts were 0 at cutoff `2026-05-13`                                                                       |
| Full integration-enabled suite   | `RUN_DATABASE_INTEGRATION=1 pnpm test` against the isolated migrated and seeded database                                            | 55 files and 277 tests passed; 0 skipped and 0 failed                                                                           |
| Static/schema checks             | `pnpm lint`, `pnpm typecheck`, broad Prettier check, and `pnpm exec drizzle-kit check --config packages/database/drizzle.config.ts` | lint/typecheck passed across all 12 projects; Prettier and Drizzle passed; no code lint errors/warnings                         |
| Production build                 | `pnpm build` under the release fixture environment                                                                                  | passed; optimized Next.js production build                                                                                      |
| Production-artifact browser      | `RUN_DATABASE_INTEGRATION=1 pnpm test:e2e` against production `next start`; one worker                                              | 28/28 passed, 0 skipped/failed: desktop 14/14 and mobile 14/14; axe 8/8                                                         |
| Production-artifact HTTP/headers | manual `curl -s -D - -o /dev/null <URL>` against the same production artifact                                                       | expected known/private/unknown/ops/OpenAPI status, cache, referrer, indexing, and security headers observed                     |
| Production rejection probes      | manual local requests with explicit origins/auth states                                                                             | cross-origin ops login `403`; same-origin invalid ops token `401`; keyless v1 create `401`; cross-origin private feedback `403` |

The purge exercise proves the CLI executed the current deletion query against
the isolated schema; zero eligible rows does not replace a fixture that proves
each terminal/nonterminal/token/analytics/orphan deletion branch or an
operational scheduler/alert.

Post-`0007` focused evidence also passed: real PostgreSQL
database/orchestration checks (13 files/34 tests), cost-admission race checks
(3 files/24 tests), and web/orchestration checks (3 files/30 tests). These
overlap the full-suite count and are not additional tests.

The browser run used the same isolated migrated/seeded database and optimized
candidate artifact served through production `next start`. It covered eight axe
checks, ops authentication plus the persisted review/approve/deliver path,
public surfaces, fixture private result/feedback, unknown request/result privacy,
and narrow viewport behavior. This is local automated evidence, not manual
keyboard/screen-reader review, remote CI, or an external deployment.

The manual direct-request matrix returned `200` for `/`, the known fixture scan,
its status route, `/ops`, and `/v1/openapi.json`; unknown scan HTML/status routes
returned `404`. Known and unknown private HTML responses carried
`Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`,
`Referrer-Policy: no-referrer`, and
`X-Robots-Tag: noindex,nofollow,noarchive`. Status JSON was private/no-store with
no-referrer; `/ops` carried the private no-store/noindex set. OpenAPI was
intentionally distinct at `Cache-Control: public, max-age=300`.

All examined responses carried the configured CSP,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, COOP/CORP `same-origin`,
`Origin-Agent-Cluster`, disabled DNS prefetch, and `Permissions-Policy`. These
were direct local requests against `next start`, not an independent-network or
deployed-header observation.

## Superseded artifact observations

Before the current hardening, a manual HTTP exercise used fixture credentials
and explicit `Origin` headers
against `/v1/openapi.json`, `/v1/next-move`, `/v1/next-moves/{id}`,
`/api/scan-requests`, `/api/scans/{token}/status`, feedback/share-consent,
`/scan/{token}`, and `/api/ops/session`. Observed outcomes:

- a public scan reached `REVIEW_REQUIRED` with all eight fixture sources marked
  `SUCCEEDED`, and an equivalent duplicate reused the same token;
- the runtime OpenAPI document returned successfully and described the mounted
  v1 creation/status paths;
- an idempotent v1 replay reused the same ID and remained `REVIEW_REQUIRED`;
- seeded results returned `200` through both the public scan ID and raw delivery
  token, while unknown tokens returned `404`;
- feedback returned `201` and explicit share consent returned `200`;
- cross-site feedback and ops login returned `403`; and
- private scan responses carried `no-referrer`/`private, no-store` behavior, and
  the application exposed its configured CSP and cross-origin isolation headers.

These were inspected direct requests, not a repeatable committed acceptance
script. They are not current-hardened acceptance evidence; repeat and retain a
redacted transcript or automated artifact at the release SHA.

Superseded direct requests to that artifact returned `200` for the fixture private result
and `/ops`, and `404` for an unknown private token. All carried
`Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`,
`X-Robots-Tag: noindex,nofollow,noarchive`, and
`Referrer-Policy: no-referrer`; the configured CSP, frame, resource, origin, and
cross-origin isolation headers were also present. This superseded observation
was not an external deployment or independent-network check.

## What this does not prove

- a remote clean-machine CI run or published release;
- manual accessibility, backup/restore, deployed trusted-proxy/admission
  behavior, retention scheduling, or a user-facing privacy-request workflow;
- live website/provider/model connectivity, provider permission, or measured
  non-fixture cost;
- an external Vercel/PostgreSQL deployment, externally observed headers, DNS,
  TLS, alerts, or rollback;
- Stripe Checkout, Portal, webhook processing, a live catalog, or any charge;
- founder, legal, tax, privacy, provider-rights, or external security approval;
- dogfood/customer outcomes, a public case study, or traction.
- safe operator reconciliation before explicit retry after an unknown provider
  effect/charge;
- provider-reported actual model usage or independent trust in the
  operator-supplied model price schedule; or
- an independently deployed throttle for public capability lookup traffic.

## Release carry-forward

Attach remote CI/artifact links, environment identity without secrets, reviewer,
and timestamps before promoting the candidate. Rerun if the commit changes.
Keep every external gate unchecked until its own evidence exists.

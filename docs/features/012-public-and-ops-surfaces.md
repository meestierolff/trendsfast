# 012 — Public and founder-ops product surfaces

Status: Phase 1 public design/structure and Phase 2 founder-operations code paths
are present in the active development tree; integrated release-SHA CI,
deployment, visual/manual accessibility, and external verification remain
required before either phase is a release claim.

## User problem

Visitors need value before signup and transparent evidence/status; the founder
needs a focused review queue without vanity dashboards.

## Scope

`/`, requested/result routes, `/agents`, `/docs`, `/channels`, `/news`, `/blog`,
`/pricing`, `/sources`, `/open`, `/open-source`, the three high-intent API pages,
and protected `/ops`, `/ops/keys`, and `/ops/sources`, with
mobile/accessibility/reduced-motion behavior.

## Non-goals

Dashboard zoo, fake progress percentages, testimonials/logos, customer account
area, auto-posting, social calendar, or denominator-free metrics.

## Product contract

Homepage begins URL -> result and a realistic example-data demo. Source strip and
open metrics are honest. Result centers the recognizable Next Move card.

## API contract

Forms call validated server routes; requested page polls state without invented
percent; private result/feedback uses narrow token; ops mutations use session +
CSRF.

## Data model

Read product/result/evidence/status/aggregate event data through scoped
repositories. Aggregate metrics require minimum denominator and definitions.

## Provider/legal constraints

Display exact source/provider labels, limitations, attribution, and consent.
Legal templates cannot masquerade as approved public policies.

## Security considerations

Escape/sanitize untrusted content, CSP/headers, no private token or URL query in
analytics/referrers, accessible generic errors, secure ops boundary.

## Tests written first

- Result-first content and no fake proof.
- Four-action example-data demo.
- Requested state without fake percentage.
- Private/public consent and source status truth.
- `Not enough verified data yet` for small denominator.
- Ops auth, keyboard/mobile/reduced-motion/accessibility flows.

## Implementation

Use the original energetic dark system: deep navy backgrounds, bright lime,
cyan, violet, coral, and amber action colors, crisp borders, generous spacing,
controlled signal glow, restrained motion, and a reduced-motion fallback. The
Next Move card is the signature object. Avoid copied layouts, generic
full-screen AI gradients, and glassmorphism overload.

### Current implementation truth

The repository mounts the listed public pages, high-intent SEO pages, local
Markdown news/blog feeds, `llms.txt`, bearer status/result routes, a
same-origin public submission route with atomic pseudonymous
count/duplicate/insert admission, same-origin feedback/share-consent mutations,
and the protected ops queue/detail surfaces. Public scan capabilities use 256
random bits. Submission replays still consume the durable daily cap. Every
mutation body is stream-counted before parsing. Turnstile is optional and
disabled by default. Status responses do not invent percentages; private route
responses are non-cacheable and pages are marked `noindex`/`nofollow`.

The public capability lookup routes do not yet have an independent durable
throttle. Their 256-bit entropy prevents practical guessing, but deployed edge
request-volume control and verification remain a defense-in-depth P2.

State-changing ops review actions require the signed session, same origin, and a
session-bound CSRF token. Ops login applies the same-origin boundary and
PostgreSQL-backed admission before token verification (5 attempts per
fingerprint and 100 globally per five minutes by default). `/v1` uses the same
durable admission store with one-minute defaults of 12 per fingerprint and 120
globally. Deployed proxy/fingerprint behavior still requires verification.

The current working tree's actual `next start` production artifact ran 60
browser checks: 58 passed and two mobile checks were intentionally skipped. The
run included 24 desktop/mobile axe checks and a complete API submit →
`REVIEW_REQUIRED` → founder verify/approve/deliver → `READY` → idempotent
replay/conflict journey. Its final optimized webpack production build passed;
the standard Turbopack build was locally blocked by sandbox port restrictions.
A local HTTP verifier also passed 26 public route/status/content-type checks,
the expected security-header/secret-marker matrix, private ops, and two
unknown-capability privacy probes. A separate manual curl exercise confirmed
the intended cache/content-type matrix, private/noindex ops and unknown scan,
unauthenticated API `401`, and `/api/sources` with all automated sources and
manual evidence at **Coming soon**/`UNVERIFIED` and Reddit at **Permission
required**/`LEGAL_REVIEW`. This is integrated `LOCAL_PASS` evidence, not
release-SHA or deployment proof. Final remote CI, manual keyboard/screen-reader
review, a public lookup edge throttle, and external security-header verification
remain gates.

The complete current working-tree evidence and its limitations are in the
[integrated local record](../operations/LOCAL_VERIFICATION_2026-08-11.md).

## Verification

Playwright desktop/mobile, accessibility scan plus keyboard/manual screen-reader
spot check, visual status audit, and analytics payload inspection.

## Limitations

Example data is illustrative and must stay labeled; founder-token ops auth is
temporary.

## Rollout

Ship fixture/public information first; enable submission/provider status only as
their gates pass.

## Rollback

Disable new submission while keeping static truth/docs and already authorized
private results available.

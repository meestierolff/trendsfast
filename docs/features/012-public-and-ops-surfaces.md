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
count/duplicate/insert admission plus a database-atomic UTC-day count and cost
reservation boundary, same-origin feedback/share-consent mutations,
and the protected ops queue/detail surfaces. Public scan capabilities use 256
random bits. Submission replays still consume the durable requester cap, but an
exact requester+URL replay reuses the existing request without reserving global
cost twice. Global count or budget exhaustion returns the stable
`TODAYS_FOUNDER_REVIEW_CAPACITY_REACHED` payload and swaps in the existing
launch-interest form. Every
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

The optimized webpack production build passed with 37 route/page entries; the
standard Turbopack build was locally blocked by sandbox port restrictions. The
final production-artifact run passed 58 Playwright checks with two intentional
mobile skips, including 24 desktop/mobile axe checks. The local deployment
verifier passed 26 routes plus two private unknown-capability `404` probes. This
is immutable local evidence at
`73297a6cfdc99b025990b001b39cef399f4d235e`, not deployment proof. Final remote
CI, manual keyboard/screen-reader review, a public lookup edge throttle, and
external security-header verification remain gates.

The complete code-local evidence and its limitations are in the
[integrated local record](../operations/LOCAL_VERIFICATION_2026-08-12.md).

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

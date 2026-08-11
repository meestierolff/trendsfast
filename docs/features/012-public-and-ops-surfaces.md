# 012 — Public and founder-ops product surfaces

Status: routes/UI and the local candidate artifact are verified at `072d5fc`;
remote CI and external/manual verification remain required.

## User problem

Visitors need value before signup and transparent evidence/status; the founder
needs a focused review queue without vanity dashboards.

## Scope

`/`, requested/result routes, `/sources`, `/docs`, `/open`, `/open-source`, and
protected `/ops`, with mobile/accessibility/reduced-motion behavior.

## Non-goals

Dashboard zoo, fake progress percentages, testimonials/logos, customer account
area, auto-posting, social calendar, or denominator-free metrics.

## Product contract

Homepage begins URL -> result and a realistic fixture example. Source strip and
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
- Four-action fixture example.
- Requested state without fake percentage.
- Private/public consent and source status truth.
- `Not enough verified data yet` for small denominator.
- Ops auth, keyboard/mobile/reduced-motion/accessibility flows.

## Implementation

Use original graphite/off-white/signal-accent design, editorial type, evidence
monospace, crisp borders, restrained motion, and no copied visual identity.

### Current implementation truth

The repository mounts the listed public pages, bearer status/result routes, a
same-origin public submission route with atomic pseudonymous
count/duplicate/insert admission, same-origin feedback/share-consent mutations,
and the protected ops queue/detail surfaces. Public scan capabilities use 256
random bits. Every mutation body is stream-counted before parsing. Turnstile is
optional and disabled by default. Status responses do not invent percentages;
private route responses are non-cacheable and pages are marked
`noindex`/`nofollow`.

The public capability lookup routes do not yet have an independent durable
throttle. Their 256-bit entropy prevents practical guessing, but deployed edge
request-volume control and verification remain a defense-in-depth P2.

State-changing ops review actions require the signed session, same origin, and a
session-bound CSRF token. Ops login applies the same-origin boundary and
PostgreSQL-backed admission before token verification (5 attempts per
fingerprint and 100 globally per five minutes by default). `/v1` uses the same
durable admission store with one-minute defaults of 12 per fingerprint and 120
globally. Deployed proxy/fingerprint behavior still requires verification.

The `072d5fc` optimized local artifact passed all 28 serialized browser checks:
14 desktop and 14 mobile, with no skips/failures. That includes the public
surface, ops auth and persisted review/approval/delivery, private
result/feedback, unknown request/result privacy, narrow viewport, and eight axe
checks. Manual direct requests to that same candidate artifact passed known/unknown HTML/status
behavior, private no-store/noindex/no-referrer protections, the configured CSP
and isolation headers, and the distinct public five-minute OpenAPI cache. A
manual rejection probe also observed cross-origin ops login/private feedback
`403`, same-origin invalid ops token `401`, and keyless v1 creation `401`. A
Remote CI, manual keyboard/screen-reader review, a public lookup edge throttle,
and external security-header verification remain gates.

## Verification

Playwright desktop/mobile, accessibility scan plus keyboard/manual screen-reader
spot check, visual status audit, and analytics payload inspection.

## Limitations

Fixture example is illustrative and must stay labeled; alpha ops auth is
temporary.

## Rollout

Ship fixture/public information first; enable submission/provider status only as
their gates pass.

## Rollback

Disable new submission while keeping static truth/docs and already authorized
private results available.

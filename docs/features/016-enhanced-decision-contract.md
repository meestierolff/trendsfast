# 016 — Enhanced decision contract

Status: contract, deterministic derivation, persistence, founder review, public
result, dashboard, and API projection are implemented locally; hosted read-back
and founder dogfood remain release gates.

## User problem

A founder should not need another agent to translate a trend score into work.
The result must name one specific `PUBLISH`, `REPLY`, `REMIX`, or `WAIT` move,
show the exact source evidence behind it, explain how long it remains useful,
and provide enough production detail to act after founder review.

## Scope

This vertical upgrades the pre-launch v1 contract in place with:

- a strict `next-move-v1` decision schema;
- action-linked PUBLISH, REPLY, REMIX, and WAIT detail payloads;
- `TrendWindow`, categorical `BreakoutPotential`, and `ContentBlueprint`;
- `generation_level=brief|draft` without decision drift;
- time-expiry and review-invalidated stale truth; and
- exact stored-evidence binding for factual action-detail fields.

The existing action, evidence set, deterministic ranking, founder review,
delivery, API-key, and `auto_publish=false` boundaries remain authoritative.

## Non-goals

This feature does not add a source, feed, probability of virality, social
publishing, direct posting credentials, MCP, CLI, weekly/monthly report UI,
bulk reply generation, or a new design system. It does not turn model prose
into factual evidence.

## Product contract

Every ready response contains one immutable action, project context,
action-specific details, a trend window, breakout-potential factors, why-now,
exact evidence receipts, limitations, founder-review state, freshness, and
`auto_publish=false`.

`PUBLISH` contains a content type, three differentiated hook styles, premise,
audience tension, credible product role, format basis, tone, structure, CTA,
assets, channel instructions, production options, and `publish_by`.

`REPLY` contains one primary and at most two secondary targets from the existing
bounded evidence set. URL, source, author, title/excerpt, publication time, and
observation time are copied from stored records. The reply is useful without a
product link. No extra provider call is made to fill secondary targets.

`REMIX` names one to three exact stored source items, distinguishes the pattern
to preserve from the brand-specific transformation, and states what must not be
copied. `SOURCE_OBSERVED` is used only when the stored source supports an
observable format family.

`WAIT` is an action, not an empty error. It names the considered opportunity,
quality-floor reasons, what not to do, the conditions that would change the
decision, and `recheck_at`.

## API contract

The public contract remains v1 because there are no production API users. The
legacy `POST /v1/next-move` keeps `product_url` as its only required caller
field. Both legacy and claimed-project requests accept `generation_level`,
defaulting to `brief`.

`brief` returns the complete intelligence and production brief. `draft` may add
`draft_content` only for PUBLISH or REMIX. REPLY always includes its exact
suggested reply. Changing generation level cannot change action, target/source
URLs, evidence IDs, timing, score, or breakout factors. Drafts are never
published automatically.

The canonical `valid_until` equals `trend_window.valid_until`. Freshness is
evaluated at read time. At the exact expiry boundary, or after founder-review
invalidation, the response is `STALE` with `requires_new_scan=true`; an expired
move is never presented as current.

## Trend-window truth rules

There is no universal lifetime. The deterministic range is selected from the
action and the available evidence basis:

| Basis                        | Claim allowed                                  | Range behavior                     |
| ---------------------------- | ---------------------------------------------- | ---------------------------------- |
| `MEASURED_EXTERNAL_SERIES`   | rising external series                         | broader rounded range              |
| `MEASURED_INTERNAL_VELOCITY` | two or more time-separated stored observations | rounded measured range             |
| `CORROBORATED_INFERENCE`     | independent current sources                    | rounded range, explicitly inferred |
| `SINGLE_SIGNAL_INFERENCE`    | one strong current source                      | short REPLY window                 |
| `UNKNOWN`                    | no defensible timing evidence                  | omit remaining hours               |

Ranges use whole hours and explanations disclose whether they are measured or
inferred. Stored observation timestamps remain exact provenance. Saturation and
remaining-window factors can label a supported window `SATURATING` or
`DECAYING`; unknown basis and state stay paired.

`BreakoutPotential` is a categorical low/medium/high/unknown label. Its six
visible factors are audience relevance, timing, novelty, product credibility,
format fit, and saturation risk. The schema has no probability field and strict
validation rejects one.

## Evidence and model boundary

Provider results are normalized and persisted before decision derivation. The
deterministic evidence-ID allowlist is resolved against those stored signals.
A missing or duplicate ID fails closed.

For REPLY and REMIX, factual URLs and authors are accepted only when they equal
a selected stored record. Metrics do not exist in the action-detail schema.
The model schema accepts no URL, author, metric, provider claim, or source claim;
it may refine bounded prose but cannot change action, evidence, channel, format,
score, confidence, timing, or validity. A failed model validation retains the
deterministic result.

## Data contract

The additive persistence slice stores:

- request generation level and optional per-run capability override;
- decision-contract version, action-details JSON, trend-window JSON,
  breakout-potential JSON, generation level, and optional draft text;
- the existing relational evidence receipts as factual authority; and
- existing signal metric snapshots and outcomes for later learning.

Legacy pre-migration moves must not be backfilled with invented detail. They are
marked stale or remain unservable as current until recomputed. `proposal_stale`
continues to mean review invalidation; clock expiry is derived from
`valid_until`, not stored as a mutable boolean.

## Future report and Reply Monitor contracts

Existing signal observations, metric snapshots, validity times, and outcomes
must remain sufficient to later study first appearance, confirmation, metric
change, saturation, expiry, and action. Weekly/monthly reports are not a launch
feature.

A future Reply Monitor may add frequent refresh, an opportunity queue, stronger
anti-spam controls, separate pricing/cost limits, and reply outcomes. It is not
shown as live and this release never sends replies.

## Security and legal constraints

All source content is untrusted. Existing SSRF, prompt-injection, byte, deadline,
cost, and provider-rights controls apply. REMIX adapts patterns, never wording,
identity, creative assets, examples, or protected expression. Suggested replies
are non-promotional by default. No field implies direct publishing.

## Tests written first

- All strict action union variants and action/detail discriminant linking.
- Exact REPLY URL/author/title/timestamp binding and at most three targets.
- REMIX source binding and non-copying instructions.
- WAIT reasons, do-not-act guidance, watch conditions, and recheck time.
- Measured, corroborated, single-signal, and unknown timing behavior.
- Unknown windows reject estimated remaining hours; ranges are rounded.
- Exact expiry boundary and review-invalidated stale behavior.
- Breakout payload rejects probability-shaped fields.
- Three differentiated hook labels and explicit format basis.
- Brief/draft invariance and exact REPLY output at both levels.
- Model rejection for added, dropped, or invented evidence.

## Verification

Focused schema, scoring, orchestration, API, fixture, request-digest, and
PostgreSQL tests are part of the observed local suites. A fresh PostgreSQL 16.14
database applied 23/23 migrations through `0024`; the full database run passed
710 tests with 5 skipped and no failures. The initial strict verifier matched
44/44 tables, but its expanded snapshot-manifest gate still requires a final
rerun. Release also requires immutable CI, authenticated hosted OpenAPI/UI/API
parity, and real Halio and ShipToUsers founder review. See the
[local product-completion record](../operations/LOCAL_VERIFICATION_2026-08-13.md).

## Limitations

Timing ranges and breakout labels remain explicit hypotheses until substantial
real outcome data exists. A categorical label may be wrong and is never a
promise of performance. Founder review remains required.

## Rollout and rollback

Roll out in fixture mode, then preview and a limited founder cohort. Roll back
by disabling new scans or forcing WAIT; do not silently downgrade a delivered
enhanced result or rebind its evidence. Because this is an intentional
pre-launch v1 change, legacy null payloads are not served as current.

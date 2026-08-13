# 010 — Deterministic ranking and constrained synthesis

Status: hardened core decision contract implemented; clean current fixture and
real-cohort review remain required.

## User problem

A raw feed or generic model prompt does not tell a founder which credible action
is timely, and may fabricate confidence/evidence.

## Scope

Deduplication, lineage/independence, clustering, deterministic feature scoring,
truth classes/action floors, compact top candidates, structured synthesis,
evidence binding, and `WAIT`.

## Non-goals

Unfiltered-feed prompts, autonomous browsing/tools, learned ranking before
outcome data, guaranteed performance, or cross-platform raw metric comparison.

## Product contract

One action only. `PUBLISH` needs strong fit/credibility, two independent items,
measured/corroborated demand, manageable saturation, defensible insight, and no
critical failure. Other actions follow the constitution; uncertainty returns
`WAIT`.

## API contract

Output uses a strict versioned schema: action/channel/topic/angle/format/hook/
outline/CTA/priority/confidence/validity, why-now truth class, evidence IDs, and
limitations. Evidence fields are system-bound.

## Data model

Store cluster/members, normalized feature vector, weights/score version,
opportunity, prompt/model/schema versions, bounded model input/output, move,
evidence receipts, and rejection reasons.

## Provider/legal constraints

Only approved stored fields enter synthesis. Model/provider processing and
retention must match account terms/privacy disclosures.

## Security considerations

Untrusted content delimiters, strict JSON, low temperature, one repair maximum,
65,536-byte input and 262,144-byte response caps, at most 8,192 output tokens,
no accepted model URL/metric/source claim, exact deterministic evidence-set
membership, secret/PII minimization, and conservative pre-call cost admission.

## Tests written first

- Deterministic scores/order, duplicate lineage, and independence.
- Every action quality floor plus adversarial `WAIT` cases.
- Numeric velocity requires valid snapshots/series.
- Malformed/extra-field/injected model output and repair limit.
- Flat/declining or other-query measurement cannot upgrade a candidate.
- Added, missing, duplicate, mismatched, or tampered evidence IDs cause
  rejection, including for `WAIT`.
- Partial provider failure and cost ceiling disclose limitations.

## Implementation

Filter/score before model use. External measurement is rising-only and isolated
to the candidate query; internal velocity requires an increase between
time-separated snapshots of the same signal. Treat weights as versioned
hypotheses (initial terms include audience fit, product relevance, momentum,
novelty, credibility, format/window/source quality, minus
saturation/dependency).

Model-assisted synthesis preserves the deterministic action, channel, format,
score/confidence/validity, and exact evidence-ID set while refining bounded
prose. Non-fixture calls require explicit input/output prices and atomically
reserve a conservative upper-bound cost before the call. Duplicate reservation
refuses replay.

## Verification

Golden fixtures, mutation/property checks for invariants, and founder blind
review on the dogfood set. Do not publish target metrics as achieved results.

## Limitations

Relevance and saturation proxies are imperfect; model language remains
probabilistic and founder review remains mandatory. Valid provider-reported
model token usage settles the local reservation; missing or invalid usage stays
conservative and unsettled. The operator-supplied price schedule is not
independently trusted, so local model cost is never invoice-equivalent.

## Rollout

Fixture first, then small reviewed cohort with versioned outcomes and drift
inspection.

## Rollback

Pin prior score/prompt versions or force `WAIT`; never rebind delivered evidence
without an audit event.

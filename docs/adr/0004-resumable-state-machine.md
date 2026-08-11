# ADR 0004: Persisted resumable scan state machine

- Status: Accepted
- Date: 2026-08-11

## Context

External calls are slow and fallible, while serverless execution is bounded and
may retry. In-memory jobs can disappear, repeat expensive calls, or deliver the
same result twice.

## Decision

Model a scan as durable, transactional state with these public states:
`QUEUED`, `RUNNING`, `REVIEW_REQUIRED`, `READY`, and `FAILED`. Persist before and
after every external step. Claim work atomically, assign idempotency keys to
requests and side effects, persist a hard deadline and rotating processing fence,
cap duration/calls/cost, and allow safe manual retry only from a reconciled
boundary.

For alpha volume, execution may happen in a bounded Vercel server function. The
orchestration package remains isolated so a durable worker/queue can replace the
executor without changing domain contracts.

## Current implementation status

Atomic claim/resume, persisted deadlines, processing-fence rotation, fenced
mutations, provider-step persistence, cost-ledger keys, review/delivery
transitions, and terminal `READY` retry are implemented. Recovery refuses to
replay a provider step left `RUNNING`; it records `PROVIDER_OUTCOME_UNKNOWN`
before considering an expired-deadline label and fails the scan. The current
`/ops` `retry` action is separate and requeues an
entire `FAILED` request as a new attempt; it does not rerun only a failed source
or synthesis step. After an uncertain upstream effect this can still repeat paid
work, so non-fixture failed-scan retry must remain disabled or tightly
operator-gated until reconciliation/fine-grained effect reuse is implemented
and tested.

## Consequences

- A process crash can resume from the last committed safe boundary, while stale
  workers are fenced out.
- An unknown upstream outcome stops automatic recovery instead of guessing.
- Delivery and provider calls need explicit deduplication.
- Operators see failure, attempts, cost, and audit history.
- The schema is more deliberate than a synchronous request handler.

## Rejected alternatives

Unbounded agent loops, implicit in-memory state, premature Temporal/Kafka/Redis,
and “retry the whole request” all violate cost or delivery guarantees.

## Verification

Test valid/invalid transitions, concurrent claiming, deadline/fence rotation,
stale mutations, crash after each boundary, unknown-provider/deadline precedence, same-key
request replay, provider retry, cost exhaustion, explicitly reconciled manual
retry, and exactly-once delivery effect.

## Reversal

A new executor may replace the alpha runner. The durable states, idempotency,
audit, and no-duplicate-delivery contracts remain unless a superseding ADR
proves stronger guarantees.

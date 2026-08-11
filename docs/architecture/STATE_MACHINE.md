# Scan state machine

## Public states

```text
QUEUED -> RUNNING -> REVIEW_REQUIRED -> READY
   |         |             |
   +---------+-------------+-----------> FAILED
```

`FAILED` is terminal for an attempt, not necessarily for the request: an
authorized operator can create a new audited attempt from a safe boundary.
`READY` means founder review is complete and private delivery is available; it
does not make a result public.

## Internal checkpoints

A run may checkpoint `CONTEXT`, `QUERY_PLAN`, each `SOURCE:<slug>`, `CLUSTER`,
`SCORE`, `SYNTHESIS`, `EVIDENCE_BIND`, `REVIEW`, and `DELIVERY`. Before an
external step, persist attempt identity, the scan hard deadline, processing
fence, limits, input hash, and start time. After it, persist status, provenance,
result hash, duration, cost/quota, and failure details before advancing.

## Transition rules

- Claim `QUEUED -> RUNNING` atomically and assign a rotating processing fence.
- Reclaim only after the persisted hard deadline and rotate the fence. Every
  processing mutation locks/rechecks the run and rejects a stale fence or
  expired deadline.
- A missing optional provider may be `DEGRADED`; a critical coverage failure
  must yield `WAIT`, `REVIEW_REQUIRED`, or `FAILED`, never silent success.
- Cost or duration ceilings stop further external work.
- If recovery finds a provider step left `RUNNING`, fail the scan with
  `PROVIDER_OUTCOME_UNKNOWN`; this check precedes and wins over an expired
  deadline label. Do not automatically replay an upstream effect whose
  charge/result may already exist.
- Only the evidence gate can enter `REVIEW_REQUIRED`.
- Review approval produces `APPROVED`; only an authenticated delivery action can
  enter `READY` and issue the private delivery capability.
- Delivery uses a unique effect key and cannot execute twice on retry.
- Public sharing is a separate consented state, not implied by `READY`.

## Idempotency

The tuple of tenant/environment plus client `Idempotency-Key` identifies a
logical API request. The contract requires replays with the same canonical
payload to return the same resource and a conflicting payload to be rejected.
The database stores/compares a canonical payload digest and detects conflicts,
including concurrent create races. The v1 service translates either conflict
path to `409`. Provider steps and delivery have independent effect keys because
request idempotency alone cannot prevent side-effect duplication.

API creation additionally uses atomic cost admission under an API-key row lock.
The same transaction rechecks idempotency, counts each rolling-hour request as
the greater of its persisted reservation or summed committed run costs, compares
exact micro-USD totals with the key ceiling, and inserts the request. Generic
creation rejects API-origin callers, preventing a bypass around that boundary.

## Retry and recovery

Retry only transient, classified failures within a provider-specific maximum.
Never recursively fan out. The current `/ops` implementation can explicitly
requeue an entire `FAILED` request as a new persisted attempt. A source-only or
synthesis-only rerun is not exposed yet; when implemented, it must invalidate and
recompute dependent clusters and proposals without rewriting history.

The explicit whole-scan retry is not equivalent to automatic recovery. After
`PROVIDER_OUTCOME_UNKNOWN`, the operator must first reconcile the upstream
request/effect and cost. Until that workflow exists, keep non-fixture manual
retry disabled or tightly blocked because it can repeat paid work.

## Required tests

- every allowed and forbidden transition;
- two workers claiming one run;
- hard-deadline reclaim, processing-fence rotation, and stale-worker rejection;
- interrupted `RUNNING` provider becomes `PROVIDER_OUTCOME_UNKNOWN` without an
  automatic second call;
- crash immediately before/after each external call;
- same idempotency key with same/conflicting body;
- parallel API cost admission at exact/below/above boundaries, including
  retained crash reservations and idempotent reuse;
- provider timeout, retry exhaustion, and partial coverage;
- cost/duration exhaustion;
- review authorization and CSRF;
- delivery retry with one observable delivery;
- `WAIT` and explicit limitations;
- private-to-public consent boundary.

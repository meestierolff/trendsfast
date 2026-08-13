# 011 — Founder review, private delivery, and feedback

Status: founder edit, context correction, stored-evidence recompute, private
delivery, audit, and redacted dogfood export are implemented; deployed release
evidence remains a separate gate.

## User problem

Early recommendations need accountable human judgment, private delivery, and
outcome learning without pretending they are autonomous or public.

## Scope

Ops queue/review, evidence verification/rejection, approve/`WAIT`, delivery,
failure/retry actions, audit trail, unguessable private delivery, feedback, used
outcome, repeat request, and public opt-in.

## Non-goals

Customer accounts/teams, auto-approval, email marketing, public-by-default
results, or long-term admin authentication.

## Product contract

Ready result shows founder-reviewed badge, evidence/limitations/confidence/
validity, `auto_publish=false`, and five feedback choices. Public case study is a
separate explicit consent.

## API contract

Review mutations are authenticated, CSRF-protected, version/attempt-aware, and
idempotent. Private token grants read/feedback only for one result and never
reveals ops or reusable API access.

## Data model

Append review events and immutable proposal revisions with before/after,
reviewer, reason, prompt/score versions, context version, retained evidence IDs,
and timestamp. Evidence and opportunities are move-versioned. Delivery persists
token hash/expiry/revocation/effect; feedback/outcome/share-consent remain
separate events.

## Provider/legal constraints

Manual evidence is labeled, attributed, minimized, and reviewed for rights.
Public use needs subject permission and takedown path.

## Security considerations

Strong server-only ops token/session, secure cookies, CSRF/origin, bounded
mutation bodies, pre-verification durable admission, 256-bit CSPRNG capability
tokens, delivery-token hashing/expiry, generic errors, and audit.

## Tests written first

- Ops unauthenticated/invalid/brute-force/session/CSRF cases.
- Edit conflict and complete immutable audit.
- Token entropy, expiry/revoke/enumeration, cross-result feedback.
- Delivery replay causes one effect.
- No public result without approval plus explicit consent.
- Manual evidence validation/label and rerun dependency invalidation.

## Implementation

Treat founder auth as temporary single-operator control and keep privileged
actions server-side. Preserve old proposal/evidence versions.

### Current implementation truth

The protected queue and detail pages read persisted request, run, provider,
context, move, evidence, and delivery state. CSRF-bound JSON actions support
verify/reject evidence, approve, edit-and-approve, correct context, recompute
from stored evidence, convert to `WAIT`, deliver, mark failed, and retry a whole
failed scan. Founder-stage evidence binding requires `verified=true`, a nonempty
reviewer, a verification timestamp, and an `EVIDENCE_VERIFIED` audit event;
processing-stage binding remains unverified and reviewerless. Approval and
delivery use only receipts from the current move version.

Edit-and-approve accepts only recommendation copy, channel/format, validity,
limitations, and confidence-rationale fields. Action, evidence identity,
providers, metrics, truth class, score, source count, and cost are immutable.
The repository locks request/run/move rows, requires an expected version,
validates channel and format against current context, rechecks the evidence
quality floor, and records a complete immutable revision. The ops route maps a
stale concurrent edit to `409`.

Context correction creates a new immutable context version, preserves the old
version, records a stale intermediate proposal, and recomputes a new draft using
only eligible signals already stored for that scan run. A founder-rejected
current-version signal is excluded and cannot re-enter through a direct
repository call. The path contains no provider or model client, records zero
provider calls/no synthesis, and creates unverified current-version receipts
that require renewed founder review. Optional structured synthesis is not
available on this path and is never implicit.

Founder-only JSON and Markdown review-bundle endpoints expose bounded release,
context, query-plan, provider, cost, evidence, scoring, proposal, and audit
truth. They require the signed ops session and return private no-store headers.
The exporter omits raw provider/model payloads and redacts capabilities,
credentials, database URLs, email addresses, and raw IPv4/IPv6 values.
Unsettled attempts remain nullable rather than appearing as settled zero.

Delivery issues a hashed, expiring bearer token and returns the raw token only
when first created; replay does not create a second token.

The private result route accepts the delivery token and, for a public-form
requester, the original unguessable scan capability after delivery. It exposes
feedback and a separate explicit public-share consent mutation; consent records
permission but does not itself publish a case study.

Founder operations can add one bounded public manual-evidence record through the
manual adapter while a scan is a draft awaiting review. The record is audited,
labeled `MANUAL_FOUNDER_EVIDENCE`, and bound as supplemental evidence. It cannot
silently qualify an existing proposal; an explicit stored-evidence recompute is
required, followed by renewed evidence review.

Source-only/synthesis-only rerun and public consent withdrawal are not
implemented. Customer identity is a separate post-value Supabase Auth and
single-use project-claim boundary; it does not replace founder operations. Ops
login uses constant-time token comparison and a signed
`HttpOnly`/`SameSite=Strict` session. Syntactically valid login attempts enter
PostgreSQL-backed admission before token comparison, defaulting to 5 per
fingerprint and 100 globally per five-minute window, in addition to an
in-process bound. Same-origin and deployed trusted-proxy/network controls remain
part of the operating boundary.

Both the public scan/status capability and separately issued delivery token use
256 random bits. The delivery token is hashed at rest and expires; the public
capability is stored as its lookup value, so both still depend on bearer secrecy
and retention. Public capability lookup has no independent durable throttle;
verified deployed-edge control remains a defense-in-depth P2. Login, feedback,
share-consent, and ops-action bodies are stream-counted before parsing. Review
edit and recompute actions carry the current proposal version; repository row
locks and version predicates reject stale concurrent mutation.

Processing recovery refuses to replay an interrupted provider and records
`PROVIDER_OUTCOME_UNKNOWN` before an expired-deadline label, but the explicit ops
retry requeues a whole failed scan. After an uncertain provider effect or
charge, non-fixture retry remains blocked until an operator reconciliation
workflow exists.

## Verification

Browser tests for queue/review/result/feedback/mobile plus concurrent/replay
integration tests and manual audit inspection.

Code-local unit and database integration coverage exercises evidence-review
identity, version conflicts, immutable-action edit-and-approve, context
correction, stored-only recomputation, delivery, and redacted bundle export. A
final production-artifact run passed 58 Playwright checks with two intentional
mobile skips, including 24 desktop/mobile axe checks. This is immutable
code-local evidence at `73297a6cfdc99b025990b001b39cef399f4d235e`, not remote
CI or a deployed workflow. See the
[integrated record](../operations/LOCAL_VERIFICATION_2026-08-12.md).

## Limitations

Token-based ops is not scalable customer identity; private links are bearer
capabilities and can be forwarded. The public scan capability becomes able to
read the reviewed result only after the separate delivery transition.
Fine-grained provider retry, optional structured resynthesis, and
consent-withdrawal surfaces remain workflow limitations. Manual evidence remains
supplemental until an explicit recompute selects it and a founder renews review.

## Rollout

One founder, small queue, short-lived sessions/tokens, network restriction where
possible, and close monitoring.

## Rollback

Disable submissions/review mutations, revoke tokens, retain audited result access
where safe, and process requests manually.

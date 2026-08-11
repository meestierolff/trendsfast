# 011 — Founder review, private delivery, and feedback

Status: core alpha trust boundary implemented; hardened local/release evidence
and the workflow gaps below remain open.

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

Append review events with before/after references, reviewer/time/reason; delivery
token hash/expiry/revocation/effect; feedback/outcome/share-consent events.

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
verify/reject evidence, approve, convert to `WAIT`, deliver, mark failed, and
retry a whole failed scan. Approval cannot deliver a non-`WAIT` move without at
least one verified stored receipt. Delivery issues a hashed, expiring bearer
token and returns the raw token only when first created; replay does not create a
second token.

The private result route accepts the delivery token and, for a public-form
requester, the original unguessable scan capability after delivery. It exposes
feedback and a separate explicit public-share consent mutation; consent records
permission but does not itself publish a case study.

Move-copy editing, manual evidence entry, source-only/synthesis-only rerun,
public consent withdrawal, and customer identity are not implemented. Ops login
uses constant-time token comparison and a signed `HttpOnly`/`SameSite=Strict`
session. Syntactically valid login attempts enter PostgreSQL-backed admission
before token comparison, defaulting to 5 per fingerprint and 100 globally per
five-minute window, in addition to an in-process bound. Same-origin and deployed
trusted-proxy/network controls remain part of the operating boundary.

Both the public scan/status capability and separately issued delivery token use
256 random bits. The delivery token is hashed at rest and expires; the public
capability is stored as its lookup value, so both still depend on bearer secrecy
and retention. Public capability lookup has no independent durable throttle;
verified deployed-edge control remains a defense-in-depth P2. Login, feedback,
share-consent, and ops-action bodies are stream-counted before parsing. Review
actions validate the current persisted state, but the client does not send an
explicit expected version/attempt precondition; add that before claiming the
full version-aware mutation contract.

Processing recovery refuses to replay an interrupted provider and records
`PROVIDER_OUTCOME_UNKNOWN` before an expired-deadline label, but the explicit ops
retry requeues a whole failed scan. After an uncertain provider effect or
charge, non-fixture retry remains blocked until an operator reconciliation
workflow exists.

## Verification

Browser tests for queue/review/result/feedback/mobile plus concurrent/replay
integration tests and manual audit inspection.

## Limitations

Token-based ops is not scalable customer identity; private links are bearer
capabilities and can be forwarded. The public scan capability becomes able to
read the reviewed result only after the separate delivery transition. Missing
manual entry/editing/fine-grained retry/consent-withdrawal surfaces remain
workflow limitations.

## Rollout

One founder, small queue, short-lived sessions/tokens, network restriction where
possible, and close monitoring.

## Rollback

Disable submissions/review mutations, revoke tokens, retain audited result access
where safe, and process requests manually.

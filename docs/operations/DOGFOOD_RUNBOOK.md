# Private dogfood runbook

The required production-equivalent internal set is exactly TrendsFast and
Halio, in that order. Keep anonymous public provider scans disabled. Use the
authenticated project flow, the existing live provider pipeline, and one
project-scoped live API key per owned project. Fixtures, mocks, reconstructed
URLs, generated metrics, and hand-edited differentiation do not count as live
dogfood evidence.

The private-alpha founder account must have the server-controlled Supabase
`app_metadata.trendsfast_project_entry` value exactly `FOUNDER` before its first
URL entry. User-editable metadata never grants this capability. Record only the
boolean readback in release evidence. Project entry is durably serialized and
capped; an account without this trusted authorization can add another product
only through an existing active entitlement or design-partner grant. Never
print the Auth user record or metadata payload.

## Required runs

### A. TrendsFast

- Product URL: `https://trendsfast.com/`
- Objective: Grow qualified technical-founder API interest.
- Preferred channels: `x`, `linkedin`, `youtube`, `blog`.
- Content capabilities: `founder_text`, `screen_recording`.

### B. Halio

- Product URL: `https://halio.nl/`
- Objective: Grow qualified Dutch investor interest in Halio.
- Preferred channels: `x`, `linkedin`, `youtube`, `blog`.
- Content capabilities: `founder_text`, `screen_recording`.

Halio output must not provide buy/sell advice or trading permissions. Unknown
data is not zero. Keep the positioning read-only and focused on product clarity,
and reject unsupported financial-performance claims.

## Procedure for each project

1. Record the release SHA, canonical product URL, owner authorization, saved
   objective, channels, capabilities, language/market context, and confirmed
   product-context version. Separate observed website facts, inferred context,
   and assumptions; record every founder correction without rewriting observed
   provenance.
2. Use one audited temporary `DESIGN_PARTNER` grant and one project-scoped live
   API key with `next_move:write` and `next_move:read`. Do not create a fake
   Stripe subscription and do not reuse a key across projects.
3. Send `POST /v1/projects/{project_id}/next-move` with a fresh UUID
   `Idempotency-Key` and `generation_level=draft`. Require `202`, `Location`, and
   `Retry-After`/`poll_after_seconds` parity when work is accepted.
4. Poll `GET /v1/next-moves/{id}` at the returned `Retry-After` cadence. Record
   queued/running source states without a synthetic progress percentage. Stop at
   `REVIEW_REQUIRED`.
5. Inspect the exact stored evidence, source availability, product specificity,
   timing, limitations, and PUBLISH/REPLY/REMIX/WAIT action details. Apply only
   factual corrections. Do not weaken the quality floor to avoid a truthful
   WAIT.
6. Approve one evidence-valid result through the authenticated owner review
   boundary, then retrieve `READY` through the same project API key. Require
   `contract_version=next-move-v1`, `generation_level=draft`, one matching action
   union, original evidence, `founder_reviewed=true`, and `auto_publish=false`.
7. Capture query plan, provider/source statuses, selected evidence, action,
   channel, exact REPLY or REMIX source URLs, draft or suggested reply,
   limitations, review edits/time, and outcome. Record actual private provider
   and model costs where available; preserve an unavailable value as `unknown`.
8. Export protected JSON and Markdown bundles with
   `pnpm dogfood:export <scan-id> --include-private-costs`. Store both files
   beneath ignored `.var/private/dogfood/`, set each file to mode `0600`, and
   record the exact paths in the release evidence.

## Quality gate

Both runs pass only when:

- the resolved product context is correct and preserves observed/inferred/
  assumed provenance;
- the recommendation is product-specific and the channel is plausible;
- a REPLY contains the exact original destination URL;
- a PUBLISH or REMIX contains a usable draft, and a REPLY contains a usable
  suggested reply, that a founder could use within five minutes;
- evidence supports `why_now`, timing is current, and no URL or metric is
  invented;
- TrendsFast and Halio do not receive interchangeable output; and
- Halio satisfies every financial-safety constraint above.

A truthful WAIT passes when its failure reasons, what-not-to-do guidance, watch
conditions, and recheck time are evidence-backed. It must not contain fake
content or a fake destination.

## Comparison and external review

```text
Product | project/scan ID | context correct | query plan/source states |
action/channel/format | exact destination | draft/reply usable |
evidence supports why_now | limitations | review outcome |
provider/model actual USD or unknown | JSON path | Markdown path
```

Fixture cost is not provider spend. Do not replace an unknown actual cost with
list pricing or a conservative reservation. Keep the scans and bundles private.
External review and explicit subject consent are required before publishing a
bundle, result, or case study; lack of public-case-study consent is not a blocker
for private dogfood or for shipping the authenticated, non-publishing core.

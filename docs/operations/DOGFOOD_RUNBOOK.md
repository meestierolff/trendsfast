# Dogfood runbook

The required production-equivalent internal set is exactly TrendsFast, Halio,
and ShipToUsers, in that order. A product name alone is not an accurate URL or
permission; the founder must confirm each current public URL, ownership, target
market, and authorization before a live scan.

## Procedure

1. Record release SHA, scan mode, product URL, market/language, available
   channels/formats, and owner consent.
2. Use an operator-granted, audited design-partner entitlement and issue one
   project-scoped live API key; do not create a fake Stripe subscription.
3. Submit through `POST /v1/next-move`, poll through the real status endpoint,
   and run live only after each enabled provider's setup/rights/read-back gate.
4. Capture inferred audience, assumptions/corrections, query plan, source
   statuses, clusters, action, channel, format, evidence, limitations, review
   edits/time, provider actual/unknown cost, conservative model reservation and
   usage status, dated model price source, and outcome.
5. Perform founder evidence review and edits, approve, deliver, retrieve through
   the API, and export both redacted JSON and Markdown review bundles.
6. Compare all three outputs. Generic repeated topic/action/advice is a launch
   blocker; do not hand-edit results merely to look different.
7. Verify every receipt at delivery and mark disappearing sources honestly.
8. Keep scans private unless each subject explicitly opts into a public case
   study.
9. Record the exact bundle paths, then stop for external review. Do not deploy
   public production or enable live Checkout until the founder resumes with
   `DOGFOOD_EXTERNAL_REVIEW_APPROVED=YES`.

## Comparison table

```text
Product | mode | audience differs | query plan differs | source weights differ |
topic/action/channel/format differ | evidence valid | limitations | review min |
provider cost USD/unknown | model reservation | model usage settled? |
used? | permission/public?
```

Fixture cost is not provider spend. Unknown live cost stays `unknown`; do not
substitute list pricing or a conservative model reservation. No dogfood result
or cost is claimed until this runbook is completed with real evidence. The
current 2026-08-12 status is **not run** because hosted infrastructure,
provider/model read-backs, and credentials are unavailable.

# Technical Reddit post draft

> Educational draft for manual posting after release verification. Adapt to a
> community's rules; remove product links if self-promotion is not allowed.

## Possible title

How I’m keeping an LLM from inventing evidence in a trend-recommendation pipeline

## Draft

I was spending hours searching social media and search demand for something
relevant to distribute. TrendsFast now gives my agents one evidence-backed Next
Move from a product URL. The implementation question that mattered most was how
to keep that answer tied to original evidence.

The obvious implementation for “what should I publish today?” is to fetch a
bunch of posts and ask a model. I tried designing the system from the opposite
direction: assume every fetched page, provider result, and model token is
untrusted.

The pipeline is:

```text
bounded source adapters -> canonical stored signals -> deterministic filters
-> source-lineage clusters -> small candidate set -> structured synthesis
-> system-bound evidence -> human review
```

Three rules matter more than the model choice:

1. **Evidence never comes from the model.** It may propose an angle, but URLs,
   metrics, publication times, and source claims are rebound from stored provider
   records. A missing ID rejects the claim.
2. **A popular post is not automatically a trend.** We distinguish a provider
   time series, velocity from two time-separated internal snapshots,
   corroboration across independent origins, one emerging signal, and
   insufficient evidence.
3. **`WAIT` is first-class.** Weak relevance, copied evidence, high saturation,
   inadequate coverage, or uncertainty should produce no content recommendation.

External calls are bounded and checkpointed in PostgreSQL before/after each
step, with separate request/provider/delivery idempotency and a per-scan cost
ceiling. Example mode walks through the same schemas, persistence, scoring,
review, and delivery path without paid keys.

The trickiest non-model boundary is submitted-URL fetching: every DNS result and
redirect must be revalidated against private/loopback/link-local/metadata ranges,
with strict byte/type/time caps. Extracted text is prompt-injection data, not
instructions.

Current verification at `[SHA]`: `[PASTE ONLY ACTUAL TEST/READ-BACK SUMMARY]`.
There is no automated Reddit ingestion; that remains permission-gated. Paid
availability is not claimed unless the linked release record proves it.

Source/code: `[REPOSITORY OR ARCHITECTURE LINK]`

I’d value critique of `[ONE SPECIFIC OPEN QUESTION: e.g. evidence independence
or crash idempotency]`, especially failure cases I should add to the example
suite.

If this is relevant to your product:

> **Drop your product URL. I’ll run a free founder-reviewed trend and
> distribution scan.** `[TRACKED LINK]`

## Posting guardrail

Do not write “production-ready,” “secure,” “all sources live,” or performance
numbers unless the linked release evidence supports each claim.

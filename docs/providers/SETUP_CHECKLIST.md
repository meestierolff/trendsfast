# Provider setup checklist

This checklist separates code configuration from external authority. Provider
consoles, pricing, terms, and APIs can change; verify current official
documentation at setup time. Never paste credentials or unredacted responses
into this repository.

## Common gate

For every provider:

- [ ] Name an accountable account owner and billing contact.
- [ ] Review current terms, commercial use, display/attribution, retention,
      caching, model-training, and redistribution rules.
- [ ] Confirm the account may process the intended user-submitted context.
- [ ] Create separate least-privilege development and production credentials.
- [ ] Put secrets in local `.env` only for development and a managed secret
      store for deployment; verify browser bundles and logs do not contain them.
- [ ] Configure provider and TrendsFast quota/spend alerts.
- [ ] Run contract tests against fixtures before making any live call.
- [ ] Run one bounded development read-back and inspect normalization.
- [ ] Run one bounded production-environment read-back with no customer data.
- [ ] Record timestamp, environment, request/provider ID, capability exercised,
      duration, HTTP outcome, returned original URL, cost/quota, and reviewer.
- [ ] Verify timeout, rate-limit, malformed response, missing key, and circuit
      breaker behavior.
- [ ] Verify scan-deadline abort tears down in-flight transport work. If an
      upstream outcome becomes unknown, confirm automatic recovery does not
      replay it and document the operator reconciliation required before any
      explicit retry.
- [ ] Add a rotation/revocation owner and date.

## Product website ingestion

- [ ] No account is required, but complete privacy/terms review for fetching
      submitted public URLs.
- [ ] Verify SSRF controls for every DNS result and redirect hop.
- [ ] Verify the default Node transport connects to the validated numeric
      address while retaining the original Host/SNI; run a controlled-socket
      check and target-production-network read-back.
- [ ] Verify size, content-type, timeout, redirect, and sanitized extraction
      limits with malicious fixtures.
- [ ] Treat all content as untrusted prompt data.
- [ ] Read back only a founder-controlled public test page in production.

## xAI X Search (`XAI_API_KEY`, `XAI_MODEL`)

- [ ] Founder creates/funds an xAI API account and confirms X Search access and
      intended commercial/data usage.
- [ ] Set `XAI_MAX_TOOL_CALLS_PER_SCAN=2` (lower is allowed).
- [ ] Read back one bounded 72-hour query; confirm original X URLs and returned
      metadata are stored, with tool/token cost.
- [ ] Keep the source `BETA_UNVERIFIED` until that production record exists.

## DataForSEO Google Trends

- [ ] Founder creates/funds DataForSEO credentials and verifies the exact Google
      Trends API surface and allowed use.
- [ ] Set `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, and
      `DATAFORSEO_GOOGLE_TRENDS_MODE=live` for on-demand alpha scans.
- [ ] Use no more than five closely related keywords.
- [ ] Verify a genuine rising time series for the candidate query and
      related/rising query provenance; flat, declining, or unrelated series must
      not produce measured momentum.
- [ ] If using DataForSEO's different proprietary Trends product, label it
      `DATAFORSEO_TRENDS`, never “Google Trends.”

## Hacker News Algolia

- [ ] Confirm current endpoint/usage guidance and attribution expectations.
- [ ] Run at most five seven-day queries and store at most 30 candidates.
- [ ] Verify object ID, author, date, points/comments, and original HN URL.
- [ ] Exercise timeout/rate-limit degradation even if no credential is needed.

## GitHub public API (`GITHUB_TOKEN`, optional)

- [ ] Founder creates a fine-grained read-only token only if higher authenticated
      limits are needed; public metadata must degrade gracefully without it.
- [ ] Confirm current API terms, acceptable use, and displayed attribution.
- [ ] Run at most three query groups and store at most 20 candidates.
- [ ] Verify repository/release/issue canonical URLs. Never claim star velocity
      without increasing metrics across at least two stored time-separated
      snapshots of the same signal.

## Tavily (`TAVILY_API_KEY`)

- [ ] Founder creates/funds an account and confirms search-result retention and
      commercial display rights.
- [ ] Set `TAVILY_MAX_CREDITS_PER_SCAN=2`.
- [ ] Use basic raw results by default; disable generated answers when not
      necessary.
- [ ] Verify publication metadata, original URLs, credits, and actual cost.

## YouTube Data API (`YOUTUBE_API_KEY`)

- [ ] Founder creates a Google Cloud project, enables the YouTube Data API, and
      restricts a server-side API key appropriately.
- [ ] Review current YouTube API Services terms, required attribution, quota,
      storage/refresh, and deletion rules.
- [ ] Set `YOUTUBE_MAX_SEARCHES_PER_SCAN=2`.
- [ ] Verify `search.list` plus batched `videos.list` public statistics only;
      no customer OAuth, transcripts, or comment crawl in v0.1.

## Synthesis model (`LLM_PROVIDER`, `LLM_MODEL`)

- [ ] Choose an explicitly configured runtime provider/model. If xAI is used,
      reuse only where account terms permit; if OpenAI is used, set a separate
      server-only `OPENAI_API_KEY`.
- [ ] Set `LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS` and
      `LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS` from a dated reviewed schedule;
      record its source/effective date without exposing account data.
- [ ] Confirm data processing/retention settings and regional needs.
- [ ] Verify strict structured output, low variance, one malformed-output repair
      maximum, prompt versioning, 65,536-byte input, 262,144-byte response, and
      8,192-token output caps.
- [ ] Prove the system rejects model-proposed evidence URLs/metrics/source claims
      and any added, dropped, or duplicate deterministic evidence ID.
- [ ] Reconcile provider-reported actual token usage/cost to the conservative
      pre-call reservation. Until implemented and evidenced, retain
      `unknown_not_settled` and do not publish the reservation as actual cost.

## Manual evidence and Reddit

- [ ] Implement and authorize a callable manual-evidence entry route or ops
      control before describing the adapter as available to founders.
- [ ] Manual records require reviewer identity, timestamp, original public URL,
      excerpt, visible metric qualifier, reason, and `MANUAL_FOUNDER_EVIDENCE`.
- [ ] Do not automate Reddit access, use `.json`, scrape, or imply commercial
      permission. Status remains `LEGAL_REVIEW` until documented permission and
      founder/legal approval exist.

## Production read-back record

Store a redacted record in the operational release evidence system:

```yaml
source: github
environment: production
checked_at: 2026-08-11T00:00:00Z
reviewer: <name>
build_sha: <full-sha>
credential_fingerprint: <non-secret-version-or-last-4>
capability: <minimal-operation>
request_id: <provider-id-if-safe>
status: pass | fail
duration_ms: <integer>
cost_usd: <decimal-or-null-with-reason>
quota_units: <number-or-null-with-reason>
price_schedule_source_and_effective_date: <required-for-models-or-na>
usage_reconciliation: actual | unknown_not_settled | not-applicable
canonical_url_verified: true | false
secret_redaction_verified: true | false
notes: <limitations-no-payloads-or-secrets>
```

Only `pass` from the intended production environment supports a public status
upgrade. There are no such records committed for this alpha snapshot.

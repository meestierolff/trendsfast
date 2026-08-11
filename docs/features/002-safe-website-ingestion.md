# 002 — Safe product website ingestion

Status: pinned/abortable implementation exists; controlled-socket and production
read-back evidence remain required.

## User problem

A URL should be onboarding, but fetching arbitrary user URLs can expose internal
networks and hostile content.

## Scope

HTTP(S) URL validation, DNS/address controls, bounded redirects/fetch/extraction,
sanitized product context, assumptions, and founder correction.

## Non-goals

Authenticated pages, browser automation, broad crawling, JavaScript execution,
private URLs, file downloads, or an archival scraper.

## Product contract

Infer name, category, ICP, pain, outcome, credible claims/topics, alternatives,
language, channels, and formats. Show assumptions and limitations for correction.

## API contract

Only `product_url` is required. Invalid/unsafe URLs return a stable client error;
timeouts and unsupported content return classified failures without leaking
network details.

## Data model

Store normalized URL, bounded fetch metadata/hash, context version, assumptions,
corrections, and source-run failure—not indefinite full HTML.

## Provider/legal constraints

The submitter must have authority to submit the URL. Review site terms, privacy,
robots expectations, copyright, retention, and removal procedures.

## Security considerations

Block loopback/private/link-local/metadata/reserved addresses across IPv4/IPv6,
validate every DNS answer and redirect, cap ports/redirects/bytes/time/types, and
treat extracted text as prompt-injection content.

## Tests written first

- URL normalization and malformed schemes/credentials/ports.
- Direct, redirected, encoded, IPv4-mapped IPv6, and DNS-rebinding SSRF corpus.
- Redirect, timeout, byte, compression, and content-type limits.
- Script/HTML sanitization and malicious prompt instructions.
- Correct context plus explicit uncertain assumptions.

## Implementation

Use one guarded fetch boundary with manual redirect handling. Re-resolve each
hop, connect the default Node transport to a validated numeric address while
preserving the original Host/SNI, and abort the underlying request/response on
timeout or scan deadline. Extract only supported textual content, then validate
a versioned context schema.

## Verification

Address, redirect, rebinding, pinning, and abort contracts are covered locally.
Also run a controlled-socket integration and founder-controlled public test-page
read-back in the target production network; record the connected address and
response limits without sensitive payloads.

## Limitations

The default Node transport is pinned, but alternative/serverless transports must
prove the same contract. Dynamic sites may yield little content. Do not weaken
SSRF policy for coverage.

## Rollout

Enable only after the SSRF/prompt suite passes; start with low rate/size limits.

## Rollback

Disable public fetching and accept fixture/manual context while preserving prior
audit records.

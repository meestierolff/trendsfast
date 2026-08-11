# Source rights and status matrix

This is an engineering/legal review aid, not a legal opinion or permission from
any provider. Terms and API policies change. The founder and qualified counsel
must review the current official documents before commercial production.

Status dimensions are intentionally separate:

- **Product maturity** is the intended launch designation from the product
  plan (`LIVE`, `BETA`, or `LEGAL_REVIEW`).
- **Verification** is what this repository can prove today. No external
  production read-back is recorded, so no automated external source is publicly
  claimable as live.

| Source / path                          | Intended maturity      | Current verification                                       | Access path                                  | v0.1 storage/display boundary                                                     | Required rights review                                                    |
| -------------------------------------- | ---------------------- | ---------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Repository fixtures                    | Fixture only           | `FIXTURE_VERIFIED` locally at `072d5fc`; remote CI pending | Committed synthetic data                     | Deterministic excerpts and URLs clearly labeled fixture                           | Ensure fixtures are synthetic/licensed and contain no customer data       |
| Submitted product website              | `LIVE` after read-back | `UNVERIFIED`                                               | Server fetch of user-provided public URL     | Sanitized minimal extraction/context; no scripts; bounded retention               | Site terms, robots expectations, privacy/copyright, user authority        |
| X                                      | `BETA`                 | `BETA_UNVERIFIED`                                          | xAI X Search                                 | Original URLs + allowed returned metadata/minimal excerpt; no summary as evidence | xAI/X commercial use, display, attribution, caching, deletion, model use  |
| Google Trends                          | `LIVE` after read-back | `UNVERIFIED`                                               | DataForSEO's actual Google Trends surface    | Time series/related queries with accurate provider label                          | DataForSEO/Google-derived data rights, storage/display/attribution        |
| Hacker News                            | `LIVE` after read-back | `UNVERIFIED`                                               | Algolia HN API                               | IDs, URLs, metadata, minimal excerpts                                             | Algolia/HN guidance, story/comment licenses and author attribution        |
| GitHub                                 | `LIVE` after read-back | `UNVERIFIED`                                               | Official public API                          | Public metadata and original URLs; no code-content archive                        | API terms, rate limits, privacy, repository/content licenses              |
| Open web/news                          | `BETA`                 | `BETA_UNVERIFIED`                                          | Tavily basic search                          | Results metadata, original URLs, minimal supporting excerpts                      | Tavily terms plus publisher copyright, caching and display rights         |
| YouTube                                | `BETA`                 | `BETA_UNVERIFIED`                                          | YouTube Data API `search.list`/`videos.list` | IDs, URLs, titles, public statistics; no transcripts/comments in v0.1             | API Services terms, required attribution, quota, storage/refresh/deletion |
| Manual founder evidence                | `LIVE` review path     | `ADAPTER_ONLY`; no entry UI/API                            | No callable founder-entry route              | Contract requires reviewer, timestamp, short excerpt, observed metric qualifier   | Copyright/privacy, accuracy, removal requests, platform terms             |
| Reddit automation                      | `LEGAL_REVIEW`         | `LEGAL_REVIEW`                                             | **None in v0.1**                             | No automated or manual-evidence ingestion claim                                   | Commercial permission and legal review required before any automation     |
| LinkedIn and other post-launch sources | `PLANNED`              | `NOT_IMPLEMENTED`                                          | None                                         | None                                                                              | Provider-specific review before implementation                            |

## Status-change gate

To change an external source from unverified to public `LIVE`/`BETA`:

1. approve intended use and current terms;
2. complete fixture and contract tests;
3. configure a production-owned least-privilege credential if required;
4. perform a minimal production read-back using no customer data;
5. verify canonical URL, provenance, labeling, cost/quota, degradation, and
   secret redaction;
6. record timestamp, build SHA, reviewer, and known limitations;
7. update UI, README, this matrix, and launch evidence in the same reviewed
   change.

Code presence, a test stub, a mock HTTP response, a development credential, or
a passing build is not sufficient.

The local fixture verification behind `LOCAL_PASS` is recorded in
[the dated local record](../operations/LOCAL_VERIFICATION_2026-08-11.md). It is
not `FIXTURE_VERIFIED` release evidence until repeated at an identified SHA.

## Takedown and correction

The operator needs a documented path to hide a receipt, mark
`SOURCE_NO_LONGER_AVAILABLE`, correct metadata without rewriting audit history,
honor deletion requests, and stop a provider quickly. Disable first when rights
or accuracy is uncertain; preserve only the minimal audit facts lawfully needed.

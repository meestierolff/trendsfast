# Feature contracts

One vertical slice equals one numbered file. Every feature includes the user
problem, scope, non-goals, product/API/data contracts, provider/legal/security
constraints, tests written first, implementation, verification, limitations,
rollout, and rollback.

| Feature | Contract                                                                      |
| ------- | ----------------------------------------------------------------------------- |
| 001     | [Fixture vertical slice](001-fixture-vertical-slice.md)                       |
| 002     | [Safe website ingestion](002-safe-website-ingestion.md)                       |
| 003     | [Google Trends / DataForSEO](003-google-trends.md)                            |
| 004     | [Hacker News / Algolia](004-hacker-news.md)                                   |
| 005     | [GitHub public metadata](005-github.md)                                       |
| 006     | [X Search / xAI](006-x-search.md)                                             |
| 007     | [REST API and API keys](007-rest-api-and-api-keys.md)                         |
| 008     | [Tavily web/news](008-tavily.md)                                              |
| 009     | [YouTube public video evidence](009-youtube.md)                               |
| 010     | [Ranking and synthesis](010-ranking-and-synthesis.md)                         |
| 011     | [Founder review, delivery, feedback](011-founder-review-delivery-feedback.md) |
| 012     | [Public and ops surfaces](012-public-and-ops-surfaces.md)                     |
| 013     | [Stripe readiness](013-stripe-readiness.md)                                   |
| 014     | [Analytics and open metrics](014-analytics-and-open-metrics.md)               |
| 015     | [Dogfood and launch](015-dogfood-and-launch.md)                               |
| 016     | [Enhanced decision contract](016-enhanced-decision-contract.md)               |

The status at the top of a feature file is authoritative only for that document.
Release completion is evidenced in `docs/operations/LAUNCH_CHECKLIST.md` and an
instance of `docs/operations/RELEASE_REPORT_TEMPLATE.md`.

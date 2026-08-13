# Product constitution

Status: accepted for the founder-reviewed first cohort. Product changes that
contradict this document require an explicit architecture/product decision.

## Category

> **TrendsFast is the social and search trend intelligence API for founders,
> creator-led brands, and their AI agents.**

It is not primarily a trend dashboard, scraper, scheduler, auto-poster, social
listening suite, or generic content generator.

## Promise

**Find relevant trends and content opportunities fast. Know exactly what to
publish, where to publish it, which conversation to reply to, what to remix, or
what to wait on.**

TrendsFast understands your brand, watches live social and search signals, and
gives every AI agent one evidence-backed Next Move—with a channel, format, hook,
tone, target, and time window.

The first cohort is founder-reviewed. It requires no card before value and never
auto-publishes.

The primary outcome is to replace hours of manual distribution research with
one relevant, evidence-backed action a founder can actually take, increasing
the odds of breakout content by acting before a relevant opportunity saturates.
This is never a guarantee of virality.

## Initial customer

Build primarily for technical solo founders and small teams making AI tools,
B2B SaaS, developer tools, and creator-led products. They have a live product
URL, ship faster than they distribute, lack a full-time distribution team, and
value evidence and speed over a large dashboard.

Support growth operators and founder-creators responsible for distributing one
specific product or brand without broadening into a generic creator database.

Do not optimize the first cohort for enterprise surveillance, agencies managing
many clients, generic entertainment creators, influencer discovery, bulk data
resale, every social network, auto-posting, or guaranteed virality.

## Job to be done

> When I need to distribute my product but do not know what is worth saying
> now, identify the highest-leverage relevant conversation or content
> opportunity so I can act without spending hours researching platforms.

## Native object: Next Move

Every completed scan returns exactly one action:

- `PUBLISH`: create a new product-credible contribution supported by at least
  two independent items and measured or corroborated demand;
- `REPLY`: contribute usefully to one exceptional recent conversation with a
  valid original URL;
- `REMIX`: translate a proven topic or format without copying it;
- `WAIT`: explain why no opportunity clears the quality floor.

`WAIT` is a trustworthy positive outcome. No source count or model preference
may force an action.

## Outcome value

TrendsFast replaces manual research with one relevant action. Value comes from
time saved, product/audience relevance, remaining timing window, original
evidence, focus, agent-ready structure, and outcome learning.

Never promise virality, views, customers, revenue, daily content, perfect
coverage, or velocity that was not measured.

## Trend truth

Only these classes may be emitted:

| Class                        | Minimum meaning                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `MEASURED_EXTERNAL_SERIES`   | A genuine provider series for the candidate's query rises from first to last point.   |
| `MEASURED_INTERNAL_VELOCITY` | Time-separated snapshots for the same canonical signal show an increasing metric.     |
| `CORROBORATED_SIGNAL`        | At least two genuinely independent sources align in one time window.                  |
| `EMERGING_SIGNAL`            | One strong, recent, highly relevant opportunity; normally suited to `REPLY`.          |
| `INSUFFICIENT_SIGNAL`        | Evidence, relevance, freshness, independence, credibility, or coverage is inadequate. |

A recent popular item is not automatically a trend. Flat/declining or unrelated
series cannot become candidate momentum. No numeric velocity may be shown
without an increase measured for the same signal/query. Items copied from one
origin are not independent.

## Evidence invariants

1. Every receipt comes from a stored provider or audited manual record.
2. The canonical original URL is stored; it is never reconstructed by a model.
3. Observed time, source, provider, and relevance are recorded.
4. Model output cannot add URLs, metrics, or source claims, and synthesis must
   retain exactly the deterministic evidence-ID set without additions, drops,
   or duplicates.
5. Disappeared evidence is marked `SOURCE_NO_LONGER_AVAILABLE`, not replaced.
6. Partial coverage is disclosed and must still pass the action quality floor.
7. Public sharing requires founder approval and explicit subject consent.

## Product shape

The first experience is `product URL -> private result`, not signup ->
integrations -> empty dashboard. After value, Google or magic-link sign-in can
claim the exact result into a simple Today/Projects/History/Agents/Billing
dashboard. The result page centers the Next Move card, action detail, receipts,
limitations, confidence, validity window, review status, feedback, and
`auto_publish=false`.

The REST API exposes the same object as the web product. It is not a generic raw
social-data API.

## Business model boundary

Open source includes the real engine. Self-hosters bring their own keys. The
planned managed service adds provider accounts, shared snapshots and baselines,
scheduling, retries, cost control, operations, uptime, support, and outcome
feedback. Billing stays disabled until the free journey and legal/operational
gates pass.

## Launch learning

The first cohort tests whether product inference works, recommendations differ
from generic model output, founders trust and use the evidence, research time is
reduced, provider cost and review time are bounded, and users request recurring
monitoring.

Initial goals (20 requests, 15 deliveries, 60% relevant, 30% usable, three
used moves, five repeat requests, bounded private provider economics, median
review under ten minutes, and zero fabricated evidence) are internal hypotheses
until denominator-backed measurements exist. They must never be presented as
results.

## Scope guardrail

The first cohort deliberately excludes automated Reddit ingestion, broad social
coverage, posting/scheduling, social OAuth, content calendars, teams, raw data
resale, credit billing, enterprise controls, MCP/CLI/mobile clients, and complex
queue infrastructure. New work must improve the unknown-founder north-star:

> An unknown founder submits a URL, receives one founder-reviewed,
> evidence-backed Next Move, trusts the sources, and says they would use it.

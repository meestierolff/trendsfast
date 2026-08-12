# Release verification report template

Copy this file for a release and replace every placeholder with observed facts.
Do not mark a gate passed without a link or artifact.

1. **Starting and ending SHAs:** `[exact immutable values; ending SHA may be PENDING]`
2. **Branch and PR:** `[branch, PR URL/state]`
3. **Commits:** `[SHA and subject list]`
4. **Green CI:** `[run URLs or NOT GREEN/NOT RUN]`
5. **Installed Stripe skills:** `[exact repository paths]`
6. **Stripe SDK/API decision:** `[SDK and explicit API version plus rationale]`
7. **Review comments:** `[thread, fix, evidence, resolution state]`
8. **Edit-and-approve:** `[editable/immutable fields, concurrency, audit, tests]`
9. **Context correction:** `[versioning, stored-only recompute, renewed review]`
10. **Dogfood bundles:** `[three JSON/Markdown path pairs or NOT RUN]`
11. **Commercial boundary:** `[open-source versus cloud/private truth]`
12. **Cost configuration:** `[public variables versus private operator values]`
13. **Supabase:** `[project/environment, 18 migrations/0019, 37-table strict read-back, ACL, backup/restore; or NOT RUN]`
14. **Vercel:** `[project/scope/plan and preview/production URLs/IDs; or NOT RUN]`
15. **Domain/DNS:** `[exact assigned records, TLS, canonical redirect; or unresolved]`
16. **Source read-backs:** `[website, HN, Google Trends, Tavily/xAI, GitHub, YouTube, manual; exact status]`
17. **Live API:** `[hosted create/poll/result evidence or NOT RUN]`
18. **Design-partner grant:** `[project, expiry, key/usage audit evidence or NOT RUN]`
19. **Stripe catalog:** `[safe Product/Price IDs or NOT CREATED/VERIFIED]`
20. **Checkout/webhook/Portal:** `[sandbox/hosted matrix or NOT RUN]`
21. **Monitoring:** `[scheduler/lease/overlap/alerts evidence or NOT RUN]`
22. **Dogfood costs:** `[TrendsFast, Halio, ShipToUsers actual/unknown breakdowns]`
23. **External dogfood review:** `[approved/pending/not reached and corrections]`
24. **Legal/operational blockers:** `[explicit remaining approvals/owners]`
25. **Go/no-go:** `[free public scans; broad Reddit/X launch; live API; live Stripe subscriptions]`
26. **Founder actions:** `[exact, executable actions still required]`

Prohibited unsupported claims include legal/provider approval, production
readiness, live billing, source coverage, security approval, successful external
deployment, customer outcomes, and traction.

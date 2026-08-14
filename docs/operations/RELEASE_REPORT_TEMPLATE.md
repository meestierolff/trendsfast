# Release verification report template

Copy this file for a release and replace every placeholder with observed facts.
Do not mark a gate passed without a link or artifact.

1. **Starting and ending SHAs:** `[exact immutable values; ending SHA may be PENDING]`
2. **Branch and PR:** `[branch, PR URL/state]`
3. **Commits:** `[SHA and subject list, grouped as reviewable verticals]`
4. **Review comments:** `[thread, fix, evidence, resolution state]`
5. **Green CI:** `[exact run/job URLs or NOT GREEN/NOT RUN]`
6. **Schema changes:** `[tables, columns, enums, constraints, indexes, compatibility]`
7. **Migrations and ACL:** `[23/23 through 0024, 44/44 tables, strict manifest, seven runtime roles, browser/default denial; exact evidence or NOT RUN]`
8. **Local verification:** `[file/test/build/browser totals and immutable SHA, or explicitly mutable local evidence]`
9. **Action-specific examples:** `[redacted PUBLISH, REPLY, REMIX, and WAIT response paths or excerpts]`
10. **TrendWindow and BreakoutPotential:** `[truth rules, expiry behavior, non-probability proof, tests]`
11. **Context extraction/provenance:** `[bounded pages/bytes/origin, observed facts, inferred context, assumptions, voice/capabilities]`
12. **Edit-and-approve/context correction:** `[editable versus immutable fields, concurrency, versioning, stored-only recompute, renewed review, audit, tests]`
13. **Supabase Auth:** `[Google PKCE and magic-link implementation, exact external redirect/provider/custom-SMTP steps, preview evidence or NOT RUN]`
14. **Claim security:** `[random-secret/hash/cookie/expiry/delivery binding, callback consumption, replay/conflict/isolation tests and hosted proof]`
15. **Dashboard route matrix:** `[Today, Projects, History, Agents, Billing access and behavior]`
16. **API-key self-service:** `[show-once issue, name, scopes, last use, revoke/reissue, project allowance behavior and hosted proof]`
17. **OpenAPI compatibility:** `[legacy and claimed-project routes, runtime/spec parity result and hosted document URL or NOT RUN]`
18. **Installed Stripe skills:** `[exact repository paths]`
19. **Stripe SDK/API decision:** `[SDK and explicit API version plus rationale]`
20. **Commercial boundary and cost configuration:** `[open-source/cloud truth; public variables versus private operator values; settlement limitations]`
21. **Supabase infrastructure:** `[project/environment, PostgreSQL version, hosted migration/runtime-role read-back, backup/restore; or NOT RUN]`
22. **Vercel:** `[project/scope/plan, Fluid Compute and 300-second read-back, public/ops Production URLs and IDs; or NOT RUN]`
23. **Hobby environment phase:** `[exact local SOL_HOBBY_ENVIRONMENT_PHASE, public and ops origins, and every enabled/disabled effect flag; or NOT APPLIED]`
24. **Daily Hobby cron:** `[public-only 0 7 * * * registration/deployment read-back; no/wrong/correct Bearer results; monitoring-disabled no-claim and bounded-reconciliation evidence; or NOT RUN]`
25. **Domain/DNS:** `[exact assigned records, public DNS, TLS, canonical metadata, www-to-apex redirect, mixed-content result; or unresolved]`
26. **Turnstile:** `[dedicated widget and exact hostnames/action; credential preflight; valid, missing, forged, replayed, expired, wrong-action, and wrong-host deployed results; or NOT RUN]`
27. **Provider readback matrix:** `[website, HN, Google Trends, Tavily/xAI, GitHub, YouTube, manual; status, cost/quota, limitation, artifact]`
28. **Live API:** `[hosted create/poll/strict result and project-scoped key evidence or NOT RUN]`
29. **Design-partner grant:** `[project, expiry, key/usage audit evidence or NOT RUN]`
30. **Stripe and paid monitoring:** `[safe Product/Price IDs, sandbox Checkout/webhook/claim/Portal matrix, live gate, €39 offer state]`
31. **Monitoring/retention/privacy:** `[scheduler, lease/overlap, alerts, purge, request workflow, backup expiry evidence or NOT RUN]`
32. **Halio bundle path:** `[exact private redacted JSON and Markdown paths or NOT RUN]`
33. **ShipToUsers bundle path:** `[exact private redacted JSON and Markdown paths or NOT RUN]`
34. **Dogfood costs:** `[Halio and ShipToUsers actual/unknown breakdowns]`
35. **External dogfood review:** `[AWAITING_EXTERNAL_DOGFOOD_REVIEW, approved value, or not reached; corrections]`
36. **Hosted URLs and domain status:** `[public; generated ops alias and app-level auth proof; no ops custom domain; Supabase; canonical domain; exact verification state]`
37. **Remaining launch blockers:** `[explicit technical, provider, legal, tax, billing, monitoring, dogfood, and founder-owned actions]`
38. **Go/no-go:** `[limited free founder scans; paid monitoring; broader launch]`
39. **Founder actions:** `[exact, executable actions still required]`

Prohibited unsupported claims include legal/provider approval, production
readiness, live billing, source coverage, security approval, successful external
deployment, customer outcomes, and traction.

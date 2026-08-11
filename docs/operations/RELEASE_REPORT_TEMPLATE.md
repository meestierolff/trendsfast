# Release verification report template

Copy this file for a release and replace every placeholder with observed facts.
Do not mark a gate passed without a link or artifact.

1. **Implemented:** `[features and exact SHA]`
2. **Deliberately excluded:** `[scope guardrails]`
3. **Local quick start:** `[commands executed on clean environment]`
4. **Environment:** `[variables required; no values/secrets]`
5. **Migrations:** `[versions, clean replay result]`
6. **Provider setup:** `[accounts/actions still required]`
7. **Read-backs:** `[per source record or NOT RUN]`
8. **API surface:** `[mounted routes, OpenAPI read-back, issuance method, idempotency conflict result, rolling-hour atomic cost-admission race/boundary evidence]`
9. **Ops/private surface:** `[auth/CSRF/durable-admission evidence, bounded bodies, actions exercised, 256-bit capability/token expiry/replay]`
10. **Privacy operations:** `[exact-target deletion, terminal/nonterminal purge result and schedule, request auth, backup expiry, export/legal holds]`
11. **Source matrix:** `[actual status at release]`
12. **Tests:** `[command, exit result, counts, artifact]`
13. **Security:** `[pinned transport/abort, atomic admission, processing deadline/fence/unknown-provider precedence, public lookup edge throttle, tests/review performed; residual risk; never “approved” without approver]`
14. **Dogfood:** `[eight results or NOT RUN]`
15. **Provider/model cost:** `[ledger-derived provider actual/unknown; conservative model reservation; actual usage reconciliation; dated price source; or fixture zero]`
16. **Stripe:** `[disabled state; application route/test journey or NOT IMPLEMENTED; no live inference]`
17. **Limitations:** `[known defects, beta/degraded paths, manual-source entry status, uncertain-effect explicit retry policy]`
18. **Launch gates:** `[every checklist item with pass/fail/not run]`
19. **Deployment procedure/result:** `[exact steps; distinguish planned from executed]`
20. **Founder actions:** `[accounts, terms, read-backs, legal, DNS, launch]`
21. **Next single feature:** `[one evidence-based choice]`

Prohibited unsupported claims include legal/provider approval, production
readiness, live billing, source coverage, security approval, successful external
deployment, customer outcomes, and traction.

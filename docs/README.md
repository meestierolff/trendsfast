# TrendsFast documentation

The repository docs separate product intent from verified release evidence. A
design document or fixture test never proves provider permission, production
connectivity, deployment, security approval, billing, or customer outcomes.

## Start here

- [Product constitution](PRODUCT_CONSTITUTION.md)
- [Architecture overview](architecture/OVERVIEW.md) and
  [state machine](architecture/STATE_MACHINE.md)
- [Architecture decisions](adr/README.md)
- [Feature contracts](features/README.md)
- [Threat model](security/THREAT_MODEL.md)
- [Provider ownership](providers/ACCOUNT_OWNERSHIP.md),
  [setup](providers/SETUP_CHECKLIST.md), [cost](providers/COST_MODEL.md), and
  [source rights/status](providers/SOURCE_RIGHTS_MATRIX.md)
- [Stripe setup](billing/STRIPE_SETUP.md) and
  [live gate](billing/LIVE_ENABLEMENT_GATE.md)
- [Launch checklist](operations/LAUNCH_CHECKLIST.md),
  [runbook](operations/RUNBOOK.md), and
  [deployment procedure](operations/DEPLOYMENT.md), plus the
  [environment reference](operations/ENVIRONMENT.md) and
  [Supabase Auth setup](operations/SUPABASE_AUTH.md)
- [2026-08-13 local product-completion record](operations/LOCAL_VERIFICATION_2026-08-13.md)
  and the preserved
  [2026-08-12 immutable historical baseline](operations/LOCAL_VERIFICATION_2026-08-12.md)
- [Legal drafting templates](legal/README.md)
- [Distribution assets](distribution/FOUNDER_STORY_REDDIT.md)
- Optional founder-agent handoffs for
  [Postiz](workflows/agent-to-postiz.md),
  [HeyGen](workflows/heygen-presenter.md), and
  [Higgsfield](workflows/higgsfield-ugc.md); these are examples, not native integrations

## Truth vocabulary

- `LOCAL_PASS`: observed locally without an immutable release SHA or external
  environment evidence.
- `FIXTURE_VERIFIED`: deterministic local behavior passed at an identified SHA.
- `READ_BACK_PENDING` / `UNVERIFIED`: code/config may exist, but no target
  production read-back record is available.
- `BETA`: an internal maturity state for a verified but deliberately limited
  path; it is not public marketing and must not conceal a pending read-back.
- `DEGRADED`: a previously usable path is currently missing/reduced.
- `LEGAL_REVIEW`: implementation/automation is blocked pending permission and
  legal review.
- `NOT_IMPLEMENTED` / `PLANNED`: no callable product path is claimed.

Only a dated release/read-back report may turn intent into a launch claim.

Public pages project technical source states into **Connected**, **Limited**,
**Coming soon**, **Unavailable**, or **Permission required**. Engineering and
operations records retain the exact states above.

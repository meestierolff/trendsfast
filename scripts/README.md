# Founder deployment scripts

`deploy-staged-production.sh` is the founder-only Phase 1 production guardrail.
It verifies a clean, synchronized `main`; the pinned `trendsfast` Vercel project
and owner IDs; its `apps/web` Next.js root, production branch, and generated
stable domain; the cron-free config; the public allowlist; and every disabled
customer-effect flag before creating one staged Production deployment. It then
uses `vercel curl` to bypass Deployment Protection only for the unique staged
URL, runs the redacted route/API smoke, and requires zero error-level runtime
logs. After acceptance and promotion, it repeats the complete smoke with
ordinary public `curl` and checks both error and fatal logs on the stable origin.
Any failure before promotion preserves the former Current deployment. After a
promotion request, a timeout or failed stable-origin proof is explicitly an
indeterminate state that requires manual Current-deployment inspection; the
script does not claim an automatic rollback.

The project must already have an `automation-bypass` entry. The authenticated
project response is streamed through a sanitizer: bypass keys are never written
to disk or printed, and only the matching-entry count plus non-secret project
metadata reaches a mode-`0600` temporary file. The script rechecks that count
immediately before every protected smoke so `vercel curl` reuses the reviewed
bypass. Do not change Deployment Protection while the script is running.

Before running it, export `EXPECTED_RELEASE_SHA` as the exact lowercase
40-character SHA already present at both local `HEAD` and freshly fetched
`origin/main`. Also export `EXPECTED_STABLE_PRODUCTION_ORIGIN` as the exact clean
generated Vercel origin previously read from the project (for this handoff,
`https://trendsfast.vercel.app`). Run from a clean `main` checkout with the
Vercel CLI linked to the existing `trendsfast` project. Do not use `bash -x`: the
script deliberately pulls Production values into a mode-`0600` temporary file,
examines only names and the non-secret launch flags,
suppresses command output, and removes all temporary response data through its
exit trap.

The exact founder command is:

```bash
bash scripts/deploy-staged-production.sh
```

The deployment command includes `--skip-domain`, so that command alone does not
promote or change the stable alias. The script first inspects, smokes, and checks
logs on the unique staged Production URL. Only after every check passes does it
run a separate `vercel promote` and prove through a second Vercel inspection that
the approved stable origin resolves to the exact accepted deployment. It never
adds or changes a custom domain. Do not claim that `trendsfast.com` or
`www.trendsfast.com` serves this deployment merely because this script passed.

The script stops on any mismatch. Provider work, public scans, API creation,
billing, Checkout, paid monitoring, monitoring, and cron remain disabled after
this staged deployment.

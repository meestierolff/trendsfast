# Founder Hobby deployment scripts

The pre-revenue Hobby release uses two founder-only scripts from a clean
monorepo root:

```bash
bash scripts/deploy-hobby-production.sh
bash scripts/deploy-hobby-ops.sh
```

Do not run either script with `bash -x`. Neither script creates Stripe objects,
adds a custom domain, changes DNS, or prints environment values.

Both scripts require `.var/private/hobby-release.json` to be a regular ignored
mode-`0600` file containing the exact accepted branch and SHA:

```json
{
  "version": 1,
  "acceptedBranch": "sol/hobby-launch-dogfood",
  "acceptedSha": "<exact-lowercase-40-character-SHA>"
}
```

The accepted branch may instead be `main`. Local `HEAD` and the freshly fetched
remote branch must both equal the accepted SHA, and the worktree must be clean.

`deploy-hobby-production.sh` pins the public `trendsfast` project, founder team,
`apps/web` root, `fra1`, Fluid Compute, 300-second Function duration, the exact
Production environment name set, and `apps/web/vercel.hobby.json`. It runs:

```bash
vercel deploy --prod --skip-domain --yes -A apps/web/vercel.hobby.json
```

It inspects the resulting immutable Production deployment and verifies the
five-field Git attestation (`githubDeployment`, accepted SHA and branch, pinned
repository and owner) before printing only its safe URL and deployment ID. The
attestation is passed through a quoted Bash array and is derived only from Git
state the script already verified independently. Because the command uses
`--skip-domain`, it does not promote the deployment or change the stable
generated alias; the script proves that boundary by requiring the stable origin
to resolve to the same READY Production deployment before and after the staged
deploy. Domain auto-assignment stays off, while the script requires both the
deployment manifest and the project-level scheduler read-back to contain the
sole daily Hobby cron bound to the new deployment. The script temporarily
preserves any prior ignored CLI-compiled config, requires CLI 58 to recreate an
exact semantic copy of the tracked public profile for this deploy, and restores
the prior ignored state. Hosted `vercel.ts` compilation independently selects
that same profile from Vercel's existing build-time project ID; both pinned
projects must keep automatic system environment variables exposed. On success
the script atomically adds the safe public deployment host and ID to the private
release contract for the ops provenance fence.

Immediately before its one public deploy call, the script creates a private
mode-`0600` attempt journal under `.var/private/release-evidence/`. The journal
is keyed by the accepted SHA and predecessor public deployment ID, then moves
through `attempt_reserved`, `url_captured`, `deployment_identified`, and
`accepted`. An unresolved pre-contract attempt with the same SHA and predecessor
therefore cannot be retried blindly. Read only the journal's safe URL/ID fields,
then reconcile that exact candidate through deployment V13, the stable Current
origin, and the project V9 cron binding. Never delete or rename the journal
merely to make a retry pass. If no external deployment or cron effect can be
proved, or if an accepted candidate needs its release contract repaired, stop
for a reviewed recovery decision. If the release contract already advanced but
final stdout was lost, treat the stage as completed and continue reconciliation
and smoke; do not deploy again. A successful release advances the predecessor in
the contract, so a later intentional same-SHA environment redeploy receives a
new journal key without erasing prior evidence.

The staged candidate owns the active daily cron before immutable smoke. The
seven scans-off flags prevent public, paid-monitoring, billing, and provider
scan effects, but an authorized scheduled invocation can still perform bounded
daily reconciliation and write reconciliation or alert state. Complete the
immutable checks and promotion before the next `07:00`–`07:59` UTC scheduler
window whenever possible.

`deploy-hobby-ops.sh` requires that public provenance, pins the
`trendsfast-ops` project, verifies its defense-in-depth Vercel Authentication
setting, generated-domain-only inventory, cron-free
`apps/web/vercel.ops.json`, and exact ops-only environment set, and runs:

```bash
vercel deploy --prod --yes -A apps/web/vercel.ops.json
```

It applies the same fresh CLI-compiled-config proof against the tracked
cron-free ops profile and restores any prior ignored compiled file.

It temporarily installs the exact pinned ops project link without invoking
`vercel link`, then restores the original public `.vercel/project.json`
byte-for-byte on success or failure. It prints only the stable
app-authenticated ops alias and deployment ID after
all five Git attestation fields are read back from the unique deployment URL.
Vercel Standard Authentication does not protect Production aliases on Hobby,
so this read-back is not the founder-access proof. The application boundary is
the high-entropy `OPS_TOKEN` admission check, signed ops session, and exact
ops-surface authorization on private pages and handlers. The ops project keeps
only generated Vercel hosts and receives no custom domain.

Both scripts also run `pnpm vercel:verify-source`. The tracked root
`.vercelignore` must exclude local environments, `.var`, tool state, caches,
test artifacts, database files, keys, and backups while retaining the required
monorepo sources. The scripts stop before upload on any boundary mismatch.

The full topology, environment boundary, cron, smoke, domain, and post-deploy
gates are in
[the 2026-08-13 Hobby launch runbook](../docs/operations/HOBBY_LAUNCH_2026-08-13.md).

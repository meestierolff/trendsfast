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
deploy. Vercel keeps this as a staged Production deployment: domain
auto-assignment stays off and the project cron record remains bound to the new
deployment with no active definitions until it becomes Current. The script
temporarily preserves any prior ignored CLI-compiled config, requires CLI 58 to
recreate an exact semantic copy of the tracked public profile for this deploy,
and restores the prior ignored state. The tracked public config still pins the
sole daily Hobby cron, whose active registration must be verified after
promotion. On success the script atomically adds the safe public deployment host
and ID to the private release contract for the ops provenance fence.

`deploy-hobby-ops.sh` requires that public provenance, pins the
`trendsfast-ops` project, verifies its defense-in-depth Vercel Authentication
setting, generated-domain-only inventory, cron-free
`apps/web/vercel.ops.json`, and exact ops-only environment set, and runs:

```bash
vercel deploy --prod --yes -A apps/web/vercel.ops.json
```

It applies the same fresh CLI-compiled-config proof against the tracked
cron-free ops profile and restores any prior ignored compiled file.

It temporarily relinks the checkout to the ops project, then restores the
original public `.vercel/project.json` byte-for-byte on success or failure. It
prints only the stable app-authenticated ops alias and deployment ID after
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

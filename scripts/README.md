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
Git SHA before printing only its safe URL and deployment ID. Because it uses
`--skip-domain`, it does not promote the deployment or change the stable
generated alias. On success it atomically adds the safe public deployment host
and ID to the private release contract for the ops provenance fence.

`deploy-hobby-ops.sh` requires that public provenance, pins the
`trendsfast-ops` project, verifies its defense-in-depth Vercel Authentication
setting, generated-domain-only inventory, cron-free
`apps/web/vercel.ops.json`, and exact ops-only environment set, and runs:

```bash
vercel deploy --prod --yes -A apps/web/vercel.ops.json
```

It temporarily relinks the checkout to the ops project, then restores the
original public `.vercel/project.json` byte-for-byte on success or failure. It
prints only the stable app-authenticated ops alias and deployment ID after
accepted-SHA inspection of the unique deployment URL.
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

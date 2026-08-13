# Repository security operations

Status: required repository baseline. Repository files define the intended
controls; GitHub settings and successful workflow runs are the operational
evidence. Do not claim a remote control is active from configuration alone.

## Protected changes

`main` must reject direct pushes and require a pull request, one approving
review, dismissal of stale approvals, conversation resolution, and review from
the owners in `.github/CODEOWNERS`. Administrators must not bypass the rule for
ordinary releases.

Require these exact checks after their first successful run establishes each
check context:

- `Lint, types, tests, migration, build`;
- `Critical browser flows`;
- `Analyze JavaScript and TypeScript`;
- `Dependency review`;
- `Full-history secret scan`.

Rules must require branches to be current before merge and must not replace a
stronger organization policy. Release automation needs least privilege and no
long-lived provider, database, hosting, or Stripe secret.

## Local-only state

`.agents/`, `.var/private/`, and `supabase/.temp/` are ignored workstation state.
They must never be tracked, staged, committed, uploaded as workflow artifacts,
or included in a support bundle. The CI jobs reject these prefixes when they
appear in the Git index. To correct an older checkout without deleting local
files:

```sh
git rm -r --cached --ignore-unmatch .agents .var/private supabase/.temp
git check-ignore -v .agents/ .var/private/ supabase/.temp/
```

Review the staged deletion before committing it. Do not use `git clean` for
this operation. Private files retain the filesystem modes specified by the
operator bootstrap process and stay outside Git.

## Workflow supply chain

All `uses:` references are pinned to full 40-character commit SHAs. A version
comment records the reviewed upstream release, while Dependabot proposes future
updates. Review the upstream release and compare its resolved commit before
accepting an Action update. Workflows keep explicit minimal permissions,
bounded timeouts, frozen dependency installation, and failure-only test
artifacts. Private operator state is never an artifact path.

CodeQL analyzes JavaScript and TypeScript on pull requests, pushes to `main`, a
weekly schedule, and manual dispatch. Dependency Review rejects newly
introduced high or critical vulnerabilities. Dependabot monitors pnpm/npm,
GitHub Actions, and Docker dependencies weekly. The secret-history workflow
checks out all reachable commits and runs a fixed Gitleaks release through an
immutable multi-platform container digest with networking disabled during the
scan. Historical synthetic fixture findings are reviewed one by one and ignored
only by their commit/path/rule/line fingerprints; new lookalikes still fail.

## GitHub security settings

The repository administrator must verify these controls through GitHub's
settings or authenticated API and save redacted evidence with the release:

- dependency graph, Dependabot alerts, and Dependabot security updates enabled;
- private vulnerability reporting enabled;
- secret scanning and push protection enabled wherever the account supports
  them;
- the full repository history scanned after enablement, with every verified
  secret revoked rather than merely marked resolved;
- Actions restricted to required, reviewed publishers where the account allows;
- unused wiki, Projects, and Pages surfaces disabled;
- default workflow token permission set to read-only, with pull-request writes
  disabled unless a narrowly reviewed workflow requires them.

If an account or plan cannot enforce a required control, record the exact
limitation as a launch blocker. Never weaken branch protection to make a check
pass.

### Hosted preflight on 2026-08-12

Point-in-time GitHub API evidence at starting commit
`cd8102aa928638d2f09aead957ad7790b33eb0ae` showed:

- `main` was protected for everyone with the existing build and browser check
  contexts required;
- private vulnerability reporting was disabled;
- Dependabot alerts were disabled, so security updates could not yet be relied
  on;
- GitHub Pages was absent;
- the repository wiki and Projects surfaces were enabled.

The available GitHub App could read repository metadata but lacked permission
to inspect or change branch protection, Dependabot, secret-scanning, push
protection, or default Actions-token settings. The local `gh` credential was
invalid. Therefore no remote setting was represented as fixed. An authenticated
repository administrator must enable and re-read those controls, disable wiki
and Projects, then add the new CodeQL, dependency-review, and full-history
secret-scan contexts to the existing required checks after each has passed once.

## Verification

Before release:

```sh
git ls-files -- '.agents' '.agents/**' '.var/private' '.var/private/**' 'supabase/.temp' 'supabase/.temp/**'
rg -n 'uses:' .github/workflows
gitleaks git . --redact=100 --no-banner --no-color --log-opts=--all
pnpm exec prettier --check '.github/**/*.{md,yml,yaml}' 'docs/security/**/*.md'
```

The first command must print nothing. Every active `uses:` value must contain a
40-character SHA. Inspect the repository security settings, branch rule, open
Dependabot and code-scanning alerts, recent workflow runs, and unresolved pull
request conversations separately. A green repository baseline does not replace
the focused external security review required before live billing.

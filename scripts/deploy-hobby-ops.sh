#!/usr/bin/env bash

if [[ "$-" == *x* ]]; then
  set +x
  printf 'FAIL: xtrace is not allowed for founder deployment\n' >&2
  exit 1
fi
set -euo pipefail

readonly public_project="trendsfast"
readonly public_project_id="prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC"
readonly ops_project="trendsfast-ops"
readonly ops_project_id="prj_EYAjX2Nyd1jUXSjfWVTVoI320nnU"
readonly ops_generated_domain="trendsfast-ops.vercel.app"
readonly team_id="team_UVAUfp4G8CmlSNPI9w5FasKj"
readonly root_directory="apps/web"
readonly release_contract=".var/private/hobby-release.json"
readonly deployment_config="apps/web/vercel.ops.json"
readonly effective_deployment_config="apps/web/.vercel/vercel.json"
readonly cron_readback_attempts=6
readonly cron_readback_delay_seconds=2
readonly expected_environment_names='NODE_ENV
APP_URL
PUBLIC_APP_URL
TRENDSFAST_SURFACE
OPS_DATABASE_URL
DATABASE_SSL_CA
PROVIDER_CREDENTIAL_MODE
OPS_TOKEN
SESSION_SECRET
API_KEY_PEPPER
MANAGED_POLICY_REVISION
PUBLIC_DEPLOYMENT_HOST
PUBLIC_DEPLOYMENT_ID
XAI_API_KEY
XAI_MODEL
XAI_ESTIMATED_COST_USD_PER_SEARCH
XAI_MAX_TOOL_CALLS_PER_SCAN
DATAFORSEO_LOGIN
DATAFORSEO_PASSWORD
DATAFORSEO_GOOGLE_TRENDS_MODE
DATAFORSEO_ESTIMATED_COST_USD_PER_TASK
TAVILY_API_KEY
TAVILY_ESTIMATED_COST_USD_PER_CREDIT
TAVILY_MAX_CREDITS_PER_SCAN
YOUTUBE_API_KEY
YOUTUBE_INTERNAL_QUOTA_VALUE_USD
YOUTUBE_MAX_SEARCHES_PER_SCAN
GITHUB_TOKEN
LLM_PROVIDER
LLM_MODEL
LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS
LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS
MAX_PROVIDER_COST_USD_PER_SCAN
MAX_SCAN_DURATION_SECONDS
PROVIDER_TIMEOUT_MS
PUBLIC_SCAN_PROCESSING
PUBLIC_SCAN_DAILY_LIMIT
PUBLIC_SCAN_GLOBAL_DAILY_LIMIT
PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD
API_CREATE_RATE_LIMIT_PER_HOUR
API_STATUS_RATE_LIMIT_PER_HOUR
API_AUTH_FAILURE_LIMIT_PER_HOUR
API_PROVIDER_COST_LIMIT_USD_PER_HOUR
SCAN_RETENTION_DAYS
PROVIDER_CALLS_ENABLED
PUBLIC_SCANS_ENABLED
LIVE_API_CREATION_ENABLED
BILLING_ENABLED
BILLING_CHECKOUT_ENABLED
PAID_MONITORING_ENABLED
MONITORING_ENABLED
FOUNDING_100_ENABLED
CLOUD_TRIAL_ENABLED
STRIPE_MODE'

temp_dir=""
command_log=""
public_link_backup=""
public_link_mode=""
public_readme_backup=""
public_readme_mode=""
ops_link_file=""
link_changed="false"
effective_config_backup=""
effective_config_existed="false"
effective_config_prepared="false"

restore_effective_deployment_config() {
  if [[ "$effective_config_prepared" != "true" ]]; then
    return 0
  fi
  local effective_config_directory="${effective_deployment_config%/*}"
  if [[ "$effective_config_existed" == "true" ]]; then
    [[ -d "$effective_config_directory" && ! -L "$effective_config_directory" && ! -L "$effective_deployment_config" ]] || return 1
    cp -p -- "$effective_config_backup" "$effective_deployment_config" || return 1
  else
    if [[ ! -e "$effective_config_directory" && ! -L "$effective_config_directory" ]]; then
      effective_config_prepared="false"
      return 0
    fi
    [[ -d "$effective_config_directory" && ! -L "$effective_config_directory" && ! -L "$effective_deployment_config" ]] || return 1
    rm -f -- "$effective_deployment_config" || return 1
  fi
  effective_config_prepared="false"
}

install_project_link() {
  # Replace the tiny non-secret link atomically so interruption cannot leave a
  # partially written project identity behind in the accepted checkout.
  # shellcheck disable=SC2016
  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const [source, target, requestedMode] = process.argv.slice(1);
    const sourceMetadata = fs.lstatSync(source);
    const parent = path.dirname(target);
    const parentMetadata = fs.lstatSync(parent);
    if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink() || sourceMetadata.size > 64 * 1024) process.exit(1);
    if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || !/^[0-7]{3,4}$/.test(requestedMode)) process.exit(1);
    try {
      const targetMetadata = fs.lstatSync(target);
      if (!targetMetadata.isFile() || targetMetadata.isSymbolicLink()) process.exit(1);
    } catch (error) {
      if (error?.code !== "ENOENT") process.exit(1);
    }
    const temporary = path.join(parent, `.project-link-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`);
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeFileSync(descriptor, fs.readFileSync(source));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.chmodSync(temporary, Number.parseInt(requestedMode, 8));
      fs.renameSync(temporary, target);
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
      try { fs.unlinkSync(temporary); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  ' "$1" "$2" "$3" >/dev/null 2>&1
}

restore_public_link() {
  if [[ "$link_changed" != "true" ]]; then
    return 0
  fi
  [[ -d .vercel && ! -L .vercel ]] || return 1
  if [[ -e .vercel/project.json || -L .vercel/project.json ]]; then
    [[ -f .vercel/project.json && ! -L .vercel/project.json ]] || return 1
  fi
  install_project_link "$public_link_backup" .vercel/project.json "$public_link_mode" || return 1
  [[ "$(file_mode .vercel/project.json)" == "$public_link_mode" ]] || return 1
  if [[ -n "$public_readme_backup" ]]; then
    [[ ! -L .vercel/README.txt ]] || return 1
    cp -p -- "$public_readme_backup" .vercel/README.txt || return 1
    [[ "$(file_mode .vercel/README.txt)" == "$public_readme_mode" ]] || return 1
  fi
  link_changed="false"
}

cleanup() {
  local status=$?
  if ! restore_public_link; then
    status=1
    printf 'FAIL: the pinned public Vercel link could not be restored\n' >&2
  fi
  if ! restore_effective_deployment_config; then
    status=1
    printf 'FAIL: the prior ignored effective deployment config could not be restored\n' >&2
  fi
  if [[ -n "${temp_dir:-}" && -d "$temp_dir" ]]; then
    rm -f -- "$temp_dir"/* 2>/dev/null || true
    rmdir -- "$temp_dir" 2>/dev/null || true
  fi
  trap - EXIT
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "${VERCEL_ORG_ID+x}" != "x" && "${VERCEL_PROJECT_ID+x}" != "x" && "${VERCEL_TEAM_ID+x}" != "x" ]] || fail "ambient Vercel project overrides are not allowed"

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "a required local command is unavailable"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

assert_git_ignored_upload_boundary() {
  local ignored_path_report="$1"
  git ls-files --others --ignored --exclude-standard -z >"$ignored_path_report" || return 1
  node -e '
    const fs = require("node:fs");
    const ignore = require("ignore");
    const reportPath = process.argv[1];
    const ignorePath = process.argv[2];
    const metadata = fs.lstatSync(reportPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024) process.exit(1);
    const bytes = fs.readFileSync(reportPath);
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 0) process.exit(1);
    const paths = bytes.length === 0 ? [] : bytes.toString("utf8").slice(0, -1).split("\0");
    const defaults = [
      ".hg", ".git", ".gitmodules", ".svn", ".cache", ".next", ".now", ".vercel",
      ".npmignore", ".dockerignore", ".gitignore", ".*.swp", ".DS_Store", ".wafpicke-*",
      ".lock-wscript", ".env.local", ".env.*.local", ".venv", ".yarn/cache", ".pnp*",
      "npm-debug.log", "config.gypi", "node_modules", "__pycache__", "venv", "CVS",
    ];
    const matcher = ignore().add(defaults.join("\n")).add(fs.readFileSync(ignorePath, "utf8"));
    const valid = paths.every((path) => path.length > 0 && !path.startsWith("/") && matcher.ignores(path));
    process.exit(valid ? 0 : 1);
  ' "$ignored_path_report" .vercelignore
}

assert_link() {
  local link_file="$1"
  node -e '
    const fs = require("node:fs");
    const link = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const valid = link.projectName === process.argv[2] && link.projectId === process.argv[3] && link.orgId === process.argv[4];
    process.exit(valid ? 0 : 1);
  ' "$link_file" "$2" "$3" "$team_id" >/dev/null 2>&1
}

assert_environment_names() {
  if ! vercel env ls production --format json --project "$ops_project_id" --no-color >"$environment_report" 2>"$command_log"; then
    return 1
  fi
  node -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const entries = Array.isArray(report) ? report : report.envs ?? report.variables;
    if (!Array.isArray(entries)) process.exit(1);
    const actual = entries.map((entry) => typeof entry === "string" ? entry : entry?.key ?? entry?.name);
    if (actual.some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) process.exit(1);
    const expected = fs.readFileSync(process.argv[2], "utf8").trim().split("\n");
    const actualSorted = [...actual].sort();
    const expectedSorted = [...expected].sort();
    const exact = new Set(actual).size === actual.length && actualSorted.length === expectedSorted.length && actualSorted.every((name, index) => name === expectedSorted[index]);
    process.exit(exact ? 0 : 1);
  ' "$environment_report" "$expected_environment_file" >/dev/null 2>&1
}

for required_command in git vercel node pnpm mktemp chmod stat cp cmp rm rmdir sleep; do
  require_command "$required_command"
done

repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "run from the TrendsFast repository root"
[[ "$(pwd -P)" == "$(cd "$repository_root" && pwd -P)" ]] || fail "run from the TrendsFast monorepo root"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail "the Git working tree is not clean"

[[ -f "$release_contract" && ! -L "$release_contract" ]] || fail "the private accepted-release contract is missing"
[[ "$(file_mode "$release_contract")" == "600" ]] || fail "the private accepted-release contract must be mode 0600"
# shellcheck disable=SC2016
if ! release_identity="$(node -e '
  const fs = require("node:fs");
  const release = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const branch = release.acceptedBranch;
  const sha = release.acceptedSha;
  const host = release.publicDeploymentHost;
  const id = release.publicDeploymentId;
  const valid =
    release.version === 1 &&
    (branch === "main" || branch === "sol/hobby-launch-dogfood") &&
    /^[0-9a-f]{40}$/.test(sha) &&
    /^[A-Za-z0-9-]+\.vercel\.app$/.test(host) &&
    /^dpl_[A-Za-z0-9]+$/.test(id);
  if (!valid) process.exit(1);
  process.stdout.write(`${branch}\t${sha}\t${host}\t${id}`);
' "$release_contract" 2>/dev/null)"; then
  fail "the private accepted-release contract lacks valid public deployment provenance"
fi
IFS=$'\t' read -r accepted_branch accepted_sha public_deployment_host public_deployment_id <<<"$release_identity"
unset release_identity

[[ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)" == "$accepted_branch" ]] || fail "HEAD is not on the accepted release branch"
if ! git fetch --quiet origin "refs/heads/${accepted_branch}:refs/remotes/origin/${accepted_branch}" >/dev/null 2>&1; then
  fail "the accepted remote release branch could not be refreshed"
fi
[[ "$(git rev-parse HEAD 2>/dev/null)" == "$accepted_sha" ]] || fail "HEAD does not equal the accepted release SHA"
[[ "$(git rev-parse "refs/remotes/origin/${accepted_branch}" 2>/dev/null)" == "$accepted_sha" ]] || fail "the remote branch does not equal the accepted release SHA"
[[ "$(git remote get-url origin 2>/dev/null)" =~ ^(https://github\.com/meestierolff/trendsfast(\.git)?|git@github\.com:meestierolff/trendsfast\.git)$ ]] || fail "origin is not the pinned TrendsFast GitHub repository"
git merge-base --is-ancestor 535ab57e6b5303747de78b7a120675032cbe837a "$accepted_sha" >/dev/null 2>&1 || fail "the accepted SHA does not descend from the launch baseline"
if ! pnpm --silent vercel:verify-source >/dev/null 2>&1; then
  fail "the tracked Vercel source-upload boundary did not pass"
fi

umask 077
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/trendsfast-hobby-ops.XXXXXX")" || fail "a secure temporary directory could not be created"
chmod 0700 "$temp_dir"
command_log="$temp_dir/command.log"
team_report="$temp_dir/team.json"
project_report="$temp_dir/project.json"
domains_report="$temp_dir/domains.json"
public_deployment_api_report="$temp_dir/public-deployment-api.json"
environment_report="$temp_dir/environment.json"
expected_environment_file="$temp_dir/expected-environment.txt"
deployment_output="$temp_dir/deployment.out"
deployment_report="$temp_dir/deployment.json"
deployment_api_report="$temp_dir/deployment-api.json"
postdeploy_project_report="$temp_dir/postdeploy-project.json"
safe_deployment="$temp_dir/deployment-safe.json"
public_link_backup="$temp_dir/public-project.json"
ops_link_file="$temp_dir/ops-project.json"
git_ignored_report="$temp_dir/git-ignored-paths.bin"
effective_config_backup="$temp_dir/effective-vercel.json"
for private_file in "$command_log" "$team_report" "$project_report" "$domains_report" "$public_deployment_api_report" "$environment_report" "$expected_environment_file" "$deployment_output" "$deployment_report" "$deployment_api_report" "$postdeploy_project_report" "$safe_deployment" "$public_link_backup" "$ops_link_file" "$git_ignored_report" "$effective_config_backup"; do
  : >"$private_file"
  chmod 0600 "$private_file"
done
printf '%s\n' "$expected_environment_names" >"$expected_environment_file"

if ! vercel_version="$(vercel --version 2>"$command_log")"; then
  fail "the supported Vercel CLI version could not be verified"
fi
[[ "$vercel_version" == "58.0.0" ]] || fail "the founder deploy requires Vercel CLI 58.0.0"
unset vercel_version

[[ -d .vercel && ! -L .vercel ]] || fail "the public Vercel project link directory is unsafe"
[[ -f .vercel/project.json && ! -L .vercel/project.json ]] || fail "the public Vercel project link is missing or unsafe"
assert_link .vercel/project.json "$public_project" "$public_project_id" || fail "the repository is not initially linked to the pinned public Vercel project"
public_link_mode="$(file_mode .vercel/project.json)" || fail "the public Vercel project link mode could not be read"
[[ "$public_link_mode" =~ ^[0-7]{3,4}$ ]] || fail "the public Vercel project link mode is invalid"
cp -p -- .vercel/project.json "$public_link_backup"
if [[ -e .vercel/README.txt || -L .vercel/README.txt ]]; then
  [[ -f .vercel/README.txt && ! -L .vercel/README.txt ]] || fail "the public Vercel project link README is unsafe"
  public_readme_mode="$(file_mode .vercel/README.txt)" || fail "the public Vercel project link README mode could not be read"
  [[ "$public_readme_mode" =~ ^[0-7]{3,4}$ ]] || fail "the public Vercel project link README mode is invalid"
  public_readme_backup="$temp_dir/public-readme.txt"
  cp -p -- .vercel/README.txt "$public_readme_backup"
fi

if ! vercel whoami --no-color >"$command_log" 2>&1; then
  fail "Vercel authentication could not be verified"
fi
if ! vercel api "/v2/teams/${team_id}" --raw >"$team_report" 2>"$command_log"; then
  fail "the pinned Vercel team could not be inspected"
fi
if ! node -e '
  const fs = require("node:fs");
  const team = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const valid =
    team.id === process.argv[2] &&
    team.billing?.plan === "hobby" &&
    team.membership?.teamId === process.argv[2] &&
    team.membership?.confirmed === true;
  process.exit(valid ? 0 : 1);
' "$team_report" "$team_id" >/dev/null 2>&1; then
  fail "the pinned Vercel team is not an authenticated Hobby team"
fi
if ! vercel api "/v13/deployments/${public_deployment_id}" --raw >"$public_deployment_api_report" 2>"$command_log"; then
  fail "the accepted public deployment could not be inspected"
fi
if ! node -e '
  const fs = require("node:fs");
  const deployment = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const valid =
    deployment.id === process.argv[2] &&
    deployment.projectId === process.argv[3] &&
    deployment.name === process.argv[4] &&
    deployment.meta?.githubDeployment === "1" &&
    deployment.meta?.githubCommitSha === process.argv[5] &&
    deployment.meta?.githubCommitRef === process.argv[7] &&
    deployment.meta?.githubCommitRepo === "trendsfast" &&
    deployment.meta?.githubCommitOrg === "meestierolff" &&
    deployment.url === process.argv[6] &&
    deployment.plan === "hobby" &&
    deployment.target === "production" &&
    deployment.readyState === "READY";
  process.exit(valid ? 0 : 1);
' "$public_deployment_api_report" "$public_deployment_id" "$public_project_id" "$public_project" "$accepted_sha" "$public_deployment_host" "$accepted_branch" >/dev/null 2>&1; then
  fail "the accepted public deployment does not match its project, host, SHA, and Hobby provenance"
fi
if ! vercel api "/v9/projects/${ops_project_id}" --raw >"$project_report" 2>"$command_log"; then
  fail "the ops Vercel project could not be inspected"
fi
if ! node -e '
  const fs = require("node:fs");
  const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const valid =
    project.id === process.argv[2] &&
    project.name === process.argv[3] &&
    project.accountId === process.argv[4] &&
    project.rootDirectory === process.argv[5] &&
    project.framework === "nextjs" &&
    project.autoExposeSystemEnvs === true &&
    project.defaultResourceConfig?.fluid === true &&
    project.resourceConfig?.fluid === true &&
    project.defaultResourceConfig?.functionDefaultTimeout === 300 &&
    project.ssoProtection?.deploymentType === "all_except_custom_domains";
  process.exit(valid ? 0 : 1);
' "$project_report" "$ops_project_id" "$ops_project" "$team_id" "$root_directory" >/dev/null 2>&1; then
  fail "the ops Vercel project settings do not match the pinned Hobby contract"
fi
if ! vercel api "/v9/projects/${ops_project_id}/domains?limit=100&teamId=${team_id}" --raw >"$domains_report" 2>"$command_log"; then
  fail "the ops Vercel domain inventory could not be inspected"
fi
if ! node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const domains = report.domains;
  const domain = Array.isArray(domains) && domains.length === 1 ? domains[0] : undefined;
  const valid =
    report.pagination?.count === 1 &&
    report.pagination?.next === null &&
    domain?.name === process.argv[2] &&
    domain?.projectId === process.argv[3] &&
    domain?.verified === true &&
    (domain?.gitBranch === null || domain?.gitBranch === undefined) &&
    (domain?.customEnvironmentId === null || domain?.customEnvironmentId === undefined);
  process.exit(valid ? 0 : 1);
' "$domains_report" "$ops_generated_domain" "$ops_project_id" >/dev/null 2>&1; then
  fail "the ops project must have only its verified generated Vercel domain and no custom domain"
fi

# shellcheck disable=SC2016
if ! node -e '
  const fs = require("node:fs");
  const actual = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expected = {
    $schema: "https://openapi.vercel.sh/vercel.json",
    git: { deploymentEnabled: { main: false } },
    regions: ["fra1"],
  };
  process.exit(JSON.stringify(actual) === JSON.stringify(expected) ? 0 : 1);
' "$deployment_config" >/dev/null 2>&1; then
  fail "the tracked ops Hobby deployment config does not match the reviewed cron-free contract"
fi

assert_environment_names || fail "the ops Production environment name set is not the exact allowlisted set"

if ! pnpm --silent env:update-ops-provenance "$public_deployment_host" "$public_deployment_id" >"$command_log" 2>&1; then
  fail "the private ops deployment provenance could not be updated"
fi
if ! pnpm --silent env:import-ops --apply >"$command_log" 2>&1; then
  fail "the exact ops Production environment could not be applied and attested"
fi

# Vercel CLI 58 `link` mutates tracked .gitignore and refreshes the linked
# project's OIDC token in .env.local. Install only the already validated,
# non-secret project identity so the accepted checkout and private local
# environment remain untouched.
# shellcheck disable=SC2016
if ! node -e '
  const fs = require("node:fs");
  const [target, projectName, projectId, orgId] = process.argv.slice(1);
  fs.writeFileSync(target, `${JSON.stringify({ projectName, projectId, orgId })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
' "$ops_link_file" "$ops_project" "$ops_project_id" "$team_id" >"$command_log" 2>&1; then
  fail "the pinned ops project link could not be prepared"
fi
assert_link "$ops_link_file" "$ops_project" "$ops_project_id" || fail "the prepared ops project link is invalid"
link_changed="true"
[[ -d .vercel && ! -L .vercel && -f .vercel/project.json && ! -L .vercel/project.json ]] || fail "the public Vercel project link became unsafe"
if ! install_project_link "$ops_link_file" .vercel/project.json 600; then
  fail "the pinned ops project link could not be installed"
fi
assert_link .vercel/project.json "$ops_project" "$ops_project_id" || fail "the isolated link does not identify the pinned ops project"
cmp -s -- "$ops_link_file" .vercel/project.json || fail "the isolated ops project link is not exact"

# This is the final environment proof after provenance import: exact all-target
# scope, sensitivity, remote revisions, and the value-bound attestation match.
if ! pnpm --silent env:import-ops --check >"$command_log" 2>&1; then
  fail "the ops Production environment attestation did not pass"
fi
if ! assert_git_ignored_upload_boundary "$git_ignored_report" >"$command_log" 2>&1; then
  fail "a Git-ignored local path is not excluded from the Vercel upload boundary"
fi

# Vercel CLI reloads the rootDirectory config after parsing -A. The tracked
# dynamic config consumes this non-secret local selector and returns the exact
# reviewed ops profile without changing the accepted worktree.
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail "the accepted worktree changed before deploy"
[[ "$(git rev-parse HEAD 2>/dev/null)" == "$accepted_sha" ]] || fail "HEAD changed before deploy"
effective_config_directory="${effective_deployment_config%/*}"
if [[ -e "$effective_config_directory" || -L "$effective_config_directory" ]]; then
  [[ -d "$effective_config_directory" && ! -L "$effective_config_directory" ]] || fail "the ignored effective deployment config directory is unsafe"
fi
[[ ! -L "$effective_deployment_config" ]] || fail "the ignored effective deployment config is unsafe"
if [[ -e "$effective_deployment_config" ]]; then
  [[ -f "$effective_deployment_config" ]] || fail "the ignored effective deployment config is unsafe"
  cp -p -- "$effective_deployment_config" "$effective_config_backup" || fail "the prior ignored effective deployment config could not be preserved"
  effective_config_existed="true"
fi
effective_config_prepared="true"
rm -f -- "$effective_deployment_config" || fail "the ignored effective deployment config could not be prepared"
deployment_git_metadata=(
  --meta "githubDeployment=1"
  --meta "githubCommitSha=${accepted_sha}"
  --meta "githubCommitRef=${accepted_branch}"
  --meta "githubCommitRepo=trendsfast"
  --meta "githubCommitOrg=meestierolff"
)
if ! TRENDSFAST_VERCEL_CONFIG_PROFILE=ops vercel deploy --prod --yes -A apps/web/vercel.ops.json "${deployment_git_metadata[@]}" >"$deployment_output" 2>"$command_log"; then
  fail "the ops Hobby Production deployment failed"
fi
if ! node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const { isDeepStrictEqual } = require("node:util");
  const parentMetadata = fs.lstatSync(path.dirname(process.argv[1]));
  const actualMetadata = fs.lstatSync(process.argv[1]);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || !actualMetadata.isFile() || actualMetadata.isSymbolicLink() || actualMetadata.size > 64 * 1024) process.exit(1);
  const actual = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expected = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  process.exit(isDeepStrictEqual(actual, expected) ? 0 : 1);
' "$effective_deployment_config" "$deployment_config" >/dev/null 2>&1; then
  fail "the effective ops deployment config did not match the reviewed cron-free profile"
fi
if ! deployment_url="$(node -e '
  const fs = require("node:fs");
  const output = fs.readFileSync(process.argv[1], "utf8");
  const urls = [...new Set(output.match(/https:\/\/[A-Za-z0-9-]+\.vercel\.app\/?/g) ?? [])].map((value) => value.replace(/\/$/, ""));
  if (urls.length !== 1) process.exit(1);
  process.stdout.write(urls[0]);
' "$deployment_output" 2>/dev/null)"; then
  fail "the ops deployment URL could not be captured safely"
fi
if ! vercel inspect "$deployment_url" --wait --timeout 5m --format=json >"$deployment_report" 2>"$command_log"; then
  fail "the ops deployment could not be inspected"
fi
if ! node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expectedProject = process.argv[2];
  const expectedUrl = new URL(process.argv[3]);
  const valid =
    /^dpl_[A-Za-z0-9]+$/.test(report.id ?? "") &&
    report.name === expectedProject &&
    report.readyState === "READY" &&
    report.target === "production" &&
    String(report.url ?? "").toLowerCase() === expectedUrl.hostname.toLowerCase();
  if (!valid) process.exit(1);
  fs.writeFileSync(process.argv[4], JSON.stringify({ url: expectedUrl.origin, id: report.id }), { mode: 0o600 });
' "$deployment_report" "$ops_project" "$deployment_url" "$safe_deployment" >/dev/null 2>&1; then
  fail "the inspected ops deployment does not match the pinned project or Production target"
fi

deployment_url="$(node -e 'const value=require(process.argv[1]); process.stdout.write(value.url)' "$safe_deployment")"
deployment_id="$(node -e 'const value=require(process.argv[1]); process.stdout.write(value.id)' "$safe_deployment")"
if ! vercel api "/v13/deployments/${deployment_id}" --raw >"$deployment_api_report" 2>"$command_log"; then
  fail "the ops deployment provenance could not be read back"
fi
if ! node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expectedHost = new URL(process.argv[6]).hostname;
  const expectedAlias = process.argv[7];
  const aliases = [
    ...(Array.isArray(report.alias) ? report.alias : []),
    ...(Array.isArray(report.automaticAliases) ? report.automaticAliases : []),
  ];
  const expectedOpsAlias = (value) =>
    typeof value === "string" && /^trendsfast-ops(?:-[a-z0-9]+)*\.vercel\.app$/.test(value);
  const valid =
    report.id === process.argv[2] &&
    report.projectId === process.argv[3] &&
    report.name === process.argv[4] &&
    report.meta?.githubDeployment === "1" &&
    report.meta?.githubCommitSha === process.argv[5] &&
    report.meta?.githubCommitRef === process.argv[8] &&
    report.meta?.githubCommitRepo === "trendsfast" &&
    report.meta?.githubCommitOrg === "meestierolff" &&
    report.plan === "hobby" &&
    report.target === "production" &&
    report.readyState === "READY" &&
    report.url === expectedHost &&
    Array.isArray(report.regions) &&
    report.regions.length === 1 &&
    report.regions[0] === "fra1" &&
    (report.crons === undefined || (Array.isArray(report.crons) && report.crons.length === 0)) &&
    report.config?.functionType === "fluid" &&
    report.config?.functionTimeout === 300 &&
    Array.isArray(report.alias) &&
    Array.isArray(report.automaticAliases) &&
    aliases.includes(expectedAlias) &&
    aliases.every(expectedOpsAlias);
  process.exit(valid ? 0 : 1);
' "$deployment_api_report" "$deployment_id" "$ops_project_id" "$ops_project" "$accepted_sha" "$deployment_url" "$ops_generated_domain" "$accepted_branch" >/dev/null 2>&1; then
  fail "the ops deployment provenance does not match the accepted SHA and pinned project"
fi
cron_state_verified="false"
for ((cron_readback_attempt = 1; cron_readback_attempt <= cron_readback_attempts; cron_readback_attempt++)); do
  if vercel api "/v9/projects/${ops_project_id}" --raw >"$postdeploy_project_report" 2>"$command_log" &&
    node -e '
      const fs = require("node:fs");
      const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const crons = project.crons;
      const noRegistration = crons === undefined;
      const emptyCronDefinitionSet =
        crons !== null &&
        typeof crons === "object" &&
        !Array.isArray(crons) &&
        Array.isArray(crons.definitions) &&
        crons.definitions.length === 0 &&
        (crons.deploymentId === undefined ||
          crons.deploymentId === null ||
          crons.deploymentId === process.argv[3]);
      const valid = project.id === process.argv[2] && (noRegistration || emptyCronDefinitionSet);
      process.exit(valid ? 0 : 1);
    ' "$postdeploy_project_report" "$ops_project_id" "$deployment_id" >/dev/null 2>&1; then
    cron_state_verified="true"
    break
  fi
  if ((cron_readback_attempt < cron_readback_attempts)); then
    sleep "$cron_readback_delay_seconds"
  fi
done
if [[ "$cron_state_verified" != "true" ]]; then
  fail "the ops project has an active cron registration or cron definition"
fi

restore_effective_deployment_config || fail "the prior ignored effective deployment config could not be restored"
cmp -s -- "$ops_link_file" .vercel/project.json || fail "the pinned ops project link changed during deploy"
restore_public_link || fail "the pinned public Vercel link could not be restored"
assert_link .vercel/project.json "$public_project" "$public_project_id" || fail "the restored Vercel link is not the pinned public project"
cmp -s -- "$public_link_backup" .vercel/project.json || fail "the original public Vercel link was not restored byte-for-byte"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail "the Git working tree was not restored to the accepted release"

# Ops authentication intentionally binds Origin to the stable generated alias,
# not the unique deployment URL used for provenance inspection above.
printf 'Deployment URL: https://%s\n' "$ops_generated_domain"
printf 'Deployment ID: %s\n' "$deployment_id"

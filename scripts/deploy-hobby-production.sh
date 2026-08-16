#!/usr/bin/env bash

if [[ "$-" == *x* ]]; then
  set +x
  printf 'FAIL: xtrace is not allowed for founder deployment\n' >&2
  exit 1
fi
set -euo pipefail

readonly public_project="trendsfast"
readonly public_project_id="prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC"
readonly public_generated_domain="trendsfast.vercel.app"
readonly team_id="team_UVAUfp4G8CmlSNPI9w5FasKj"
readonly root_directory="apps/web"
readonly release_contract=".var/private/hobby-release.json"
readonly deployment_config="apps/web/vercel.hobby.json"
readonly effective_deployment_config="apps/web/.vercel/vercel.json"
readonly cron_readback_attempts=6
readonly cron_readback_delay_seconds=2
readonly expected_environment_names='NODE_ENV
APP_URL
PUBLIC_APP_URL
TRENDSFAST_SURFACE
DATABASE_URL
MEMBER_DATABASE_URL
AUTH_DATABASE_URL
WORKER_DATABASE_URL
DATABASE_SSL_CA
PROVIDER_CREDENTIAL_MODE
MANAGED_POLICY_REVISION
PUBLIC_SCAN_PROCESSING
PUBLIC_SCAN_DAILY_LIMIT
PUBLIC_SCAN_GLOBAL_DAILY_LIMIT
PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD
API_CREATE_RATE_LIMIT_PER_HOUR
API_STATUS_RATE_LIMIT_PER_HOUR
API_AUTH_FAILURE_LIMIT_PER_HOUR
API_PROVIDER_COST_LIMIT_USD_PER_HOUR
SCAN_RETENTION_DAYS
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
SESSION_SECRET
API_KEY_PEPPER
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
TURNSTILE_ENABLED
TURNSTILE_SECRET_KEY
NEXT_PUBLIC_TURNSTILE_SITE_KEY
CRON_SECRET
PROVIDER_CALLS_ENABLED
PUBLIC_SCANS_ENABLED
LIVE_API_CREATION_ENABLED
BILLING_ENABLED
BILLING_CHECKOUT_ENABLED
PAID_MONITORING_ENABLED
MONITORING_ENABLED
FOUNDING_100_ENABLED
CLOUD_TRIAL_ENABLED
STRIPE_MODE
NEXT_PUBLIC_ANNOUNCEMENT_ENABLED
NEXT_PUBLIC_ANNOUNCEMENT_TEXT
DATAFAST_ENABLED'

temp_dir=""
command_log=""
effective_config_backup=""
effective_config_existed="false"
effective_config_prepared="false"
deployment_attempt_journal=""
predecessor_deployment_id=""

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

cleanup() {
  local status=$?
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

write_deployment_attempt() {
  local next_state="$1"
  local deployment_url_value="${2:-}"
  local deployment_host_value="${3:-}"
  local deployment_id_value="${4:-}"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [target, nextState, branch, sha, projectId, predecessorDeploymentId, deploymentUrl, deploymentHost, deploymentId] = process.argv.slice(1);
    const now = new Date().toISOString();
    const transitions = {
      attempt_reserved: undefined,
      url_captured: "attempt_reserved",
      deployment_identified: "url_captured",
      accepted: "deployment_identified",
    };
    if (!(nextState in transitions)) process.exit(1);
    let previous;
    if (nextState !== "attempt_reserved") {
      previous = JSON.parse(fs.readFileSync(target, "utf8"));
      if (
        previous?.version !== 1 ||
        previous?.state !== transitions[nextState] ||
        previous?.acceptedBranch !== branch ||
        previous?.acceptedSha !== sha ||
        previous?.projectId !== projectId ||
        previous?.predecessorDeploymentId !== predecessorDeploymentId
      ) process.exit(1);
    }
    const value = {
      version: 1,
      state: nextState,
      acceptedBranch: branch,
      acceptedSha: sha,
      projectId,
      predecessorDeploymentId,
      deploymentUrl: deploymentUrl || previous?.deploymentUrl || null,
      deploymentHost: deploymentHost || previous?.deploymentHost || null,
      deploymentId: deploymentId || previous?.deploymentId || null,
      recordedAt: previous?.recordedAt || now,
      updatedAt: now,
    };
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
    let descriptor;
    try {
      if (nextState === "attempt_reserved") {
        descriptor = fs.openSync(target, "wx", 0o600);
      } else {
        descriptor = fs.openSync(temporary, "wx", 0o600);
      }
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      if (nextState !== "attempt_reserved") fs.renameSync(temporary, target);
      fs.chmodSync(target, 0o600);
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  ' "$deployment_attempt_journal" "$next_state" "$accepted_branch" "$accepted_sha" "$public_project_id" "$predecessor_deployment_id" "$deployment_url_value" "$deployment_host_value" "$deployment_id_value" >/dev/null 2>&1
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

for required_command in git vercel node pnpm mktemp chmod stat cp rm rmdir sleep; do
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
  const predecessorDeploymentHost = release.publicDeploymentHost;
  const predecessorDeploymentId = release.publicDeploymentId ?? "none";
  const validBranch = branch === "main" || branch === "sol/hobby-launch-dogfood";
  const noProvenance = predecessorDeploymentHost === undefined && predecessorDeploymentId === "none";
  const validProvenance =
    typeof predecessorDeploymentHost === "string" &&
    /^[A-Za-z0-9-]+\.vercel\.app$/.test(predecessorDeploymentHost) &&
    /^dpl_[A-Za-z0-9]+$/.test(predecessorDeploymentId);
  if (release.version !== 1 || !validBranch || !/^[0-9a-f]{40}$/.test(sha) || (!noProvenance && !validProvenance)) process.exit(1);
  process.stdout.write(`${branch}\t${sha}\t${predecessorDeploymentId}`);
' "$release_contract" 2>/dev/null)"; then
  fail "the private accepted-release contract is invalid"
fi
IFS=$'\t' read -r accepted_branch accepted_sha predecessor_deployment_id <<<"$release_identity"
unset release_identity

release_evidence_directory="${release_contract%/*}/release-evidence"
[[ -d "$release_evidence_directory" && ! -L "$release_evidence_directory" ]] || fail "the private release-evidence directory is missing or unsafe"
[[ "$(file_mode "$release_evidence_directory")" == "700" ]] || fail "the private release-evidence directory must be mode 0700"
deployment_attempt_journal="${release_evidence_directory}/hobby-public-deployment-attempt-${accepted_sha}-${predecessor_deployment_id}.json"
git check-ignore -q -- "$deployment_attempt_journal" || fail "the public deployment attempt journal is not ignored"
[[ ! -e "$deployment_attempt_journal" && ! -L "$deployment_attempt_journal" ]] || fail "this accepted SHA already has a public deployment attempt requiring read-only reconciliation"

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
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/trendsfast-hobby-public.XXXXXX")" || fail "a secure temporary directory could not be created"
chmod 0700 "$temp_dir"
command_log="$temp_dir/command.log"
team_report="$temp_dir/team.json"
project_report="$temp_dir/project.json"
environment_report="$temp_dir/environment.json"
expected_environment_file="$temp_dir/expected-environment.txt"
deployment_output="$temp_dir/deployment.out"
deployment_report="$temp_dir/deployment.json"
deployment_api_report="$temp_dir/deployment-api.json"
postdeploy_project_report="$temp_dir/postdeploy-project.json"
safe_deployment="$temp_dir/deployment-safe.json"
git_ignored_report="$temp_dir/git-ignored-paths.bin"
stable_origin_before_report="$temp_dir/stable-origin-before.json"
stable_origin_after_report="$temp_dir/stable-origin-after.json"
effective_config_backup="$temp_dir/effective-vercel.json"
for private_file in "$command_log" "$team_report" "$project_report" "$environment_report" "$expected_environment_file" "$deployment_output" "$deployment_report" "$deployment_api_report" "$postdeploy_project_report" "$safe_deployment" "$git_ignored_report" "$stable_origin_before_report" "$stable_origin_after_report" "$effective_config_backup"; do
  : >"$private_file"
  chmod 0600 "$private_file"
done
printf '%s\n' "$expected_environment_names" >"$expected_environment_file"

if ! vercel_version="$(vercel --version 2>"$command_log")"; then
  fail "the supported Vercel CLI version could not be verified"
fi
[[ "$vercel_version" == "58.0.0" ]] || fail "the founder deploy requires Vercel CLI 58.0.0"
unset vercel_version

[[ -f .vercel/project.json ]] || fail "the public Vercel project link is missing"
if ! node -e '
  const fs = require("node:fs");
  const link = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const valid = link.projectName === process.argv[2] && link.projectId === process.argv[3] && link.orgId === process.argv[4];
  process.exit(valid ? 0 : 1);
' .vercel/project.json "$public_project" "$public_project_id" "$team_id" >/dev/null 2>&1; then
  fail "the repository is not linked to the pinned public Vercel project"
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
if ! vercel api "/v9/projects/${public_project_id}" --raw >"$project_report" 2>"$command_log"; then
  fail "the public Vercel project could not be inspected"
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
    project.link?.productionBranch === "main" &&
    project.autoExposeSystemEnvs === true &&
    project.defaultResourceConfig?.fluid === true &&
    project.resourceConfig?.fluid === true &&
    project.defaultResourceConfig?.functionDefaultTimeout === 300;
  process.exit(valid ? 0 : 1);
' "$project_report" "$public_project_id" "$public_project" "$team_id" "$root_directory" >/dev/null 2>&1; then
  fail "the public Vercel project settings do not match the pinned Hobby contract"
fi

# shellcheck disable=SC2016
if ! node -e '
  const fs = require("node:fs");
  const actual = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expected = {
    $schema: "https://openapi.vercel.sh/vercel.json",
    git: { deploymentEnabled: { main: false } },
    regions: ["fra1"],
    crons: [{ path: "/api/cron/monitoring", schedule: "0 7 * * *" }],
  };
  process.exit(JSON.stringify(actual) === JSON.stringify(expected) ? 0 : 1);
' "$deployment_config" >/dev/null 2>&1; then
  fail "the tracked public Hobby deployment config does not match the reviewed contract"
fi

if ! vercel env ls production --format json --project "$public_project_id" --no-color >"$environment_report" 2>"$command_log"; then
  fail "the public Production environment metadata could not be read"
fi
if ! node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const entries = Array.isArray(report) ? report : report.envs ?? report.variables;
  if (!Array.isArray(entries)) process.exit(1);
  const actual = entries.map((entry) => typeof entry === "string" ? entry : entry?.key ?? entry?.name);
  if (actual.some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) process.exit(1);
  const expected = fs.readFileSync(process.argv[2], "utf8").trim().split("\n");
  const exact = new Set(actual).size === actual.length && actual.length === expected.length && actual.sort().every((name, index) => name === expected.sort()[index]);
  process.exit(exact ? 0 : 1);
' "$environment_report" "$expected_environment_file" >/dev/null 2>&1; then
  fail "the public Production environment name set is not the exact allowlisted set"
fi

# This is the final environment proof: exact all-target scope, sensitivity,
# remote revisions, and a private value-bound attestation must all match.
if ! pnpm --silent env:import-production --check >"$command_log" 2>&1; then
  fail "the public Production environment attestation did not pass"
fi
if ! pnpm --silent turnstile:verify-production >"$command_log" 2>&1; then
  fail "the pinned Turnstile Production credentials did not pass the fail-closed preflight"
fi
if ! assert_git_ignored_upload_boundary "$git_ignored_report" >"$command_log" 2>&1; then
  fail "a Git-ignored local path is not excluded from the Vercel upload boundary"
fi

# Vercel CLI reloads the rootDirectory config after parsing -A. The tracked
# dynamic config consumes this non-secret local selector and returns the exact
# reviewed public profile without changing the accepted worktree.
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
if ! vercel inspect "https://${public_generated_domain}" --format=json >"$stable_origin_before_report" 2>"$command_log"; then
  fail "the stable public Vercel origin could not be inspected before deployment"
fi
if ! stable_origin_deployment_id="$(node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const valid = /^dpl_[A-Za-z0-9]+$/.test(report.id ?? "") && report.name === process.argv[2] && report.target === "production" && report.readyState === "READY";
  if (!valid) process.exit(1);
  process.stdout.write(report.id);
' "$stable_origin_before_report" "$public_project" 2>/dev/null)"; then
  fail "the stable public Vercel origin did not resolve to a READY Production deployment"
fi
deployment_git_metadata=(
  --meta "githubDeployment=1"
  --meta "githubCommitSha=${accepted_sha}"
  --meta "githubCommitRef=${accepted_branch}"
  --meta "githubCommitRepo=trendsfast"
  --meta "githubCommitOrg=meestierolff"
)
if ! write_deployment_attempt "attempt_reserved"; then
  fail "the public deployment attempt could not be reserved safely"
fi
if ! TRENDSFAST_VERCEL_CONFIG_PROFILE=public vercel deploy --prod --skip-domain --yes -A apps/web/vercel.hobby.json "${deployment_git_metadata[@]}" >"$deployment_output" 2>"$command_log"; then
  fail "the public Hobby Production deployment failed"
fi
if ! deployment_url="$(node -e '
  const fs = require("node:fs");
  const output = fs.readFileSync(process.argv[1], "utf8");
  const urls = [...new Set(output.match(/https:\/\/[A-Za-z0-9-]+\.vercel\.app\/?/g) ?? [])].map((value) => value.replace(/\/$/, ""));
  if (urls.length !== 1) process.exit(1);
  process.stdout.write(urls[0]);
' "$deployment_output" 2>/dev/null)"; then
  fail "the public deployment URL could not be captured safely"
fi
if ! write_deployment_attempt "url_captured" "$deployment_url"; then
  fail "the public deployment URL could not be journaled safely"
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
  fail "the effective public deployment config did not match the reviewed Hobby profile"
fi
if ! vercel inspect "$deployment_url" --wait --timeout 5m --format=json >"$deployment_report" 2>"$command_log"; then
  fail "the public deployment could not be inspected"
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
  fs.writeFileSync(process.argv[4], JSON.stringify({ url: expectedUrl.origin, host: expectedUrl.hostname, id: report.id }), { mode: 0o600 });
' "$deployment_report" "$public_project" "$deployment_url" "$safe_deployment" >/dev/null 2>&1; then
  fail "the inspected public deployment does not match the pinned project or Production target"
fi

deployment_url="$(node -e 'const value=require(process.argv[1]); process.stdout.write(value.url)' "$safe_deployment")"
deployment_host="$(node -e 'const value=require(process.argv[1]); process.stdout.write(value.host)' "$safe_deployment")"
deployment_id="$(node -e 'const value=require(process.argv[1]); process.stdout.write(value.id)' "$safe_deployment")"
if ! write_deployment_attempt "deployment_identified" "$deployment_url" "$deployment_host" "$deployment_id"; then
  fail "the public deployment identity could not be journaled safely"
fi
if ! vercel api "/v13/deployments/${deployment_id}" --raw >"$deployment_api_report" 2>"$command_log"; then
  fail "the public deployment provenance could not be read back"
fi
if ! node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expectedHost = new URL(process.argv[6]).hostname;
  const aliases = [
    ...(Array.isArray(report.alias) ? report.alias : []),
    ...(Array.isArray(report.automaticAliases) ? report.automaticAliases : []),
  ];
  const expectedStagedAlias = (value) =>
    typeof value === "string" &&
    value !== "trendsfast.vercel.app" &&
    /^trendsfast(?:-[a-z0-9]+)*-clarios-projects-05f6a57e\.vercel\.app$/.test(value);
  const valid =
    report.id === process.argv[2] &&
    report.projectId === process.argv[3] &&
    report.name === process.argv[4] &&
    report.meta?.githubDeployment === "1" &&
    report.meta?.githubCommitSha === process.argv[5] &&
    report.meta?.githubCommitRef === process.argv[7] &&
    report.meta?.githubCommitRepo === "trendsfast" &&
    report.meta?.githubCommitOrg === "meestierolff" &&
    report.plan === "hobby" &&
    report.target === "production" &&
    report.readyState === "READY" &&
    report.url === expectedHost &&
    Array.isArray(report.regions) &&
    report.regions.length === 1 &&
    report.regions[0] === "fra1" &&
    Array.isArray(report.crons) &&
    report.crons.length === 1 &&
    report.crons[0]?.path === "/api/cron/monitoring" &&
    report.crons[0]?.schedule === "0 7 * * *" &&
    report.config?.functionType === "fluid" &&
    report.config?.functionTimeout === 300 &&
    report.autoAssignCustomDomains === false &&
    Array.isArray(report.alias) &&
    report.alias.length === 1 &&
    Array.isArray(report.automaticAliases) &&
    report.automaticAliases.length === 1 &&
    aliases.every(expectedStagedAlias);
  process.exit(valid ? 0 : 1);
' "$deployment_api_report" "$deployment_id" "$public_project_id" "$public_project" "$accepted_sha" "$deployment_url" "$accepted_branch" >/dev/null 2>&1; then
  fail "the public deployment provenance does not match the accepted SHA and pinned project"
fi
cron_state_verified="false"
for ((cron_readback_attempt = 1; cron_readback_attempt <= cron_readback_attempts; cron_readback_attempt++)); do
  if vercel api "/v9/projects/${public_project_id}" --raw >"$postdeploy_project_report" 2>"$command_log" &&
    node -e '
      const fs = require("node:fs");
      const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const crons = project.crons;
      const definitions = crons?.definitions;
      const valid =
        project.id === process.argv[2] &&
        crons !== null &&
        typeof crons === "object" &&
        !Array.isArray(crons) &&
        crons.deploymentId === process.argv[3] &&
        crons.disabledAt === null &&
        Number.isSafeInteger(crons.enabledAt) &&
        crons.enabledAt > 0 &&
        Array.isArray(definitions) &&
        definitions.length === 1 &&
        definitions[0]?.path === "/api/cron/monitoring" &&
        definitions[0]?.schedule === "0 7 * * *";
      process.exit(valid ? 0 : 1);
    ' "$postdeploy_project_report" "$public_project_id" "$deployment_id" >/dev/null 2>&1; then
    cron_state_verified="true"
    break
  fi
  if ((cron_readback_attempt < cron_readback_attempts)); then
    sleep "$cron_readback_delay_seconds"
  fi
done
if [[ "$cron_state_verified" != "true" ]]; then
  fail "the public project did not register the exact active Hobby cron for the new deployment"
fi
if ! vercel inspect "https://${public_generated_domain}" --format=json >"$stable_origin_after_report" 2>"$command_log"; then
  fail "the stable public Vercel origin could not be inspected after deployment"
fi
if ! node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const valid = report.id === process.argv[2] && report.name === process.argv[3] && report.target === "production" && report.readyState === "READY";
  process.exit(valid ? 0 : 1);
' "$stable_origin_after_report" "$stable_origin_deployment_id" "$public_project" >/dev/null 2>&1; then
  fail "the staged deployment changed the stable public Vercel origin"
fi
restore_effective_deployment_config || fail "the prior ignored effective deployment config could not be restored"
if ! write_deployment_attempt "accepted" "$deployment_url" "$deployment_host" "$deployment_id"; then
  fail "the accepted public deployment could not be finalized in private evidence"
fi
# shellcheck disable=SC2016
if ! node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const target = process.argv[1];
  const release = JSON.parse(fs.readFileSync(target, "utf8"));
  if (release.acceptedBranch !== process.argv[2] || release.acceptedSha !== process.argv[3]) process.exit(1);
  const updated = { ...release, publicDeploymentHost: process.argv[4], publicDeploymentId: process.argv[5] };
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(updated, null, 2)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
' "$release_contract" "$accepted_branch" "$accepted_sha" "$deployment_host" "$deployment_id" >/dev/null 2>&1; then
  fail "the accepted-release provenance could not be updated atomically"
fi
[[ "$(file_mode "$release_contract")" == "600" ]] || fail "the accepted-release contract lost its private mode"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail "the Git working tree was not restored to the accepted release"

printf 'Deployment URL: %s\n' "$deployment_url"
printf 'Deployment ID: %s\n' "$deployment_id"

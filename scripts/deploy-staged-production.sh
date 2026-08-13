#!/usr/bin/env bash
set -euo pipefail

# Founder-only Phase 1 deployment. The initial --skip-domain deployment is
# inspected and smoked before a separate, final promotion to the stable origin.

readonly expected_project="trendsfast"
readonly expected_project_id="prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC"
readonly expected_org_id="team_UVAUfp4G8CmlSNPI9w5FasKj"
readonly expected_root_directory="apps/web"
readonly expected_production_branch="main"
readonly deployment_config="apps/web/vercel.json"

temp_dir=""
production_env_file=""
production_env_names_file=""
project_report_file=""
project_api_file=""
domains_api_file=""
inspect_file=""
stable_inspect_file=""
headers_file=""
body_file=""
command_output_file=""
logs_file=""

cleanup() {
  if [[ -n "${temp_dir:-}" && -d "$temp_dir" ]]; then
    rm -f -- \
      "$production_env_file" \
      "$production_env_names_file" \
      "$project_report_file" \
      "$project_api_file" \
      "$domains_api_file" \
      "$inspect_file" \
      "$stable_inspect_file" \
      "$headers_file" \
      "$body_file" \
      "$command_output_file" \
      "$logs_file"
    rmdir -- "$temp_dir" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required local command is unavailable"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

env_key_count() {
  LC_ALL=C awk -v wanted="$2" '
    /^[[:space:]]*(#|$)/ { next }
    {
      line = $0
      sub(/\r$/, "", line)
      equals = index(line, "=")
      if (equals == 0) next
      key = substr(line, 1, equals - 1)
      sub(/^[[:space:]]*export[[:space:]]+/, "", key)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key == wanted) count++
    }
    END { print count + 0 }
  ' "$1"
}

env_flag_value() {
  LC_ALL=C awk -v wanted="$2" '
    /^[[:space:]]*(#|$)/ { next }
    {
      line = $0
      sub(/\r$/, "", line)
      equals = index(line, "=")
      if (equals == 0) next
      key = substr(line, 1, equals - 1)
      sub(/^[[:space:]]*export[[:space:]]+/, "", key)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key != wanted) next
      count++
      value = substr(line, equals + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if (length(value) >= 2) {
        first = substr(value, 1, 1)
        last = substr(value, length(value), 1)
        if ((first == "\"" && last == "\"") || (first == "\047" && last == "\047")) {
          value = substr(value, 2, length(value) - 2)
        }
      }
      selected = value
    }
    END {
      if (count != 1) exit 2
      print selected
    }
  ' "$1"
}

assert_env_key_exactly_once() {
  local count
  count="$(env_key_count "$production_env_file" "$1")" || fail "Production environment names could not be inspected"
  [[ "$count" == "1" ]] || fail "a required Production environment variable name is missing or duplicated"
}

assert_env_key_absent() {
  local count
  count="$(env_key_count "$production_env_file" "$1")" || fail "Production environment names could not be inspected"
  [[ "$count" == "0" ]] || fail "a forbidden Production environment variable name is configured"
}

refresh_sanitized_project_api() {
  : >"$project_api_file"
  : >"$command_output_file"
  if ! vercel api "/v9/projects/${expected_project_id}" --raw 2>"$command_output_file" | node -e '
    const fs = require("node:fs");
    const project = JSON.parse(fs.readFileSync(0, "utf8"));
    const bypassEntries =
      project.protectionBypass && typeof project.protectionBypass === "object"
        ? Object.values(project.protectionBypass)
        : [];
    const automationBypassCount = bypassEntries.filter(
      (entry) => entry && typeof entry === "object" && entry.scope === "automation-bypass",
    ).length;
    process.stdout.write(JSON.stringify({
      id: project.id,
      name: project.name,
      accountId: project.accountId,
      rootDirectory: project.rootDirectory,
      framework: project.framework,
      productionBranch: project.link?.productionBranch,
      automationBypassCount,
    }));
  ' 2>>"$command_output_file" >"$project_api_file"; then
    fail "Vercel project API read-back or sanitization failed"
  fi
  chmod 0600 "$project_api_file"
}

assert_preexisting_automation_bypass() {
  if ! node -e '
    const fs = require("node:fs");
    const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.exit(Number.isInteger(project.automationBypassCount) && project.automationBypassCount >= 1 ? 0 : 1);
  ' "$project_api_file" >/dev/null 2>&1; then
    fail "a pre-existing automation-bypass entry is required before deploy or protected smoke"
  fi
}

assert_status() {
  local label="$1"
  local path="$2"
  local expected_status="$3"
  local method="${4:-GET}"
  local request_mode="${5:-staged}"
  local request_url
  local status

  if [[ "$request_mode" == "stable" ]]; then
    request_url="${EXPECTED_STABLE_PRODUCTION_ORIGIN}${path}"
  else
    request_url="${deployment_url}${path}"
  fi
  : >"$headers_file"
  : >"$body_file"
  : >"$command_output_file"
  chmod 0600 "$headers_file" "$body_file" "$command_output_file"

  if [[ "$request_mode" == "staged" ]]; then
    refresh_sanitized_project_api
    assert_preexisting_automation_bypass
    if [[ "$method" == "POST" ]]; then
      if ! status="$({ printf '%s' '{"product_url":"https://example.com"}'; } | vercel curl "$path" \
        --deployment "$deployment_url" \
        --yes \
        -- \
        --silent \
        --show-error \
        --connect-timeout 10 \
        --max-time 30 \
        --request POST \
        --header 'Content-Type: application/json' \
        --data-binary @- \
        --output "$body_file" \
        --dump-header "$headers_file" \
        --write-out '%{http_code}' 2>"$command_output_file")"; then
        fail "${label} smoke request failed"
      fi
    else
      if ! status="$(vercel curl "$path" \
        --deployment "$deployment_url" \
        --yes \
        -- \
        --silent \
        --show-error \
        --connect-timeout 10 \
        --max-time 30 \
        --output "$body_file" \
        --dump-header "$headers_file" \
        --write-out '%{http_code}' 2>"$command_output_file")"; then
        fail "${label} smoke request failed"
      fi
    fi
  elif [[ "$method" == "POST" ]]; then
    if ! status="$({ printf '%s' '{"product_url":"https://example.com"}'; } | curl \
      --silent --show-error --connect-timeout 10 --max-time 30 \
      --request POST --header 'Content-Type: application/json' --data-binary @- \
      --output "$body_file" --dump-header "$headers_file" --write-out '%{http_code}' \
      "$request_url" 2>"$command_output_file")"; then
      fail "${label} smoke request failed"
    fi
  else
    if ! status="$(curl \
      --silent --show-error --connect-timeout 10 --max-time 30 \
      --output "$body_file" --dump-header "$headers_file" --write-out '%{http_code}' \
      "$request_url" 2>"$command_output_file")"; then
      fail "${label} smoke request failed"
    fi
  fi

  [[ "$status" =~ ^[0-9][0-9][0-9]$ ]] || fail "${label} smoke response was not parseable"
  [[ "$status" == "$expected_status" ]] || fail "${label} smoke status did not match the Phase 1 contract"
  pass "${label} [HTTP ${expected_status}]"
}

for required_command in git vercel curl node awk grep mktemp chmod stat rmdir rm; do
  require_command "$required_command"
done

[[ -n "${EXPECTED_RELEASE_SHA:-}" ]] || fail "EXPECTED_RELEASE_SHA must be exported before the founder deploy"
[[ "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "EXPECTED_RELEASE_SHA must be an exact lowercase 40-character Git SHA"
[[ -n "${EXPECTED_STABLE_PRODUCTION_ORIGIN:-}" ]] || fail "EXPECTED_STABLE_PRODUCTION_ORIGIN must be exported before the founder deploy"
if ! node -e '
  const origin = process.argv[1];
  try {
    const parsed = new URL(origin);
    const valid =
      origin === parsed.origin &&
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      parsed.hostname.endsWith(".vercel.app") &&
      parsed.hostname.length > ".vercel.app".length;
    process.exit(valid ? 0 : 1);
  } catch {
    process.exit(1);
  }
' "$EXPECTED_STABLE_PRODUCTION_ORIGIN" >/dev/null 2>&1; then
  fail "EXPECTED_STABLE_PRODUCTION_ORIGIN must be an exact clean HTTPS Vercel origin"
fi

repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "run this command from the TrendsFast Git repository"
cd "$repository_root"

[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail "the Git working tree is not clean"
[[ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)" == "$expected_production_branch" ]] || fail "the checked-out branch is not main"

if ! git fetch --quiet origin "$expected_production_branch" >/dev/null 2>&1; then
  fail "origin/main could not be refreshed"
fi

local_sha="$(git rev-parse HEAD 2>/dev/null)" || fail "the local release SHA could not be read"
remote_sha="$(git rev-parse "refs/remotes/origin/${expected_production_branch}" 2>/dev/null)" || fail "origin/main could not be resolved"
[[ "$local_sha" == "$EXPECTED_RELEASE_SHA" ]] || fail "HEAD does not equal EXPECTED_RELEASE_SHA"
[[ "$remote_sha" == "$EXPECTED_RELEASE_SHA" ]] || fail "origin/main does not equal EXPECTED_RELEASE_SHA"
pass "clean main and exact remote release SHA"

umask 077
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/trendsfast-staged-production.XXXXXX")" || fail "secure temporary directory could not be created"
chmod 0700 "$temp_dir"
production_env_file="$temp_dir/production.env"
production_env_names_file="$temp_dir/production-env-names.txt"
project_report_file="$temp_dir/project.txt"
project_api_file="$temp_dir/project.json"
domains_api_file="$temp_dir/domains.json"
inspect_file="$temp_dir/deployment.json"
stable_inspect_file="$temp_dir/stable-deployment.json"
headers_file="$temp_dir/response.headers"
body_file="$temp_dir/response.body"
command_output_file="$temp_dir/command.stderr"
logs_file="$temp_dir/error-logs.jsonl"
for private_temp_file in \
  "$production_env_file" \
  "$production_env_names_file" \
  "$project_report_file" \
  "$project_api_file" \
  "$domains_api_file" \
  "$inspect_file" \
  "$stable_inspect_file" \
  "$headers_file" \
  "$body_file" \
  "$command_output_file" \
  "$logs_file"; do
  : >"$private_temp_file"
  chmod 0600 "$private_temp_file"
done

if ! vercel whoami --no-color >"$command_output_file" 2>&1; then
  fail "Vercel login verification failed"
fi

[[ -f .vercel/project.json ]] || fail "the repository is not linked to a Vercel project"
if ! node -e '
  const fs = require("node:fs");
  const linked = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const valid =
    linked.projectName === process.argv[2] &&
    linked.projectId === process.argv[3] &&
    linked.orgId === process.argv[4];
  process.exit(valid ? 0 : 1);
' .vercel/project.json "$expected_project" "$expected_project_id" "$expected_org_id" >/dev/null 2>&1; then
  fail "the linked Vercel project name, ID or owner does not match the pinned public project"
fi

if ! vercel project inspect "$expected_project" --yes --no-color >"$project_report_file" 2>"$command_output_file"; then
  fail "Vercel project inspection failed"
fi
refresh_sanitized_project_api
if ! vercel api "/v9/projects/${expected_project_id}/domains" --raw 2>"$command_output_file" | node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(0, "utf8"));
  const domains = Array.isArray(report) ? report : report.domains;
  if (!Array.isArray(domains)) process.exit(1);
  process.stdout.write(JSON.stringify({
    domains: domains.map((domain) =>
      typeof domain === "string"
        ? { name: domain, verified: false }
        : { name: domain?.name, verified: domain?.verified === true },
    ),
  }));
' 2>>"$command_output_file" >"$domains_api_file"; then
  fail "Vercel project domain read-back or sanitization failed"
fi
chmod 0600 "$project_api_file" "$domains_api_file"
if ! node -e '
  const fs = require("node:fs");
  const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const domainReport = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const expectedHost = new URL(process.argv[3]).hostname.toLowerCase();
  const domains = Array.isArray(domainReport) ? domainReport : domainReport.domains;
  const domainNames = Array.isArray(domains)
    ? domains.map((domain) =>
        typeof domain === "string" ? domain.toLowerCase() : domain?.name?.toLowerCase(),
      )
    : [];
  const exactDomain =
    Array.isArray(domains) &&
    domains.some((domain) =>
      typeof domain === "string"
        ? domain.toLowerCase() === expectedHost
        : domain &&
          typeof domain === "object" &&
          domain.name?.toLowerCase() === expectedHost &&
          domain.verified === true,
    );
  const valid =
    project.id === process.argv[4] &&
    project.name === process.argv[5] &&
    project.accountId === process.argv[6] &&
    project.rootDirectory === process.argv[7] &&
    project.framework === "nextjs" &&
    project.productionBranch === process.argv[8] &&
    project.automationBypassCount >= 1 &&
    domainNames.length === 1 &&
    domainNames[0] === expectedHost &&
    exactDomain;
  process.exit(valid ? 0 : 1);
' "$project_api_file" "$domains_api_file" "$EXPECTED_STABLE_PRODUCTION_ORIGIN" "$expected_project_id" "$expected_project" "$expected_org_id" "$expected_root_directory" "$expected_production_branch" >/dev/null 2>&1; then
  fail "Vercel project read-back failed; the pinned project and a pre-existing automation-bypass entry are required before deploy"
fi

# The JavaScript is single-quoted deliberately; ShellCheck must not expand config.$schema.
# shellcheck disable=SC2016
if ! node -e '
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const validSchema = config.$schema === "https://openapi.vercel.sh/vercel.json";
  const noCronProperty = !Object.prototype.hasOwnProperty.call(config, "crons");
  const mainAutoDeployDisabled = config.git?.deploymentEnabled?.main === false;
  const euRegionPinned =
    Array.isArray(config.regions) &&
    config.regions.length === 1 &&
    config.regions[0] === "fra1";
  process.exit(validSchema && noCronProperty && mainAutoDeployDisabled && euRegionPinned ? 0 : 1);
' "$deployment_config" >/dev/null 2>&1; then
  fail "apps/web/vercel.json is not the reviewed cron-free staged-production config"
fi
pass "pinned Vercel project, owner, root, framework, branch, domain and cron-free config"

if ! vercel env ls production --format json --project "$expected_project_id" --no-color 2>"$command_output_file" | node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(0, "utf8"));
  const entries = Array.isArray(report) ? report : report.envs ?? report.variables;
  if (!Array.isArray(entries)) process.exit(1);
  const names = entries.map((entry) =>
    typeof entry === "string" ? entry : typeof entry?.key === "string" ? entry.key : entry?.name,
  );
  if (names.some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    process.exit(1);
  }
  process.stdout.write(names.sort().join("\n") + "\n");
' 2>>"$command_output_file" >"$production_env_names_file"; then
  fail "Vercel Production environment name inventory or sanitization failed"
fi
chmod 0600 "$production_env_names_file"

if ! vercel env pull "$production_env_file" --environment production --yes >"$command_output_file" 2>&1; then
  fail "Vercel Production environment pull failed"
fi
chmod 0600 "$production_env_file"
[[ "$(file_mode "$production_env_file")" == "600" ]] || fail "the pulled Production environment file is not mode 0600"

if ! LC_ALL=C awk '
  /^[[:space:]]*(#|$)/ { next }
  {
    line = $0
    sub(/\r$/, "", line)
    equals = index(line, "=")
    if (equals == 0) next
    key = substr(line, 1, equals - 1)
    sub(/^[[:space:]]*export[[:space:]]+/, "", key)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
    if (++seen[key] > 1) exit 1
  }
' "$production_env_file"; then
  fail "the pulled Production environment contains duplicate variable names"
fi

if ! LC_ALL=C awk '
  BEGIN {
    count = split("NODE_ENV APP_URL PUBLIC_APP_URL TRENDSFAST_SURFACE DATABASE_URL MEMBER_DATABASE_URL AUTH_DATABASE_URL DATABASE_SSL_CA PROVIDER_CREDENTIAL_MODE MANAGED_POLICY_REVISION PUBLIC_SCAN_PROCESSING PUBLIC_SCAN_DAILY_LIMIT PUBLIC_SCAN_GLOBAL_DAILY_LIMIT PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD API_CREATE_RATE_LIMIT_PER_HOUR API_STATUS_RATE_LIMIT_PER_HOUR API_AUTH_FAILURE_LIMIT_PER_HOUR API_PROVIDER_COST_LIMIT_USD_PER_HOUR SCAN_RETENTION_DAYS XAI_API_KEY XAI_MODEL XAI_ESTIMATED_COST_USD_PER_SEARCH XAI_MAX_TOOL_CALLS_PER_SCAN DATAFORSEO_LOGIN DATAFORSEO_PASSWORD DATAFORSEO_GOOGLE_TRENDS_MODE DATAFORSEO_ESTIMATED_COST_USD_PER_TASK TAVILY_API_KEY TAVILY_ESTIMATED_COST_USD_PER_CREDIT TAVILY_MAX_CREDITS_PER_SCAN YOUTUBE_API_KEY YOUTUBE_INTERNAL_QUOTA_VALUE_USD YOUTUBE_MAX_SEARCHES_PER_SCAN GITHUB_TOKEN LLM_PROVIDER LLM_MODEL OPENAI_API_KEY LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS MAX_PROVIDER_COST_USD_PER_SCAN MAX_SCAN_DURATION_SECONDS PROVIDER_TIMEOUT_MS SESSION_SECRET API_KEY_PEPPER NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY TURNSTILE_ENABLED TURNSTILE_SECRET_KEY NEXT_PUBLIC_TURNSTILE_SITE_KEY BILLING_ENABLED BILLING_CHECKOUT_ENABLED FOUNDING_100_ENABLED CLOUD_TRIAL_ENABLED STRIPE_MODE STRIPE_SANDBOX_KEY_ROTATED STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_FOUNDER_CLOUD_PRICE_ID STRIPE_PORTAL_LOGIN_URL NEXT_PUBLIC_ANNOUNCEMENT_ENABLED NEXT_PUBLIC_ANNOUNCEMENT_TEXT NEXT_PUBLIC_DEMO_VIDEO_URL NEXT_PUBLIC_DEMO_CAPTIONS_URL DATAFAST_ENABLED DATAFAST_WEBSITE_ID PROVIDER_CALLS_ENABLED PUBLIC_SCANS_ENABLED LIVE_API_CREATION_ENABLED PAID_MONITORING_ENABLED MONITORING_ENABLED", names, " ")
    for (entry_number = 1; entry_number <= count; entry_number++) {
      allowed[names[entry_number]] = 1
    }
  }
  !allowed[$0] { exit 1 }
' "$production_env_names_file"; then
  fail "Vercel Production has a configured variable outside the public allowlist"
fi

for required_name in \
  NODE_ENV \
  APP_URL \
  PUBLIC_APP_URL \
  TRENDSFAST_SURFACE \
  DATABASE_URL \
  MEMBER_DATABASE_URL \
  AUTH_DATABASE_URL \
  DATABASE_SSL_CA \
  PROVIDER_CREDENTIAL_MODE \
  MANAGED_POLICY_REVISION \
  PUBLIC_SCAN_PROCESSING \
  PUBLIC_SCAN_DAILY_LIMIT \
  PUBLIC_SCAN_GLOBAL_DAILY_LIMIT \
  PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD \
  API_CREATE_RATE_LIMIT_PER_HOUR \
  API_STATUS_RATE_LIMIT_PER_HOUR \
  API_AUTH_FAILURE_LIMIT_PER_HOUR \
  API_PROVIDER_COST_LIMIT_USD_PER_HOUR \
  SCAN_RETENTION_DAYS \
  SESSION_SECRET \
  API_KEY_PEPPER \
  NEXT_PUBLIC_SUPABASE_URL \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  PROVIDER_CALLS_ENABLED \
  PUBLIC_SCANS_ENABLED \
  LIVE_API_CREATION_ENABLED \
  BILLING_ENABLED \
  BILLING_CHECKOUT_ENABLED \
  PAID_MONITORING_ENABLED \
  MONITORING_ENABLED \
  FOUNDING_100_ENABLED \
  CLOUD_TRIAL_ENABLED \
  STRIPE_MODE; do
  assert_env_key_exactly_once "$required_name"
done

if ! LC_ALL=C awk '
  BEGIN {
    count = split("NODE_ENV APP_URL PUBLIC_APP_URL TRENDSFAST_SURFACE DATABASE_URL MEMBER_DATABASE_URL AUTH_DATABASE_URL DATABASE_SSL_CA PROVIDER_CREDENTIAL_MODE MANAGED_POLICY_REVISION PUBLIC_SCAN_PROCESSING PUBLIC_SCAN_DAILY_LIMIT PUBLIC_SCAN_GLOBAL_DAILY_LIMIT PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD API_CREATE_RATE_LIMIT_PER_HOUR API_STATUS_RATE_LIMIT_PER_HOUR API_AUTH_FAILURE_LIMIT_PER_HOUR API_PROVIDER_COST_LIMIT_USD_PER_HOUR SCAN_RETENTION_DAYS XAI_API_KEY XAI_MODEL XAI_ESTIMATED_COST_USD_PER_SEARCH XAI_MAX_TOOL_CALLS_PER_SCAN DATAFORSEO_LOGIN DATAFORSEO_PASSWORD DATAFORSEO_GOOGLE_TRENDS_MODE DATAFORSEO_ESTIMATED_COST_USD_PER_TASK TAVILY_API_KEY TAVILY_ESTIMATED_COST_USD_PER_CREDIT TAVILY_MAX_CREDITS_PER_SCAN YOUTUBE_API_KEY YOUTUBE_INTERNAL_QUOTA_VALUE_USD YOUTUBE_MAX_SEARCHES_PER_SCAN GITHUB_TOKEN LLM_PROVIDER LLM_MODEL OPENAI_API_KEY LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS MAX_PROVIDER_COST_USD_PER_SCAN MAX_SCAN_DURATION_SECONDS PROVIDER_TIMEOUT_MS SESSION_SECRET API_KEY_PEPPER NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY TURNSTILE_ENABLED TURNSTILE_SECRET_KEY NEXT_PUBLIC_TURNSTILE_SITE_KEY BILLING_ENABLED BILLING_CHECKOUT_ENABLED FOUNDING_100_ENABLED CLOUD_TRIAL_ENABLED STRIPE_MODE STRIPE_SANDBOX_KEY_ROTATED STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_FOUNDER_CLOUD_PRICE_ID STRIPE_PORTAL_LOGIN_URL NEXT_PUBLIC_ANNOUNCEMENT_ENABLED NEXT_PUBLIC_ANNOUNCEMENT_TEXT NEXT_PUBLIC_DEMO_VIDEO_URL NEXT_PUBLIC_DEMO_CAPTIONS_URL DATAFAST_ENABLED DATAFAST_WEBSITE_ID PROVIDER_CALLS_ENABLED PUBLIC_SCANS_ENABLED LIVE_API_CREATION_ENABLED PAID_MONITORING_ENABLED MONITORING_ENABLED", names, " ")
    for (entry_number = 1; entry_number <= count; entry_number++) {
      allowed[names[entry_number]] = 1
    }
  }
  /^[[:space:]]*(#|$)/ { next }
  {
    line = $0
    sub(/\r$/, "", line)
    equals = index(line, "=")
    if (equals == 0) exit 1
    key = substr(line, 1, equals - 1)
    sub(/^[[:space:]]*export[[:space:]]+/, "", key)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
    if (key != "VERCEL_OIDC_TOKEN" && !allowed[key]) exit 1
  }
' "$production_env_file"; then
  fail "Vercel Production contains a variable outside the public allowlist"
fi

for forbidden_name in \
  OPS_TOKEN \
  OPS_DATABASE_URL \
  RETENTION_DATABASE_URL \
  DIRECT_DATABASE_URL \
  ROLE_ADMIN_DATABASE_URL \
  WORKER_DATABASE_URL \
  BILLING_DATABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY \
  SUPABASE_SERVICE_KEY \
  SERVICE_ROLE_KEY \
  SUPABASE_DB_PASSWORD \
  DATABASE_PASSWORD \
  POSTGRES_PASSWORD \
  CRON_SECRET \
  OPS_ALERT_WEBHOOK_URL \
  OPS_ALERT_WEBHOOK_SECRET; do
  assert_env_key_absent "$forbidden_name"
done

while IFS='=' read -r flag_name expected_value; do
  [[ -n "$flag_name" ]] || continue
  actual_value="$(env_flag_value "$production_env_file" "$flag_name")" || fail "a Phase 1 effect flag could not be read exactly once"
  [[ "$actual_value" == "$expected_value" ]] || fail "a Phase 1 customer-effect flag is not in its required disabled state"
done <<'PHASE_1_FLAGS'
PROVIDER_CALLS_ENABLED=false
PUBLIC_SCANS_ENABLED=false
LIVE_API_CREATION_ENABLED=false
BILLING_ENABLED=false
BILLING_CHECKOUT_ENABLED=false
PAID_MONITORING_ENABLED=false
MONITORING_ENABLED=false
FOUNDING_100_ENABLED=false
CLOUD_TRIAL_ENABLED=false
STRIPE_MODE=test
TRENDSFAST_SURFACE=public
PHASE_1_FLAGS
pass "required Production variable names and exact Phase 1 effect flags"

: >"$command_output_file"
if ! deployment_output="$(vercel deploy --prod --skip-domain --yes -A apps/web/vercel.json 2>"$command_output_file")"; then
  fail "staged Production deployment failed"
fi

if ! deployment_url="$(printf '%s\n' "$deployment_output" | LC_ALL=C awk '
  /^https:\/\/[A-Za-z0-9-]+\.vercel\.app\/?$/ { count++; selected = $0 }
  END {
    if (count != 1) exit 1
    print selected
  }
')"; then
  fail "the staged Production deployment URL could not be captured safely"
fi
deployment_url="${deployment_url%/}"
unset deployment_output

if ! vercel inspect "$deployment_url" --wait --timeout 5m --format=json >"$inspect_file" 2>"$command_output_file"; then
  fail "the staged Production deployment could not be inspected"
fi
if ! node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expectedProject = process.argv[2];
  const expectedUrl = new URL(process.argv[3]);
  const collect = (value, wanted, found = []) => {
    if (!value || typeof value !== "object") return found;
    for (const [key, nested] of Object.entries(value)) {
      if (wanted.has(key) && (typeof nested === "string" || typeof nested === "number")) {
        found.push(String(nested));
      }
      collect(nested, wanted, found);
    }
    return found;
  };
  const normalized = (values) => values.map((value) => value.trim().toLowerCase());
  const projectValues = normalized(collect(report, new Set(["name", "projectName"])));
  const stateValues = normalized(collect(report, new Set(["readyState", "state", "status"])));
  const targetValues = normalized(collect(report, new Set(["target", "environment"])));
  const urlValues = collect(report, new Set(["url", "host", "hostname"])).map((value) =>
    value.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase(),
  );
  const valid =
    projectValues.includes(expectedProject.toLowerCase()) &&
    stateValues.some((value) => value === "ready" || value === "● ready") &&
    targetValues.includes("production") &&
    urlValues.includes(expectedUrl.hostname.toLowerCase());
  process.exit(valid ? 0 : 1);
' "$inspect_file" "$expected_project" "$deployment_url" >/dev/null 2>&1; then
  fail "the inspected deployment is not a READY trendsfast Production deployment"
fi
pass "staged Production deployment inspected as READY"

assert_status "public landing" "/" "200"
assert_status "login" "/login" "200"
assert_status "dashboard" "/dashboard" "307"
dashboard_location="$(LC_ALL=C awk '
  tolower($0) ~ /^location:/ {
    value = substr($0, index($0, ":") + 1)
    gsub(/^[[:space:]]+|[[:space:]\r]+$/, "", value)
    selected = value
  }
  END { print selected }
' "$headers_file")"
if ! node -e '
  const origin = new URL(process.argv[1]);
  const redirect = new URL(process.argv[2], origin);
  const valid =
    redirect.origin === origin.origin &&
    redirect.pathname === "/login" &&
    redirect.searchParams.get("next") === "/dashboard";
  process.exit(valid ? 0 : 1);
' "$deployment_url" "$dashboard_location" >/dev/null 2>&1; then
  fail "dashboard redirect is not the exact safe same-origin login redirect"
fi
pass "dashboard redirect target is same-origin and exact"
assert_status "public ops boundary" "/ops" "404"
assert_status "OpenAPI" "/v1/openapi.json" "200"
assert_status "public sources" "/api/sources" "200"
assert_status "disabled public scan create" "/api/scan-requests" "503" "POST"

for log_level in error fatal; do
  : >"$logs_file"
  : >"$command_output_file"
  chmod 0600 "$logs_file" "$command_output_file"
  if ! vercel logs "$deployment_url" --level "$log_level" --since 30m --json --no-color >"$logs_file" 2>"$command_output_file"; then
    fail "error-level or fatal staged-deployment log verification failed"
  fi
  if LC_ALL=C grep -Eq '[^[:space:]]' "$logs_file"; then
    fail "error-level or fatal staged-deployment logs are present"
  fi
done
pass "no error-level or fatal logs returned for the staged deployment"

staged_deployment_url="$deployment_url"
: >"$command_output_file"
promotion_command_status=0
vercel promote "$staged_deployment_url" --yes --timeout 5m --no-color >"$command_output_file" 2>&1 || promotion_command_status=$?
if [[ "$promotion_command_status" -ne 0 ]]; then
  : >"$command_output_file"
  vercel promote status "$expected_project" --no-color >"$command_output_file" 2>&1 || true
fi

promotion_verified=false
promotion_attempt=1
while [[ "$promotion_attempt" -le 10 ]]; do
  : >"$stable_inspect_file"
  : >"$command_output_file"
  if vercel inspect "$EXPECTED_STABLE_PRODUCTION_ORIGIN" --format=json >"$stable_inspect_file" 2>"$command_output_file"; then
    if node -e '
  const fs = require("node:fs");
  const staged = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const stable = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const stagedHost = new URL(process.argv[3]).hostname.toLowerCase();
  const collect = (value, wanted, found = []) => {
    if (!value || typeof value !== "object") return found;
    for (const [key, nested] of Object.entries(value)) {
      if (wanted.has(key) && (typeof nested === "string" || typeof nested === "number")) {
        found.push(String(nested));
      }
      collect(nested, wanted, found);
    }
    return found;
  };
  const ids = (report) => collect(report, new Set(["id", "uid", "deploymentId"]));
  const stagedIds = ids(staged);
  const stableIds = new Set(ids(stable));
  const stableUrls = collect(stable, new Set(["url", "host", "hostname"])).map((value) =>
    value.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase(),
  );
  const sameDeployment = stagedIds.length > 0 && stagedIds.some((id) => stableIds.has(id));
  process.exit(sameDeployment && stableUrls.includes(stagedHost) ? 0 : 1);
' "$inspect_file" "$stable_inspect_file" "$staged_deployment_url" >/dev/null 2>&1; then
      promotion_verified=true
      break
    fi
  fi
  promotion_attempt=$((promotion_attempt + 1))
  if [[ "$promotion_attempt" -le 10 ]]; then
    sleep 6
  fi
done
if [[ "$promotion_verified" != "true" ]]; then
  if [[ "$promotion_command_status" -ne 0 ]]; then
    fail "promotion status is indeterminate after the Vercel command returned nonzero; inspect the Current deployment manually before retrying"
  fi
  fail "promotion was requested but stable-origin identity could not be proved; inspect the Current deployment manually before retrying"
fi
pass "accepted staged deployment promoted after all checks"
pass "stable Production origin resolves to the accepted deployment"

deployment_url="$EXPECTED_STABLE_PRODUCTION_ORIGIN"
assert_status "stable public landing" "/" "200" "GET" "stable"
assert_status "stable login" "/login" "200" "GET" "stable"
assert_status "stable dashboard" "/dashboard" "307" "GET" "stable"
stable_dashboard_location="$(LC_ALL=C awk '
  tolower($0) ~ /^location:/ {
    value = substr($0, index($0, ":") + 1)
    gsub(/^[[:space:]]+|[[:space:]\r]+$/, "", value)
    selected = value
  }
  END { print selected }
' "$headers_file")"
if ! node -e '
  const origin = new URL(process.argv[1]);
  const redirect = new URL(process.argv[2], origin);
  const valid =
    redirect.origin === origin.origin &&
    redirect.pathname === "/login" &&
    redirect.searchParams.get("next") === "/dashboard";
  process.exit(valid ? 0 : 1);
' "$EXPECTED_STABLE_PRODUCTION_ORIGIN" "$stable_dashboard_location" >/dev/null 2>&1; then
  fail "stable dashboard redirect is not the exact same-origin login redirect; promotion already occurred"
fi
pass "stable dashboard redirect target is same-origin and exact"
assert_status "stable public ops boundary" "/ops" "404" "GET" "stable"
assert_status "stable OpenAPI" "/v1/openapi.json" "200" "GET" "stable"
assert_status "stable public sources" "/api/sources" "200" "GET" "stable"
assert_status "stable disabled public scan create" "/api/scan-requests" "503" "POST" "stable"

for log_level in error fatal; do
  : >"$logs_file"
  : >"$command_output_file"
  if ! vercel logs "$EXPECTED_STABLE_PRODUCTION_ORIGIN" --level "$log_level" --since 30m --json --no-color >"$logs_file" 2>"$command_output_file"; then
    fail "stable deployment log verification failed after promotion"
  fi
  if LC_ALL=C grep -Eq '[^[:space:]]' "$logs_file"; then
    fail "stable deployment error-level or fatal logs are present after promotion"
  fi
done
pass "no error-level or fatal logs returned for the stable Production origin"

printf 'Staged Production deployment URL: %s\n' "$staged_deployment_url"
printf 'Stable Production origin: %s\n' "$EXPECTED_STABLE_PRODUCTION_ORIGIN"

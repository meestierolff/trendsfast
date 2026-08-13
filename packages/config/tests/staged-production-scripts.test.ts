import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { STAGED_PRODUCTION_ALLOWLIST } from "../../../scripts/staged-production-env";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const deployScript = join(repositoryRoot, "scripts/deploy-staged-production.sh");
const scriptsReadme = join(repositoryRoot, "scripts/README.md");
const vercelConfig = join(repositoryRoot, "apps/web/vercel.json");
const temporaryRoots: string[] = [];

const requiredEnvironment = `# fake Vercel Production environment
VERCEL_OIDC_TOKEN="TOP_SECRET_SENTINEL_OIDC"
NODE_ENV="production"
APP_URL="https://trendsfast.vercel.app"
PUBLIC_APP_URL="https://trendsfast.vercel.app"
TRENDSFAST_SURFACE="public"
DATABASE_URL="TOP_SECRET_SENTINEL_DATABASE"
MEMBER_DATABASE_URL="TOP_SECRET_SENTINEL_MEMBER"
AUTH_DATABASE_URL="TOP_SECRET_SENTINEL_AUTH"
DATABASE_SSL_CA="TOP_SECRET_SENTINEL_CA"
PROVIDER_CREDENTIAL_MODE="managed"
MANAGED_POLICY_REVISION="TOP_SECRET_SENTINEL_POLICY"
PUBLIC_SCAN_PROCESSING="inline"
PUBLIC_SCAN_DAILY_LIMIT="1"
PUBLIC_SCAN_GLOBAL_DAILY_LIMIT="1"
PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD="1"
API_CREATE_RATE_LIMIT_PER_HOUR="1"
API_STATUS_RATE_LIMIT_PER_HOUR="1"
API_AUTH_FAILURE_LIMIT_PER_HOUR="1"
API_PROVIDER_COST_LIMIT_USD_PER_HOUR="1"
SCAN_RETENTION_DAYS="90"
SESSION_SECRET="TOP_SECRET_SENTINEL_SESSION"
API_KEY_PEPPER="TOP_SECRET_SENTINEL_PEPPER"
NEXT_PUBLIC_SUPABASE_URL="https://example.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="TOP_SECRET_SENTINEL_PUBLISHABLE"
PROVIDER_CALLS_ENABLED="false"
PUBLIC_SCANS_ENABLED="false"
LIVE_API_CREATION_ENABLED="false"
BILLING_ENABLED="false"
BILLING_CHECKOUT_ENABLED="false"
PAID_MONITORING_ENABLED="false"
MONITORING_ENABLED="false"
FOUNDING_100_ENABLED="false"
CLOUD_TRIAL_ENABLED="false"
STRIPE_MODE="test"
`;

type HarnessOptions = {
  environment?: string;
  projectReport?: string;
  projectApi?: string;
  domainsApi?: string;
  linkedProject?: string;
  deploymentState?: string;
  dashboardLocation?: string;
  statusOverrides?: Record<string, string>;
  errorLogs?: string;
  cronConfig?: boolean;
  dirty?: boolean;
  expectedSha?: string;
};

type HarnessResult = {
  result: ReturnType<typeof spawnSync>;
  vercelLog: string;
  envPullPath: string;
  expectedSha: string;
};

function executable(path: string, source: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runHarness(options: HarnessOptions = {}): HarnessResult {
  const root = mkdtempSync(join(tmpdir(), "trendsfast-staged-script-test-"));
  temporaryRoots.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const fakeBin = join(root, "bin");
  const vercelLogPath = join(root, "vercel.log");
  const envPullPathRecord = join(root, "env-pull-path.txt");
  mkdirSync(repo, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  git(repo, "config", "user.email", "script-tests@example.invalid");
  git(repo, "config", "user.name", "Script Tests");

  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "apps/web"), { recursive: true });
  mkdirSync(join(repo, ".vercel"), { recursive: true });
  writeFileSync(join(repo, "scripts/deploy-staged-production.sh"), readFileSync(deployScript));
  chmodSync(join(repo, "scripts/deploy-staged-production.sh"), 0o700);
  writeFileSync(
    join(repo, "apps/web/vercel.json"),
    options.cronConfig
      ? '{"$schema":"https://openapi.vercel.sh/vercel.json","git":{"deploymentEnabled":{"main":false}},"regions":["fra1"],"crons":[]}\n'
      : '{"$schema":"https://openapi.vercel.sh/vercel.json","git":{"deploymentEnabled":{"main":false}},"regions":["fra1"]}\n',
  );
  writeFileSync(
    join(repo, ".vercel/project.json"),
    options.linkedProject ??
      '{"projectId":"prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC","orgId":"team_UVAUfp4G8CmlSNPI9w5FasKj","projectName":"trendsfast"}\n',
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "test fixture");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");
  const releaseSha = git(repo, "rev-parse", "HEAD");
  if (options.dirty) writeFileSync(join(repo, "dirty.txt"), "dirty\n");

  executable(
    join(fakeBin, "vercel"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_VERCEL_LOG"
case "\${1:-}" in
  whoami)
    printf '%s\\n' 'fake-founder'
    ;;
  project)
    [[ "\${2:-}" == "inspect" ]]
    printf '%s\\n' "$FAKE_PROJECT_REPORT"
    ;;
  api)
    if [[ "\${2:-}" == *'/domains' ]]; then
      printf '%s' "$FAKE_DOMAINS_API"
    else
      printf '%s' "$FAKE_PROJECT_API"
    fi
    ;;
  env)
    if [[ "\${2:-}" == "ls" ]]; then
      node -e '
        const names = process.env.FAKE_PRODUCTION_ENV
          .split(String.fromCharCode(10))
          .filter((line) => line && !line.startsWith("#") && line.includes("="))
          .map((line) => line.slice(0, line.indexOf("=")).trim())
          .filter((name) => name !== "VERCEL_OIDC_TOKEN");
        process.stdout.write(JSON.stringify({ envs: names.map((key) => ({ key })) }));
      '
    else
      [[ "\${2:-}" == "pull" ]]
      env_file="$3"
      printf '%s' "$env_file" > "$FAKE_ENV_PULL_PATH_RECORD"
      printf '%s' "$FAKE_PRODUCTION_ENV" > "$env_file"
      chmod 0600 "$env_file"
    fi
    ;;
  deploy)
    printf '%s\\n' 'https://trendsfast-abcdef.vercel.app'
    ;;
  curl)
    request_path="$2"
    shift 2
    deployment=''
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --deployment)
          deployment="$2"
          shift 2
          ;;
        --)
          shift
          break
          ;;
        *)
          shift
          ;;
      esac
    done
    fake-curl "$@" "\${deployment%/}\${request_path}"
    ;;
  promote)
    ;;
  inspect)
    printf '%s' "$FAKE_DEPLOYMENT_STATE"
    ;;
  logs)
    printf '%s' "$FAKE_ERROR_LOGS"
    ;;
  *)
    exit 91
    ;;
esac
`,
  );

  executable(
    join(fakeBin, "fake-curl"),
    `#!/usr/bin/env bash
set -euo pipefail
output_file=''
headers_file=''
request_url=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      output_file="$2"
      shift 2
      ;;
    --dump-header)
      headers_file="$2"
      shift 2
      ;;
    --connect-timeout|--max-time|--request|--header|--data-binary|--write-out)
      shift 2
      ;;
    --silent|--show-error)
      shift
      ;;
    *)
      request_url="$1"
      shift
      ;;
  esac
done
path="\${request_url#https://trendsfast-abcdef.vercel.app}"
path="\${path#https://trendsfast.vercel.app}"
status='200'
case "$path" in
  /) status="\${FAKE_ROOT_STATUS:-200}" ;;
  /login) status="\${FAKE_LOGIN_STATUS:-200}" ;;
  /dashboard) status="\${FAKE_DASHBOARD_STATUS:-307}" ;;
  /ops) status="\${FAKE_OPS_STATUS:-404}" ;;
  /v1/openapi.json) status="\${FAKE_OPENAPI_STATUS:-200}" ;;
  /api/sources) status="\${FAKE_SOURCES_STATUS:-200}" ;;
  /api/scan-requests) status="\${FAKE_SCAN_REQUESTS_STATUS:-503}" ;;
esac
printf 'HTTP/2 %s\\r\\n' "$status" > "$headers_file"
if [[ "$path" == '/dashboard' ]]; then
  printf 'Location: %s\\r\\n' "$FAKE_DASHBOARD_LOCATION" >> "$headers_file"
fi
printf '\\r\\n' >> "$headers_file"
printf '%s' 'TOP_SECRET_SENTINEL_RESPONSE_BODY' > "$output_file"
printf '%s' "$status"
`,
  );
  executable(
    join(fakeBin, "curl"),
    `#!/usr/bin/env bash
exec fake-curl "$@"
`,
  );

  const projectReport =
    options.projectReport ??
    `Name: trendsfast
Framework Preset: Next.js
Root Directory: apps/web
Production Branch: main`;
  const deploymentState =
    options.deploymentState ??
    '{"id":"dpl_fake","name":"trendsfast","url":"trendsfast-abcdef.vercel.app","readyState":"READY","target":"production"}';
  const projectApi =
    options.projectApi ??
    '{"id":"prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC","name":"trendsfast","accountId":"team_UVAUfp4G8CmlSNPI9w5FasKj","rootDirectory":"apps/web","framework":"nextjs","link":{"productionBranch":"main"},"protectionBypass":{"synthetic-token":{"scope":"automation-bypass"}}}';
  const domainsApi =
    options.domainsApi ?? '{"domains":[{"name":"trendsfast.vercel.app","verified":true}]}';
  const statusNames: Record<string, string> = {
    "/": "FAKE_ROOT_STATUS",
    "/login": "FAKE_LOGIN_STATUS",
    "/dashboard": "FAKE_DASHBOARD_STATUS",
    "/ops": "FAKE_OPS_STATUS",
    "/v1/openapi.json": "FAKE_OPENAPI_STATUS",
    "/api/sources": "FAKE_SOURCES_STATUS",
    "/api/scan-requests": "FAKE_SCAN_REQUESTS_STATUS",
  };
  const statusEnvironment = Object.fromEntries(
    Object.entries(options.statusOverrides ?? {}).map(([path, value]) => [
      statusNames[path],
      value,
    ]),
  );
  const result = spawnSync("/bin/bash", ["scripts/deploy-staged-production.sh"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      ...statusEnvironment,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      EXPECTED_RELEASE_SHA: options.expectedSha ?? releaseSha,
      EXPECTED_STABLE_PRODUCTION_ORIGIN: "https://trendsfast.vercel.app",
      FAKE_VERCEL_LOG: vercelLogPath,
      FAKE_ENV_PULL_PATH_RECORD: envPullPathRecord,
      FAKE_PRODUCTION_ENV: options.environment ?? requiredEnvironment,
      FAKE_PROJECT_REPORT: projectReport,
      FAKE_PROJECT_API: projectApi,
      FAKE_DOMAINS_API: domainsApi,
      FAKE_DEPLOYMENT_STATE: deploymentState,
      FAKE_DASHBOARD_LOCATION: options.dashboardLocation ?? "/login?next=/dashboard",
      FAKE_ERROR_LOGS: options.errorLogs ?? "",
    },
  });

  return {
    result,
    vercelLog: existsSync(vercelLogPath) ? readFileSync(vercelLogPath, "utf8") : "",
    envPullPath: existsSync(envPullPathRecord) ? readFileSync(envPullPathRecord, "utf8") : "",
    expectedSha: releaseSha,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("founder staged Production deploy script", () => {
  it("pins the tracked no-cron, manual-main, Frankfurt Vercel config", () => {
    const config = JSON.parse(readFileSync(vercelConfig, "utf8"));

    expect(config).not.toHaveProperty("crons");
    expect(config.git?.deploymentEnabled?.main).toBe(false);
    expect(config.regions).toEqual(["fra1"]);
  });

  it("contains the exact guarded deploy command and documents the exact founder command", () => {
    const script = readFileSync(deployScript, "utf8");
    const readme = readFileSync(scriptsReadme, "utf8");

    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("vercel deploy --prod --skip-domain --yes -A apps/web/vercel.json");
    expect(script).toContain("trap cleanup EXIT");
    expect(script).not.toMatch(/\bsource\s+[^\n]*production\.env/);
    expect(script).not.toMatch(/\beval\s+[^\n]*production_env_file/);
    expect(script).not.toContain("automation_bypass_secret");
    const shellAllowlist = script.match(/split\("([A-Z0-9_ ]+)", names, " "\)/)?.[1]?.split(" ");
    expect(shellAllowlist).toEqual([...STAGED_PRODUCTION_ALLOWLIST]);
    expect(readme).toContain("bash scripts/deploy-staged-production.sh");
    expect(readme).toContain("command alone does not\npromote or change the stable alias");
  });

  it("runs the guarded flow against fake binaries without leaking pulled or response values", () => {
    const { result, vercelLog, envPullPath } = runHarness();
    const combinedOutput = `${result.stdout}${result.stderr}`;

    expect(result.status, combinedOutput).toBe(0);
    expect(combinedOutput).toContain(
      "Staged Production deployment URL: https://trendsfast-abcdef.vercel.app",
    );
    expect(combinedOutput).toContain(
      "PASS: stable Production origin resolves to the accepted deployment",
    );
    expect(combinedOutput).not.toContain("TOP_SECRET_SENTINEL");
    expect(vercelLog).toContain("deploy --prod --skip-domain --yes -A apps/web/vercel.json\n");
    expect(vercelLog.match(/^deploy /gm)).toHaveLength(1);
    expect(vercelLog).toContain(
      "inspect https://trendsfast-abcdef.vercel.app --wait --timeout 5m --format=json",
    );
    expect(vercelLog).toContain(
      "logs https://trendsfast-abcdef.vercel.app --level error --since 30m --json --no-color",
    );
    expect(vercelLog).toContain(
      "promote https://trendsfast-abcdef.vercel.app --yes --timeout 5m --no-color",
    );
    expect(vercelLog).toContain("inspect https://trendsfast.vercel.app --format=json");
    expect(vercelLog).toContain(
      "curl / --deployment https://trendsfast-abcdef.vercel.app --yes --",
    );
    expect(vercelLog.match(/^curl /gm)).toHaveLength(7);
    expect(vercelLog).toContain(
      "logs https://trendsfast.vercel.app --level fatal --since 30m --json --no-color",
    );
    expect(envPullPath).not.toBe("");
    expect(existsSync(envPullPath)).toBe(false);
  });

  it("fails before any Vercel call when the tree is dirty or the release SHA is not exact", () => {
    const dirty = runHarness({ dirty: true });
    expect(dirty.result.status).not.toBe(0);
    expect(dirty.vercelLog).toBe("");

    const mismatch = runHarness({ expectedSha: "0".repeat(40) });
    expect(mismatch.result.status).not.toBe(0);
    expect(mismatch.vercelLog).toBe("");
  });

  it("fails closed before deploy for project, cron, environment-name, or flag drift", () => {
    const projectMismatch = runHarness({
      projectApi:
        '{"id":"prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC","name":"trendsfast","accountId":"team_UVAUfp4G8CmlSNPI9w5FasKj","rootDirectory":".","framework":"nextjs","link":{"productionBranch":"main"},"protectionBypass":{"synthetic-token":{"scope":"automation-bypass"}}}',
    });
    expect(projectMismatch.result.status).not.toBe(0);
    expect(projectMismatch.vercelLog).not.toContain("deploy ");

    const wrongLink = runHarness({
      linkedProject: '{"projectId":"prj_other","orgId":"team_other","projectName":"trendsfast"}\n',
    });
    expect(wrongLink.result.status).not.toBe(0);
    expect(wrongLink.vercelLog).not.toContain("deploy ");

    const missingBypass = runHarness({
      projectApi:
        '{"id":"prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC","name":"trendsfast","accountId":"team_UVAUfp4G8CmlSNPI9w5FasKj","rootDirectory":"apps/web","framework":"nextjs","link":{"productionBranch":"main"},"protectionBypass":{}}',
    });
    expect(missingBypass.result.status).not.toBe(0);
    expect(missingBypass.vercelLog).not.toContain("deploy ");

    const unexpectedDomain = runHarness({
      domainsApi:
        '{"domains":[{"name":"trendsfast.vercel.app","verified":true},{"name":"trendsfast.com","verified":true}]}',
    });
    expect(unexpectedDomain.result.status).not.toBe(0);
    expect(unexpectedDomain.vercelLog).not.toContain("deploy ");

    const cronConfig = runHarness({ cronConfig: true });
    expect(cronConfig.result.status).not.toBe(0);
    expect(cronConfig.vercelLog).not.toContain("deploy ");

    const missingRequired = runHarness({
      environment: requiredEnvironment.replace(/^MEMBER_DATABASE_URL=.*\n/m, ""),
    });
    expect(missingRequired.result.status).not.toBe(0);
    expect(missingRequired.vercelLog).not.toContain("deploy ");

    const forbidden = runHarness({
      environment: `${requiredEnvironment}OPS_TOKEN="TOP_SECRET_SENTINEL_OPS"\n`,
    });
    expect(forbidden.result.status).not.toBe(0);
    expect(forbidden.vercelLog).not.toContain("deploy ");
    expect(`${forbidden.result.stdout}${forbidden.result.stderr}`).not.toContain(
      "TOP_SECRET_SENTINEL",
    );

    const unknown = runHarness({
      environment: `${requiredEnvironment}SERVICE_ROLE_JWT="TOP_SECRET_SENTINEL_UNKNOWN"\n`,
    });
    expect(unknown.result.status).not.toBe(0);
    expect(unknown.vercelLog).not.toContain("deploy ");

    const enabledEffect = runHarness({
      environment: requiredEnvironment.replace(
        'PUBLIC_SCANS_ENABLED="false"',
        'PUBLIC_SCANS_ENABLED="true"',
      ),
    });
    expect(enabledEffect.result.status).not.toBe(0);
    expect(enabledEffect.vercelLog).not.toContain("deploy ");
  }, 15_000);

  it("fails after deployment when inspection, smoke, redirect, or error logs are unsafe", () => {
    const notReady = runHarness({
      deploymentState:
        '{"name":"trendsfast","url":"trendsfast-abcdef.vercel.app","readyState":"ERROR","target":"production"}',
    });
    expect(notReady.result.status).not.toBe(0);
    expect(notReady.vercelLog).toContain("deploy --prod --skip-domain");

    const wrongStatus = runHarness({ statusOverrides: { "/ops": "200" } });
    expect(wrongStatus.result.status).not.toBe(0);

    const crossOriginRedirect = runHarness({
      dashboardLocation: "https://attacker.example/login?next=/dashboard",
    });
    expect(crossOriginRedirect.result.status).not.toBe(0);

    const errorLogs = runHarness({ errorLogs: '{"level":"error"}\n' });
    expect(errorLogs.result.status).not.toBe(0);
    expect(`${errorLogs.result.stdout}${errorLogs.result.stderr}`).not.toContain(
      '{"level":"error"}',
    );
  });
});

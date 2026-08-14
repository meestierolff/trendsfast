import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { resolveVercelConfig } from "../../../apps/web/vercel";
import { HOBBY_OPS_ALLOWLIST, HOBBY_PUBLIC_ALLOWLIST } from "../../../scripts/hobby-environments";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const publicScriptPath = join(repositoryRoot, "scripts/deploy-hobby-production.sh");
const opsScriptPath = join(repositoryRoot, "scripts/deploy-hobby-ops.sh");
const publicScript = readFileSync(publicScriptPath, "utf8");
const opsScript = readFileSync(opsScriptPath, "utf8");

const publicEnvironmentNames = [
  "NODE_ENV",
  "APP_URL",
  "PUBLIC_APP_URL",
  "TRENDSFAST_SURFACE",
  "DATABASE_URL",
  "MEMBER_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "DATABASE_SSL_CA",
  "PROVIDER_CREDENTIAL_MODE",
  "MANAGED_POLICY_REVISION",
  "PUBLIC_SCAN_PROCESSING",
  "PUBLIC_SCAN_DAILY_LIMIT",
  "PUBLIC_SCAN_GLOBAL_DAILY_LIMIT",
  "PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD",
  "API_CREATE_RATE_LIMIT_PER_HOUR",
  "API_STATUS_RATE_LIMIT_PER_HOUR",
  "API_AUTH_FAILURE_LIMIT_PER_HOUR",
  "API_PROVIDER_COST_LIMIT_USD_PER_HOUR",
  "SCAN_RETENTION_DAYS",
  "XAI_API_KEY",
  "XAI_MODEL",
  "XAI_ESTIMATED_COST_USD_PER_SEARCH",
  "XAI_MAX_TOOL_CALLS_PER_SCAN",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "DATAFORSEO_GOOGLE_TRENDS_MODE",
  "DATAFORSEO_ESTIMATED_COST_USD_PER_TASK",
  "TAVILY_API_KEY",
  "TAVILY_ESTIMATED_COST_USD_PER_CREDIT",
  "TAVILY_MAX_CREDITS_PER_SCAN",
  "YOUTUBE_API_KEY",
  "YOUTUBE_INTERNAL_QUOTA_VALUE_USD",
  "YOUTUBE_MAX_SEARCHES_PER_SCAN",
  "GITHUB_TOKEN",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS",
  "LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS",
  "MAX_PROVIDER_COST_USD_PER_SCAN",
  "MAX_SCAN_DURATION_SECONDS",
  "PROVIDER_TIMEOUT_MS",
  "SESSION_SECRET",
  "API_KEY_PEPPER",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "TURNSTILE_ENABLED",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "CRON_SECRET",
  "PROVIDER_CALLS_ENABLED",
  "PUBLIC_SCANS_ENABLED",
  "LIVE_API_CREATION_ENABLED",
  "BILLING_ENABLED",
  "BILLING_CHECKOUT_ENABLED",
  "PAID_MONITORING_ENABLED",
  "MONITORING_ENABLED",
  "FOUNDING_100_ENABLED",
  "CLOUD_TRIAL_ENABLED",
  "STRIPE_MODE",
  "NEXT_PUBLIC_ANNOUNCEMENT_ENABLED",
  "NEXT_PUBLIC_ANNOUNCEMENT_TEXT",
  "DATAFAST_ENABLED",
] as const;

const opsEnvironmentNames = [
  "NODE_ENV",
  "APP_URL",
  "PUBLIC_APP_URL",
  "TRENDSFAST_SURFACE",
  "OPS_DATABASE_URL",
  "DATABASE_SSL_CA",
  "PROVIDER_CREDENTIAL_MODE",
  "OPS_TOKEN",
  "SESSION_SECRET",
  "API_KEY_PEPPER",
  "MANAGED_POLICY_REVISION",
  "PUBLIC_DEPLOYMENT_HOST",
  "PUBLIC_DEPLOYMENT_ID",
  "XAI_API_KEY",
  "XAI_MODEL",
  "XAI_ESTIMATED_COST_USD_PER_SEARCH",
  "XAI_MAX_TOOL_CALLS_PER_SCAN",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "DATAFORSEO_GOOGLE_TRENDS_MODE",
  "DATAFORSEO_ESTIMATED_COST_USD_PER_TASK",
  "TAVILY_API_KEY",
  "TAVILY_ESTIMATED_COST_USD_PER_CREDIT",
  "TAVILY_MAX_CREDITS_PER_SCAN",
  "YOUTUBE_API_KEY",
  "YOUTUBE_INTERNAL_QUOTA_VALUE_USD",
  "YOUTUBE_MAX_SEARCHES_PER_SCAN",
  "GITHUB_TOKEN",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS",
  "LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS",
  "MAX_PROVIDER_COST_USD_PER_SCAN",
  "MAX_SCAN_DURATION_SECONDS",
  "PROVIDER_TIMEOUT_MS",
  "PUBLIC_SCAN_PROCESSING",
  "PUBLIC_SCAN_DAILY_LIMIT",
  "PUBLIC_SCAN_GLOBAL_DAILY_LIMIT",
  "PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD",
  "API_CREATE_RATE_LIMIT_PER_HOUR",
  "API_STATUS_RATE_LIMIT_PER_HOUR",
  "API_AUTH_FAILURE_LIMIT_PER_HOUR",
  "API_PROVIDER_COST_LIMIT_USD_PER_HOUR",
  "SCAN_RETENTION_DAYS",
  "PROVIDER_CALLS_ENABLED",
  "PUBLIC_SCANS_ENABLED",
  "LIVE_API_CREATION_ENABLED",
  "BILLING_ENABLED",
  "BILLING_CHECKOUT_ENABLED",
  "PAID_MONITORING_ENABLED",
  "MONITORING_ENABLED",
  "FOUNDING_100_ENABLED",
  "CLOUD_TRIAL_ENABLED",
  "STRIPE_MODE",
] as const;

const acceptedSha = "a".repeat(40);
const redactionCanary = "harness-secret-must-not-leak";

type DeployHarnessOptions = {
  target: "public" | "ops";
  staleCronReads?: number;
  opsAliasMode?: "accepted" | "rejected";
  failOpsAttestation?: boolean;
  ambientProjectOverride?: boolean;
  ambientTeamOverride?: boolean;
  vercelVersion?: string;
  gitIgnoredPath?: string;
};

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o700 });
  chmodSync(path, 0o700);
}

function runDeployHarness(options: DeployHarnessOptions) {
  const root = mkdtempSync(join(tmpdir(), "trendsfast-hobby-deploy-test-"));
  const bin = join(root, "bin");
  const state = join(root, ".harness");
  const privateDirectory = join(root, ".var", "private");
  const vercelDirectory = join(root, ".vercel");
  const webDirectory = join(root, "apps", "web");
  const temporaryDirectory = join(root, "tmp");
  const originalLink = `${JSON.stringify(
    {
      projectName: "trendsfast",
      projectId: "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC",
      orgId: "team_UVAUfp4G8CmlSNPI9w5FasKj",
    },
    null,
    2,
  )}\n`;
  const originalReadme = "pinned public link\n";

  try {
    for (const directory of [
      bin,
      state,
      privateDirectory,
      vercelDirectory,
      webDirectory,
      temporaryDirectory,
    ]) {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(join(vercelDirectory, "project.json"), originalLink);
    writeFileSync(join(vercelDirectory, "README.txt"), originalReadme);
    writeFileSync(join(root, ".vercelignore"), ".env*\n.vercel\nnode_modules\n");
    writeFileSync(
      join(privateDirectory, "hobby-release.json"),
      `${JSON.stringify(
        {
          version: 1,
          acceptedBranch: "sol/hobby-launch-dogfood",
          acceptedSha,
          ...(options.target === "ops"
            ? {
                publicDeploymentHost: "trendsfast-public-accepted.vercel.app",
                publicDeploymentId: "dpl_PublicAccepted",
              }
            : {}),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    chmodSync(join(privateDirectory, "hobby-release.json"), 0o600);
    writeFileSync(
      join(webDirectory, "vercel.hobby.json"),
      '{"$schema":"https://openapi.vercel.sh/vercel.json","git":{"deploymentEnabled":{"main":false}},"regions":["fra1"],"crons":[{"path":"/api/cron/monitoring","schedule":"0 7 * * *"}]}\n',
    );
    writeFileSync(
      join(webDirectory, "vercel.ops.json"),
      '{"$schema":"https://openapi.vercel.sh/vercel.json","git":{"deploymentEnabled":{"main":false}},"regions":["fra1"]}\n',
    );
    writeFileSync(join(state, "public-environment.json"), JSON.stringify(publicEnvironmentNames));
    writeFileSync(join(state, "ops-environment.json"), JSON.stringify(opsEnvironmentNames));

    writeExecutable(
      join(bin, "git"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const root = process.env.HARNESS_ROOT;
const sha = process.env.HARNESS_SHA;
if (args[0] === "rev-parse" && args[1] === "--show-toplevel") process.stdout.write(root + "\\n");
else if (args[0] === "status") process.exit(0);
else if (args[0] === "symbolic-ref") process.stdout.write("sol/hobby-launch-dogfood\\n");
else if (args[0] === "fetch") process.exit(0);
else if (args[0] === "ls-files" && args.includes("--others") && args.includes("--ignored") && args.includes("--exclude-standard")) {
  if (process.env.HARNESS_GIT_IGNORED_PATH) process.stdout.write(process.env.HARNESS_GIT_IGNORED_PATH + "\\0");
}
else if (args[0] === "rev-parse") process.stdout.write(sha + "\\n");
else if (args[0] === "remote" && args[1] === "get-url") process.stdout.write("https://github.com/meestierolff/trendsfast.git\\n");
else if (args[0] === "merge-base") process.exit(0);
else process.exit(91);
`,
    );
    writeExecutable(
      join(bin, "pnpm"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.HARNESS_ROOT, ".harness", "pnpm.log"), JSON.stringify(args) + "\\n");
process.stderr.write(process.env.HARNESS_SECRET + "\\n");
if (process.env.HARNESS_FAIL_OPS_ATTESTATION === "true" && args.includes("env:import-ops") && args.includes("--check")) process.exit(23);
`,
    );
    writeExecutable(
      join(bin, "sleep"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(path.join(process.env.HARNESS_ROOT, ".harness", "sleep.log"), process.argv[2] + "\\n");
`,
    );
    writeExecutable(
      join(bin, "vercel"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const root = process.env.HARNESS_ROOT;
const state = path.join(root, ".harness");
const target = process.env.HARNESS_TARGET;
const sha = process.env.HARNESS_SHA;
const teamId = "team_UVAUfp4G8CmlSNPI9w5FasKj";
const publicProjectId = "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC";
const opsProjectId = "prj_EYAjX2Nyd1jUXSjfWVTVoI320nnU";
const deployedMarker = path.join(state, "deployed");
fs.appendFileSync(path.join(state, "vercel.log"), JSON.stringify(args) + "\\n");
process.stderr.write(process.env.HARNESS_SECRET + "\\n");
const send = (value) => process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
const publicProject = () => ({
  id: publicProjectId,
  name: "trendsfast",
  accountId: teamId,
  rootDirectory: "apps/web",
  framework: "nextjs",
  link: { productionBranch: "main" },
  defaultResourceConfig: { fluid: true, functionDefaultTimeout: 300 },
  resourceConfig: { fluid: true },
});
const opsProject = () => ({
  id: opsProjectId,
  name: "trendsfast-ops",
  accountId: teamId,
  rootDirectory: "apps/web",
  framework: "nextjs",
  defaultResourceConfig: { fluid: true, functionDefaultTimeout: 300 },
  resourceConfig: { fluid: true },
  ssoProtection: { deploymentType: "all_except_custom_domains" },
});
const nextCronRead = () => {
  const counterPath = path.join(state, "cron-read-count");
  const count = fs.existsSync(counterPath) ? Number(fs.readFileSync(counterPath, "utf8")) + 1 : 1;
  fs.writeFileSync(counterPath, String(count));
  return count;
};
if (args[0] === "--version") {
  send(process.env.HARNESS_VERCEL_VERSION + "\\n");
} else if (args[0] === "whoami") {
  send("founder\\n");
} else if (args[0] === "env" && args[1] === "ls") {
  const environment = args.includes(publicProjectId) ? "public-environment.json" : "ops-environment.json";
  send(fs.readFileSync(path.join(state, environment), "utf8"));
} else if (args[0] === "link") {
  fs.writeFileSync(path.join(root, ".vercel", "project.json"), JSON.stringify({ projectName: "trendsfast-ops", projectId: opsProjectId, orgId: teamId }));
  fs.writeFileSync(path.join(root, ".vercel", "README.txt"), "mutated ops link\\n");
  send("linked\\n");
} else if (args[0] === "deploy") {
  fs.writeFileSync(deployedMarker, target);
  send(target === "public" ? "https://trendsfast-public-new.vercel.app\\n" : "https://trendsfast-ops-new.vercel.app\\n");
} else if (args[0] === "inspect") {
  if (target === "public") {
    send({ id: "dpl_PublicNew", name: "trendsfast", readyState: "READY", target: "production", url: "trendsfast-public-new.vercel.app" });
  } else {
    send({ id: "dpl_OpsNew", name: "trendsfast-ops", readyState: "READY", target: "production", url: "trendsfast-ops-new.vercel.app" });
  }
} else if (args[0] === "api" && args[1] === "/v2/teams/" + teamId) {
  send({ id: teamId, billing: { plan: "hobby" }, membership: { teamId, confirmed: true } });
} else if (args[0] === "api" && args[1] === "/v9/projects/" + publicProjectId) {
  const project = publicProject();
  if (target === "public" && fs.existsSync(deployedMarker)) {
    const read = nextCronRead();
    const stale = read <= Number(process.env.HARNESS_STALE_CRON_READS);
    project.crons = {
      deploymentId: stale ? "dpl_Stale" : "dpl_PublicNew",
      disabledAt: null,
      definitions: [{ path: "/api/cron/monitoring", schedule: "0 7 * * *" }],
    };
  }
  send(project);
} else if (args[0] === "api" && args[1] === "/v9/projects/" + opsProjectId) {
  const project = opsProject();
  if (target === "ops" && fs.existsSync(deployedMarker)) {
    const read = nextCronRead();
    const stale = read <= Number(process.env.HARNESS_STALE_CRON_READS);
    project.crons = stale
      ? { deploymentId: "dpl_Stale", disabledAt: null, definitions: [{ path: "/api/cron/monitoring", schedule: "0 7 * * *" }] }
      : { deploymentId: "dpl_OpsNew", disabledAt: null, definitions: [] };
  }
  send(project);
} else if (args[0] === "api" && args[1] === "/v9/projects/" + opsProjectId + "/domains?limit=100&teamId=" + teamId) {
  send({ pagination: { count: 1, next: null }, domains: [{ name: "trendsfast-ops.vercel.app", projectId: opsProjectId, verified: true, gitBranch: null, customEnvironmentId: null }] });
} else if (args[0] === "api" && args[1] === "/v13/deployments/dpl_PublicAccepted") {
  send({ id: "dpl_PublicAccepted", projectId: publicProjectId, name: "trendsfast", meta: { githubCommitSha: sha }, url: "trendsfast-public-accepted.vercel.app", plan: "hobby", target: "production", readyState: "READY" });
} else if (args[0] === "api" && args[1] === "/v13/deployments/dpl_PublicNew") {
  send({
    id: "dpl_PublicNew",
    projectId: publicProjectId,
    name: "trendsfast",
    meta: { githubCommitSha: sha },
    plan: "hobby",
    target: "production",
    readyState: "READY",
    url: "trendsfast-public-new.vercel.app",
    regions: ["fra1"],
    crons: [{ path: "/api/cron/monitoring", schedule: "0 7 * * *" }],
    config: { functionType: "fluid", functionTimeout: 300 },
    autoAssignCustomDomains: false,
    alias: [],
    automaticAliases: [],
  });
} else if (args[0] === "api" && args[1] === "/v13/deployments/dpl_OpsNew") {
  const aliases = process.env.HARNESS_OPS_ALIAS_MODE === "rejected"
    ? ["trendsfast-ops.vercel.app", "unrelated-project.vercel.app"]
    : ["trendsfast-ops.vercel.app"];
  send({
    id: "dpl_OpsNew",
    projectId: opsProjectId,
    name: "trendsfast-ops",
    meta: { githubCommitSha: sha },
    plan: "hobby",
    target: "production",
    readyState: "READY",
    url: "trendsfast-ops-new.vercel.app",
    regions: ["fra1"],
    crons: [],
    config: { functionType: "fluid", functionTimeout: 300 },
    alias: aliases,
    automaticAliases: ["trendsfast-ops-git-main-team.vercel.app"],
  });
} else {
  process.exit(91);
}
`,
    );

    const harnessEnvironment: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      NODE_PATH: join(repositoryRoot, "node_modules"),
      TMPDIR: temporaryDirectory,
      HARNESS_ROOT: root,
      HARNESS_SHA: acceptedSha,
      HARNESS_SECRET: redactionCanary,
      HARNESS_TARGET: options.target,
      HARNESS_STALE_CRON_READS: String(options.staleCronReads ?? 1),
      HARNESS_OPS_ALIAS_MODE: options.opsAliasMode ?? "accepted",
      HARNESS_FAIL_OPS_ATTESTATION: String(options.failOpsAttestation ?? false),
      HARNESS_VERCEL_VERSION: options.vercelVersion ?? "58.0.0",
      HARNESS_GIT_IGNORED_PATH: options.gitIgnoredPath ?? "",
    };
    delete harnessEnvironment.VERCEL_ORG_ID;
    delete harnessEnvironment.VERCEL_PROJECT_ID;
    delete harnessEnvironment.VERCEL_TEAM_ID;
    if (options.ambientProjectOverride) {
      harnessEnvironment.VERCEL_ORG_ID = "team_Attacker";
      harnessEnvironment.VERCEL_PROJECT_ID = "prj_Attacker";
    }
    if (options.ambientTeamOverride) harnessEnvironment.VERCEL_TEAM_ID = "";

    const result = spawnSync(
      "/bin/bash",
      [options.target === "public" ? publicScriptPath : opsScriptPath],
      {
        cwd: root,
        encoding: "utf8",
        env: harnessEnvironment,
        timeout: 30_000,
      },
    );
    const counterPath = join(state, "cron-read-count");
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      cronReadCount: statSync(counterPath, { throwIfNoEntry: false })
        ? Number(readFileSync(counterPath, "utf8"))
        : 0,
      sleepLog: statSync(join(state, "sleep.log"), { throwIfNoEntry: false })
        ? readFileSync(join(state, "sleep.log"), "utf8")
        : "",
      vercelLog: statSync(join(state, "vercel.log"), { throwIfNoEntry: false })
        ? readFileSync(join(state, "vercel.log"), "utf8")
        : "",
      restoredLink: readFileSync(join(vercelDirectory, "project.json"), "utf8"),
      restoredReadme: readFileSync(join(vercelDirectory, "README.txt"), "utf8"),
      originalLink,
      originalReadme,
      release: JSON.parse(readFileSync(join(privateDirectory, "hobby-release.json"), "utf8")) as {
        publicDeploymentHost?: string;
        publicDeploymentId?: string;
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function embeddedEnvironmentNames(script: string): string[] {
  const match = /readonly expected_environment_names='([\s\S]*?)'\n/u.exec(script);
  if (!match?.[1]) throw new Error("missing embedded environment allowlist");
  return match[1].split("\n");
}

describe("founder-only Hobby deployment scripts", () => {
  it("pins the exact public Hobby cron contract and leaves Pro at its paid cadence", () => {
    const hobby = JSON.parse(
      readFileSync(join(repositoryRoot, "apps/web/vercel.hobby.json"), "utf8"),
    );
    const pro = JSON.parse(readFileSync(join(repositoryRoot, "apps/web/vercel.pro.json"), "utf8"));
    expect(hobby).toEqual({
      $schema: "https://openapi.vercel.sh/vercel.json",
      git: { deploymentEnabled: { main: false } },
      regions: ["fra1"],
      crons: [{ path: "/api/cron/monitoring", schedule: "0 7 * * *" }],
    });
    expect(pro).toEqual({
      $schema: "https://openapi.vercel.sh/vercel.json",
      crons: [{ path: "/api/cron/monitoring", schedule: "*/10 * * * *" }],
    });
  });

  it("keeps the separate Hobby ops surface cron-free", () => {
    const ops = JSON.parse(readFileSync(join(repositoryRoot, "apps/web/vercel.ops.json"), "utf8"));
    expect(ops).toEqual({
      $schema: "https://openapi.vercel.sh/vercel.json",
      git: { deploymentEnabled: { main: false } },
      regions: ["fra1"],
    });
  });

  it("selects tracked root profiles without changing the accepted worktree", () => {
    const hobby = JSON.parse(
      readFileSync(join(repositoryRoot, "apps/web/vercel.hobby.json"), "utf8"),
    );
    const ops = JSON.parse(readFileSync(join(repositoryRoot, "apps/web/vercel.ops.json"), "utf8"));
    const pro = JSON.parse(readFileSync(join(repositoryRoot, "apps/web/vercel.pro.json"), "utf8"));
    expect(resolveVercelConfig(undefined)).toEqual(ops);
    expect(resolveVercelConfig("ops")).toEqual(ops);
    expect(resolveVercelConfig("staged")).toEqual(ops);
    expect(resolveVercelConfig("public")).toEqual(hobby);
    expect(resolveVercelConfig("pro")).toEqual(pro);
    expect(() => resolveVercelConfig("unexpected")).toThrow(
      "TRENDSFAST_VERCEL_CONFIG_PROFILE must be public, staged, ops, pro, or unset",
    );
  });

  it("keeps both executable scripts syntactically valid and free of xtrace", () => {
    expect(statSync(publicScriptPath).mode & 0o111).not.toBe(0);
    expect(statSync(opsScriptPath).mode & 0o111).not.toBe(0);
    expect(spawnSync("/bin/bash", ["-n", publicScriptPath]).status).toBe(0);
    expect(spawnSync("/bin/bash", ["-n", opsScriptPath]).status).toBe(0);
    expect(publicScript).not.toMatch(/^[ \t]*set[ \t]+-x/mu);
    expect(opsScript).not.toMatch(/^[ \t]*set[ \t]+-x/mu);
  });

  it("rejects ambient Vercel project overrides before any founder workflow", () => {
    for (const script of [publicScript, opsScript]) {
      expect(script).toContain(
        '[[ "${VERCEL_ORG_ID+x}" != "x" && "${VERCEL_PROJECT_ID+x}" != "x" && "${VERCEL_TEAM_ID+x}" != "x" ]] || fail "ambient Vercel project overrides are not allowed"',
      );
    }

    const result = runDeployHarness({ target: "public", ambientProjectOverride: true });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("FAIL: ambient Vercel project overrides are not allowed\n");
    expect(result.stderr).not.toContain(redactionCanary);

    const definedEmptyTeam = runDeployHarness({ target: "ops", ambientTeamOverride: true });
    expect(definedEmptyTeam.status).not.toBe(0);
    expect(definedEmptyTeam.stdout).toBe("");
    expect(definedEmptyTeam.stderr).toBe(
      "FAIL: ambient Vercel project overrides are not allowed\n",
    );
    expect(definedEmptyTeam.stderr).not.toContain(redactionCanary);
  }, 30_000);

  it("pins Vercel CLI 58.0.0 before authentication or deployment", () => {
    for (const script of [publicScript, opsScript]) {
      expect(script).toContain('vercel_version="$(vercel --version 2>"$command_log")"');
      expect(script).toContain('[[ "$vercel_version" == "58.0.0" ]]');
      expect(script.indexOf("vercel --version")).toBeLessThan(script.indexOf("vercel whoami"));
    }

    const result = runDeployHarness({ target: "public", vercelVersion: "58.0.1" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("FAIL: the founder deploy requires Vercel CLI 58.0.0\n");
    expect(result.vercelLog).toBe('["--version"]\n');
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("checks every Git-ignored path against the effective Vercel upload matcher", () => {
    for (const script of [publicScript, opsScript]) {
      expect(script).toContain(
        'git ls-files --others --ignored --exclude-standard -z >"$ignored_path_report"',
      );
      expect(script).toContain('const ignore = require("ignore")');
      expect(script).toContain("metadata.size > 16 * 1024 * 1024");
      expect(script).toContain("matcher.ignores(path)");
      expect(script.indexOf("assert_git_ignored_upload_boundary")).toBeLessThan(
        script.indexOf("TRENDSFAST_VERCEL_CONFIG_PROFILE="),
      );
    }

    const result = runDeployHarness({ target: "public", gitIgnoredPath: "global-private.txt" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "FAIL: a Git-ignored local path is not excluded from the Vercel upload boundary\n",
    );
    expect(result.vercelLog).not.toContain('"deploy"');
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("pins the exact remote environment name sets without privileged database or Stripe secrets", () => {
    expect(embeddedEnvironmentNames(publicScript)).toEqual(publicEnvironmentNames);
    expect(embeddedEnvironmentNames(opsScript)).toEqual(opsEnvironmentNames);
    expect([...publicEnvironmentNames].sort()).toEqual([...HOBBY_PUBLIC_ALLOWLIST].sort());
    expect([...opsEnvironmentNames].sort()).toEqual([...HOBBY_OPS_ALLOWLIST].sort());

    for (const script of [publicScript, opsScript]) {
      for (const forbidden of [
        "DIRECT_DATABASE_URL",
        "ROLE_ADMIN_DATABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
      ]) {
        expect(embeddedEnvironmentNames(script)).not.toContain(forbidden);
      }
    }
    expect(embeddedEnvironmentNames(publicScript)).not.toContain("OPS_TOKEN");
    for (const forbidden of [
      "DATABASE_URL",
      "AUTH_DATABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "TURNSTILE_SECRET_KEY",
      "CRON_SECRET",
    ]) {
      expect(embeddedEnvironmentNames(opsScript)).not.toContain(forbidden);
    }
  });

  it("requires Vercel Authentication on the founder-only ops project", () => {
    expect(opsScript).toContain(
      'project.ssoProtection?.deploymentType === "all_except_custom_domains"',
    );
  });

  it("fails closed unless the pinned team is Hobby and ops has no custom domain", () => {
    for (const script of [publicScript, opsScript]) {
      expect(script).toContain('vercel api "/v2/teams/${team_id}" --raw');
      expect(script).toContain('team.billing?.plan === "hobby"');
    }
    expect(opsScript).toContain(
      'vercel api "/v9/projects/${ops_project_id}/domains?limit=100&teamId=${team_id}" --raw',
    );
    expect(opsScript).toContain(
      "the ops project must have only its verified generated Vercel domain and no custom domain",
    );
    expect(opsScript).toContain("aliases.every(expectedOpsAlias)");
    expect(opsScript).toContain("aliases.includes(expectedAlias)");
    expect(publicScript).toContain("report.autoAssignCustomDomains !== true");
    expect(publicScript).toContain("report.alias.length === 0");
    expect(publicScript).toContain("report.automaticAliases.length === 0");
  });

  it("uses only the two reviewed deploy commands and never promotes or mutates domains", () => {
    expect(publicScript).toContain(
      "vercel deploy --prod --skip-domain --yes -A apps/web/vercel.hobby.json",
    );
    expect(opsScript).toContain("vercel deploy --prod --yes -A apps/web/vercel.ops.json");
    for (const script of [publicScript, opsScript]) {
      expect(script).not.toMatch(/vercel[ \t]+promote/u);
      expect(script).not.toMatch(/vercel[ \t]+(?:domains?|alias)[ \t]/u);
      expect(script).not.toMatch(/^[ \t]*stripe[ \t]/mu);
    }
  });

  it("reads back the exact project-level cron state after each new deployment", () => {
    expect(
      publicScript.match(/vercel api "\/v9\/projects\/\$\{public_project_id\}" --raw/gu),
    ).toHaveLength(2);
    expect(publicScript).toContain("crons.deploymentId === process.argv[3]");
    expect(publicScript).toContain("crons.disabledAt === null");
    expect(publicScript).toContain("definitions.length === 1");
    expect(publicScript).toContain('definitions[0]?.path === "/api/cron/monitoring"');
    expect(publicScript).toContain('definitions[0]?.schedule === "0 7 * * *"');

    expect(
      opsScript.match(/vercel api "\/v9\/projects\/\$\{ops_project_id\}" --raw/gu),
    ).toHaveLength(2);
    expect(opsScript).toContain("const noRegistration = crons === undefined");
    expect(opsScript).toContain("const emptyCronDefinitionSet =");
    expect(opsScript).toContain("crons.definitions.length === 0");
    expect(opsScript).toContain("crons.deploymentId === process.argv[3]");
    expect(opsScript).toContain(
      "project.id === process.argv[2] && (noRegistration || emptyCronDefinitionSet)",
    );
    expect(opsScript).toContain('"$postdeploy_project_report" "$ops_project_id" "$deployment_id"');
    for (const script of [publicScript, opsScript]) {
      expect(script).toContain("readonly cron_readback_attempts=6");
      expect(script).toContain("readonly cron_readback_delay_seconds=2");
      expect(script).toContain("cron_readback_attempt <= cron_readback_attempts");
      expect(script).toContain('sleep "$cron_readback_delay_seconds"');
      expect(script).toContain('if [[ "$cron_state_verified" != "true" ]]');
    }
  });

  it("tolerates stale public V9 cron state and accepts only the new deployment registration", () => {
    const result = runDeployHarness({
      target: "public",
      staleCronReads: 1,
      gitIgnoredPath: ".env.private",
    });
    expect(result.status).toBe(0);
    expect(result.cronReadCount).toBe(2);
    expect(result.sleepLog).toBe("2\n");
    expect(result.stdout).toBe(
      "Deployment URL: https://trendsfast-public-new.vercel.app\nDeployment ID: dpl_PublicNew\n",
    );
    expect(result.release).toMatchObject({
      publicDeploymentHost: "trendsfast-public-new.vercel.app",
      publicDeploymentId: "dpl_PublicNew",
    });
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("bounds public cron polling and reports only a fixed safe failure", () => {
    const result = runDeployHarness({ target: "public", staleCronReads: 99 });
    expect(result.status).not.toBe(0);
    expect(result.cronReadCount).toBe(6);
    expect(result.sleepLog).toBe("2\n".repeat(5));
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "FAIL: the public project did not register the exact active Hobby cron for the new deployment\n",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("accepts only pinned ops aliases, polls away stale cron state, and restores the public link", () => {
    const result = runDeployHarness({ target: "ops", staleCronReads: 1 });
    expect(result.status).toBe(0);
    expect(result.cronReadCount).toBe(2);
    expect(result.sleepLog).toBe("2\n");
    expect(result.restoredLink).toBe(result.originalLink);
    expect(result.restoredReadme).toBe(result.originalReadme);
    expect(result.stdout).toBe(
      "Deployment URL: https://trendsfast-ops.vercel.app\nDeployment ID: dpl_OpsNew\n",
    );
    expect(result.stdout).not.toContain("trendsfast-ops-new.vercel.app");
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("rejects an unrelated ops alias without leaking responses and restores the public link", () => {
    const result = runDeployHarness({
      target: "ops",
      staleCronReads: 0,
      opsAliasMode: "rejected",
    });
    expect(result.status).not.toBe(0);
    expect(result.restoredLink).toBe(result.originalLink);
    expect(result.restoredReadme).toBe(result.originalReadme);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "FAIL: the ops deployment provenance does not match the accepted SHA and pinned project\n",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("restores the public link when an ops predeploy proof fails after relinking", () => {
    const result = runDeployHarness({ target: "ops", failOpsAttestation: true });
    expect(result.status).not.toBe(0);
    expect(result.cronReadCount).toBe(0);
    expect(result.restoredLink).toBe(result.originalLink);
    expect(result.restoredReadme).toBe(result.originalReadme);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("FAIL: the ops Production environment attestation did not pass\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("works around CLI 58 root-config precedence without dirtying the accepted SHA", () => {
    expect(publicScript).toContain(
      "TRENDSFAST_VERCEL_CONFIG_PROFILE=public vercel deploy --prod --skip-domain --yes -A apps/web/vercel.hobby.json",
    );
    expect(opsScript).toContain(
      "TRENDSFAST_VERCEL_CONFIG_PROFILE=ops vercel deploy --prod --yes -A apps/web/vercel.ops.json",
    );
    for (const script of [publicScript, opsScript]) {
      expect(script).not.toContain('cp -p -- "$deployment_config"');
      expect(script).toContain('[[ -z "$(git status --porcelain --untracked-files=normal)" ]]');
      expect(script).toContain("report.meta?.githubCommitSha === process.argv[5]");
      expect(script).toContain('report.config?.functionType === "fluid"');
      expect(script).toContain("report.config?.functionTimeout === 300");
    }
  });

  it("chains verified public provenance into ops and restores the public link", () => {
    expect(publicScript).toContain("publicDeploymentHost");
    expect(publicScript).toContain("publicDeploymentId");
    expect(publicScript).toContain("fs.renameSync(temporary, target)");
    expect(opsScript).toContain(
      'pnpm --silent env:update-ops-provenance -- "$public_deployment_host" "$public_deployment_id"',
    );
    expect(opsScript).toContain('vercel api "/v13/deployments/${public_deployment_id}" --raw');
    expect(opsScript).toContain("deployment.meta?.githubCommitSha === process.argv[5]");
    expect(opsScript).not.toMatch(/vercel env add PUBLIC_DEPLOYMENT_(?:HOST|ID)/u);
    expect(opsScript).toContain("trap cleanup EXIT");
    expect(opsScript).toContain("restore_public_link || fail");
    expect(opsScript).toContain('cmp -s -- "$public_link_backup" .vercel/project.json');
    expect(opsScript).toContain("aliases.includes(expectedAlias)");
    expect(opsScript).toContain("printf 'Deployment URL: https://%s\\n' \"$ops_generated_domain\"");
  });

  it("uses value-bound environment attestations as the final predeploy proof", () => {
    const publicCheck = "pnpm --silent env:import-production --check";
    const opsApply = "pnpm --silent env:import-ops --apply";
    const opsCheck = "pnpm --silent env:import-ops --check";

    expect(publicScript).toContain(publicCheck);
    expect(publicScript.indexOf(publicCheck)).toBeLessThan(
      publicScript.indexOf("TRENDSFAST_VERCEL_CONFIG_PROFILE=public vercel deploy"),
    );
    expect(opsScript).toContain(opsApply);
    expect(opsScript).toContain(opsCheck);
    expect(opsScript.indexOf(opsApply)).toBeLessThan(opsScript.indexOf(opsCheck));
    expect(opsScript.indexOf(opsCheck)).toBeLessThan(
      opsScript.indexOf("TRENDSFAST_VERCEL_CONFIG_PROFILE=ops vercel deploy"),
    );
  });

  it("fails closed on the public Turnstile credential preflight before the deploy fence", () => {
    const turnstileCheck = "pnpm --silent turnstile:verify-production";
    const cleanFence = '[[ -z "$(git status --porcelain --untracked-files=normal)" ]]';

    expect(publicScript).toContain(turnstileCheck);
    expect(publicScript.indexOf(turnstileCheck)).toBeLessThan(publicScript.lastIndexOf(cleanFence));
    expect(publicScript).toContain(
      'pnpm --silent turnstile:verify-production >"$command_log" 2>&1',
    );
    expect(opsScript).not.toContain(turnstileCheck);
  });
});

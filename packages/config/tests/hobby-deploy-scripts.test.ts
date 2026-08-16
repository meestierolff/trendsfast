import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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

function readOptionalHarnessFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

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
const acceptedBranch = "sol/hobby-launch-dogfood";
const redactionCanary = "harness-secret-must-not-leak";

type GitMetadataMode = "accepted" | "missing" | "mismatched";
const gitMetadataFields = [
  "githubDeployment",
  "githubCommitSha",
  "githubCommitRef",
  "githubCommitRepo",
  "githubCommitOrg",
] as const;
type GitMetadataField = (typeof gitMetadataFields)[number];

type DeployHarnessOptions = {
  target: "public" | "ops";
  staleCronReads?: number;
  opsAliasMode?: "accepted" | "rejected";
  publicAliasMode?: "accepted" | "rejected";
  publicStableOriginMode?: "accepted" | "reassigned";
  effectiveConfigMode?: "accepted" | "missing" | "mismatched" | "malformed" | "oversized";
  preexistingEffectiveConfig?: "matching" | "leaf-symlink" | "parent-symlink";
  failOpsAttestation?: boolean;
  initialLinkMode?: "accepted" | "project-symlink" | "readme-symlink";
  ambientProjectOverride?: boolean;
  ambientTeamOverride?: boolean;
  autoExposeSystemEnvs?: boolean;
  publicCronEnabledAt?: "accepted" | "missing" | "zero";
  preexistingPublicAttempt?: boolean;
  preexistingPriorPublicAttempt?: boolean;
  publicPredecessor?: boolean;
  vercelVersion?: string;
  gitIgnoredPath?: string;
  acceptedPublicGitMetadataMode?: GitMetadataMode;
  acceptedPublicGitMetadataField?: GitMetadataField;
  newDeploymentGitMetadataMode?: GitMetadataMode;
  newDeploymentGitMetadataField?: GitMetadataField;
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
  const releaseEvidenceDirectory = join(privateDirectory, "release-evidence");
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
  const expectedOpsLink = `${JSON.stringify({
    projectName: "trendsfast-ops",
    projectId: "prj_EYAjX2Nyd1jUXSjfWVTVoI320nnU",
    orgId: "team_UVAUfp4G8CmlSNPI9w5FasKj",
  })}\n`;
  const originalReadme = "pinned public link\n";
  const originalGitignore = ".vercel/\n.env.*\n!.env.example\n";
  const originalEnvLocal = "LOCAL_SENTINEL=preserve-byte-for-byte\n";
  const publicPredecessorDeploymentId = options.publicPredecessor ? "dpl_PublicPrevious" : "none";

  try {
    for (const directory of [
      bin,
      state,
      privateDirectory,
      releaseEvidenceDirectory,
      vercelDirectory,
      webDirectory,
      temporaryDirectory,
    ]) {
      mkdirSync(directory, { recursive: true });
    }
    chmodSync(privateDirectory, 0o700);
    chmodSync(releaseEvidenceDirectory, 0o700);

    writeFileSync(join(vercelDirectory, "project.json"), originalLink);
    writeFileSync(join(vercelDirectory, "README.txt"), originalReadme);
    chmodSync(join(vercelDirectory, "project.json"), 0o644);
    chmodSync(join(vercelDirectory, "README.txt"), 0o644);
    if (options.initialLinkMode === "project-symlink") {
      const target = join(state, "public-project-link.json");
      writeFileSync(target, originalLink);
      rmSync(join(vercelDirectory, "project.json"));
      symlinkSync(target, join(vercelDirectory, "project.json"));
    } else if (options.initialLinkMode === "readme-symlink") {
      const target = join(state, "public-link-readme.txt");
      writeFileSync(target, originalReadme);
      rmSync(join(vercelDirectory, "README.txt"));
      symlinkSync(target, join(vercelDirectory, "README.txt"));
    }
    writeFileSync(join(root, ".gitignore"), originalGitignore);
    writeFileSync(join(root, ".env.local"), originalEnvLocal, { mode: 0o600 });
    chmodSync(join(root, ".env.local"), 0o600);
    writeFileSync(join(state, "original-gitignore"), originalGitignore);
    writeFileSync(join(root, ".vercelignore"), ".env*\n.vercel\nnode_modules\n");
    writeFileSync(
      join(privateDirectory, "hobby-release.json"),
      `${JSON.stringify(
        {
          version: 1,
          acceptedBranch,
          acceptedSha,
          ...(options.target === "ops"
            ? {
                publicDeploymentHost: "trendsfast-public-accepted.vercel.app",
                publicDeploymentId: "dpl_PublicAccepted",
              }
            : options.publicPredecessor
              ? {
                  publicDeploymentHost: "trendsfast-public-previous.vercel.app",
                  publicDeploymentId: publicPredecessorDeploymentId,
                }
              : {}),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    chmodSync(join(privateDirectory, "hobby-release.json"), 0o600);
    if (options.preexistingPublicAttempt) {
      writeFileSync(
        join(
          releaseEvidenceDirectory,
          `hobby-public-deployment-attempt-${acceptedSha}-${publicPredecessorDeploymentId}.json`,
        ),
        '{"version":1,"state":"attempt_reserved"}\n',
        { mode: 0o600 },
      );
    }
    if (options.preexistingPriorPublicAttempt) {
      writeFileSync(
        join(releaseEvidenceDirectory, `hobby-public-deployment-attempt-${acceptedSha}-none.json`),
        '{"version":1,"state":"accepted"}\n',
        { mode: 0o600 },
      );
    }
    writeFileSync(
      join(webDirectory, "vercel.hobby.json"),
      '{"$schema":"https://openapi.vercel.sh/vercel.json","git":{"deploymentEnabled":{"main":false}},"regions":["fra1"],"crons":[{"path":"/api/cron/monitoring","schedule":"0 7 * * *"}]}\n',
    );
    writeFileSync(
      join(webDirectory, "vercel.ops.json"),
      '{"$schema":"https://openapi.vercel.sh/vercel.json","git":{"deploymentEnabled":{"main":false}},"regions":["fra1"]}\n',
    );
    const selectedProfile = readFileSync(
      join(webDirectory, options.target === "public" ? "vercel.hobby.json" : "vercel.ops.json"),
      "utf8",
    );
    const effectiveConfigDirectory = join(webDirectory, ".vercel");
    const effectiveConfigPath = join(effectiveConfigDirectory, "vercel.json");
    if (options.preexistingEffectiveConfig === "parent-symlink") {
      const symlinkTarget = join(state, "effective-config-directory");
      mkdirSync(symlinkTarget);
      symlinkSync(symlinkTarget, effectiveConfigDirectory);
    } else if (options.preexistingEffectiveConfig) {
      mkdirSync(effectiveConfigDirectory);
      if (options.preexistingEffectiveConfig === "leaf-symlink") {
        const symlinkTarget = join(state, "effective-vercel.json");
        writeFileSync(symlinkTarget, selectedProfile);
        symlinkSync(symlinkTarget, effectiveConfigPath);
      } else {
        writeFileSync(effectiveConfigPath, selectedProfile);
      }
    }
    writeFileSync(join(state, "public-environment.json"), JSON.stringify(publicEnvironmentNames));
    writeFileSync(join(state, "ops-environment.json"), JSON.stringify(opsEnvironmentNames));

    writeExecutable(
      join(bin, "git"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const root = process.env.HARNESS_ROOT;
const sha = process.env.HARNESS_SHA;
if (args[0] === "rev-parse" && args[1] === "--show-toplevel") process.stdout.write(root + "\\n");
else if (args[0] === "status") {
  const expected = fs.readFileSync(path.join(root, ".harness", "original-gitignore"), "utf8");
  const actual = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  if (actual !== expected) process.stdout.write(" M .gitignore\\n");
}
else if (args[0] === "symbolic-ref") process.stdout.write(process.env.HARNESS_BRANCH + "\\n");
else if (args[0] === "fetch") process.exit(0);
else if (args[0] === "check-ignore") process.exit(0);
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
if (args.includes("env:import-ops") && args.includes("--check")) {
  fs.copyFileSync(
    path.join(process.env.HARNESS_ROOT, ".vercel", "project.json"),
    path.join(process.env.HARNESS_ROOT, ".harness", "ops-check-project.json"),
  );
}
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
const branch = process.env.HARNESS_BRANCH;
const teamId = "team_UVAUfp4G8CmlSNPI9w5FasKj";
const publicProjectId = "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC";
const opsProjectId = "prj_EYAjX2Nyd1jUXSjfWVTVoI320nnU";
const deployedMarker = path.join(state, "deployed");
fs.appendFileSync(path.join(state, "vercel.log"), JSON.stringify(args) + "\\n");
process.stderr.write(process.env.HARNESS_SECRET + "\\n");
const send = (value) => process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
const gitMetadata = (mode, field) => {
  const accepted = {
    githubDeployment: "1",
    githubCommitSha: sha,
    githubCommitRef: branch,
    githubCommitRepo: "trendsfast",
    githubCommitOrg: "meestierolff",
  };
  if (mode === "missing") {
    delete accepted[field];
    return accepted;
  }
  if (mode === "mismatched") {
    accepted[field] = "mismatched";
  }
  return accepted;
};
const publicProject = () => ({
  id: publicProjectId,
  name: "trendsfast",
  accountId: teamId,
  rootDirectory: "apps/web",
  framework: "nextjs",
  link: { productionBranch: "main" },
  autoExposeSystemEnvs: process.env.HARNESS_AUTO_EXPOSE_SYSTEM_ENVS === "true",
  defaultResourceConfig: { fluid: true, functionDefaultTimeout: 300 },
  resourceConfig: { fluid: true },
});
const opsProject = () => ({
  id: opsProjectId,
  name: "trendsfast-ops",
  accountId: teamId,
  rootDirectory: "apps/web",
  framework: "nextjs",
  autoExposeSystemEnvs: process.env.HARNESS_AUTO_EXPOSE_SYSTEM_ENVS === "true",
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
  fs.appendFileSync(path.join(root, ".gitignore"), ".vercel\\n.env*\\n");
  fs.writeFileSync(path.join(root, ".env.local"), "LOCAL_SENTINEL=mutated-by-vercel-link\\n");
  fs.writeFileSync(path.join(root, ".vercel", "project.json"), JSON.stringify({ projectName: "trendsfast-ops", projectId: opsProjectId, orgId: teamId }));
  fs.writeFileSync(path.join(root, ".vercel", "README.txt"), "mutated ops link\\n");
  send("linked\\n");
} else if (args[0] === "deploy") {
  fs.copyFileSync(path.join(root, ".vercel", "project.json"), path.join(state, "deploy-project.json"));
  if (process.env.HARNESS_EFFECTIVE_CONFIG_MODE !== "missing") {
    const compiledDirectory = path.join(root, "apps", "web", ".vercel");
    fs.mkdirSync(compiledDirectory, { recursive: true });
    const compiledPath = path.join(compiledDirectory, "vercel.json");
    if (process.env.HARNESS_EFFECTIVE_CONFIG_MODE === "malformed") {
      fs.writeFileSync(compiledPath, "{");
    } else if (process.env.HARNESS_EFFECTIVE_CONFIG_MODE === "oversized") {
      fs.writeFileSync(compiledPath, "x".repeat(65 * 1024));
    } else {
      const profile = target === "public" ? "vercel.hobby.json" : "vercel.ops.json";
      const compiled = JSON.parse(fs.readFileSync(path.join(root, "apps", "web", profile), "utf8"));
      if (process.env.HARNESS_EFFECTIVE_CONFIG_MODE === "mismatched") compiled.regions = ["iad1"];
      fs.writeFileSync(compiledPath, JSON.stringify(compiled));
    }
  }
  fs.writeFileSync(deployedMarker, target);
  send(target === "public" ? "https://trendsfast-public-new.vercel.app\\n" : "https://trendsfast-ops-new.vercel.app\\n");
} else if (args[0] === "inspect") {
  if (args[1] === "https://trendsfast.vercel.app") {
    const reassigned = fs.existsSync(deployedMarker) && process.env.HARNESS_PUBLIC_STABLE_ORIGIN_MODE === "reassigned";
    send({ id: reassigned ? "dpl_PublicNew" : "dpl_PublicCurrent", name: "trendsfast", readyState: "READY", target: "production", url: "trendsfast-current.vercel.app" });
  } else if (target === "public") {
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
      ...(process.env.HARNESS_PUBLIC_CRON_ENABLED_AT === "missing"
        ? {}
        : { enabledAt: process.env.HARNESS_PUBLIC_CRON_ENABLED_AT === "zero" ? 0 : 1 }),
      definitions: stale
        ? [{ path: "/api/cron/monitoring", schedule: "*/10 * * * *" }]
        : [{ path: "/api/cron/monitoring", schedule: "0 7 * * *" }],
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
  send({ id: "dpl_PublicAccepted", projectId: publicProjectId, name: "trendsfast", meta: gitMetadata(process.env.HARNESS_ACCEPTED_PUBLIC_GIT_METADATA_MODE, process.env.HARNESS_ACCEPTED_PUBLIC_GIT_METADATA_FIELD), url: "trendsfast-public-accepted.vercel.app", plan: "hobby", target: "production", readyState: "READY" });
} else if (args[0] === "api" && args[1] === "/v13/deployments/dpl_PublicNew") {
  const aliases = process.env.HARNESS_PUBLIC_ALIAS_MODE === "rejected"
    ? ["trendsfast-clarios-projects-05f6a57e.vercel.app", "trendsfast-ops.vercel.app"]
    : ["trendsfast-clarios-projects-05f6a57e.vercel.app", "trendsfast-git-main-clarios-projects-05f6a57e.vercel.app"];
  send({
    id: "dpl_PublicNew",
    projectId: publicProjectId,
    name: "trendsfast",
    meta: gitMetadata(process.env.HARNESS_NEW_DEPLOYMENT_GIT_METADATA_MODE, process.env.HARNESS_NEW_DEPLOYMENT_GIT_METADATA_FIELD),
    plan: "hobby",
    target: "production",
    readyState: "READY",
    url: "trendsfast-public-new.vercel.app",
    regions: ["fra1"],
    crons: [{ path: "/api/cron/monitoring", schedule: "0 7 * * *" }],
    config: { functionType: "fluid", functionTimeout: 300 },
    autoAssignCustomDomains: false,
    alias: [aliases[0]],
    automaticAliases: [aliases[1]],
  });
} else if (args[0] === "api" && args[1] === "/v13/deployments/dpl_OpsNew") {
  const aliases = process.env.HARNESS_OPS_ALIAS_MODE === "rejected"
    ? ["trendsfast-ops.vercel.app", "unrelated-project.vercel.app"]
    : ["trendsfast-ops.vercel.app"];
  send({
    id: "dpl_OpsNew",
    projectId: opsProjectId,
    name: "trendsfast-ops",
    meta: gitMetadata(process.env.HARNESS_NEW_DEPLOYMENT_GIT_METADATA_MODE, process.env.HARNESS_NEW_DEPLOYMENT_GIT_METADATA_FIELD),
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
      HARNESS_BRANCH: acceptedBranch,
      HARNESS_SECRET: redactionCanary,
      HARNESS_TARGET: options.target,
      HARNESS_STALE_CRON_READS: String(options.staleCronReads ?? 1),
      HARNESS_OPS_ALIAS_MODE: options.opsAliasMode ?? "accepted",
      HARNESS_PUBLIC_ALIAS_MODE: options.publicAliasMode ?? "accepted",
      HARNESS_PUBLIC_STABLE_ORIGIN_MODE: options.publicStableOriginMode ?? "accepted",
      HARNESS_EFFECTIVE_CONFIG_MODE: options.effectiveConfigMode ?? "accepted",
      HARNESS_FAIL_OPS_ATTESTATION: String(options.failOpsAttestation ?? false),
      HARNESS_AUTO_EXPOSE_SYSTEM_ENVS: String(options.autoExposeSystemEnvs ?? true),
      HARNESS_PUBLIC_CRON_ENABLED_AT: options.publicCronEnabledAt ?? "accepted",
      HARNESS_VERCEL_VERSION: options.vercelVersion ?? "58.0.0",
      HARNESS_GIT_IGNORED_PATH: options.gitIgnoredPath ?? "",
      HARNESS_ACCEPTED_PUBLIC_GIT_METADATA_MODE:
        options.acceptedPublicGitMetadataMode ?? "accepted",
      HARNESS_ACCEPTED_PUBLIC_GIT_METADATA_FIELD:
        options.acceptedPublicGitMetadataField ?? "githubDeployment",
      HARNESS_NEW_DEPLOYMENT_GIT_METADATA_MODE: options.newDeploymentGitMetadataMode ?? "accepted",
      HARNESS_NEW_DEPLOYMENT_GIT_METADATA_FIELD:
        options.newDeploymentGitMetadataField ?? "githubDeployment",
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
      cronReadCount: Number(readOptionalHarnessFile(counterPath) || "0"),
      sleepLog: readOptionalHarnessFile(join(state, "sleep.log")),
      vercelLog: readOptionalHarnessFile(join(state, "vercel.log")),
      pnpmLog: readOptionalHarnessFile(join(state, "pnpm.log")),
      opsCheckLink: readOptionalHarnessFile(join(state, "ops-check-project.json")),
      deployedLink: readOptionalHarnessFile(join(state, "deploy-project.json")),
      restoredLink: readFileSync(join(vercelDirectory, "project.json"), "utf8"),
      restoredLinkMode: statSync(join(vercelDirectory, "project.json")).mode & 0o777,
      restoredReadme: readFileSync(join(vercelDirectory, "README.txt"), "utf8"),
      restoredReadmeMode: statSync(join(vercelDirectory, "README.txt")).mode & 0o777,
      restoredGitignore: readFileSync(join(root, ".gitignore"), "utf8"),
      restoredEnvLocal: readFileSync(join(root, ".env.local"), "utf8"),
      restoredEnvLocalMode: statSync(join(root, ".env.local")).mode & 0o777,
      publicDeploymentAttempt: readOptionalHarnessFile(
        join(
          releaseEvidenceDirectory,
          `hobby-public-deployment-attempt-${acceptedSha}-${publicPredecessorDeploymentId}.json`,
        ),
      ),
      publicDeploymentAttemptMode: (() => {
        try {
          return (
            statSync(
              join(
                releaseEvidenceDirectory,
                `hobby-public-deployment-attempt-${acceptedSha}-${publicPredecessorDeploymentId}.json`,
              ),
            ).mode & 0o777
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        }
      })(),
      priorPublicDeploymentAttempt: readOptionalHarnessFile(
        join(releaseEvidenceDirectory, `hobby-public-deployment-attempt-${acceptedSha}-none.json`),
      ),
      originalLink,
      originalLinkMode: 0o644,
      originalReadme,
      originalReadmeMode: 0o644,
      originalGitignore,
      originalEnvLocal,
      expectedOpsLink,
      release: JSON.parse(readFileSync(join(privateDirectory, "hobby-release.json"), "utf8")) as {
        publicDeploymentHost?: string;
        publicDeploymentId?: string;
      },
      effectiveConfig: readOptionalHarnessFile(join(webDirectory, ".vercel", "vercel.json")),
      selectedProfile,
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

function harnessCommandCalls(log: string): string[][] {
  return log
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function harnessMetaValues(calls: string[][]): string[] {
  return calls.flatMap((args) =>
    args.filter((_, index, currentArgs) => currentArgs[index - 1] === "--meta"),
  );
}

const expectedGitMetadataArguments = [
  "--meta",
  "githubDeployment=1",
  "--meta",
  `githubCommitSha=${acceptedSha}`,
  "--meta",
  `githubCommitRef=${acceptedBranch}`,
  "--meta",
  "githubCommitRepo=trendsfast",
  "--meta",
  "githubCommitOrg=meestierolff",
] as const;

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
    expect(resolveVercelConfig(undefined, "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC")).toEqual(hobby);
    expect(resolveVercelConfig(undefined, "prj_EYAjX2Nyd1jUXSjfWVTVoI320nnU")).toEqual(ops);
    expect(resolveVercelConfig("ops", "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC")).toEqual(ops);
    expect(resolveVercelConfig("staged", "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC")).toEqual(ops);
    expect(() => resolveVercelConfig(undefined, "prj_Unpinned")).toThrow(
      "VERCEL_PROJECT_ID does not identify a pinned TrendsFast project",
    );
    expect(() => resolveVercelConfig("public", "prj_Unpinned")).toThrow(
      "VERCEL_PROJECT_ID does not identify a pinned TrendsFast project",
    );
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

  it("rejects symlinked local Vercel link state before authentication or deployment", () => {
    const cases = [
      {
        initialLinkMode: "project-symlink" as const,
        failure: "FAIL: the public Vercel project link is missing or unsafe\n",
      },
      {
        initialLinkMode: "readme-symlink" as const,
        failure: "FAIL: the public Vercel project link README is unsafe\n",
      },
    ];

    for (const testCase of cases) {
      const result = runDeployHarness({ target: "ops", initialLinkMode: testCase.initialLinkMode });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(testCase.failure);
      expect(result.vercelLog).toBe('["--version"]\n');
      expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
    }
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
    expect(publicScript).toContain("report.autoAssignCustomDomains === false");
    expect(publicScript).toContain("report.alias.length === 1");
    expect(publicScript).toContain("report.automaticAliases.length === 1");
    expect(publicScript).toContain("aliases.every(expectedStagedAlias)");
    expect(publicScript).toContain('value !== "trendsfast.vercel.app"');
    expect(publicScript).toContain(
      "^trendsfast(?:-[a-z0-9]+)*-clarios-projects-05f6a57e\\.vercel\\.app$",
    );
  });

  it("requires build-time Vercel project identity on both pinned projects", () => {
    for (const script of [publicScript, opsScript]) {
      expect(script).toContain("project.autoExposeSystemEnvs === true");
    }

    for (const target of ["public", "ops"] as const) {
      const result = runDeployHarness({ target, autoExposeSystemEnvs: false });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        `FAIL: the ${target} Vercel project settings do not match the pinned Hobby contract\n`,
      );
      expect(harnessCommandCalls(result.vercelLog).filter((args) => args[0] === "deploy")).toEqual(
        [],
      );
      expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
    }
  }, 30_000);

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

  it("passes only the validated Git attestation through safely quoted Bash arrays", () => {
    const expectedArray = `deployment_git_metadata=(
  --meta "githubDeployment=1"
  --meta "githubCommitSha=\${accepted_sha}"
  --meta "githubCommitRef=\${accepted_branch}"
  --meta "githubCommitRepo=trendsfast"
  --meta "githubCommitOrg=meestierolff"
)`;
    for (const script of [publicScript, opsScript]) {
      expect(script).toContain(expectedArray);
      expect(script).toContain('"${deployment_git_metadata[@]}"');
      expect(script).not.toContain("${deployment_git_metadata[*]}");
      expect(script).not.toMatch(/(?<!["'])\$\{deployment_git_metadata\[@\]\}(?!["'])/u);
      expect(script).toContain('report.meta?.githubDeployment === "1"');
      expect(script).toContain("report.meta?.githubCommitSha === process.argv[5]");
      expect(script).toContain("report.meta?.githubCommitRef === process.argv[");
      expect(script).toContain('report.meta?.githubCommitRepo === "trendsfast"');
      expect(script).toContain('report.meta?.githubCommitOrg === "meestierolff"');
    }
    expect(opsScript).toContain('deployment.meta?.githubDeployment === "1"');
    expect(opsScript).toContain("deployment.meta?.githubCommitSha === process.argv[5]");
    expect(opsScript).toContain("deployment.meta?.githubCommitRef === process.argv[7]");
    expect(opsScript).toContain('deployment.meta?.githubCommitRepo === "trendsfast"');
    expect(opsScript).toContain('deployment.meta?.githubCommitOrg === "meestierolff"');

    const publicResult = runDeployHarness({ target: "public", staleCronReads: 0 });
    const opsResult = runDeployHarness({ target: "ops", staleCronReads: 0 });
    expect(publicResult.status).toBe(0);
    expect(opsResult.status).toBe(0);

    const publicCalls = harnessCommandCalls(publicResult.vercelLog);
    const opsCalls = harnessCommandCalls(opsResult.vercelLog);
    const publicDeploys = publicCalls.filter((args) => args[0] === "deploy");
    const opsDeploys = opsCalls.filter((args) => args[0] === "deploy");
    expect(publicDeploys).toHaveLength(1);
    expect(opsDeploys).toHaveLength(1);
    const [publicDeploy] = publicDeploys;
    const [opsDeploy] = opsDeploys;
    expect(publicDeploy).toEqual([
      "deploy",
      "--prod",
      "--skip-domain",
      "--yes",
      "-A",
      "apps/web/vercel.hobby.json",
      ...expectedGitMetadataArguments,
    ]);
    expect(opsDeploy).toEqual([
      "deploy",
      "--prod",
      "--yes",
      "-A",
      "apps/web/vercel.ops.json",
      ...expectedGitMetadataArguments,
    ]);
    expect(JSON.stringify([publicCalls, opsCalls])).not.toContain(redactionCanary);
    const expectedMetaValues = expectedGitMetadataArguments.filter((value) => value !== "--meta");
    const publicMetaValues = harnessMetaValues(publicCalls);
    const opsMetaValues = harnessMetaValues(opsCalls);
    expect(publicMetaValues).toEqual(expectedMetaValues);
    expect(opsMetaValues).toEqual(expectedMetaValues);
    for (const forbiddenName of [...publicEnvironmentNames, ...opsEnvironmentNames]) {
      expect(publicMetaValues.some((value) => value.startsWith(`${forbiddenName}=`))).toBe(false);
      expect(opsMetaValues.some((value) => value.startsWith(`${forbiddenName}=`))).toBe(false);
    }
  }, 30_000);

  it("rejects every missing or mismatched Git attestation field on both new deployments", () => {
    for (const target of ["public", "ops"] as const) {
      for (const newDeploymentGitMetadataMode of ["missing", "mismatched"] as const) {
        for (const newDeploymentGitMetadataField of gitMetadataFields) {
          const result = runDeployHarness({
            target,
            staleCronReads: 0,
            newDeploymentGitMetadataMode,
            newDeploymentGitMetadataField,
          });
          expect(result.status).not.toBe(0);
          expect(result.stdout).toBe("");
          expect(result.stderr).toBe(
            `FAIL: the ${target} deployment provenance does not match the accepted SHA and pinned project\n`,
          );
          expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
        }
      }
    }
  }, 120_000);

  it("rejects every missing or mismatched Git attestation field in the accepted public ops chain", () => {
    for (const acceptedPublicGitMetadataMode of ["missing", "mismatched"] as const) {
      for (const acceptedPublicGitMetadataField of gitMetadataFields) {
        const result = runDeployHarness({
          target: "ops",
          acceptedPublicGitMetadataMode,
          acceptedPublicGitMetadataField,
        });
        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "FAIL: the accepted public deployment does not match its project, host, SHA, and Hobby provenance\n",
        );
        expect(result.vercelLog).not.toContain('["deploy"');
        expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
      }
    }
  }, 120_000);

  it("rejects missing or mismatched effective deployment profiles after CLI compilation", () => {
    for (const target of ["public", "ops"] as const) {
      for (const effectiveConfigMode of [
        "missing",
        "mismatched",
        "malformed",
        "oversized",
      ] as const) {
        const result = runDeployHarness({ target, effectiveConfigMode });
        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          target === "public"
            ? "FAIL: the effective public deployment config did not match the reviewed Hobby profile\n"
            : "FAIL: the effective ops deployment config did not match the reviewed cron-free profile\n",
        );
        if (target === "public") {
          expect(JSON.parse(result.publicDeploymentAttempt)).toMatchObject({
            state: "url_captured",
            deploymentUrl: "https://trendsfast-public-new.vercel.app",
          });
          expect(result.publicDeploymentAttemptMode).toBe(0o600);
        }
        expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
      }
    }
  }, 60_000);

  it("cannot reuse a matching stale effective profile and restores the ignored file", () => {
    for (const target of ["public", "ops"] as const) {
      const result = runDeployHarness({
        target,
        effectiveConfigMode: "missing",
        preexistingEffectiveConfig: "matching",
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        target === "public"
          ? "FAIL: the effective public deployment config did not match the reviewed Hobby profile\n"
          : "FAIL: the effective ops deployment config did not match the reviewed cron-free profile\n",
      );
      expect(result.effectiveConfig).toBe(result.selectedProfile);
      expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
    }
  }, 30_000);

  it("rejects symlinked effective-config parents and leaves before deployment", () => {
    for (const target of ["public", "ops"] as const) {
      for (const preexistingEffectiveConfig of ["parent-symlink", "leaf-symlink"] as const) {
        const result = runDeployHarness({ target, preexistingEffectiveConfig });
        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          preexistingEffectiveConfig === "parent-symlink"
            ? "FAIL: the ignored effective deployment config directory is unsafe\n"
            : "FAIL: the ignored effective deployment config is unsafe\n",
        );
        expect(
          harnessCommandCalls(result.vercelLog).filter((args) => args[0] === "deploy"),
        ).toHaveLength(0);
        expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
      }
    }
  }, 30_000);

  it("reads back the exact public Hobby cron and cron-free ops state after each deployment", () => {
    expect(
      publicScript.match(/vercel api "\/v9\/projects\/\$\{public_project_id\}" --raw/gu),
    ).toHaveLength(2);
    expect(publicScript).toContain("report.crons.length === 1");
    expect(publicScript).toContain('report.crons[0]?.path === "/api/cron/monitoring"');
    expect(publicScript).toContain('report.crons[0]?.schedule === "0 7 * * *"');
    expect(publicScript).toContain(
      'readonly effective_deployment_config="apps/web/.vercel/vercel.json"',
    );
    expect(publicScript).toContain("isDeepStrictEqual(actual, expected)");
    expect(publicScript).toContain('rm -f -- "$effective_deployment_config"');
    expect(publicScript).toContain("crons.deploymentId === process.argv[3]");
    expect(publicScript).toContain("crons.disabledAt === null");
    expect(publicScript).toContain("Number.isSafeInteger(crons.enabledAt)");
    expect(publicScript).toContain("crons.enabledAt > 0");
    expect(publicScript).toContain("definitions.length === 1");
    expect(publicScript).toContain('definitions[0]?.path === "/api/cron/monitoring"');
    expect(publicScript).toContain('definitions[0]?.schedule === "0 7 * * *"');

    expect(
      opsScript.match(/vercel api "\/v9\/projects\/\$\{ops_project_id\}" --raw/gu),
    ).toHaveLength(2);
    expect(opsScript).toContain("const noRegistration = crons === undefined");
    expect(opsScript).toContain(
      'readonly effective_deployment_config="apps/web/.vercel/vercel.json"',
    );
    expect(opsScript).toContain("isDeepStrictEqual(actual, expected)");
    expect(opsScript).toContain('rm -f -- "$effective_deployment_config"');
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

  it("tolerates stale public V9 cron state and accepts only the new exact registration", () => {
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
    expect(JSON.parse(result.publicDeploymentAttempt)).toMatchObject({
      version: 1,
      state: "accepted",
      acceptedBranch,
      acceptedSha,
      projectId: "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC",
      predecessorDeploymentId: "none",
      deploymentUrl: "https://trendsfast-public-new.vercel.app",
      deploymentHost: "trendsfast-public-new.vercel.app",
      deploymentId: "dpl_PublicNew",
    });
    expect(result.publicDeploymentAttemptMode).toBe(0o600);
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
    expect(JSON.parse(result.publicDeploymentAttempt)).toMatchObject({
      state: "deployment_identified",
      deploymentId: "dpl_PublicNew",
    });
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("requires a positive scheduler enabledAt value for the staged public cron", () => {
    for (const publicCronEnabledAt of ["missing", "zero"] as const) {
      const result = runDeployHarness({
        target: "public",
        staleCronReads: 0,
        publicCronEnabledAt,
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "FAIL: the public project did not register the exact active Hobby cron for the new deployment\n",
      );
      expect(JSON.parse(result.publicDeploymentAttempt)).toMatchObject({
        state: "deployment_identified",
        deploymentId: "dpl_PublicNew",
      });
      expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
    }
  }, 30_000);

  it("blocks an unresolved attempt but permits the same SHA after its predecessor advances", () => {
    const result = runDeployHarness({ target: "public", preexistingPublicAttempt: true });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "FAIL: this accepted SHA already has a public deployment attempt requiring read-only reconciliation\n",
    );
    expect(result.vercelLog).toBe("");
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);

    const advancedPredecessor = runDeployHarness({
      target: "public",
      staleCronReads: 0,
      publicPredecessor: true,
      preexistingPriorPublicAttempt: true,
    });
    expect(advancedPredecessor.status).toBe(0);
    expect(advancedPredecessor.priorPublicDeploymentAttempt).toContain('"state":"accepted"');
    expect(JSON.parse(advancedPredecessor.publicDeploymentAttempt)).toMatchObject({
      state: "accepted",
      acceptedSha,
      predecessorDeploymentId: "dpl_PublicPrevious",
      deploymentId: "dpl_PublicNew",
    });
  }, 30_000);

  it("rejects an unrelated staged public alias without leaking the response", () => {
    const result = runDeployHarness({
      target: "public",
      staleCronReads: 0,
      publicAliasMode: "rejected",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "FAIL: the public deployment provenance does not match the accepted SHA and pinned project\n",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("proves that --skip-domain leaves the stable public origin on its prior deployment", () => {
    expect(publicScript).toContain('readonly public_generated_domain="trendsfast.vercel.app"');
    expect(publicScript).toContain(
      'vercel inspect "https://${public_generated_domain}" --format=json',
    );
    expect(publicScript).toContain("report.id === process.argv[2]");

    const accepted = runDeployHarness({ target: "public", staleCronReads: 0 });
    const stableReads = harnessCommandCalls(accepted.vercelLog).filter(
      (args) => args[0] === "inspect" && args[1] === "https://trendsfast.vercel.app",
    );
    expect(accepted.status).toBe(0);
    expect(stableReads).toHaveLength(2);

    const reassigned = runDeployHarness({
      target: "public",
      staleCronReads: 0,
      publicStableOriginMode: "reassigned",
    });
    expect(reassigned.status).not.toBe(0);
    expect(reassigned.stdout).toBe("");
    expect(reassigned.stderr).toBe(
      "FAIL: the staged deployment changed the stable public Vercel origin\n",
    );
    expect(`${reassigned.stdout}${reassigned.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("forwards exact ops provenance arguments, accepts only pinned aliases, and restores the public link", () => {
    const result = runDeployHarness({ target: "ops", staleCronReads: 1 });
    expect(result.status).toBe(0);
    expect(result.cronReadCount).toBe(2);
    expect(result.sleepLog).toBe("2\n");
    expect(result.opsCheckLink).toBe(result.expectedOpsLink);
    expect(result.deployedLink).toBe(result.expectedOpsLink);
    expect(result.restoredLink).toBe(result.originalLink);
    expect(result.restoredLinkMode).toBe(result.originalLinkMode);
    expect(result.restoredReadme).toBe(result.originalReadme);
    expect(result.restoredReadmeMode).toBe(result.originalReadmeMode);
    expect(result.restoredGitignore).toBe(result.originalGitignore);
    expect(result.restoredEnvLocal).toBe(result.originalEnvLocal);
    expect(result.restoredEnvLocalMode).toBe(0o600);
    expect(harnessCommandCalls(result.vercelLog).filter((args) => args[0] === "link")).toEqual([]);
    expect(result.stdout).toBe(
      "Deployment URL: https://trendsfast-ops.vercel.app\nDeployment ID: dpl_OpsNew\n",
    );
    expect(result.stdout).not.toContain("trendsfast-ops-new.vercel.app");
    expect(
      harnessCommandCalls(result.pnpmLog).filter((args) => args[1] === "env:update-ops-provenance"),
    ).toEqual([
      [
        "--silent",
        "env:update-ops-provenance",
        "trendsfast-public-accepted.vercel.app",
        "dpl_PublicAccepted",
      ],
    ]);
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("rejects an unrelated ops alias without leaking responses and restores the public link", () => {
    const result = runDeployHarness({
      target: "ops",
      staleCronReads: 0,
      opsAliasMode: "rejected",
    });
    expect(result.status).not.toBe(0);
    expect(result.opsCheckLink).toBe(result.expectedOpsLink);
    expect(result.deployedLink).toBe(result.expectedOpsLink);
    expect(result.restoredLink).toBe(result.originalLink);
    expect(result.restoredLinkMode).toBe(result.originalLinkMode);
    expect(result.restoredReadme).toBe(result.originalReadme);
    expect(result.restoredReadmeMode).toBe(result.originalReadmeMode);
    expect(result.restoredGitignore).toBe(result.originalGitignore);
    expect(result.restoredEnvLocal).toBe(result.originalEnvLocal);
    expect(result.restoredEnvLocalMode).toBe(0o600);
    expect(harnessCommandCalls(result.vercelLog).filter((args) => args[0] === "link")).toEqual([]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "FAIL: the ops deployment provenance does not match the accepted SHA and pinned project\n",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(redactionCanary);
  }, 30_000);

  it("restores the public link when an ops predeploy proof fails after installing the temporary ops link", () => {
    const result = runDeployHarness({ target: "ops", failOpsAttestation: true });
    expect(result.status).not.toBe(0);
    expect(result.cronReadCount).toBe(0);
    expect(result.opsCheckLink).toBe(result.expectedOpsLink);
    expect(result.deployedLink).toBe("");
    expect(result.restoredLink).toBe(result.originalLink);
    expect(result.restoredLinkMode).toBe(result.originalLinkMode);
    expect(result.restoredReadme).toBe(result.originalReadme);
    expect(result.restoredReadmeMode).toBe(result.originalReadmeMode);
    expect(result.restoredGitignore).toBe(result.originalGitignore);
    expect(result.restoredEnvLocal).toBe(result.originalEnvLocal);
    expect(result.restoredEnvLocalMode).toBe(0o600);
    expect(harnessCommandCalls(result.vercelLog).filter((args) => args[0] === "link")).toEqual([]);
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
      'pnpm --silent env:update-ops-provenance "$public_deployment_host" "$public_deployment_id"',
    );
    expect(opsScript).not.toMatch(/env:update-ops-provenance[ \t]+--(?:[ \t]|$)/u);
    expect(opsScript).not.toMatch(/\bvercel[ \t]+link\b/u);
    expect(opsScript).toContain('vercel api "/v13/deployments/${public_deployment_id}" --raw');
    expect(opsScript).toContain("deployment.meta?.githubCommitSha === process.argv[5]");
    expect(opsScript).not.toMatch(/vercel env add PUBLIC_DEPLOYMENT_(?:HOST|ID)/u);
    expect(opsScript).toContain("trap cleanup EXIT");
    expect(opsScript).toContain("const [target, projectName, projectId, orgId]");
    expect(opsScript).toContain("JSON.stringify({ projectName, projectId, orgId })");
    expect(opsScript).toContain('install_project_link "$ops_link_file" .vercel/project.json 600');
    expect(opsScript).toContain("fs.renameSync(temporary, target)");
    expect(opsScript).toContain('cmp -s -- "$ops_link_file" .vercel/project.json');
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

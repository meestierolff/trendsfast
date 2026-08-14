import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HOBBY_CANONICAL_PUBLIC_ORIGIN,
  HOBBY_DEFAULT_ENVIRONMENT_PHASE,
  HOBBY_ENVIRONMENT_PHASE_FIELD,
  HOBBY_ENVIRONMENT_PHASES,
  HOBBY_LOCAL_SUPABASE_REF_FIELD,
  HOBBY_OPS_ALLOWLIST,
  HOBBY_OPS_EFFECTS,
  HOBBY_PUBLIC_ALLOWLIST,
  HOBBY_PUBLIC_EFFECTS,
  HOBBY_PUBLIC_ORIGIN,
  HOBBY_SUPABASE_ORIGIN,
  HOBBY_SUPABASE_POOLER_HOST,
  HOBBY_SUPABASE_PROJECT_REF,
  HOBBY_VERCEL_ORG_ID,
  HOBBY_PROJECTS,
  HobbyEnvironmentError,
  buildHobbyEnvironmentPlan,
  createHobbyEnvironmentAttestation,
  executeHobbyEnvironmentImport,
  preflightHobbyEnvironmentImport,
  resolveHobbyEnvironmentPhase,
  verifyHobbyEnvironmentAttestation,
  type CommandResult,
  type HobbyRemoteEnvironmentSnapshot,
  type HobbyScanEnablementContext,
  type HobbySurface,
  type VercelCommandRunner,
} from "../../../scripts/hobby-environments";
import {
  HOBBY_ENVIRONMENT_ATTESTATION_PATHS,
  hobbyEnvironmentAttestationPath,
  readPrivateHobbyEnvironmentAttestation,
  writePrivateHobbyEnvironmentAttestation,
} from "../../../scripts/import-hobby-environment";
import {
  HOBBY_ACCEPTED_RELEASE_PATH,
  HOBBY_SCAN_ENABLEMENT_EVIDENCE_PATH,
  readPrivateHobbyScanEnablementContext,
} from "../../../scripts/hobby-scan-enablement";
import {
  applyReviewedHobbyEnvironmentPhase,
  resolveHobbyPublicDeploymentProvenance,
} from "../../../scripts/prepare-hobby-inventory";
import { PRODUCTION_SUPABASE_POOLER_HOST } from "../../database/src/production-target";

const syntheticTurnstileSiteKey = "synthetic-turnstile-site-key";
const acceptedSha = "a".repeat(40);

function runtimeDatabaseUrl(role: string, host: string = HOBBY_SUPABASE_POOLER_HOST): string {
  return `postgresql://${role}.${HOBBY_SUPABASE_PROJECT_REF}:synthetic-password@${host}:6543/postgres`;
}

function validScanEnablementContext(
  evidenceOverrides: Readonly<Record<string, unknown>> = {},
): HobbyScanEnablementContext {
  const release = {
    version: 1,
    acceptedBranch: "sol/hobby-launch-dogfood",
    acceptedSha,
    publicDeploymentHost: "trendsfast-public-tested.vercel.app",
    publicDeploymentId: "dpl_PublicTested123",
  };
  return {
    acceptedReleaseSource: `${JSON.stringify(release)}\n`,
    evidenceSource: `${JSON.stringify({
      schemaVersion: 1,
      acceptedSha,
      testedPublicDeploymentHost: release.publicDeploymentHost,
      testedPublicDeploymentId: release.publicDeploymentId,
      siteKeySha256: createHash("sha256").update(syntheticTurnstileSiteKey).digest("hex"),
      action: "public_scan",
      hostnames: ["trendsfast.vercel.app", "trendsfast.com", "www.trendsfast.com"],
      turnstileMatrix: {
        valid: "PASS",
        missing: "PASS",
        forged: "PASS",
        replayed: "PASS",
        expired: "PASS",
        wrongAction: "PASS",
        wrongHostname: "PASS",
      },
      dogfood: { halio: "PASS", shipToUsers: "PASS" },
      founderApproved: true,
      ...evidenceOverrides,
    })}\n`,
  };
}

function syntheticInventory(overrides: Readonly<Record<string, string>> = {}): string {
  const values: Record<string, string> = {
    NODE_ENV: "production",
    APP_URL: HOBBY_PUBLIC_ORIGIN,
    PUBLIC_APP_URL: HOBBY_PUBLIC_ORIGIN,
    DATABASE_URL: runtimeDatabaseUrl("trendsfast_public_runtime"),
    MEMBER_DATABASE_URL: runtimeDatabaseUrl("trendsfast_member_runtime"),
    AUTH_DATABASE_URL: runtimeDatabaseUrl("trendsfast_auth_runtime"),
    WORKER_DATABASE_URL: runtimeDatabaseUrl("trendsfast_worker_runtime"),
    OPS_DATABASE_URL: runtimeDatabaseUrl("trendsfast_ops_runtime"),
    DATABASE_SSL_CA:
      [
        readFileSync(
          fileURLToPath(
            new URL("../../../config/certs/supabase-prod-ca-2021.crt", import.meta.url),
          ),
          "utf8",
        ).trimEnd(),
        readFileSync(
          fileURLToPath(
            new URL("../../../config/certs/supabase-prod-ca-2025.crt", import.meta.url),
          ),
          "utf8",
        ).trimEnd(),
      ].join("\n") + "\n",
    PROVIDER_CREDENTIAL_MODE: "managed",
    MANAGED_POLICY_REVISION: "revision_abcdefghijklmnopqrstuvwxyz012345",
    PUBLIC_SCAN_PROCESSING: "inline",
    PUBLIC_SCAN_DAILY_LIMIT: "5",
    PUBLIC_SCAN_GLOBAL_DAILY_LIMIT: "10",
    PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD: "20",
    API_CREATE_RATE_LIMIT_PER_HOUR: "5",
    API_STATUS_RATE_LIMIT_PER_HOUR: "50",
    API_AUTH_FAILURE_LIMIT_PER_HOUR: "10",
    API_PROVIDER_COST_LIMIT_USD_PER_HOUR: "25",
    SCAN_RETENTION_DAYS: "30",
    XAI_API_KEY: "synthetic-xai-key",
    XAI_MODEL: "synthetic-x-search-model",
    XAI_ESTIMATED_COST_USD_PER_SEARCH: "0.01",
    XAI_MAX_TOOL_CALLS_PER_SCAN: "2",
    DATAFORSEO_LOGIN: "founder@example.test",
    DATAFORSEO_PASSWORD: "synthetic-dataforseo-password",
    DATAFORSEO_GOOGLE_TRENDS_MODE: "live",
    DATAFORSEO_ESTIMATED_COST_USD_PER_TASK: "0.02",
    TAVILY_API_KEY: "synthetic-tavily-key",
    TAVILY_ESTIMATED_COST_USD_PER_CREDIT: "0.03",
    TAVILY_MAX_CREDITS_PER_SCAN: "2",
    YOUTUBE_API_KEY: "synthetic-youtube-key",
    YOUTUBE_INTERNAL_QUOTA_VALUE_USD: "0",
    YOUTUBE_MAX_SEARCHES_PER_SCAN: "2",
    GITHUB_TOKEN: "synthetic-github-token",
    LLM_PROVIDER: "xai",
    LLM_MODEL: "synthetic-synthesis-model",
    LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "1",
    LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "2",
    MAX_PROVIDER_COST_USD_PER_SCAN: "1",
    MAX_SCAN_DURATION_SECONDS: "240",
    PROVIDER_TIMEOUT_MS: "15000",
    SESSION_SECRET: "public-session-secret-abcdefghijklmnopqrstuvwxyz-0123456789",
    SOL_HOBBY_OPS_SESSION_SECRET: "ops-session-secret-abcdefghijklmnopqrstuvwxyz-0123456789",
    API_KEY_PEPPER: "shared-api-key-pepper-abcdefghijklmnopqrstuvwxyz-0123456789",
    NEXT_PUBLIC_SUPABASE_URL: HOBBY_SUPABASE_ORIGIN,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic-production-key",
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: syntheticTurnstileSiteKey,
    CRON_SECRET: "cron-secret-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ_-",
    OPS_TOKEN: "ops-token-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ_-",
    SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST: "trendsfast.vercel.app",
    SOL_HOBBY_PUBLIC_DEPLOYMENT_ID: "dpl_PublicSynthetic123",
    NEXT_PUBLIC_ANNOUNCEMENT_ENABLED: "true",
    NEXT_PUBLIC_ANNOUNCEMENT_TEXT: "Synthetic announcement",
    DATAFAST_ENABLED: "false",
    [HOBBY_LOCAL_SUPABASE_REF_FIELD]: HOBBY_SUPABASE_PROJECT_REF,
    ...HOBBY_PUBLIC_EFFECTS,
    ...overrides,
  };
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

class RecordingRunner implements VercelCommandRunner {
  readonly calls: Array<{ args: readonly string[]; stdin?: string }> = [];

  constructor(
    private readonly surface: HobbySurface,
    private readonly initialNames: readonly string[] = [],
    private readonly initialMetadata: Readonly<
      Record<
        string,
        {
          type?: string;
          target?: readonly string[];
          gitBranch?: string | null;
          decrypted?: boolean;
          configurationId?: unknown;
          customEnvironmentIds?: readonly string[] | null;
          id?: string;
          updatedAt?: string | number;
        }
      >
    > = {},
    private readonly envelope:
      | "unpaginated"
      | "complete"
      | "continuation"
      | "bad-count"
      | "bad-prev"
      | "unknown" = "unpaginated",
  ) {}

  run(args: readonly string[], stdin?: string): CommandResult {
    this.calls.push(stdin === undefined ? { args } : { args, stdin });
    if (args[0] === "api" && args[1]?.includes("/env?")) {
      const writes = this.calls.filter(
        ({ args: previous }) => previous[0] === "env" && previous[1] === "add",
      );
      const envs = writes.length
        ? writes.map(({ args: previous }, index) => ({
            key: previous[2],
            id: `env_${this.surface}_${index}`,
            updatedAt: `2026-08-13T12:00:${String(index).padStart(2, "0")}.000Z`,
            type: previous.includes("--no-sensitive") ? "encrypted" : "sensitive",
            target: ["production"],
            decrypted: false,
          }))
        : this.initialNames.map((key, index) => ({
            key,
            id: `env_${this.surface}_initial_${index}`,
            updatedAt: `2026-08-12T12:00:${String(index).padStart(2, "0")}.000Z`,
            type: "sensitive",
            target: ["production"],
            decrypted: false,
            ...this.initialMetadata[key],
          }));
      const response: Record<string, unknown> = { envs, hiddenProductionEnvCount: 0 };
      if (this.envelope !== "unpaginated") {
        response.pagination = {
          count: envs.length + (this.envelope === "bad-count" ? 1 : 0),
          next: this.envelope === "continuation" ? "cursor_next" : null,
          prev: this.envelope === "bad-prev" ? "cursor_prev" : null,
          ...(this.envelope === "unknown" ? { extra: true } : {}),
        };
      }
      return { status: 0, stdout: JSON.stringify(response) };
    }
    if (args[0] === "api") {
      const project = HOBBY_PROJECTS[this.surface];
      return {
        status: 0,
        stdout: JSON.stringify({
          id: project.id,
          name: project.name,
          accountId: HOBBY_VERCEL_ORG_ID,
          rootDirectory: "apps/web",
          defaultResourceConfig: { fluid: true, functionDefaultTimeout: 300 },
          resourceConfig: { fluid: true },
          ...(this.surface === "ops"
            ? { ssoProtection: { deploymentType: "all_except_custom_domains" } }
            : {}),
        }),
      };
    }
    if (args[0] === "env" && args[1] === "ls") {
      const writes = this.calls.filter(
        ({ args: previous }) => previous[0] === "env" && previous[1] === "add",
      );
      const envs = writes.length
        ? writes.map(({ args: previous }) => ({
            key: previous[2],
            type: previous.includes("--no-sensitive") ? "encrypted" : "sensitive",
          }))
        : this.initialNames.map((key) => ({ key, type: "sensitive" }));
      return { status: 0, stdout: JSON.stringify({ envs }) };
    }
    return { status: 0, stdout: "captured and ignored" };
  }
}

describe("Hobby Production environment contracts", () => {
  it("builds disjoint public and protected-ops plans with one shared key-hash pepper", () => {
    const source = syntheticInventory({
      DIRECT_DATABASE_URL: "postgresql://owner:secret@db.example.test/postgres",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-legacy-service-role",
      STRIPE_SECRET_KEY: "sk_live_synthetic",
    });
    const publicPlan = buildHobbyEnvironmentPlan("public", source);
    const opsPlan = buildHobbyEnvironmentPlan("ops", source);

    expect(publicPlan.names).toEqual(HOBBY_PUBLIC_ALLOWLIST);
    expect(opsPlan.names).toEqual(HOBBY_OPS_ALLOWLIST);
    expect(publicPlan.names).toContain("WORKER_DATABASE_URL");
    expect(publicPlan.names).toContain("CRON_SECRET");
    expect(publicPlan.names).not.toContain("OPS_TOKEN");
    expect(opsPlan.names).toContain("OPS_DATABASE_URL");
    expect(opsPlan.names).not.toContain("DATABASE_URL");
    expect(opsPlan.names).not.toContain("CRON_SECRET");
    for (const forbidden of [
      "DIRECT_DATABASE_URL",
      "ROLE_ADMIN_DATABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]) {
      expect(publicPlan.names).not.toContain(forbidden);
      expect(opsPlan.names).not.toContain(forbidden);
    }
    const publicValues = Object.fromEntries(
      publicPlan.variables.map(({ name, value }) => [name, value]),
    );
    const opsValues = Object.fromEntries(opsPlan.variables.map(({ name, value }) => [name, value]));
    expect(opsValues.API_KEY_PEPPER).toBe(publicValues.API_KEY_PEPPER);
    expect(opsValues.SESSION_SECRET).not.toBe(publicValues.SESSION_SECRET);
    expect(opsValues).toMatchObject(HOBBY_OPS_EFFECTS);
    expect(publicPlan.phase).toBe(HOBBY_DEFAULT_ENVIRONMENT_PHASE);
    expect(opsPlan.phase).toBe(HOBBY_DEFAULT_ENVIRONMENT_PHASE);
  });

  it("accepts only the three pinned launch phases and maps both surfaces exactly", () => {
    for (const [phase, profile] of Object.entries(HOBBY_ENVIRONMENT_PHASES)) {
      const source = syntheticInventory({
        [HOBBY_ENVIRONMENT_PHASE_FIELD]: phase,
        APP_URL: profile.publicOrigin,
        PUBLIC_APP_URL: profile.publicOrigin,
        PUBLIC_SCANS_ENABLED: profile.publicScansEnabled,
      });
      const publicPlan = buildHobbyEnvironmentPlan(
        "public",
        source,
        phase === "canonical-origin-scans-on" ? validScanEnablementContext() : undefined,
      );
      const opsPlan = buildHobbyEnvironmentPlan("ops", source);
      const publicValues = Object.fromEntries(
        publicPlan.variables.map(({ name, value }) => [name, value]),
      );
      const opsValues = Object.fromEntries(
        opsPlan.variables.map(({ name, value }) => [name, value]),
      );

      expect(publicPlan.phase).toBe(phase);
      expect(opsPlan.phase).toBe(phase);
      expect(publicValues.APP_URL).toBe(profile.publicOrigin);
      expect(publicValues.PUBLIC_APP_URL).toBe(profile.publicOrigin);
      expect(publicValues.PUBLIC_SCANS_ENABLED).toBe(profile.publicScansEnabled);
      expect(opsValues.APP_URL).toBe("https://trendsfast-ops.vercel.app");
      expect(opsValues.PUBLIC_APP_URL).toBe(profile.publicOrigin);
      expect(opsValues.PUBLIC_SCANS_ENABLED).toBe(profile.publicScansEnabled);
    }
  });

  it("requires an explicit gated phase for canonical scans and rejects origin drift", () => {
    expect(() =>
      buildHobbyEnvironmentPlan(
        "public",
        syntheticInventory({
          APP_URL: HOBBY_CANONICAL_PUBLIC_ORIGIN,
          PUBLIC_APP_URL: HOBBY_CANONICAL_PUBLIC_ORIGIN,
          PUBLIC_SCANS_ENABLED: "true",
        }),
      ),
    ).toThrow(`APP_URL must equal ${HOBBY_PUBLIC_ORIGIN}`);
    expect(() =>
      buildHobbyEnvironmentPlan(
        "public",
        syntheticInventory({
          [HOBBY_ENVIRONMENT_PHASE_FIELD]: "canonical-origin-scans-off",
          APP_URL: HOBBY_CANONICAL_PUBLIC_ORIGIN,
          PUBLIC_APP_URL: HOBBY_CANONICAL_PUBLIC_ORIGIN,
          PUBLIC_SCANS_ENABLED: "true",
        }),
      ),
    ).toThrow(
      "PUBLIC_SCANS_ENABLED must equal false for Hobby environment phase canonical-origin-scans-off",
    );
    expect(() =>
      buildHobbyEnvironmentPlan(
        "ops",
        syntheticInventory({
          [HOBBY_ENVIRONMENT_PHASE_FIELD]: "canonical-origin-scans-on",
          APP_URL: HOBBY_CANONICAL_PUBLIC_ORIGIN,
          PUBLIC_APP_URL: "https://www.trendsfast.com",
          PUBLIC_SCANS_ENABLED: "true",
        }),
      ),
    ).toThrow(`PUBLIC_APP_URL must equal ${HOBBY_CANONICAL_PUBLIC_ORIGIN}`);
    expect(() =>
      buildHobbyEnvironmentPlan(
        "public",
        syntheticInventory({
          [HOBBY_ENVIRONMENT_PHASE_FIELD]: "custom-origin-scans-on",
          APP_URL: "https://attacker.example",
          PUBLIC_APP_URL: "https://attacker.example",
          PUBLIC_SCANS_ENABLED: "true",
        }),
      ),
    ).toThrow(`${HOBBY_ENVIRONMENT_PHASE_FIELD} must equal one of`);
  });

  it("requires exact founder-approved deployment, Turnstile, and dogfood evidence for scans-on", () => {
    const source = syntheticInventory({
      [HOBBY_ENVIRONMENT_PHASE_FIELD]: "canonical-origin-scans-on",
      APP_URL: HOBBY_CANONICAL_PUBLIC_ORIGIN,
      PUBLIC_APP_URL: HOBBY_CANONICAL_PUBLIC_ORIGIN,
      PUBLIC_SCANS_ENABLED: "true",
    });
    expect(() => buildHobbyEnvironmentPlan("public", source)).toThrow(
      "Public scans-on requires the private founder-approved dogfood and Turnstile evidence contract",
    );
    expect(() =>
      buildHobbyEnvironmentPlan("public", source, validScanEnablementContext()),
    ).not.toThrow();

    for (const changed of [
      { acceptedSha: "b".repeat(40) },
      { testedPublicDeploymentId: "dpl_Different123" },
      { siteKeySha256: "0".repeat(64) },
      { action: "different_action" },
      { hostnames: ["trendsfast.com"] },
      {
        turnstileMatrix: {
          valid: "PASS",
          missing: "PASS",
          forged: "PASS",
          replayed: "FAIL",
          expired: "PASS",
          wrongAction: "PASS",
          wrongHostname: "PASS",
        },
      },
      { dogfood: { halio: "PASS", shipToUsers: "FAIL" } },
      { founderApproved: false },
    ]) {
      expect(() =>
        buildHobbyEnvironmentPlan("public", source, validScanEnablementContext(changed)),
      ).toThrow("does not match the accepted release, Turnstile contract, and dogfood gates");
    }

    expect(() => buildHobbyEnvironmentPlan("ops", source)).not.toThrow();
  });

  it("reads scans-on contracts only from ignored regular mode-0600 files", () => {
    const temporaryRoot = mkdtempSync(resolve(tmpdir(), "trendsfast-scan-enablement-"));
    const context = validScanEnablementContext();
    const evidencePath = resolve(temporaryRoot, HOBBY_SCAN_ENABLEMENT_EVIDENCE_PATH);
    const releasePath = resolve(temporaryRoot, HOBBY_ACCEPTED_RELEASE_PATH);
    try {
      mkdirSync(resolve(temporaryRoot, ".var/private"), { recursive: true, mode: 0o700 });
      writeFileSync(evidencePath, context.evidenceSource, { mode: 0o600 });
      writeFileSync(releasePath, context.acceptedReleaseSource, { mode: 0o600 });
      expect(readPrivateHobbyScanEnablementContext(temporaryRoot, () => true)).toEqual(context);
      expect(() => readPrivateHobbyScanEnablementContext(temporaryRoot, () => false)).toThrow(
        "must remain ignored by Git",
      );
      chmodSync(evidencePath, 0o644);
      expect(() => readPrivateHobbyScanEnablementContext(temporaryRoot, () => true)).toThrow(
        "must be a regular mode-0600 file",
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("defaults only an absent phase marker and rejects empty or arbitrary markers", () => {
    expect(resolveHobbyEnvironmentPhase({})).toBe(HOBBY_DEFAULT_ENVIRONMENT_PHASE);
    expect(
      resolveHobbyEnvironmentPhase({
        [HOBBY_ENVIRONMENT_PHASE_FIELD]: "canonical-origin-scans-off",
      }),
    ).toBe("canonical-origin-scans-off");
    for (const selected of ["", "canonical", "generated-origin-scans-on"]) {
      expect(() =>
        resolveHobbyEnvironmentPhase({ [HOBBY_ENVIRONMENT_PHASE_FIELD]: selected }),
      ).toThrow(`${HOBBY_ENVIRONMENT_PHASE_FIELD} must equal one of`);
    }
  });

  it("preparation preserves an explicit reviewed phase and leaves the default marker absent", () => {
    const defaultTarget = {
      [HOBBY_ENVIRONMENT_PHASE_FIELD]: "stale-value",
      APP_URL: "https://stale.example",
      PUBLIC_APP_URL: "https://stale.example",
      PUBLIC_SCANS_ENABLED: "true",
    };
    applyReviewedHobbyEnvironmentPhase(defaultTarget, {});
    expect(defaultTarget).toEqual({
      APP_URL: HOBBY_PUBLIC_ORIGIN,
      PUBLIC_APP_URL: HOBBY_PUBLIC_ORIGIN,
      PUBLIC_SCANS_ENABLED: "false",
    });

    const reviewedTarget: Record<string, string> = {};
    applyReviewedHobbyEnvironmentPhase(reviewedTarget, {
      [HOBBY_ENVIRONMENT_PHASE_FIELD]: "canonical-origin-scans-on",
    });
    expect(reviewedTarget).toEqual({
      [HOBBY_ENVIRONMENT_PHASE_FIELD]: "canonical-origin-scans-on",
      APP_URL: HOBBY_CANONICAL_PUBLIC_ORIGIN,
      PUBLIC_APP_URL: HOBBY_CANONICAL_PUBLIC_ORIGIN,
      PUBLIC_SCANS_ENABLED: "true",
    });
  });

  it("fails closed on altered gates, database identities, and legacy browser keys", () => {
    expect(() =>
      buildHobbyEnvironmentPlan("public", syntheticInventory({ PUBLIC_SCANS_ENABLED: "true" })),
    ).toThrow(
      "PUBLIC_SCANS_ENABLED must equal false for Hobby environment phase generated-origin-scans-off",
    );
    expect(() =>
      buildHobbyEnvironmentPlan(
        "public",
        syntheticInventory({
          DATABASE_URL: `postgresql://postgres.${HOBBY_SUPABASE_PROJECT_REF}:synthetic@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
        }),
      ),
    ).toThrow("DATABASE_URL must use its pinned production runtime identity");
    expect(() =>
      buildHobbyEnvironmentPlan(
        "public",
        syntheticInventory({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "legacy-jwt-key" }),
      ),
    ).toThrow("Only a modern Supabase publishable browser key is accepted");
    const sameLongSecret = "same-long-session-secret-abcdefghijklmnopqrstuvwxyz-0123456789";
    expect(() =>
      buildHobbyEnvironmentPlan(
        "ops",
        syntheticInventory({
          SOL_HOBBY_OPS_SESSION_SECRET: sameLongSecret,
          SESSION_SECRET: sameLongSecret,
        }),
      ),
    ).toThrow("public and ops SESSION_SECRET values must be distinct");
    expect(() =>
      buildHobbyEnvironmentPlan("public", syntheticInventory({ CRON_SECRET: "c".repeat(64) })),
    ).toThrow("Unresolved placeholder: CRON_SECRET");
    expect(() =>
      buildHobbyEnvironmentPlan("ops", syntheticInventory({ OPS_TOKEN: "ab".repeat(32) })),
    ).toThrow("Unresolved placeholder: OPS_TOKEN");
  });

  it.each([
    ["public", "DATABASE_URL", "trendsfast_public_runtime"],
    ["public", "MEMBER_DATABASE_URL", "trendsfast_member_runtime"],
    ["public", "AUTH_DATABASE_URL", "trendsfast_auth_runtime"],
    ["public", "WORKER_DATABASE_URL", "trendsfast_worker_runtime"],
    ["ops", "OPS_DATABASE_URL", "trendsfast_ops_runtime"],
  ] as const)(
    "pins the %s Hobby surface %s to the exact production pooler host",
    (surface, variable, role) => {
      expect(HOBBY_SUPABASE_POOLER_HOST).toBe(PRODUCTION_SUPABASE_POOLER_HOST);

      for (const wrongHost of [
        "aws-0-eu-west-1.pooler.supabase.com",
        "attacker.pooler.supabase.com",
      ]) {
        expect(() =>
          buildHobbyEnvironmentPlan(
            surface,
            syntheticInventory({ [variable]: runtimeDatabaseUrl(role, wrongHost) }),
          ),
        ).toThrow(`${variable} must use its pinned production runtime identity`);
      }
    },
  );

  it("rejects short and official test Turnstile credentials from the production plan", () => {
    expect(() =>
      buildHobbyEnvironmentPlan(
        "public",
        syntheticInventory({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "short-key" }),
      ),
    ).toThrow("NEXT_PUBLIC_TURNSTILE_SITE_KEY must be a non-test production Turnstile credential");
    expect(() =>
      buildHobbyEnvironmentPlan(
        "public",
        syntheticInventory({ TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" }),
      ),
    ).toThrow("TURNSTILE_SECRET_KEY must be a non-test production Turnstile credential");
  });

  it("rejects remote names outside each exact allowlist before mutation", () => {
    const plan = buildHobbyEnvironmentPlan("public", syntheticInventory());
    const runner = new RecordingRunner("public", ["APP_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(() => preflightHobbyEnvironmentImport(plan, runner)).toThrow(
      "outside the public allowlist or Production-only scope; no mutation performed",
    );
    expect(runner.calls.some(({ args }) => args[1] === "add")).toBe(false);
  });

  it("rejects wrong Vercel target, sensitivity, branch, and decrypted metadata", () => {
    const plan = buildHobbyEnvironmentPlan("public", syntheticInventory());
    for (const metadata of [
      { target: ["preview"] },
      { type: "encrypted" },
      { gitBranch: "main" },
      { decrypted: true },
    ]) {
      const runner = new RecordingRunner("public", ["SESSION_SECRET"], {
        SESSION_SECRET: metadata,
      });
      expect(() => preflightHobbyEnvironmentImport(plan, runner)).toThrow();
    }
  });

  it("requires the complete exact remote manifest in check mode", () => {
    const plan = buildHobbyEnvironmentPlan("public", syntheticInventory());
    const runner = new RecordingRunner("public", ["APP_URL"], {
      APP_URL: { type: "encrypted" },
    });
    expect(() => preflightHobbyEnvironmentImport(plan, runner, true)).toThrow(
      "did not match the exact allowlist",
    );
  });

  it("accepts only the complete exact manifest in check mode", () => {
    const plan = buildHobbyEnvironmentPlan("public", syntheticInventory());
    const runner = new RecordingRunner("public");
    executeHobbyEnvironmentImport(plan, runner);
    const snapshot = preflightHobbyEnvironmentImport(plan, runner, true);
    expect(snapshot.surface).toBe("public");
    expect(snapshot.projectId).toBe(HOBBY_PROJECTS.public.id);
    expect(snapshot.variables.map(({ name }) => name).sort()).toEqual([...plan.names].sort());
  });

  it("accepts a complete Vercel V10 pagination envelope and rejects incomplete variants", () => {
    const plan = buildHobbyEnvironmentPlan("public", syntheticInventory());
    const runner = new RecordingRunner("public", [], {}, "complete");
    executeHobbyEnvironmentImport(plan, runner);
    expect(() => preflightHobbyEnvironmentImport(plan, runner, true)).not.toThrow();

    for (const envelope of ["continuation", "bad-count", "bad-prev", "unknown"] as const) {
      const incomplete = new RecordingRunner("public", [], {}, envelope);
      expect(() => executeHobbyEnvironmentImport(plan, incomplete)).toThrow("hidden or incomplete");
    }
  });

  it("uploads only through stdin and verifies exact redacted name/type metadata", () => {
    const plan = buildHobbyEnvironmentPlan("ops", syntheticInventory());
    const runner = new RecordingRunner("ops");
    executeHobbyEnvironmentImport(plan, runner);
    const writes = runner.calls.filter(({ args }) => args[0] === "env" && args[1] === "add");
    expect(writes).toHaveLength(HOBBY_OPS_ALLOWLIST.length);
    for (const variable of plan.variables) {
      const write = writes.find(({ args }) => args[2] === variable.name);
      expect(write?.stdin).toBe(variable.value);
      if (variable.sensitivity === "sensitive") {
        expect(write?.args).not.toContain(variable.value);
      }
    }
    expect(writes.every(({ args }) => args.includes(HOBBY_PROJECTS.ops.id))).toBe(true);
    expect(writes.find(({ args }) => args[2] === "OPS_TOKEN")?.args).toContain("--sensitive");
    expect(writes.find(({ args }) => args[2] === "TRENDSFAST_SURFACE")?.args).toContain(
      "--no-sensitive",
    );
  });

  it("binds the exact local plan and remote revision metadata without storing values", () => {
    const plan = buildHobbyEnvironmentPlan("ops", syntheticInventory());
    const runner = new RecordingRunner("ops");
    const snapshot = executeHobbyEnvironmentImport(plan, runner);
    const attestation = createHobbyEnvironmentAttestation(plan, snapshot);
    const opsToken = plan.variables.find(({ name }) => name === "OPS_TOKEN")!.value;
    expect(attestation).not.toContain(opsToken);
    expect(() => verifyHobbyEnvironmentAttestation(plan, snapshot, attestation)).not.toThrow();

    const parsed = JSON.parse(attestation) as Record<string, unknown>;
    const proof = parsed.proofSha256 as string;
    parsed.proofSha256 = `${proof[0] === "0" ? "1" : "0"}${proof.slice(1)}`;
    expect(() => verifyHobbyEnvironmentAttestation(plan, snapshot, JSON.stringify(parsed))).toThrow(
      "does not match the exact local plan",
    );

    const driftedSnapshot: HobbyRemoteEnvironmentSnapshot = {
      ...snapshot,
      variables: snapshot.variables.map((variable, index) =>
        index === 0 ? { ...variable, updatedAt: `${variable.updatedAt}-drift` } : variable,
      ),
    };
    expect(() => verifyHobbyEnvironmentAttestation(plan, driftedSnapshot, attestation)).toThrow(
      "does not match current Vercel metadata",
    );
    const changedPlan = buildHobbyEnvironmentPlan(
      "ops",
      syntheticInventory({
        SOL_HOBBY_OPS_SESSION_SECRET:
          "changed-ops-session-secret-abcdefghijklmnopqrstuvwxyz-0123456789",
      }),
    );
    expect(() => verifyHobbyEnvironmentAttestation(changedPlan, snapshot, attestation)).toThrow(
      "does not match the exact local plan",
    );
    expect(() => verifyHobbyEnvironmentAttestation(plan, snapshot, "not-json")).toThrow(
      "was malformed",
    );
  });

  it("uses an ignored per-surface attestation path and enforces private file modes", () => {
    const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
    for (const surface of ["public", "ops"] as const) {
      const relativePath = HOBBY_ENVIRONMENT_ATTESTATION_PATHS[surface];
      expect(hobbyEnvironmentAttestationPath(surface, repositoryRoot)).toBe(
        resolve(repositoryRoot, relativePath),
      );
      expect(
        spawnSync("git", ["check-ignore", "-q", "--", relativePath], {
          cwd: repositoryRoot,
        }).status,
      ).toBe(0);
    }

    const temporaryRoot = mkdtempSync(resolve(tmpdir(), "trendsfast-hobby-attestation-"));
    const path = hobbyEnvironmentAttestationPath("public", temporaryRoot);
    try {
      expect(() => readPrivateHobbyEnvironmentAttestation(path)).toThrow(
        "is missing; run an explicit --apply",
      );
      writePrivateHobbyEnvironmentAttestation(path, '{"redacted":true}\n');
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
      expect(readPrivateHobbyEnvironmentAttestation(path)).toBe('{"redacted":true}\n');
      chmodSync(path, 0o644);
      expect(() => readPrivateHobbyEnvironmentAttestation(path)).toThrow("mode-0600");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("preserves validated public deployment provenance and bootstraps only when absent", () => {
    expect(resolveHobbyPublicDeploymentProvenance({})).toEqual({
      host: "trendsfast.vercel.app",
      id: "dpl_9Z3XyyjM7UGtkhJRCVEVfKKUpFm8",
    });
    expect(
      resolveHobbyPublicDeploymentProvenance({
        SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST: "trendsfast-newrevision.vercel.app",
        SOL_HOBBY_PUBLIC_DEPLOYMENT_ID: "dpl_NewRevision123",
      }),
    ).toEqual({
      host: "trendsfast-newrevision.vercel.app",
      id: "dpl_NewRevision123",
    });
    expect(() =>
      resolveHobbyPublicDeploymentProvenance({
        SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST: "trendsfast-newrevision.vercel.app",
      }),
    ).toThrow("incomplete or malformed");
    expect(() =>
      resolveHobbyPublicDeploymentProvenance({
        SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST: "attacker.vercel.app",
        SOL_HOBBY_PUBLIC_DEPLOYMENT_ID: "dpl_Attacker123",
      }),
    ).toThrow("incomplete or malformed");
  });

  it("pins the sole Supabase project and distinct Vercel projects", () => {
    expect(HOBBY_SUPABASE_PROJECT_REF).toBe("auxienkuufejeakaczlq");
    expect(HOBBY_PROJECTS.public.id).not.toBe(HOBBY_PROJECTS.ops.id);
    expect(new Set(HOBBY_PUBLIC_ALLOWLIST).size).toBe(HOBBY_PUBLIC_ALLOWLIST.length);
    expect(new Set(HOBBY_OPS_ALLOWLIST).size).toBe(HOBBY_OPS_ALLOWLIST.length);
    expect(HobbyEnvironmentError).toBeTypeOf("function");
  });
});

import { describe, expect, it } from "vitest";

import {
  assertStagedProductionLink,
  buildStagedProductionPlan,
  executeStagedProductionImport,
  parseProductionInventory,
  STAGED_PRODUCTION_EFFECTS,
  STAGED_PRODUCTION_ORG_ID,
  STAGED_PRODUCTION_ORIGIN,
  STAGED_PRODUCTION_PROJECT,
  STAGED_PRODUCTION_PROJECT_ID,
  STAGED_PRODUCTION_SUPABASE_REF_FIELD,
  StagedProductionEnvironmentError,
  type CommandResult,
  type VercelCommandRunner,
} from "../../../scripts/staged-production-env";

function validInventory(overrides: Readonly<Record<string, string>> = {}): string {
  const projectRef = "abcdefghijklmnopqrst";
  const values: Record<string, string> = {
    NODE_ENV: "production",
    APP_URL: STAGED_PRODUCTION_ORIGIN,
    PUBLIC_APP_URL: STAGED_PRODUCTION_ORIGIN,
    DATABASE_URL: `postgresql://trendsfast_public_runtime.${projectRef}:synthetic@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
    MEMBER_DATABASE_URL: `postgresql://trendsfast_member_runtime.${projectRef}:synthetic@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
    AUTH_DATABASE_URL: `postgresql://trendsfast_auth_runtime.${projectRef}:synthetic@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
    DATABASE_SSL_CA: "synthetic-ca",
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
    SESSION_SECRET: "session-secret-with-varied-synthetic-characters-1234567890",
    API_KEY_PEPPER: `pepper-${"synthetic"}-varied-0987654321-characters`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    TURNSTILE_ENABLED: "false",
    [STAGED_PRODUCTION_SUPABASE_REF_FIELD]: projectRef,
    ...STAGED_PRODUCTION_EFFECTS,
    ...overrides,
  };
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`;
}

class RecordingRunner implements VercelCommandRunner {
  readonly calls: Array<{ args: readonly string[]; stdin?: string }> = [];

  constructor(private readonly remoteOutput?: string) {}

  run(args: readonly string[], stdin?: string): CommandResult {
    this.calls.push(stdin === undefined ? { args } : { args, stdin });
    if (args[0] === "env" && args[1] === "ls") {
      if (this.remoteOutput !== undefined) return { status: 0, stdout: this.remoteOutput };
      const writes = this.calls.filter(
        ({ args: previousArgs }) => previousArgs[0] === "env" && previousArgs[1] === "add",
      );
      return {
        status: 0,
        stdout: JSON.stringify({
          envs: writes.map(({ args: writeArgs }) => ({
            key: writeArgs[2],
            type: writeArgs.includes("--no-sensitive") ? "encrypted" : "sensitive",
          })),
        }),
      };
    }
    return { status: 0, stdout: "output deliberately ignored" };
  }
}

describe("staged Production environment inventory", () => {
  it("requires the exact linked Vercel name, project ID, and team ID", () => {
    const exactLink = {
      projectName: STAGED_PRODUCTION_PROJECT,
      projectId: STAGED_PRODUCTION_PROJECT_ID,
      orgId: STAGED_PRODUCTION_ORG_ID,
    };
    expect(() => assertStagedProductionLink(exactLink)).not.toThrow();
    expect(() => assertStagedProductionLink({ ...exactLink, orgId: "team_other" })).toThrow(
      "pinned TrendsFast Vercel project and team",
    );
    expect(() => assertStagedProductionLink({ ...exactLink, projectId: "prj_other" })).toThrow(
      "pinned TrendsFast Vercel project and team",
    );
  });

  it("parses dotenv syntax as data and rejects duplicate names", () => {
    const parsed = parseProductionInventory(
      [
        "# comment",
        'ONE="first\\nsecond"',
        "TWO='hash#kept'",
        "THREE=value # discarded comment",
        'FOUR="multi',
        'line"',
      ].join("\n"),
    );

    expect(parsed.values).toEqual({
      ONE: "first\nsecond",
      TWO: "hash#kept",
      THREE: "value",
      FOUR: "multi\nline",
    });
    expect(() => parseProductionInventory("DUPLICATE=one\nDUPLICATE=two\n")).toThrow(
      "Duplicate variable name: DUPLICATE",
    );
  });

  it("creates an explicit public-only plan and never selects SOL or operator values", () => {
    const source = `${validInventory({
      NEXT_PUBLIC_ANNOUNCEMENT_TEXT: "Synthetic announcement",
      XAI_API_KEY: "synthetic-provider-key",
    })}OPS_TOKEN=operator-token-with-varied-synthetic-characters-1234567890\nDIRECT_DATABASE_URL=postgresql://operator:synthetic@db.example.com/postgres\nSOL_PROVISIONS_DATABASE_PASSWORD=synthetic-local-only\nUNKNOWN_PRIVATE_VALUE=synthetic-local-only\n`;
    const plan = buildStagedProductionPlan(source);

    expect(plan.names).toContain("XAI_API_KEY");
    expect(plan.names).toContain("NEXT_PUBLIC_ANNOUNCEMENT_TEXT");
    expect(plan.names).not.toContain("OPS_TOKEN");
    expect(plan.names).not.toContain("DIRECT_DATABASE_URL");
    expect(plan.names.some((name) => name.startsWith("SOL_"))).toBe(false);
    expect(plan.names).not.toContain("UNKNOWN_PRIVATE_VALUE");
    expect(plan.forbiddenInventoryNames).toEqual(["OPS_TOKEN", "DIRECT_DATABASE_URL"]);
    expect(plan.ignoredInventoryNameCount).toBe(5);

    for (const variable of plan.variables) {
      expect(variable.sensitivity).toBe(
        Object.hasOwn(STAGED_PRODUCTION_EFFECTS, variable.name) ? "plain" : "sensitive",
      );
    }
  });

  it("fails closed on unresolved values, unsafe origins, and altered Phase 1 effects", () => {
    expect(() =>
      buildStagedProductionPlan(validInventory({ DATABASE_URL: "replace-with-production-url" })),
    ).toThrow("Unresolved placeholder: DATABASE_URL");
    expect(() =>
      buildStagedProductionPlan(
        validInventory({ PUBLIC_APP_URL: "https://other-project.vercel.app" }),
      ),
    ).toThrow("APP_URL and PUBLIC_APP_URL must be the same exact origin");
    expect(() =>
      buildStagedProductionPlan(
        validInventory({
          APP_URL: "https://other-project.vercel.app",
          PUBLIC_APP_URL: "https://other-project.vercel.app",
        }),
      ),
    ).toThrow(`APP_URL and PUBLIC_APP_URL must equal ${STAGED_PRODUCTION_ORIGIN}`);
    expect(() =>
      buildStagedProductionPlan(validInventory({ PUBLIC_SCANS_ENABLED: "true" })),
    ).toThrow("PUBLIC_SCANS_ENABLED must equal the Phase 1 value false");
    expect(() => buildStagedProductionPlan(validInventory({ DATABASE_URL: "" }))).toThrow(
      "Required production variable is missing: DATABASE_URL",
    );
    expect(() =>
      buildStagedProductionPlan(
        validInventory({
          DATABASE_URL:
            "postgresql://trendsfast_public_runtime.abcdefghijklmnopqrst:replace_me@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
        }),
      ),
    ).toThrow("Unresolved placeholder: DATABASE_URL");
    expect(() =>
      buildStagedProductionPlan(validInventory({ SESSION_SECRET: "x".repeat(48) })),
    ).toThrow("Unresolved placeholder: SESSION_SECRET");
  });

  it("uses the application environment parser before producing a mutation plan", () => {
    expect(() =>
      buildStagedProductionPlan(validInventory({ DATAFORSEO_LOGIN: "founder@example.com" })),
    ).toThrow("Application environment validation failed for: DATAFORSEO_LOGIN");
  });

  it("rejects privileged Supabase keys and live or incomplete Stripe credentials", () => {
    const syntheticLiveKey = `sk_${"live"}_synthetic`;
    expect(() =>
      buildStagedProductionPlan(
        validInventory({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "legacy-or-privileged-key" }),
      ),
    ).toThrow("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must use the modern publishable key format");
    expect(() =>
      buildStagedProductionPlan(validInventory({ STRIPE_SECRET_KEY: syntheticLiveKey })),
    ).toThrow("Disabled Stripe server credentials must be configured as a complete pair");
    expect(() =>
      buildStagedProductionPlan(
        validInventory({
          STRIPE_SECRET_KEY: syntheticLiveKey,
          STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
          STRIPE_SANDBOX_KEY_ROTATED: "YES",
        }),
      ),
    ).toThrow("Staged production accepts only a Stripe test secret key");
  });

  it("requires distinct credentialed runtime identities and accepts Supabase pooler suffixes", () => {
    expect(() =>
      buildStagedProductionPlan(
        validInventory({
          DATABASE_URL: "postgresql://postgres:synthetic@pooler.example.com:5432/postgres",
        }),
      ),
    ).toThrow("DATABASE_URL must use its credentialed least-privilege runtime identity");
    expect(() =>
      buildStagedProductionPlan(
        validInventory({
          MEMBER_DATABASE_URL:
            "postgresql://trendsfast_member_runtime@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
        }),
      ),
    ).toThrow("MEMBER_DATABASE_URL must use its credentialed least-privilege runtime identity");

    expect(() =>
      buildStagedProductionPlan(
        validInventory({
          DATABASE_URL:
            "postgresql://trendsfast_public_runtime.abcdefghijklmnopqrst:synthetic@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
          MEMBER_DATABASE_URL:
            "postgresql://trendsfast_member_runtime.abcdefghijklmnopqrst:synthetic@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
          AUTH_DATABASE_URL:
            "postgresql://trendsfast_auth_runtime.abcdefghijklmnopqrst:synthetic@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
        }),
      ),
    ).not.toThrow();
  });

  it("binds Auth and every runtime URL to the explicit local-only production ref", () => {
    const withoutReadback = validInventory().replace(
      new RegExp(`^${STAGED_PRODUCTION_SUPABASE_REF_FIELD}=.*\\n`, "mu"),
      "",
    );
    expect(() => buildStagedProductionPlan(withoutReadback)).toThrow(
      `Required local-only readback is missing: ${STAGED_PRODUCTION_SUPABASE_REF_FIELD}`,
    );
    expect(() =>
      buildStagedProductionPlan(
        validInventory({ [STAGED_PRODUCTION_SUPABASE_REF_FIELD]: "zyxwvutsrqponmlkjihg" }),
      ),
    ).toThrow("Supabase Auth configuration does not match the production project readback");
    expect(() =>
      buildStagedProductionPlan(
        validInventory({
          MEMBER_DATABASE_URL:
            "postgresql://trendsfast_member_runtime.zyxwvutsrqponmlkjihg:synthetic@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
        }),
      ),
    ).toThrow("MEMBER_DATABASE_URL must use its credentialed least-privilege runtime identity");
  });
});

describe("staged Production Vercel import", () => {
  it("sends values only on stdin and marks only exact effect flags as plain", () => {
    const plan = buildStagedProductionPlan(
      validInventory({ XAI_API_KEY: "synthetic-provider-secret" }),
    );
    const runner = new RecordingRunner();

    executeStagedProductionImport(plan, runner);

    expect(runner.calls.slice(0, 3).map(({ args }) => args.slice(0, 2))).toEqual([
      ["whoami", "--no-color"],
      ["project", "inspect"],
      ["env", "ls"],
    ]);
    expect(runner.calls[1]?.args).toEqual([
      "project",
      "inspect",
      STAGED_PRODUCTION_PROJECT_ID,
      "--no-color",
    ]);
    expect(runner.calls[2]?.args).toEqual([
      "env",
      "ls",
      "production",
      "--format",
      "json",
      "--project",
      STAGED_PRODUCTION_PROJECT_ID,
      "--no-color",
    ]);
    const writes = runner.calls.filter(({ args }) => args[0] === "env" && args[1] === "add");
    expect(writes).toHaveLength(plan.variables.length);
    for (const [index, write] of writes.entries()) {
      const planned = plan.variables[index];
      expect(planned).toBeDefined();
      expect(write.args).toContain(planned?.name);
      expect(write.args).toContain("production");
      expect(write.args).toContain("--force");
      expect(write.args).not.toContain("--value");
      expect(write.stdin).toBe(planned?.value);
      expect(write.args).toContain(
        planned?.sensitivity === "plain" ? "--no-sensitive" : "--sensitive",
      );
    }
    for (const name of ["APP_URL", "PUBLIC_APP_URL"] as const) {
      const originWrite = writes.find(({ args }) => args.includes(name));
      expect(originWrite?.args).toContain("--sensitive");
    }
    expect(runner.calls.flatMap(({ args }) => args)).not.toContain("synthetic-provider-secret");
  });

  it("completes every remote preflight before the first write", () => {
    const plan = buildStagedProductionPlan(validInventory());
    const runner = new RecordingRunner(
      JSON.stringify({
        envs: [{ key: "OPS_TOKEN", value: "a value the importer must never forward" }],
      }),
    );

    let failure: unknown;
    try {
      executeStagedProductionImport(plan, runner);
    } catch (error) {
      failure = error;
    }
    expect(failure).toEqual(
      new StagedProductionEnvironmentError(
        "Vercel Production has 1 variable(s) outside the public allowlist; no mutation performed",
      ),
    );
    expect(String(failure)).not.toContain("a value the importer must never forward");
    expect(runner.calls.some(({ args }) => args[0] === "env" && args[1] === "add")).toBe(false);
  });

  it("refuses stale allowlisted remote variables omitted from the local plan", () => {
    const plan = buildStagedProductionPlan(validInventory());
    const runner = new RecordingRunner(
      JSON.stringify({
        envs: [{ key: "STRIPE_SECRET_KEY", value: "synthetic-stale-value" }],
      }),
    );

    expect(() => executeStagedProductionImport(plan, runner)).toThrow(
      "Vercel Production has 1 stale allowlisted variable(s); no mutation performed",
    );
    expect(runner.calls.some(({ args }) => args[0] === "env" && args[1] === "add")).toBe(false);
  });

  it("requires CLI 58 encrypted metadata for readable effect flags after writes", () => {
    const plan = buildStagedProductionPlan(validInventory());
    let inventoryReads = 0;
    const runner: VercelCommandRunner = {
      run(args) {
        if (args[0] !== "env" || args[1] !== "ls") return { status: 0, stdout: "" };
        inventoryReads += 1;
        if (inventoryReads === 1) return { status: 0, stdout: '{"envs":[]}' };
        return {
          status: 0,
          stdout: JSON.stringify({
            envs: plan.variables.map(({ name, sensitivity }) => ({
              key: name,
              type: sensitivity === "plain" ? "plain" : "sensitive",
            })),
          }),
        };
      },
    };

    expect(() => executeStagedProductionImport(plan, runner)).toThrow(
      "Vercel Production sensitivity readback did not match",
    );
  });
});

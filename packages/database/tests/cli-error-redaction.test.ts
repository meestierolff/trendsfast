import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const malformedCredentialCanary = "postgresql://role:CLI_SECRET_CANARY@[";

const rolePasswordVariables = [
  "TRENDSFAST_MIGRATOR_PASSWORD",
  "TRENDSFAST_PUBLIC_RUNTIME_PASSWORD",
  "TRENDSFAST_MEMBER_RUNTIME_PASSWORD",
  "TRENDSFAST_OPS_RUNTIME_PASSWORD",
  "TRENDSFAST_WORKER_RUNTIME_PASSWORD",
  "TRENDSFAST_BILLING_RUNTIME_PASSWORD",
  "TRENDSFAST_AUTH_RUNTIME_PASSWORD",
  "TRENDSFAST_RETENTION_RUNTIME_PASSWORD",
] as const;

function runDatabaseEntrypoint(path: URL) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DIRECT_DATABASE_URL: malformedCredentialCanary,
    ROLE_ADMIN_DATABASE_URL: malformedCredentialCanary,
    DATABASE_SSL_CA: "",
    RUNTIME_ROLE_SECRETS_FILE: "",
  };
  for (const variable of rolePasswordVariables) {
    environment[variable] = `role-password-${variable}-${"x".repeat(48)}`;
  }
  return spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(path)], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    encoding: "utf8",
    env: environment,
    timeout: 20_000,
  });
}

describe("database CLI error privacy", () => {
  const entrypoints = [
    {
      path: new URL("../../../scripts/db/verify-runtime-roles.ts", import.meta.url),
      category: "RUNTIME_ROLE_VERIFICATION_FAILED",
    },
    {
      path: new URL("../../../scripts/db/provision-runtime-roles.ts", import.meta.url),
      category: "RUNTIME_ROLE_PROVISIONING_FAILED",
    },
    {
      path: new URL("../../../scripts/db/verify-hosted-schema.ts", import.meta.url),
      category: "HOSTED_SCHEMA_VERIFICATION_FAILED",
    },
    {
      path: new URL("../src/migrate.ts", import.meta.url),
      category: "DATABASE_MIGRATION_FAILED",
    },
  ] as const;

  for (const entrypoint of entrypoints) {
    it(`emits only the fixed ${entrypoint.category} category`, () => {
      const result = runDatabaseEntrypoint(entrypoint.path);

      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(JSON.stringify({ ok: false, error: entrypoint.category }));
      expect(`${result.stdout}${result.stderr}`).not.toContain("CLI_SECRET_CANARY");
      expect(`${result.stdout}${result.stderr}`).not.toContain(malformedCredentialCanary);
    });
  }
});

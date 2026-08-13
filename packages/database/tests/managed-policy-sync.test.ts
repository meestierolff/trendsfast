import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  MANAGED_POLICY_VARIABLES,
  MANAGED_RUNTIME_POLICY_UPSERT_SQL,
  managedPolicyDatabaseConnection,
  managedRuntimePolicyParameters,
  parseManagedRuntimePolicy,
  resolveManagedRuntimePolicy,
  validatedManagedPolicyFilePath,
} from "../../../scripts/db/sync-managed-runtime-policy";

function validPolicyEnvironment(): Record<string, string> {
  return Object.fromEntries(
    MANAGED_POLICY_VARIABLES.map((variable, index) => [
      variable,
      variable === "MANAGED_POLICY_REVISION" ? "r".repeat(32) : String(index + 1),
    ]),
  );
}

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { force: true, recursive: true });
  temporaryDirectory = undefined;
});

describe("managed runtime policy synchronization", () => {
  it("parses every private policy input without embedding policy values in SQL", () => {
    const policy = parseManagedRuntimePolicy(validPolicyEnvironment());
    expect(managedRuntimePolicyParameters(policy)).toHaveLength(10);
    expect(MANAGED_RUNTIME_POLICY_UPSERT_SQL).toContain(
      "ELSE public.managed_runtime_policy.policy_version + 1",
    );
    expect(MANAGED_RUNTIME_POLICY_UPSERT_SQL).toContain(
      "public.managed_runtime_policy.revision = EXCLUDED.revision",
    );
    expect(MANAGED_RUNTIME_POLICY_UPSERT_SQL).toContain("IS NOT DISTINCT FROM");
    expect(MANAGED_RUNTIME_POLICY_UPSERT_SQL).toContain("pg_catalog.statement_timestamp()");
    expect(MANAGED_RUNTIME_POLICY_UPSERT_SQL).toContain(
      "true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1",
    );
    expect(MANAGED_RUNTIME_POLICY_UPSERT_SQL).not.toContain(policy.revision);
    expect(MANAGED_RUNTIME_POLICY_UPSERT_SQL).toContain("RETURNING policy_version");

    const script = readFileSync(
      fileURLToPath(new URL("../../../scripts/db/sync-managed-runtime-policy.ts", import.meta.url)),
      "utf8",
    );
    expect(script).not.toMatch(/console\.(?:info|log)\(/);
    expect(script).not.toMatch(/console\.error\([^)]*revision/i);
  });

  it("rejects malformed revisions, non-positive policy values, and unsafe retention", () => {
    const malformedRevision = validPolicyEnvironment();
    malformedRevision.MANAGED_POLICY_REVISION = "contains whitespace";
    expect(() => parseManagedRuntimePolicy(malformedRevision)).toThrow("MANAGED_POLICY_REVISION");

    for (const variable of MANAGED_POLICY_VARIABLES.filter(
      (candidate) => candidate !== "MANAGED_POLICY_REVISION",
    )) {
      const environment = validPolicyEnvironment();
      environment[variable] = "0";
      expect(() => parseManagedRuntimePolicy(environment)).toThrow(variable);
    }

    const unsafeRetention = validPolicyEnvironment();
    unsafeRetention.SCAN_RETENTION_DAYS = String(366);
    expect(() => parseManagedRuntimePolicy(unsafeRetention)).toThrow("SCAN_RETENTION_DAYS");
  });

  it("accepts an optional policy file only when it is a bounded regular mode-0600 file", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "trendsfast-managed-policy-"));
    const policyPath = join(temporaryDirectory, "managed-policy.env");
    writeFileSync(policyPath, "MANAGED_POLICY_REVISION=not-loaded-by-this-test\n", {
      encoding: "utf8",
      mode: 0o600,
    });

    await expect(validatedManagedPolicyFilePath({ MANAGED_POLICY_FILE: policyPath })).resolves.toBe(
      policyPath,
    );
    chmodSync(policyPath, 0o640);
    await expect(
      validatedManagedPolicyFilePath({ MANAGED_POLICY_FILE: policyPath }),
    ).rejects.toThrow("mode 0600");
    await expect(validatedManagedPolicyFilePath({})).resolves.toBeNull();
  });

  it("treats an explicitly selected policy file as the complete policy authority", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "trendsfast-managed-policy-authority-"));
    const policyPath = join(temporaryDirectory, "managed-policy.env");
    const fileEnvironment = validPolicyEnvironment();
    fileEnvironment.MANAGED_POLICY_REVISION = "f".repeat(32);
    writeFileSync(
      policyPath,
      `${MANAGED_POLICY_VARIABLES.map(
        (variable) => `${variable}=${fileEnvironment[variable]}`,
      ).join("\n")}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const ambientEnvironment = {
      ...validPolicyEnvironment(),
      MANAGED_POLICY_REVISION: "a".repeat(32),
      MANAGED_POLICY_FILE: policyPath,
    };

    await expect(resolveManagedRuntimePolicy(ambientEnvironment)).resolves.toMatchObject({
      revision: "f".repeat(32),
    });

    writeFileSync(policyPath, `MANAGED_POLICY_REVISION=${"m".repeat(32)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await expect(resolveManagedRuntimePolicy(ambientEnvironment)).rejects.toThrow(
      "PUBLIC_SCAN_DAILY_LIMIT",
    );
  });

  it("requires the direct database URL and an explicit verified CA", () => {
    const certificate = [
      "-----BEGIN CERTIFICATE-----",
      "test-certificate-body",
      "-----END CERTIFICATE-----",
    ].join("\n");
    expect(() =>
      managedPolicyDatabaseConnection({
        ROLE_ADMIN_DATABASE_URL: "postgresql://admin.invalid/database",
        DATABASE_SSL_CA: certificate,
      }),
    ).toThrow("DIRECT_DATABASE_URL");
    expect(() =>
      managedPolicyDatabaseConnection({
        DIRECT_DATABASE_URL: "postgresql://direct.invalid/database",
      }),
    ).toThrow("DATABASE_SSL_CA");
    expect(
      managedPolicyDatabaseConnection({
        DIRECT_DATABASE_URL: "postgresql://direct.invalid/database",
        DATABASE_SSL_CA: certificate,
      }),
    ).toEqual({
      connectionString: "postgresql://direct.invalid/database",
      sslCa: certificate,
    });
  });
});

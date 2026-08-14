import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertLiveDatabaseCliIdentity,
  databaseCliTarget,
  PINNED_PRODUCTION_DATABASE_PATHS,
  RuntimeRoleUnsafeDefaultAclError,
  loadPinnedProductionDatabaseEnvironment,
  resolveDatabaseCliEnvironment,
  resolveRuntimeRoleIntegrationEnvironment,
  runtimeRoleVerificationFailureCategory,
  type ProductionDatabaseCliProfile,
} from "../src/production-cli-environment";
import { DATABASE_ROLES } from "../src/runtime-roles";

const runtimeUrls = {
  DATABASE_URL: "postgresql://public:secret@runtime.invalid/postgres",
  MEMBER_DATABASE_URL: "postgresql://member:secret@runtime.invalid/postgres",
  OPS_DATABASE_URL: "postgresql://ops:secret@runtime.invalid/postgres",
  WORKER_DATABASE_URL: "postgresql://worker:secret@runtime.invalid/postgres",
  BILLING_DATABASE_URL: "postgresql://billing:secret@runtime.invalid/postgres",
  AUTH_DATABASE_URL: "postgresql://auth:secret@runtime.invalid/postgres",
  RETENTION_DATABASE_URL: "postgresql://retention:secret@runtime.invalid/postgres",
} as const;

const roleSecrets = {
  TRENDSFAST_MIGRATOR_PASSWORD: "migrator-password-value",
  TRENDSFAST_PUBLIC_RUNTIME_PASSWORD: "public-password-value",
  TRENDSFAST_MEMBER_RUNTIME_PASSWORD: "member-password-value",
  TRENDSFAST_OPS_RUNTIME_PASSWORD: "ops-password-value",
  TRENDSFAST_WORKER_RUNTIME_PASSWORD: "worker-password-value",
  TRENDSFAST_BILLING_RUNTIME_PASSWORD: "billing-password-value",
  TRENDSFAST_AUTH_RUNTIME_PASSWORD: "auth-password-value",
  TRENDSFAST_RETENTION_RUNTIME_PASSWORD: "retention-password-value",
} as const;

const localRoleSecrets = Object.fromEntries(
  Object.keys(roleSecrets).map((name) => [name, `ci-${name.toLowerCase()}-${"x".repeat(40)}`]),
) as Record<keyof typeof roleSecrets, string>;

function localUrl(role: string, password = "ci-database-password"): string {
  return `postgresql://${role}:${password}@127.0.0.1:5432/trendsfast`;
}

function localRoleEnvironment(
  includeSecrets = false,
): Readonly<Record<string, string | undefined>> {
  return {
    CI: "true",
    RUN_DATABASE_INTEGRATION: "1",
    ALLOW_LOCAL_ROLE_VERIFICATION: "YES",
    ROLE_ADMIN_DATABASE_URL: localUrl("trendsfast_managed_operator"),
    DIRECT_DATABASE_URL: localUrl("trendsfast_managed_operator"),
    DATABASE_URL: localUrl(DATABASE_ROLES.public),
    MEMBER_DATABASE_URL: localUrl(DATABASE_ROLES.member),
    OPS_DATABASE_URL: localUrl(DATABASE_ROLES.ops),
    WORKER_DATABASE_URL: localUrl(DATABASE_ROLES.worker),
    BILLING_DATABASE_URL: localUrl(DATABASE_ROLES.billing),
    AUTH_DATABASE_URL: localUrl(DATABASE_ROLES.auth),
    RETENTION_DATABASE_URL: localUrl(DATABASE_ROLES.retention),
    ...(includeSecrets ? localRoleSecrets : {}),
  };
}

function localHostedEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    CI: "true",
    RUN_DATABASE_INTEGRATION: "1",
    DATABASE_URL: localUrl("trendsfast_managed_operator"),
    DIRECT_DATABASE_URL: localUrl(DATABASE_ROLES.migrator),
  };
}

function localRuntimeIntegrationEnvironment(): Readonly<Record<string, string | undefined>> {
  const roles = localRoleEnvironment();
  return {
    ...roles,
    ALLOW_LOCAL_ROLE_VERIFICATION: undefined,
    ROLE_ADMIN_DATABASE_URL: "",
    DIRECT_DATABASE_URL: localUrl(DATABASE_ROLES.migrator),
    RUN_DATABASE_ROLE_INTEGRATION: "1",
  };
}

let roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function serialize(values: Readonly<Record<string, string>>): string {
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

function writePrivate(root: string, relativePath: string, contents: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tf-production-db-env-"));
  roots.push(root);
  writePrivate(
    root,
    PINNED_PRODUCTION_DATABASE_PATHS.migrator,
    serialize({ DIRECT_DATABASE_URL: "postgresql://migrator:secret@database.invalid/postgres" }),
  );
  writePrivate(
    root,
    PINNED_PRODUCTION_DATABASE_PATHS.productionInventory,
    serialize({ DATABASE_SSL_CA: "pinned-ca", UNRELATED: "must-not-load" }),
  );
  writePrivate(root, PINNED_PRODUCTION_DATABASE_PATHS.runtimeUrls, serialize(runtimeUrls));
  writePrivate(root, PINNED_PRODUCTION_DATABASE_PATHS.runtimeSecrets, serialize(roleSecrets));
  return root;
}

function load(
  root: string,
  profile: ProductionDatabaseCliProfile,
  ambient: Readonly<Record<string, string | undefined>> = {},
  isIgnored: (relativePath: string) => boolean = () => true,
) {
  return loadPinnedProductionDatabaseEnvironment(profile, {
    ambient,
    isIgnored,
    repositoryRoot: root,
  });
}

describe("pinned production database CLI environment", () => {
  it("loads only the exact profile values without mutating ambient state or printing", () => {
    const root = fixtureRoot();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(load(root, "migrate")).toEqual({
      DIRECT_DATABASE_URL: "postgresql://migrator:secret@database.invalid/postgres",
      DATABASE_SSL_CA: "pinned-ca",
    });
    expect(load(root, "verify-hosted")).toEqual(load(root, "migrate"));
    expect(load(root, "verify-runtime-roles")).toMatchObject(runtimeUrls);
    expect(load(root, "verify-runtime-roles").UNRELATED).toBeUndefined();
    expect(load(root, "provision-runtime-roles")).toMatchObject(roleSecrets);
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("rejects a conflicting ambient value but accepts an identical one", () => {
    const root = fixtureRoot();
    expect(() =>
      load(root, "migrate", { DIRECT_DATABASE_URL: "postgresql://attacker.invalid/postgres" }),
    ).toThrow("conflicts with its pinned private inventory");
    expect(
      load(root, "migrate", {
        DIRECT_DATABASE_URL: "postgresql://migrator:secret@database.invalid/postgres",
      }).DIRECT_DATABASE_URL,
    ).toContain("migrator");
  });

  it("rejects unignored, non-0600, symlinked, and unexpected-shape inventories", () => {
    const unignoredRoot = fixtureRoot();
    expect(() => load(unignoredRoot, "migrate", {}, () => false)).toThrow("must remain ignored");

    const permissiveRoot = fixtureRoot();
    chmodSync(join(permissiveRoot, PINNED_PRODUCTION_DATABASE_PATHS.migrator), 0o644);
    expect(() => load(permissiveRoot, "migrate")).toThrow("mode-0600");

    const symlinkRoot = fixtureRoot();
    const migratorPath = join(symlinkRoot, PINNED_PRODUCTION_DATABASE_PATHS.migrator);
    const targetPath = join(symlinkRoot, ".var/private/migrator-target.env");
    writePrivate(
      symlinkRoot,
      ".var/private/migrator-target.env",
      serialize({ DIRECT_DATABASE_URL: "postgresql://migrator:secret@database.invalid/postgres" }),
    );
    unlinkSync(migratorPath);
    symlinkSync(targetPath, migratorPath);
    expect(() => load(symlinkRoot, "migrate")).toThrow("mode-0600");

    const extraRoot = fixtureRoot();
    writePrivate(
      extraRoot,
      PINNED_PRODUCTION_DATABASE_PATHS.runtimeUrls,
      `${serialize(runtimeUrls)}UNEXPECTED_DATABASE_URL="postgresql://unexpected.invalid/postgres"\n`,
    );
    expect(() => load(extraRoot, "verify-runtime-roles")).toThrow("unexpected variable shape");
  });

  it("requires role-admin and role-secret indirection to remain pinned", () => {
    const root = fixtureRoot();
    expect(() =>
      load(root, "verify-runtime-roles", {
        ROLE_ADMIN_DATABASE_URL: "postgresql://postgres:secret@database.invalid/postgres",
      }),
    ).toThrow("requires its pinned private inventory");
    expect(() =>
      load(root, "provision-runtime-roles", {
        RUNTIME_ROLE_SECRETS_FILE: "/tmp/attacker.env",
      }),
    ).toThrow("overrides are not accepted");

    const adminUrl = "postgresql://postgres:secret@database.invalid/postgres";
    writePrivate(
      root,
      PINNED_PRODUCTION_DATABASE_PATHS.roleAdmin,
      serialize({ ROLE_ADMIN_DATABASE_URL: adminUrl }),
    );
    expect(
      load(root, "verify-runtime-roles", { ROLE_ADMIN_DATABASE_URL: adminUrl })
        .ROLE_ADMIN_DATABASE_URL,
    ).toBe(adminUrl);
  });
});

describe("explicit local database CLI integration profiles", () => {
  it("classifies only the typed unsafe-default-ACL condition without reflecting errors", () => {
    const canary = "secret-canary-must-not-appear";
    const knownCategory = runtimeRoleVerificationFailureCategory(
      new RuntimeRoleUnsafeDefaultAclError(),
    );
    const genericCategory = runtimeRoleVerificationFailureCategory(new Error(canary));

    expect(knownCategory).toBe("RUNTIME_ROLE_UNSAFE_DEFAULT_ACL");
    expect(genericCategory).toBe("RUNTIME_ROLE_VERIFICATION_FAILED");
    expect(JSON.stringify({ ok: false, error: genericCategory })).not.toContain(canary);
  });

  it("keeps the pinned loader as the only signal-free production path", () => {
    const production = Object.freeze({
      DIRECT_DATABASE_URL: "pinned-production-url",
      DATABASE_SSL_CA: "pinned-production-ca",
    });
    const loadProduction = vi.fn(() => production);

    const execution = resolveDatabaseCliEnvironment("verify-hosted", {
      ambient: {},
      loadProduction,
    });

    expect(execution).toEqual({ mode: "production", environment: production });
    expect(loadProduction).toHaveBeenCalledExactlyOnceWith("verify-hosted");
  });

  it("resolves the exact hosted verifier transition without reading production inventories", () => {
    const loadProduction = vi.fn(() => {
      throw new Error("production inventory must not be read");
    });
    const execution = resolveDatabaseCliEnvironment("verify-hosted", {
      ambient: localHostedEnvironment(),
      loadProduction,
    });

    expect(execution.mode).toBe("ci-integration");
    expect(loadProduction).not.toHaveBeenCalled();
    const target = databaseCliTarget({
      execution,
      variable: "DIRECT_DATABASE_URL",
      productionEndpoint: "direct-or-session",
      productionRole: DATABASE_ROLES.migrator,
      ciRole: DATABASE_ROLES.migrator,
    });
    expect(target).toEqual({
      mode: "ci-integration",
      connectionString: localUrl(DATABASE_ROLES.migrator),
      expectedDatabase: "trendsfast",
      expectedRole: DATABASE_ROLES.migrator,
      sslCa: undefined,
    });
    expect(() =>
      assertLiveDatabaseCliIdentity(
        { current_database: "trendsfast", current_user: DATABASE_ROLES.migrator },
        target,
      ),
    ).not.toThrow();
    expect(() =>
      assertLiveDatabaseCliIdentity(
        { current_database: "postgres", current_user: DATABASE_ROLES.migrator },
        target,
      ),
    ).toThrow("exact local CI target");
  });

  it("resolves provision and verify profiles only behind the explicit role gate", () => {
    const provision = resolveDatabaseCliEnvironment("provision-runtime-roles", {
      ambient: localRoleEnvironment(true),
      loadProduction: () => {
        throw new Error("production inventory must not be read");
      },
    });
    expect(provision).toMatchObject({
      mode: "ci-integration",
      environment: {
        ALLOW_LOCAL_ROLE_VERIFICATION: "YES",
        ROLE_ADMIN_DATABASE_URL: localUrl("trendsfast_managed_operator"),
        DATABASE_URL: localUrl(DATABASE_ROLES.public),
        ...localRoleSecrets,
      },
    });

    const verifyWithProvisionSecrets = resolveDatabaseCliEnvironment("verify-runtime-roles", {
      ambient: localRoleEnvironment(true),
    });
    expect(verifyWithProvisionSecrets.mode).toBe("ci-integration");
    expect(verifyWithProvisionSecrets.environment.TRENDSFAST_MIGRATOR_PASSWORD).toBeUndefined();
  });

  it.each([
    [
      "partial CI gate",
      "verify-hosted",
      { ...localHostedEnvironment(), RUN_DATABASE_INTEGRATION: undefined },
    ],
    ["wrong CI gate", "verify-hosted", { ...localHostedEnvironment(), CI: "1" }],
    [
      "unexpected role gate on schema verification",
      "verify-hosted",
      { ...localHostedEnvironment(), ALLOW_LOCAL_ROLE_VERIFICATION: "YES" },
    ],
    [
      "write-capable test gate on schema verification",
      "verify-hosted",
      { ...localHostedEnvironment(), RUN_DATABASE_ROLE_INTEGRATION: "1" },
    ],
    [
      "missing role gate",
      "verify-runtime-roles",
      { ...localRoleEnvironment(), ALLOW_LOCAL_ROLE_VERIFICATION: undefined },
    ],
    ["production CA", "verify-runtime-roles", { ...localRoleEnvironment(), DATABASE_SSL_CA: "" }],
    [
      "secret-file override",
      "provision-runtime-roles",
      { ...localRoleEnvironment(true), RUNTIME_ROLE_SECRETS_FILE: "" },
    ],
    [
      "hosted role ambiguity",
      "verify-hosted",
      { ...localHostedEnvironment(), OPS_DATABASE_URL: localUrl(DATABASE_ROLES.ops) },
    ],
    [
      "localhost alias",
      "verify-hosted",
      {
        ...localHostedEnvironment(),
        DIRECT_DATABASE_URL: `postgresql://${DATABASE_ROLES.migrator}:secret@localhost:5432/trendsfast`,
      },
    ],
    [
      "wrong runtime identity",
      "verify-runtime-roles",
      { ...localRoleEnvironment(), OPS_DATABASE_URL: localUrl(DATABASE_ROLES.worker) },
    ],
    [
      "non-loopback host",
      "verify-hosted",
      {
        ...localHostedEnvironment(),
        DIRECT_DATABASE_URL: `postgresql://${DATABASE_ROLES.migrator}:secret@database.invalid:5432/trendsfast`,
      },
    ],
    [
      "query override",
      "verify-hosted",
      {
        ...localHostedEnvironment(),
        DIRECT_DATABASE_URL: `${localUrl(DATABASE_ROLES.migrator)}?sslmode=disable`,
      },
    ],
    [
      "different database",
      "verify-hosted",
      {
        ...localHostedEnvironment(),
        DIRECT_DATABASE_URL: localUrl(DATABASE_ROLES.migrator).replace(/trendsfast$/u, "postgres"),
      },
    ],
    [
      "split role-admin URLs",
      "verify-runtime-roles",
      {
        ...localRoleEnvironment(),
        DIRECT_DATABASE_URL: localUrl("trendsfast_managed_operator", "different-password"),
      },
    ],
  ] as const)("rejects %s", (_name, profile, ambient) => {
    expect(() =>
      resolveDatabaseCliEnvironment(profile as ProductionDatabaseCliProfile, {
        ambient,
        loadProduction: () => {
          throw new Error("must not fall back to production");
        },
      }),
    ).toThrow();
  });

  it("pins the write-capable runtime integration test to its exact local matrix", () => {
    const execution = resolveRuntimeRoleIntegrationEnvironment(
      localRuntimeIntegrationEnvironment(),
    );
    expect(execution).toMatchObject({
      mode: "ci-integration",
      environment: {
        CI: "true",
        RUN_DATABASE_INTEGRATION: "1",
        RUN_DATABASE_ROLE_INTEGRATION: "1",
        DIRECT_DATABASE_URL: localUrl(DATABASE_ROLES.migrator),
        DATABASE_URL: localUrl(DATABASE_ROLES.public),
        RETENTION_DATABASE_URL: localUrl(DATABASE_ROLES.retention),
      },
    });
    expect(execution.environment.ROLE_ADMIN_DATABASE_URL).toBeUndefined();
  });

  it.each([
    ["missing CI gate", { ...localRuntimeIntegrationEnvironment(), CI: undefined }],
    [
      "missing database integration gate",
      { ...localRuntimeIntegrationEnvironment(), RUN_DATABASE_INTEGRATION: undefined },
    ],
    [
      "wrong role integration gate",
      { ...localRuntimeIntegrationEnvironment(), RUN_DATABASE_ROLE_INTEGRATION: "true" },
    ],
    ["hosted CA", { ...localRuntimeIntegrationEnvironment(), DATABASE_SSL_CA: "" }],
    [
      "nonempty role administrator",
      {
        ...localRuntimeIntegrationEnvironment(),
        ROLE_ADMIN_DATABASE_URL: localUrl("trendsfast_managed_operator"),
      },
    ],
    [
      "whitespace role administrator",
      { ...localRuntimeIntegrationEnvironment(), ROLE_ADMIN_DATABASE_URL: " " },
    ],
    [
      "local verification override",
      { ...localRuntimeIntegrationEnvironment(), ALLOW_LOCAL_ROLE_VERIFICATION: "YES" },
    ],
    [
      "role provisioning secret",
      {
        ...localRuntimeIntegrationEnvironment(),
        TRENDSFAST_MIGRATOR_PASSWORD: "x".repeat(40),
      },
    ],
    [
      "wrong public identity",
      {
        ...localRuntimeIntegrationEnvironment(),
        DATABASE_URL: localUrl(DATABASE_ROLES.member),
      },
    ],
    [
      "wrong direct database",
      {
        ...localRuntimeIntegrationEnvironment(),
        DIRECT_DATABASE_URL: localUrl(DATABASE_ROLES.migrator).replace(/trendsfast$/u, "postgres"),
      },
    ],
  ])("rejects runtime integration with %s", (_name, ambient) => {
    expect(() => resolveRuntimeRoleIntegrationEnvironment(ambient)).toThrow();
  });
});

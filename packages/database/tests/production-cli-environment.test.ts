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
  PINNED_PRODUCTION_DATABASE_PATHS,
  loadPinnedProductionDatabaseEnvironment,
  type ProductionDatabaseCliProfile,
} from "../src/production-cli-environment";

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

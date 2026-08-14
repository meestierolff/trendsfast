import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadCliEnvironment } from "../src/load-cli-env";
import {
  assertLiveMigrationIdentity,
  migrationConnectionString,
  migrationTarget,
  resolveMigrationEnvironment,
} from "../src/migrate";
import { PRODUCTION_SUPABASE_PROJECT_REF } from "../src/production-target";

const original = process.env.TRENDSFAST_ENV_LOADER_TEST;
let directory: string | undefined;
const productionCa = `${[
  readFileSync(
    new URL("../../../config/certs/supabase-prod-ca-2021.crt", import.meta.url),
    "utf8",
  ).trimEnd(),
  readFileSync(
    new URL("../../../config/certs/supabase-prod-ca-2025.crt", import.meta.url),
    "utf8",
  ).trimEnd(),
].join("\n")}\n`;

afterEach(() => {
  if (original === undefined) delete process.env.TRENDSFAST_ENV_LOADER_TEST;
  else process.env.TRENDSFAST_ENV_LOADER_TEST = original;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("database CLI environment loading", () => {
  it("loads .env.local before .env without printing values", () => {
    directory = mkdtempSync(join(tmpdir(), "trendsfast-env-test-"));
    writeFileSync(join(directory, ".env"), "TRENDSFAST_ENV_LOADER_TEST=from-env\n", "utf8");
    writeFileSync(join(directory, ".env.local"), "TRENDSFAST_ENV_LOADER_TEST=from-local\n", "utf8");
    delete process.env.TRENDSFAST_ENV_LOADER_TEST;

    loadCliEnvironment(directory);

    expect(process.env.TRENDSFAST_ENV_LOADER_TEST).toBe("from-local");
  });

  it("prefers the direct PostgreSQL URL for controlled migrations", () => {
    const directUrl = `postgresql://trendsfast_migrator:secret@db.${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`;
    expect(
      migrationConnectionString({
        DATABASE_URL: "postgresql://runtime.invalid/runtime",
        DIRECT_DATABASE_URL: directUrl,
        DATABASE_SSL_CA: productionCa,
      }),
    ).toBe(directUrl);
    expect(() =>
      migrationConnectionString({ DATABASE_URL: "postgresql://runtime.invalid/runtime" }),
    ).toThrow("DIRECT_DATABASE_URL is required");
    expect(() =>
      migrationConnectionString({
        DIRECT_DATABASE_URL: "https://db.invalid",
        DATABASE_SSL_CA: productionCa,
      }),
    ).toThrow("must use PostgreSQL");
  });
});

describe("migration environment isolation", () => {
  const localOperatorUrl =
    "postgresql://trendsfast_managed_operator:trendsfast_ci@127.0.0.1:5432/trendsfast";
  const localMigratorUrl =
    "postgresql://trendsfast_migrator:ci-migrator-password@127.0.0.1:5432/trendsfast";
  const localServiceUrl = "postgresql://trendsfast:trendsfast_ci@127.0.0.1:5432/trendsfast";

  function ciEnvironment(
    overrides: Readonly<Record<string, string | undefined>> = {},
  ): Readonly<Record<string, string | undefined>> {
    return {
      CI: "true",
      RUN_DATABASE_INTEGRATION: "1",
      DATABASE_URL: localOperatorUrl,
      DIRECT_DATABASE_URL: localOperatorUrl,
      ...overrides,
    };
  }

  it("uses the explicit local integration target without reading production inventories", () => {
    const loadProduction = vi.fn(() => {
      throw new Error("production inventory must not be read");
    });

    const environment = resolveMigrationEnvironment(ciEnvironment(), loadProduction);
    expect(loadProduction).not.toHaveBeenCalled();
    expect(migrationTarget(environment)).toEqual({
      mode: "ci-integration",
      connectionString: localOperatorUrl,
      expectedDatabase: "trendsfast",
      expectedRole: "trendsfast_managed_operator",
      sslCa: undefined,
    });
  });

  it("accepts only the workflow's deliberate identity shapes", () => {
    expect(
      migrationTarget(
        ciEnvironment({
          DATABASE_URL: localServiceUrl,
          DIRECT_DATABASE_URL: localServiceUrl,
        }),
      ).mode,
    ).toBe("ci-integration");
    expect(
      migrationTarget(
        ciEnvironment({
          DIRECT_DATABASE_URL: localMigratorUrl,
        }),
      ),
    ).toMatchObject({
      mode: "ci-integration",
      connectionString: localMigratorUrl,
      expectedRole: "trendsfast_migrator",
    });
  });

  it("binds the live identity to the selected local URL", () => {
    const target = migrationTarget(
      ciEnvironment({
        DIRECT_DATABASE_URL: localMigratorUrl,
      }),
    );
    expect(() =>
      assertLiveMigrationIdentity(
        { current_database: "trendsfast", current_user: "trendsfast_migrator" },
        target,
      ),
    ).not.toThrow();
    expect(() =>
      assertLiveMigrationIdentity(
        { current_database: "postgres", current_user: "trendsfast_migrator" },
        target,
      ),
    ).toThrow("live PostgreSQL identity");
    expect(() =>
      assertLiveMigrationIdentity(
        { current_database: "trendsfast", current_user: "trendsfast_managed_operator" },
        target,
      ),
    ).toThrow("live PostgreSQL identity");
  });

  it("keeps the pinned production loader as the only non-CI path", () => {
    const pinned = Object.freeze({
      DIRECT_DATABASE_URL: "pinned-production-url",
      DATABASE_SSL_CA: "pinned-production-ca",
    });
    const loadProduction = vi.fn(() => pinned);

    expect(resolveMigrationEnvironment({}, loadProduction)).toBe(pinned);
    expect(loadProduction).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong CI gate", { CI: "1" }],
    ["wrong integration gate", { RUN_DATABASE_INTEGRATION: "true" }],
    ["empty CI gate", { CI: "" }],
    ["missing runtime URL", { DATABASE_URL: undefined }],
    ["missing direct URL", { DIRECT_DATABASE_URL: undefined }],
    [
      "localhost alias",
      {
        DATABASE_URL: "postgresql://trendsfast_managed_operator:secret@localhost:5432/trendsfast",
      },
    ],
    [
      "alternate PostgreSQL scheme",
      {
        DIRECT_DATABASE_URL:
          "postgres://trendsfast_managed_operator:secret@127.0.0.1:5432/trendsfast",
      },
    ],
    [
      "normalized numeric host alias",
      {
        DIRECT_DATABASE_URL:
          "postgresql://trendsfast_managed_operator:secret@127.000.000.001:5432/trendsfast",
      },
    ],
    [
      "non-loopback host",
      {
        DIRECT_DATABASE_URL:
          "postgresql://trendsfast_managed_operator:secret@database.invalid:5432/trendsfast",
      },
    ],
    [
      "production host",
      {
        DIRECT_DATABASE_URL: `postgresql://trendsfast_migrator:secret@db.${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`,
      },
    ],
    [
      "different port",
      {
        DIRECT_DATABASE_URL:
          "postgresql://trendsfast_managed_operator:secret@127.0.0.1:5433/trendsfast",
      },
    ],
    [
      "different database",
      {
        DIRECT_DATABASE_URL:
          "postgresql://trendsfast_managed_operator:secret@127.0.0.1:5432/postgres",
      },
    ],
    ["query override", { DIRECT_DATABASE_URL: `${localOperatorUrl}?sslmode=disable` }],
    ["fragment", { DIRECT_DATABASE_URL: `${localOperatorUrl}#other` }],
    [
      "missing password",
      {
        DIRECT_DATABASE_URL: "postgresql://trendsfast_managed_operator@127.0.0.1:5432/trendsfast",
      },
    ],
    [
      "unapproved role",
      {
        DATABASE_URL: "postgresql://postgres:secret@127.0.0.1:5432/trendsfast",
        DIRECT_DATABASE_URL: "postgresql://postgres:secret@127.0.0.1:5432/trendsfast",
      },
    ],
    ["surrounding whitespace", { DIRECT_DATABASE_URL: ` ${localOperatorUrl}` }],
    ["production CA", { DATABASE_SSL_CA: productionCa }],
    ["defined-empty production CA", { DATABASE_SSL_CA: "" }],
    [
      "unrelated production role URL",
      {
        OPS_DATABASE_URL: "postgresql://trendsfast_ops_runtime:secret@127.0.0.1:5432/trendsfast",
      },
    ],
    [
      "unapproved identity transition",
      {
        DATABASE_URL: localServiceUrl,
        DIRECT_DATABASE_URL: localMigratorUrl,
      },
    ],
  ])("rejects %s", (_name, overrides) => {
    expect(() => migrationTarget(ciEnvironment(overrides))).toThrow();
  });

  it.each([
    { ambient: { CI: "true" }, name: "missing integration gate" },
    { ambient: { RUN_DATABASE_INTEGRATION: "1" }, name: "missing CI gate" },
    {
      ambient: { CI: "false", RUN_DATABASE_INTEGRATION: "1" },
      name: "disabled CI gate",
    },
  ])("does not fall back to production with $name", ({ ambient }) => {
    const loadProduction = vi.fn(() => ({
      DIRECT_DATABASE_URL: "pinned-production-url",
      DATABASE_SSL_CA: "pinned-production-ca",
    }));

    expect(() => resolveMigrationEnvironment(ambient, loadProduction)).toThrow(
      "exact CI integration gates",
    );
    expect(loadProduction).not.toHaveBeenCalled();
  });
});

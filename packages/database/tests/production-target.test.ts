import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DATABASE_ROLES } from "../src/runtime-roles";
import {
  PRODUCTION_SUPABASE_POOLER_HOST,
  PRODUCTION_SUPABASE_PROJECT_REF,
  assertLiveProductionDatabaseIdentity,
  assertProductionDatabaseTarget,
} from "../src/production-target";

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

function assertMigrator(connectionString: string, sslCa = productionCa) {
  return assertProductionDatabaseTarget({
    connectionString,
    endpoint: "direct-or-session",
    expectedRole: DATABASE_ROLES.migrator,
    sslCa,
  });
}

describe("sole production database target", () => {
  it("accepts only the pinned direct/session and runtime pooler shapes", () => {
    const direct = `postgresql://trendsfast_migrator:secret@db.${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`;
    const session = `postgresql://trendsfast_migrator.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@${PRODUCTION_SUPABASE_POOLER_HOST}:5432/postgres`;
    expect(assertMigrator(direct).connectionString).toBe(direct);
    expect(assertMigrator(session).connectionString).toBe(session);

    const roleAdmin = `postgresql://postgres.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@${PRODUCTION_SUPABASE_POOLER_HOST}:5432/postgres`;
    expect(
      assertProductionDatabaseTarget({
        connectionString: roleAdmin,
        endpoint: "direct-or-session",
        expectedRole: "postgres",
        sslCa: productionCa,
      }).connectionString,
    ).toBe(roleAdmin);

    const runtime = `postgresql://${DATABASE_ROLES.public}.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@${PRODUCTION_SUPABASE_POOLER_HOST}:6543/postgres`;
    expect(
      assertProductionDatabaseTarget({
        connectionString: runtime,
        endpoint: "transaction-pooler",
        expectedRole: DATABASE_ROLES.public,
        sslCa: productionCa,
      }).connectionString,
    ).toBe(runtime);
  });

  it.each([
    [
      "host",
      `postgresql://trendsfast_migrator.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    ],
    [
      "project ref",
      `postgresql://trendsfast_migrator.wrongproject:secret@${PRODUCTION_SUPABASE_POOLER_HOST}:5432/postgres`,
    ],
    [
      "username",
      `postgresql://postgres.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@${PRODUCTION_SUPABASE_POOLER_HOST}:5432/postgres`,
    ],
    [
      "port",
      `postgresql://trendsfast_migrator.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@${PRODUCTION_SUPABASE_POOLER_HOST}:6543/postgres`,
    ],
    [
      "database",
      `postgresql://trendsfast_migrator.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@${PRODUCTION_SUPABASE_POOLER_HOST}:5432/other`,
    ],
    [
      "query",
      `postgresql://trendsfast_migrator.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@${PRODUCTION_SUPABASE_POOLER_HOST}:5432/postgres?sslmode=require`,
    ],
    [
      "fragment",
      `postgresql://trendsfast_migrator.${PRODUCTION_SUPABASE_PROJECT_REF}:secret@${PRODUCTION_SUPABASE_POOLER_HOST}:5432/postgres#other`,
    ],
  ])("rejects an adversarial wrong %s", (_label, connectionString) => {
    expect(() => assertMigrator(connectionString)).toThrow();
  });

  it("rejects an absent, altered, or non-canonical CA bundle", () => {
    const connectionString = `postgresql://trendsfast_migrator:secret@db.${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`;
    expect(() => assertMigrator(connectionString, "")).toThrow("pinned Supabase production");
    expect(() => assertMigrator(connectionString, `${productionCa} `)).toThrow(
      "pinned Supabase production",
    );
  });

  it("requires the live role and database to match before mutation", () => {
    expect(() =>
      assertLiveProductionDatabaseIdentity(
        { current_user: DATABASE_ROLES.migrator, current_database: "postgres" },
        DATABASE_ROLES.migrator,
      ),
    ).not.toThrow();
    expect(() =>
      assertLiveProductionDatabaseIdentity(
        { current_user: "postgres", current_database: "postgres" },
        DATABASE_ROLES.migrator,
      ),
    ).toThrow("live PostgreSQL identity");
    expect(() =>
      assertLiveProductionDatabaseIdentity(
        { current_user: DATABASE_ROLES.migrator, current_database: "other" },
        DATABASE_ROLES.migrator,
      ),
    ).toThrow("live PostgreSQL identity");
  });
});

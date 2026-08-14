import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BACKUP_SCHEMAS,
  BACKUP_MIGRATOR_ROLE,
  BACKUP_PROJECT_REF,
  PG_DUMP_ARGUMENTS,
  PINNED_DATABASE_CA_SHA256,
  assertPinnedBackupConnection,
  assertPinnedDatabaseCa,
  parsePostgresConnectionString,
  postgresBackupEnvironment,
  validateBackupArchiveListing,
} from "../../../scripts/db/backup-encrypted";
import { APPLICATION_TABLES } from "../src/runtime-roles";

const script = readFileSync(
  fileURLToPath(new URL("../../../scripts/db/backup-encrypted.ts", import.meta.url)),
  "utf8",
);

function validArchiveListing(): string {
  let archiveId = 100;
  let objectId = 10_000;
  const lines = ["; pg_restore archive contents"];
  for (const [schema, tables] of [
    ["public", APPLICATION_TABLES],
    ["drizzle", ["__drizzle_migrations"]],
  ] as const) {
    for (const table of tables) {
      lines.push(`${archiveId++}; 1259 ${objectId++} TABLE ${schema} ${table} owner`);
    }
    for (const table of tables) {
      lines.push(`${archiveId++}; 0 ${objectId++} TABLE DATA ${schema} ${table} owner`);
    }
  }
  return `${lines.join("\n")}\n`;
}

describe("encrypted logical database backup", () => {
  it("uses a custom-format application dump without a connection URL argument", () => {
    expect(BACKUP_SCHEMAS).toEqual(["public", "drizzle"]);
    expect(PG_DUMP_ARGUMENTS).toEqual(
      expect.arrayContaining([
        "--format=custom",
        "--no-password",
        "--no-owner",
        "--no-privileges",
        "--schema=public",
        "--schema=drizzle",
      ]),
    );
    expect(PG_DUMP_ARGUMENTS.some((argument) => argument.includes("://"))).toBe(false);
    expect(script).toContain("PGPASSWORD: connection.password");
    expect(script).toContain('PGSSLMODE: "verify-full"');
    expect(script).toContain("PGSSLROOTCERT: caPath");
    expect(script).toContain('spawn(process.env.PG_DUMP_BIN?.trim() || "pg_dump"');
  });

  it("parses credentials privately and overrides URL TLS options with verified TLS env", () => {
    const connection = parsePostgresConnectionString(
      "postgresql://backup_user:p%40ssword@db.example.test:6543/app_db?sslmode=disable",
    );
    const environment = postgresBackupEnvironment(connection, "/private/database-ca.pem");

    expect(environment).toMatchObject({
      PGDATABASE: "app_db",
      PGHOST: "db.example.test",
      PGPASSWORD: "p@ssword",
      PGPORT: "6543",
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: "/private/database-ca.pem",
      PGTARGETSESSIONATTRS: "read-write",
      PGUSER: "backup_user",
    });
    expect(environment.DIRECT_DATABASE_URL).toBeUndefined();
    expect(environment.DATABASE_URL).toBeUndefined();
    expect(() => parsePostgresConnectionString("https://db.example.test/app_db")).toThrow(
      "must use PostgreSQL",
    );
    expect(() => parsePostgresConnectionString("postgresql://db.example.test/app_db")).toThrow(
      "incomplete",
    );
  });

  it("pins the sole production project, migrator identity, endpoint, and CA bundle", () => {
    expect(BACKUP_PROJECT_REF).toBe("auxienkuufejeakaczlq");
    expect(BACKUP_MIGRATOR_ROLE).toBe("trendsfast_migrator");
    expect(() =>
      assertPinnedBackupConnection(
        parsePostgresConnectionString(
          `postgresql://${BACKUP_MIGRATOR_ROLE}.${BACKUP_PROJECT_REF}:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
        ),
      ),
    ).not.toThrow();
    expect(() =>
      assertPinnedBackupConnection(
        parsePostgresConnectionString(
          `postgresql://${BACKUP_MIGRATOR_ROLE}:secret@db.${BACKUP_PROJECT_REF}.supabase.co:5432/postgres`,
        ),
      ),
    ).not.toThrow();
    for (const value of [
      `postgresql://${BACKUP_MIGRATOR_ROLE}.anotherproject:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      `postgresql://${BACKUP_MIGRATOR_ROLE}.${BACKUP_PROJECT_REF}:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
      `postgresql://${BACKUP_MIGRATOR_ROLE}.${BACKUP_PROJECT_REF}:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
      `postgresql://${BACKUP_MIGRATOR_ROLE}.${BACKUP_PROJECT_REF}:secret@aws-0-eu-central-1.pooler.supabase.com:5432/other`,
    ]) {
      expect(() => assertPinnedBackupConnection(parsePostgresConnectionString(value))).toThrow(
        "pinned production project and migrator",
      );
    }

    const certificateRoot = fileURLToPath(new URL("../../../config/certs/", import.meta.url));
    const ca = `${[
      readFileSync(`${certificateRoot}/supabase-prod-ca-2021.crt`, "utf8").trimEnd(),
      readFileSync(`${certificateRoot}/supabase-prod-ca-2025.crt`, "utf8").trimEnd(),
    ].join("\n")}\n`;
    expect(PINNED_DATABASE_CA_SHA256).toHaveLength(64);
    expect(() => assertPinnedDatabaseCa(ca)).not.toThrow();
    expect(() => assertPinnedDatabaseCa(`${ca} `)).toThrow("pinned Supabase certificate bundle");
  });

  it("accepts only the exact application and migration table/data manifest", () => {
    const listing = validArchiveListing();
    expect(() => validateBackupArchiveListing(listing)).not.toThrow();

    const firstTable = APPLICATION_TABLES[0]!;
    expect(() =>
      validateBackupArchiveListing(
        listing.replace(`TABLE DATA public ${firstTable}`, "TABLE DATA public unexpected_table"),
      ),
    ).toThrow();
    expect(() =>
      validateBackupArchiveListing(
        listing.replace(new RegExp(`^.*TABLE DATA public ${firstTable} owner\\n`, "mu"), ""),
      ),
    ).toThrow("incomplete");
    expect(() =>
      validateBackupArchiveListing(
        listing.replace(`TABLE public ${firstTable}`, `TABLE private ${firstTable}`),
      ),
    ).toThrow("unexpected table manifest");
  });

  it("encrypts the stream before storage and verifies decryption through pg_restore", () => {
    expect(script).toContain('"--passphrase-fd"');
    expect(script).not.toMatch(/["']--passphrase["']/);
    expect(script).toContain('"--cipher-algo"');
    expect(script).toContain('"AES256"');
    expect(script).toContain("dump.stdout.pipe(encryption.stdin)");
    expect(script).toContain("decryption.stdout.pipe(listing.stdin)");
    expect(script).toContain(
      'spawn(process.env.PG_RESTORE_BIN?.trim() || "pg_restore", ["--list"]',
    );
    expect(script).toContain("await verifyEncryptedDump(partialPath");
    expect(script).toContain("validateBackupArchiveListing(listingText)");
    expect(script).toContain("await rename(partialPath, finalPath)");
    expect(script).toContain('mode: "0600"');
    expect(script).toContain("plaintextWrittenToDisk: false");
    expect(script).toContain("connectionUrlPrinted: false");
    expect(script).toContain("passphrasePrinted: false");
    expect(script).not.toContain("shell: true");
    expect(script).not.toContain("process.env.DIRECT_DATABASE_URL");
    expect(script).not.toContain("process.env.DATABASE_SSL_CA");
    expect(script).toContain("artifact: `.var/private/backups/${basename}`");
  });

  it("fails closed with a generic public error and deletes partial or unaccepted output", () => {
    expect(script).toContain("if (cleanupPath) await unlink(cleanupPath)");
    expect(script).toContain("Encrypted logical backup failed; no backup was accepted.");
    expect(script).not.toMatch(/console\.error\([^)]*error/);
  });

  it("exposes the exact launch-facing database command aliases", () => {
    const packageJson = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["db:migrate"]).toBe("tsx packages/database/src/migrate.ts");
    expect(packageJson.scripts["db:verify-hosted"]).toBe("tsx scripts/db/verify-hosted-schema.ts");
    expect(packageJson.scripts["db:provision-runtime-roles"]).toBe(
      "tsx scripts/db/provision-runtime-roles.ts",
    );
    expect(packageJson.scripts["db:verify-runtime-roles"]).toBe(
      "tsx scripts/db/verify-runtime-roles.ts",
    );
    expect(packageJson.scripts["db:backup"]).toBe("tsx scripts/db/backup-encrypted.ts");
  });
});

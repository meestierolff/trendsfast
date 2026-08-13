import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compareHostedSchemaCatalog,
  create0024HostedSchemaManifest,
  EXPECTED_0024_CATALOG_COUNTS,
  EXPECTED_0024_SNAPSHOT_ID,
  EXPECTED_0024_SNAPSHOT_SHA256,
  normalizePostgresIdentifier,
  readPinned0024HostedSchemaManifest,
  type HostedSchemaCatalog,
} from "../../../scripts/db/hosted-schema-manifest";

const snapshotPath = fileURLToPath(
  new URL("../migrations/meta/0024_snapshot.json", import.meta.url),
);
const snapshotBytes = readFileSync(snapshotPath);
const snapshot = JSON.parse(snapshotBytes.toString("utf8")) as {
  id: string;
  tables: Record<
    string,
    {
      name: string;
      columns: Record<string, { name: string }>;
      indexes: Record<string, { name: string }>;
      foreignKeys: Record<string, { name: string }>;
      checkConstraints: Record<string, { name: string }>;
    }
  >;
};

function exactCatalog(): HostedSchemaCatalog {
  const manifest = create0024HostedSchemaManifest(snapshot);
  return {
    tables: manifest.tables,
    columns: manifest.columns,
    enums: manifest.enums,
    indexes: manifest.indexes,
    constraints: manifest.constraints,
  };
}

describe("hosted 0024 schema manifest", () => {
  it("materializes every table column, explicit index, enum, FK, and CHECK in snapshot 0024", () => {
    const manifest = create0024HostedSchemaManifest(snapshot);
    const snapshotTableColumns = Object.fromEntries(
      Object.values(snapshot.tables).map((table) => [table.name, Object.keys(table.columns)]),
    );
    const snapshotIndexes = Object.values(snapshot.tables)
      .flatMap((table) => Object.keys(table.indexes))
      .sort();
    const snapshotConstraints = Object.values(snapshot.tables)
      .flatMap((table) => [
        ...Object.keys(table.foreignKeys),
        ...Object.keys(table.checkConstraints),
      ])
      .map(normalizePostgresIdentifier)
      .sort();

    expect(snapshot.id).toBe(EXPECTED_0024_SNAPSHOT_ID);
    expect(createHash("sha256").update(snapshotBytes).digest("hex")).toBe(
      EXPECTED_0024_SNAPSHOT_SHA256,
    );
    expect(manifest.tableColumns).toEqual(snapshotTableColumns);
    expect(manifest.indexes).toEqual(snapshotIndexes);
    expect(manifest.constraints).toEqual(snapshotConstraints);
    expect({
      tables: manifest.tables.length,
      columns: manifest.columns.length,
      enums: manifest.enums.length,
      indexes: manifest.indexes.length,
      constraints: manifest.constraints.length,
    }).toEqual(EXPECTED_0024_CATALOG_COUNTS);
    expect(manifest.indexes).toEqual(
      expect.arrayContaining([
        "analytics_events_name_occurred_idx",
        "api_auth_admission_window_idx",
        "scan_requests_queue_idx",
        "stripe_customers_project_idx",
      ]),
    );
    expect(manifest.constraints).toContain(
      "next_moves_project_context_version_id_project_context_versions_",
    );
    expect(manifest.constraints).not.toContain(
      "next_moves_project_context_version_id_project_context_versions_id_fk",
    );
  });

  it("fails every missing catalog category and gates every extra category in strict mode", () => {
    const expected = create0024HostedSchemaManifest(snapshot);
    const exact = exactCatalog();
    const missing: HostedSchemaCatalog = {
      tables: exact.tables.slice(1),
      columns: exact.columns.slice(1),
      enums: exact.enums.slice(1),
      indexes: exact.indexes.slice(1),
      constraints: exact.constraints.slice(1),
    };
    const missingDrift = compareHostedSchemaCatalog(expected, missing, false);

    expect(missingDrift.ok).toBe(false);
    expect(missingDrift.missingTables).toEqual([exact.tables[0]]);
    expect(missingDrift.missingColumns).toEqual([exact.columns[0]]);
    expect(missingDrift.missingEnums).toEqual([exact.enums[0]]);
    expect(missingDrift.missingIndexes).toEqual([exact.indexes[0]]);
    expect(missingDrift.missingConstraints).toEqual([exact.constraints[0]]);

    const extra: HostedSchemaCatalog = {
      tables: [...exact.tables, "unexpected_table"],
      columns: [...exact.columns, "unexpected_table.unexpected_column"],
      enums: [...exact.enums, "unexpected_enum"],
      indexes: [...exact.indexes, "unexpected_index"],
      constraints: [...exact.constraints, "unexpected_constraint"],
    };
    const nonStrictDrift = compareHostedSchemaCatalog(expected, extra, false);
    const strictDrift = compareHostedSchemaCatalog(expected, extra, true);

    expect(nonStrictDrift.ok).toBe(true);
    expect(strictDrift.ok).toBe(false);
    expect(strictDrift.extraTables).toEqual(["unexpected_table"]);
    expect(strictDrift.extraColumns).toEqual(["unexpected_table.unexpected_column"]);
    expect(strictDrift.extraEnums).toEqual(["unexpected_enum"]);
    expect(strictDrift.extraIndexes).toEqual(["unexpected_index"]);
    expect(strictDrift.extraConstraints).toEqual(["unexpected_constraint"]);
  });

  it("pins the immutable snapshot and queries only explicit indexes plus FK/CHECK constraints", () => {
    expect(() => create0024HostedSchemaManifest({ ...snapshot, id: "different" })).toThrow(
      EXPECTED_0024_SNAPSHOT_ID,
    );

    const verifier = readFileSync(
      fileURLToPath(new URL("../../../scripts/db/verify-hosted-schema.ts", import.meta.url)),
      "utf8",
    );
    expect(verifier).toContain("constraint_metadata.conindid = index_metadata.indexrelid");
    expect(verifier).toContain("constraint_metadata.oid is null");
    expect(verifier).toContain("constraint_metadata.contype in ('f', 'c')");
    expect(verifier).toContain("compareHostedSchemaCatalog(expectedCatalog, actualCatalog");
    expect(verifier).toContain("readPinned0024HostedSchemaManifest(snapshot0024)");
    expect(verifier).not.toContain("information_schema");
    expect(verifier).toContain("applicationOwnerDriftResult");
    expect(verifier).toContain("platformManagedDefaultGrants");
    expect(verifier).toContain("select oid, rolname from pg_roles where rolname = $2");
    expect(verifier).toContain("coalesce(defaults.defaclacl, acldefault");
    expect(verifier).toContain("schema_additions");
    const tamperedSnapshotBytes = Buffer.from(snapshotBytes);
    tamperedSnapshotBytes[tamperedSnapshotBytes.length - 2] = 32;
    expect(() => readPinned0024HostedSchemaManifest(tamperedSnapshotBytes)).toThrow(
      EXPECTED_0024_SNAPSHOT_SHA256,
    );
  });
});

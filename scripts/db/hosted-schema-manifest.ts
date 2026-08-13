import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export const EXPECTED_0024_SNAPSHOT_ID = "a7f5797d-f8d7-45f0-97b8-57bb2408c95c";
export const EXPECTED_0024_SNAPSHOT_SHA256 =
  "67a5415e96f6eed21be26edca08bd8ba62c37ef131519697596a804d8fc1c402";

export const EXPECTED_0024_CATALOG_COUNTS = {
  tables: 44,
  columns: 560,
  enums: 30,
  indexes: 119,
  constraints: 177,
} as const;

interface NamedSnapshotObject {
  name: unknown;
}

interface SnapshotTable extends NamedSnapshotObject {
  schema: unknown;
  columns: unknown;
  indexes: unknown;
  foreignKeys: unknown;
  checkConstraints: unknown;
}

interface SnapshotEnum extends NamedSnapshotObject {
  schema: unknown;
}

interface DrizzleSnapshot {
  id: unknown;
  dialect: unknown;
  version: unknown;
  tables: unknown;
  enums: unknown;
}

export interface HostedSchemaManifest {
  snapshotId: string;
  tables: readonly string[];
  tableColumns: Readonly<Record<string, readonly string[]>>;
  columns: readonly string[];
  enums: readonly string[];
  indexes: readonly string[];
  constraints: readonly string[];
}

export interface HostedSchemaCatalog {
  tables: readonly string[];
  columns: readonly string[];
  enums: readonly string[];
  indexes: readonly string[];
  constraints: readonly string[];
}

export interface HostedSchemaDrift {
  ok: boolean;
  missingTables: string[];
  missingColumns: string[];
  missingEnums: string[];
  missingIndexes: string[];
  missingConstraints: string[];
  extraTables: string[];
  extraColumns: string[];
  extraEnums: string[];
  extraIndexes: string[];
  extraConstraints: string[];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The 0024 Drizzle snapshot has an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requireName(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The 0024 Drizzle snapshot has an invalid ${label} name.`);
  }
  return value;
}

function readNamedObjects(value: unknown, label: string) {
  return Object.entries(requireRecord(value, label)).map(([key, candidate]) => {
    const entry = requireRecord(candidate, `${label}.${key}`) as unknown as NamedSnapshotObject;
    const name = requireName(entry.name, `${label}.${key}`);
    if (name !== key) {
      throw new Error(`The 0024 Drizzle snapshot ${label} key ${key} does not match ${name}.`);
    }
    return name;
  });
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new Error(`The 0024 Drizzle snapshot has duplicate normalized ${label}.`);
  }
}

function assertCount(values: readonly unknown[], expected: number, label: string) {
  if (values.length !== expected) {
    throw new Error(
      `The 0024 Drizzle snapshot expected ${expected} ${label}, but found ${values.length}.`,
    );
  }
}

/** PostgreSQL stores identifiers in at most NAMEDATALEN - 1 (63) UTF-8 bytes. */
export function normalizePostgresIdentifier(identifier: string) {
  let normalized = "";
  let bytes = 0;
  for (const character of identifier) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > 63) break;
    normalized += character;
    bytes += characterBytes;
  }
  return normalized;
}

export function create0024HostedSchemaManifest(value: unknown): HostedSchemaManifest {
  const snapshot = requireRecord(value, "root") as unknown as DrizzleSnapshot;
  if (snapshot.id !== EXPECTED_0024_SNAPSHOT_ID) {
    throw new Error(
      `Hosted schema verification requires committed 0024 snapshot ${EXPECTED_0024_SNAPSHOT_ID}.`,
    );
  }
  if (snapshot.dialect !== "postgresql" || snapshot.version !== "7") {
    throw new Error("Hosted schema verification requires the PostgreSQL v7 Drizzle snapshot.");
  }

  const rawTables = requireRecord(snapshot.tables, "tables");
  const tableColumns: Record<string, readonly string[]> = {};
  const indexes: string[] = [];
  const constraints: string[] = [];

  for (const [qualifiedName, candidate] of Object.entries(rawTables)) {
    const table = requireRecord(candidate, `tables.${qualifiedName}`) as unknown as SnapshotTable;
    const tableName = requireName(table.name, `tables.${qualifiedName}`);
    if (
      qualifiedName !== `public.${tableName}` ||
      (table.schema !== "" && table.schema !== "public")
    ) {
      throw new Error(`The 0024 Drizzle snapshot contains a non-public table: ${qualifiedName}.`);
    }
    tableColumns[tableName] = readNamedObjects(table.columns, `${tableName}.columns`);
    indexes.push(...readNamedObjects(table.indexes, `${tableName}.indexes`));
    constraints.push(
      ...readNamedObjects(table.foreignKeys, `${tableName}.foreignKeys`).map(
        normalizePostgresIdentifier,
      ),
      ...readNamedObjects(table.checkConstraints, `${tableName}.checkConstraints`).map(
        normalizePostgresIdentifier,
      ),
    );
  }

  const rawEnums = requireRecord(snapshot.enums, "enums");
  const enums = Object.entries(rawEnums).map(([qualifiedName, candidate]) => {
    const entry = requireRecord(candidate, `enums.${qualifiedName}`) as unknown as SnapshotEnum;
    const name = requireName(entry.name, `enums.${qualifiedName}`);
    if (qualifiedName !== `public.${name}` || entry.schema !== "public") {
      throw new Error(`The 0024 Drizzle snapshot contains a non-public enum: ${qualifiedName}.`);
    }
    return name;
  });

  const tables = Object.keys(tableColumns).sort();
  const columns = tables.flatMap((table) =>
    (tableColumns[table] ?? []).map((column) => `${table}.${column}`),
  );
  indexes.sort();
  constraints.sort();
  enums.sort();

  assertUnique(tables, "tables");
  assertUnique(columns, "columns");
  assertUnique(enums, "enums");
  assertUnique(indexes, "indexes");
  assertUnique(constraints, "foreign-key/check constraints");
  assertCount(tables, EXPECTED_0024_CATALOG_COUNTS.tables, "tables");
  assertCount(columns, EXPECTED_0024_CATALOG_COUNTS.columns, "columns");
  assertCount(enums, EXPECTED_0024_CATALOG_COUNTS.enums, "enums");
  assertCount(indexes, EXPECTED_0024_CATALOG_COUNTS.indexes, "indexes");
  assertCount(
    constraints,
    EXPECTED_0024_CATALOG_COUNTS.constraints,
    "foreign-key/check constraints",
  );

  return {
    snapshotId: EXPECTED_0024_SNAPSHOT_ID,
    tables,
    tableColumns,
    columns,
    enums,
    indexes,
    constraints,
  };
}

export function readPinned0024HostedSchemaManifest(
  snapshotBytes: Uint8Array,
): HostedSchemaManifest {
  const hash = createHash("sha256").update(snapshotBytes).digest("hex");
  if (hash !== EXPECTED_0024_SNAPSHOT_SHA256) {
    throw new Error(
      `The committed 0024 snapshot hash is ${hash}; expected ${EXPECTED_0024_SNAPSHOT_SHA256}.`,
    );
  }
  return create0024HostedSchemaManifest(
    JSON.parse(Buffer.from(snapshotBytes).toString("utf8")) as unknown,
  );
}

function difference(expected: readonly string[], actual: ReadonlySet<string>) {
  return expected.filter((value) => !actual.has(value));
}

function extras(expected: readonly string[], actual: readonly string[]) {
  const expectedSet = new Set(expected);
  return [...new Set(actual)].filter((value) => !expectedSet.has(value)).sort();
}

export function compareHostedSchemaCatalog(
  expected: HostedSchemaManifest,
  actual: HostedSchemaCatalog,
  strictExtras: boolean,
): HostedSchemaDrift {
  const missingTables = difference(expected.tables, new Set(actual.tables));
  const missingColumns = difference(expected.columns, new Set(actual.columns));
  const missingEnums = difference(expected.enums, new Set(actual.enums));
  const missingIndexes = difference(expected.indexes, new Set(actual.indexes));
  const missingConstraints = difference(expected.constraints, new Set(actual.constraints));
  const extraTables = extras(expected.tables, actual.tables);
  const extraColumns = extras(expected.columns, actual.columns);
  const extraEnums = extras(expected.enums, actual.enums);
  const extraIndexes = extras(expected.indexes, actual.indexes);
  const extraConstraints = extras(expected.constraints, actual.constraints);
  const hasMissing =
    missingTables.length > 0 ||
    missingColumns.length > 0 ||
    missingEnums.length > 0 ||
    missingIndexes.length > 0 ||
    missingConstraints.length > 0;
  const hasExtras =
    extraTables.length > 0 ||
    extraColumns.length > 0 ||
    extraEnums.length > 0 ||
    extraIndexes.length > 0 ||
    extraConstraints.length > 0;

  return {
    ok: !hasMissing && (!strictExtras || !hasExtras),
    missingTables,
    missingColumns,
    missingEnums,
    missingIndexes,
    missingConstraints,
    extraTables,
    extraColumns,
    extraEnums,
    extraIndexes,
    extraConstraints,
  };
}

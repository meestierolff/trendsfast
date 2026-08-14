import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseProductionInventory } from "../staged-production-env";

const DEFAULT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROJECT_REF = "auxienkuufejeakaczlq";
const PENDING_PATH = ".var/private/runtime-role-rotation.pending.json";
const LINKED_PROJECT_REF_PATH = "supabase/.temp/project-ref";
const POOLER_HOST = "aws-0-eu-central-1.pooler.supabase.com";
const DATABASE_NAME = "postgres";

const ROLES = {
  migrator: {
    role: "trendsfast_migrator",
    passwordVariable: "TRENDSFAST_MIGRATOR_PASSWORD",
  },
  public: {
    role: "trendsfast_public_runtime",
    passwordVariable: "TRENDSFAST_PUBLIC_RUNTIME_PASSWORD",
    urlVariable: "DATABASE_URL",
  },
  member: {
    role: "trendsfast_member_runtime",
    passwordVariable: "TRENDSFAST_MEMBER_RUNTIME_PASSWORD",
    urlVariable: "MEMBER_DATABASE_URL",
  },
  ops: {
    role: "trendsfast_ops_runtime",
    passwordVariable: "TRENDSFAST_OPS_RUNTIME_PASSWORD",
    urlVariable: "OPS_DATABASE_URL",
  },
  worker: {
    role: "trendsfast_worker_runtime",
    passwordVariable: "TRENDSFAST_WORKER_RUNTIME_PASSWORD",
    urlVariable: "WORKER_DATABASE_URL",
  },
  billing: {
    role: "trendsfast_billing_runtime",
    passwordVariable: "TRENDSFAST_BILLING_RUNTIME_PASSWORD",
    urlVariable: "BILLING_DATABASE_URL",
  },
  auth: {
    role: "trendsfast_auth_runtime",
    passwordVariable: "TRENDSFAST_AUTH_RUNTIME_PASSWORD",
    urlVariable: "AUTH_DATABASE_URL",
  },
  retention: {
    role: "trendsfast_retention_runtime",
    passwordVariable: "TRENDSFAST_RETENTION_RUNTIME_PASSWORD",
    urlVariable: "RETENTION_DATABASE_URL",
  },
} as const;

const URL_ROLE_KINDS = [
  "public",
  "member",
  "ops",
  "worker",
  "billing",
  "auth",
  "retention",
] as const;

type RoleKind = keyof typeof ROLES;
type Passwords = Readonly<Record<RoleKind, string>>;

type PendingRotation = {
  readonly version: 1;
  readonly projectRef: typeof PROJECT_REF;
  readonly passwords: Passwords;
};

type UrlKind = "migrator" | "runtime";

export interface RotationOptions {
  readonly root?: string;
  readonly resume?: boolean;
  readonly runLinkedSql?: (sqlPath: string) => boolean;
  readonly isIgnored?: (relativePath: string) => boolean;
}

function fail(message: string): never {
  throw new Error(message);
}

function openCheckedRegularFile(
  path: string,
  isSafe: (metadata: Stats) => boolean,
  message: string,
): number {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (metadata.isSymbolicLink() || !metadata.isFile() || !isSafe(metadata)) {
      throw new Error("unsafe file");
    }
    return descriptor;
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    fail(message);
  }
}

function assertPrivateFile(path: string): void {
  const descriptor = openCheckedRegularFile(
    path,
    (metadata) => (metadata.mode & 0o777) === 0o600,
    "Every runtime-role rotation input must be a regular mode-0600 file",
  );
  closeSync(descriptor);
}

function readPrivateFile(path: string): string {
  const descriptor = openCheckedRegularFile(
    path,
    (metadata) => (metadata.mode & 0o777) === 0o600,
    "Every runtime-role rotation input must be a regular mode-0600 file",
  );
  try {
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function parsePrivateInventory(path: string): Record<string, string> {
  return { ...parseProductionInventory(readPrivateFile(path)).values };
}

function serializeEnvironment(values: Readonly<Record<string, string>>): string {
  return `${Object.keys(values)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => `${name}=${JSON.stringify(values[name] ?? "")}`)
    .join("\n")}\n`;
}

function writePrivateAtomic(path: string, contents: string): void {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.partial`;
  writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  assertPrivateFile(path);
}

function generatedPasswords(): Passwords {
  return Object.fromEntries(
    (Object.keys(ROLES) as RoleKind[]).map((kind) => [kind, randomBytes(48).toString("base64url")]),
  ) as Record<RoleKind, string>;
}

function parsePending(path: string): PendingRotation {
  const source = readPrivateFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail("The pending runtime-role rotation record is malformed");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("The pending runtime-role rotation record is malformed");
  }
  const record = parsed as Record<string, unknown>;
  const passwords = record.passwords;
  const passwordValues =
    passwords && typeof passwords === "object" && !Array.isArray(passwords)
      ? (Object.values(passwords) as unknown[])
      : [];
  if (
    record.version !== 1 ||
    record.projectRef !== PROJECT_REF ||
    !passwords ||
    typeof passwords !== "object" ||
    Array.isArray(passwords) ||
    JSON.stringify(Object.keys(passwords).sort()) !== JSON.stringify(Object.keys(ROLES).sort()) ||
    (Object.keys(ROLES) as RoleKind[]).some((kind) => {
      const value = (passwords as Record<string, unknown>)[kind];
      return typeof value !== "string" || !/^[A-Za-z0-9_-]{64}$/u.test(value);
    }) ||
    new Set(passwordValues).size !== Object.keys(ROLES).length
  ) {
    fail("The pending runtime-role rotation record is malformed");
  }
  return record as PendingRotation;
}

function sqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function rotationSql(passwords: Passwords): string {
  const statements = (Object.keys(ROLES) as RoleKind[]).map(
    (kind) =>
      `ALTER ROLE ${sqlIdentifier(ROLES[kind].role)} PASSWORD ${sqlLiteral(passwords[kind])};`,
  );
  return [
    "BEGIN;",
    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('trendsfast-runtime-role-password-rotation-v1', 0));",
    "SET LOCAL password_encryption = 'scram-sha-256';",
    ...statements,
    "COMMIT;",
    "",
  ].join("\n");
}

function defaultLinkedSql(root: string, sqlPath: string): boolean {
  assertLinkedProductionProject(root);
  const result = spawnSync("supabase", ["db", "query", "--linked", "--file", sqlPath], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  return result.status === 0;
}

function parsePinnedUrl(source: string | undefined, expectedRole: string, kind: UrlKind): URL {
  if (!source) fail("A runtime-role URL is missing from the private inventory");
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    fail("A runtime-role URL is malformed");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    fail("A runtime-role URL must use PostgreSQL");
  }
  let username: string;
  let database: string;
  try {
    username = decodeURIComponent(url.username);
    database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
    decodeURIComponent(url.password);
  } catch {
    fail("A runtime-role URL has invalid percent encoding");
  }
  if (!url.password || database !== DATABASE_NAME || url.search || url.hash) {
    fail("A runtime-role URL does not use the pinned PostgreSQL database shape");
  }

  const isRuntimeEndpoint =
    kind === "runtime" &&
    url.hostname === POOLER_HOST &&
    (url.port || "5432") === "6543" &&
    username === `${expectedRole}.${PROJECT_REF}`;
  const isMigratorPoolerEndpoint =
    kind === "migrator" &&
    url.hostname === POOLER_HOST &&
    (url.port || "5432") === "5432" &&
    username === `${expectedRole}.${PROJECT_REF}`;
  const isMigratorDirectEndpoint =
    kind === "migrator" &&
    url.hostname === `db.${PROJECT_REF}.supabase.co` &&
    (url.port || "5432") === "5432" &&
    username === expectedRole;
  if (!isRuntimeEndpoint && !isMigratorPoolerEndpoint && !isMigratorDirectEndpoint) {
    fail("A runtime-role URL does not use its pinned PostgreSQL identity");
  }

  return url;
}

function updateUrl(
  source: string | undefined,
  expectedRole: string,
  password: string,
  kind: UrlKind,
): string {
  const url = parsePinnedUrl(source, expectedRole, kind);
  url.password = password;
  const planned = url.href;
  const validated = parsePinnedUrl(planned, expectedRole, kind);
  if (decodeURIComponent(validated.password) !== password) {
    fail("A planned runtime-role URL replacement is invalid");
  }
  return planned;
}

export function assertLinkedProductionProject(root: string): void {
  const path = resolve(root, LINKED_PROJECT_REF_PATH);
  const message = "The exact Supabase production project must be linked before role rotation";
  const descriptor = openCheckedRegularFile(path, (metadata) => metadata.size <= 128, message);
  let linkedRef: string;
  try {
    linkedRef = readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
  if (linkedRef !== PROJECT_REF && linkedRef !== `${PROJECT_REF}\n`) {
    fail(message);
  }
}

function requireCurrentRoleSecrets(roleSecrets: Readonly<Record<string, string>>): void {
  for (const { passwordVariable } of Object.values(ROLES)) {
    if (!roleSecrets[passwordVariable]?.trim()) {
      fail("A runtime-role password is missing from the private inventory");
    }
  }
}

function assertExactInventoryKeys(
  inventory: Readonly<Record<string, string>>,
  expectedNames: readonly string[],
  label: string,
): void {
  if (
    JSON.stringify(Object.keys(inventory).sort()) !==
    JSON.stringify([...expectedNames].sort((left, right) => left.localeCompare(right)))
  ) {
    fail(`The private ${label} inventory has an unexpected shape`);
  }
}

function materializePlannedInventories(
  roleSecrets: Record<string, string>,
  roleUrls: Record<string, string>,
  migrator: Record<string, string>,
  production: Record<string, string>,
  passwords: Passwords,
): void {
  assertExactInventoryKeys(
    roleSecrets,
    Object.values(ROLES).map(({ passwordVariable }) => passwordVariable),
    "runtime-role secret",
  );
  assertExactInventoryKeys(
    roleUrls,
    URL_ROLE_KINDS.map((kind) => ROLES[kind].urlVariable),
    "runtime-role URL",
  );
  assertExactInventoryKeys(migrator, ["DIRECT_DATABASE_URL"], "migrator URL");
  requireCurrentRoleSecrets(roleSecrets);
  const plannedPasswords = Object.values(passwords);
  if (
    new Set(plannedPasswords).size !== Object.keys(ROLES).length ||
    (Object.keys(ROLES) as RoleKind[]).some(
      (kind) => roleSecrets[ROLES[kind].passwordVariable] === passwords[kind],
    )
  ) {
    fail("Every planned runtime-role password must be fresh and unique");
  }
  for (const kind of Object.keys(ROLES) as RoleKind[]) {
    roleSecrets[ROLES[kind].passwordVariable] = passwords[kind];
  }
  for (const kind of URL_ROLE_KINDS) {
    const urlVariable = ROLES[kind].urlVariable;
    const nextUrl = updateUrl(roleUrls[urlVariable], ROLES[kind].role, passwords[kind], "runtime");
    // Validate the separately maintained production copy before replacing it
    // with the canonical materialized URL.
    updateUrl(production[urlVariable], ROLES[kind].role, passwords[kind], "runtime");
    roleUrls[urlVariable] = nextUrl;
    production[urlVariable] = nextUrl;
  }
  migrator.DIRECT_DATABASE_URL = updateUrl(
    migrator.DIRECT_DATABASE_URL,
    ROLES.migrator.role,
    passwords.migrator,
    "migrator",
  );
}

function defaultIgnored(root: string, relativePath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--", relativePath], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0;
}

export function rotateRuntimeRolePasswords(options: RotationOptions = {}): void {
  const root = resolve(options.root ?? DEFAULT_ROOT);
  const pendingPath = resolve(root, PENDING_PATH);
  const secretsPath = resolve(root, ".var/private/runtime-role-secrets.env");
  const urlsPath = resolve(root, ".var/private/runtime-role-urls.env");
  const migratorPath = resolve(root, ".var/private/migrator-database-url.env");
  const productionPath = resolve(root, ".env.production.local");
  const isIgnored = options.isIgnored ?? ((path: string) => defaultIgnored(root, path));

  for (const relativePath of [
    PENDING_PATH,
    ".var/private/runtime-role-secrets.env",
    ".var/private/runtime-role-urls.env",
    ".var/private/migrator-database-url.env",
    ".env.production.local",
  ]) {
    if (!isIgnored(relativePath)) fail("Every runtime-role rotation file must remain ignored");
  }
  const roleSecrets = parsePrivateInventory(secretsPath);
  const roleUrls = parsePrivateInventory(urlsPath);
  const migrator = parsePrivateInventory(migratorPath);
  const production = parsePrivateInventory(productionPath);

  let pending: PendingRotation;
  let persistPending = false;
  if (existsSync(pendingPath)) {
    if (!options.resume) {
      fail("A pending runtime-role rotation exists; rerun with --resume");
    }
    pending = parsePending(pendingPath);
  } else {
    if (options.resume) fail("No pending runtime-role rotation exists");
    pending = { version: 1, projectRef: PROJECT_REF, passwords: generatedPasswords() };
    persistPending = true;
  }

  // Materialize and revalidate every rotation-relevant URL before the linked
  // database can be mutated. These in-memory updates are written only after a
  // successful transaction.
  materializePlannedInventories(roleSecrets, roleUrls, migrator, production, pending.passwords);
  assertLinkedProductionProject(root);
  if (persistPending) writePrivateAtomic(pendingPath, `${JSON.stringify(pending)}\n`);

  const secureDirectory = mkdtempSync(join(tmpdir(), "trendsfast-role-rotation-"));
  chmodSync(secureDirectory, 0o700);
  const sqlPath = join(secureDirectory, "rotate.sql");
  writeFileSync(sqlPath, rotationSql(pending.passwords), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(sqlPath, 0o600);
  try {
    const runLinkedSql = options.runLinkedSql ?? ((path: string) => defaultLinkedSql(root, path));
    if (!runLinkedSql(sqlPath)) {
      fail("Supabase linked role rotation failed; output withheld; rerun with --resume");
    }
  } finally {
    rmSync(secureDirectory, { recursive: true, force: true });
  }

  writePrivateAtomic(secretsPath, serializeEnvironment(roleSecrets));
  writePrivateAtomic(urlsPath, serializeEnvironment(roleUrls));
  writePrivateAtomic(migratorPath, serializeEnvironment(migrator));
  writePrivateAtomic(productionPath, serializeEnvironment(production));
  unlinkSync(pendingPath);
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument !== "--resume") || arguments_.length > 1) {
    fail("Usage: pnpm exec tsx scripts/db/rotate-runtime-role-passwords.ts [--resume]");
  }
  rotateRuntimeRolePasswords({ resume: arguments_[0] === "--resume" });
  console.info(
    JSON.stringify({
      rotated: true,
      projectRef: PROJECT_REF,
      roles: Object.values(ROLES).map(({ role }) => role),
      secretValuesPrinted: false,
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Runtime-role rotation failed");
    process.exitCode = 1;
  }
}

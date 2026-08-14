import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, open, rename, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseCliEnvironmentFile } from "../../packages/database/src/load-cli-env";
import { APPLICATION_TABLES } from "../../packages/database/src/runtime-roles";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PRIVATE_ROOT = resolve(REPOSITORY_ROOT, ".var/private");
const BACKUP_DIRECTORY = join(PRIVATE_ROOT, "backups");
const DEFAULT_DATABASE_ENV_FILE = join(PRIVATE_ROOT, "migrator-database-url.env");
const DEFAULT_CA_ENV_FILE = resolve(REPOSITORY_ROOT, ".env.production.local");
const PASSPHRASE_FILE = join(PRIVATE_ROOT, "backup-passphrase");
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const MAX_ARCHIVE_LISTING_BYTES = 4 * 1024 * 1024;

export const BACKUP_PROJECT_REF = "auxienkuufejeakaczlq" as const;
export const BACKUP_MIGRATOR_ROLE = "trendsfast_migrator" as const;
export const PINNED_DATABASE_CA_SHA256 =
  "6ecd239038a7db063a6619b71742372ecfe06c0b0ec12a9993fee4445bf0d4d6" as const;

const BACKUP_ENDPOINTS = [
  {
    database: "postgres",
    host: `db.${BACKUP_PROJECT_REF}.supabase.co`,
    port: "5432",
    user: BACKUP_MIGRATOR_ROLE,
  },
  {
    database: "postgres",
    host: "aws-0-eu-central-1.pooler.supabase.com",
    port: "5432",
    user: `${BACKUP_MIGRATOR_ROLE}.${BACKUP_PROJECT_REF}`,
  },
] as const;

const EXPECTED_ARCHIVE_TABLES = new Map<string, ReadonlySet<string>>([
  ["public", new Set(APPLICATION_TABLES)],
  ["drizzle", new Set(["__drizzle_migrations"])],
]);

export const BACKUP_SCHEMAS = ["public", "drizzle"] as const;
export const PG_DUMP_ARGUMENTS = [
  "--format=custom",
  "--no-password",
  "--no-owner",
  "--no-privileges",
  ...BACKUP_SCHEMAS.flatMap((schema) => [`--schema=${schema}`]),
] as const;

export type DatabaseConnection = {
  database: string;
  host: string;
  password: string;
  port: string;
  user: string;
};

function safeToolEnvironment(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "C",
    LC_ALL: process.env.LC_ALL ?? "C",
    PATH: process.env.PATH,
    ...extra,
  };
}

export function parsePostgresConnectionString(value: string): DatabaseConnection {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The private backup database URL is malformed");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("The private backup database URL must use PostgreSQL");
  }

  let user: string;
  let password: string;
  let database: string;
  try {
    user = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("The private backup database URL has invalid percent encoding");
  }
  if (!parsed.hostname || !user || !password || !database) {
    throw new Error("The private backup database URL is incomplete");
  }

  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user,
    password,
    database,
  };
}

export function assertPinnedBackupConnection(connection: DatabaseConnection): void {
  if (
    !BACKUP_ENDPOINTS.some(
      (endpoint) =>
        connection.database === endpoint.database &&
        connection.host === endpoint.host &&
        connection.port === endpoint.port &&
        connection.user === endpoint.user,
    )
  ) {
    throw new Error(
      "The private backup database URL does not identify the pinned production project and migrator",
    );
  }
}

export function assertPinnedDatabaseCa(ca: string): void {
  if (
    !ca.startsWith("-----BEGIN CERTIFICATE-----\n") ||
    !ca.trimEnd().endsWith("-----END CERTIFICATE-----") ||
    createHash("sha256").update(ca).digest("hex") !== PINNED_DATABASE_CA_SHA256
  ) {
    throw new Error("The private TLS CA is not the pinned Supabase certificate bundle");
  }
}

function sameSet(actual: ReadonlySet<string>, expected: ReadonlySet<string>): boolean {
  return actual.size === expected.size && [...actual].every((value) => expected.has(value));
}

export function validateBackupArchiveListing(listing: string): void {
  const tables = new Map<string, Set<string>>();
  const tableData = new Map<string, Set<string>>();
  let entries = 0;

  for (const line of listing.split(/\r?\n/u)) {
    const match = /^\d+;\s+\d+\s+\d+\s+(TABLE DATA|TABLE)\s+(\S+)\s+(\S+)(?:\s+.*)?$/u.exec(line);
    if (!match) continue;
    entries += 1;
    const [, kind, schema, table] = match;
    if (!kind || !schema || !table || !EXPECTED_ARCHIVE_TABLES.has(schema)) {
      throw new Error("The encrypted backup archive has an unexpected table manifest");
    }
    const destination = kind === "TABLE" ? tables : tableData;
    const names = destination.get(schema) ?? new Set<string>();
    if (names.has(table)) {
      throw new Error("The encrypted backup archive has a duplicate table manifest entry");
    }
    names.add(table);
    destination.set(schema, names);
  }

  const expectedEntries =
    [...EXPECTED_ARCHIVE_TABLES.values()].reduce((total, names) => total + names.size, 0) * 2;
  if (entries !== expectedEntries) {
    throw new Error("The encrypted backup archive table manifest is incomplete");
  }
  for (const [schema, expected] of EXPECTED_ARCHIVE_TABLES) {
    if (!sameSet(tables.get(schema) ?? new Set(), expected)) {
      throw new Error("The encrypted backup archive has an unexpected table schema");
    }
    if (!sameSet(tableData.get(schema) ?? new Set(), expected)) {
      throw new Error("The encrypted backup archive has incomplete table data");
    }
  }
}

export function postgresBackupEnvironment(
  connection: DatabaseConnection,
  caPath: string,
): NodeJS.ProcessEnv {
  return safeToolEnvironment({
    PGAPPNAME: "trendsfast_encrypted_backup",
    PGCONNECT_TIMEOUT: "15",
    PGDATABASE: connection.database,
    PGHOST: connection.host,
    PGPASSWORD: connection.password,
    PGPORT: connection.port,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: caPath,
    PGTARGETSESSIONATTRS: "read-write",
    PGUSER: connection.user,
  });
}

function mode(metadata: { mode: number }): number {
  return metadata.mode & 0o777;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    const existing = await lstat(path);
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error("A required private backup path is not a real directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  }
  await chmod(path, PRIVATE_DIRECTORY_MODE);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || mode(metadata) !== 0o700) {
    throw new Error("A required private backup directory is unsafe");
  }
}

async function assertPrivateRegularFile(path: string, minimumBytes = 1): Promise<void> {
  const metadata = await lstat(path);
  const currentUid = process.getuid?.();
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    mode(metadata) !== PRIVATE_FILE_MODE ||
    metadata.size < minimumBytes ||
    (currentUid !== undefined && metadata.uid !== currentUid)
  ) {
    throw new Error("A required private backup input is unsafe");
  }
}

async function parsePrivateEnvironmentFile(path: string): Promise<Record<string, string>> {
  await assertPrivateRegularFile(path);
  return parseCliEnvironmentFile(path);
}

function requirePrivateValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  label: string,
): string {
  const value = environment[name];
  if (!value?.trim()) throw new Error(`The private ${label} inventory is missing ${name}`);
  return value;
}

async function readBackupInputs(): Promise<{ ca: string; connectionString: string }> {
  // Deliberately ignore ambient URL, CA, and path overrides. Backup identity is
  // sourced only from the repository's protected inventories and pinned below.
  const databaseEnvironment = await parsePrivateEnvironmentFile(DEFAULT_DATABASE_ENV_FILE);
  const caEnvironment = await parsePrivateEnvironmentFile(DEFAULT_CA_ENV_FILE);
  const connectionString = requirePrivateValue(
    databaseEnvironment,
    "DIRECT_DATABASE_URL",
    "database URL",
  );
  const ca = requirePrivateValue(caEnvironment, "DATABASE_SSL_CA", "TLS CA");
  assertPinnedBackupConnection(parsePostgresConnectionString(connectionString));
  assertPinnedDatabaseCa(ca);
  return { ca, connectionString };
}

async function ensurePassphraseFile(): Promise<void> {
  try {
    const handle = await open(PASSPHRASE_FILE, "wx", PRIVATE_FILE_MODE);
    try {
      await handle.writeFile(`${randomBytes(48).toString("base64")}\n`, { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await assertPrivateRegularFile(PASSPHRASE_FILE, 64);
}

function childCompletion(child: ChildProcess, label: string): Promise<void> {
  return new Promise((accept, reject) => {
    child.once("error", () => reject(new Error(`${label} could not start`)));
    child.once("close", (code, signal) => {
      if (code === 0) accept();
      else reject(new Error(`${label} failed (${signal ? "signal" : "exit"})`));
    });
  });
}

async function createEncryptedDump(
  encryptedPath: string,
  databaseEnvironment: NodeJS.ProcessEnv,
  passphraseFd: number,
  gnupgHome: string,
): Promise<void> {
  const dump = spawn(process.env.PG_DUMP_BIN?.trim() || "pg_dump", [...PG_DUMP_ARGUMENTS], {
    env: databaseEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const encryption = spawn(
    process.env.GPG_BIN?.trim() || "gpg",
    [
      "--batch",
      "--yes",
      "--no-tty",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "3",
      "--symmetric",
      "--cipher-algo",
      "AES256",
      "--output",
      encryptedPath,
    ],
    {
      env: safeToolEnvironment({ GNUPGHOME: gnupgHome }),
      stdio: ["pipe", "ignore", "pipe", passphraseFd],
    },
  );
  if (!dump.stdout || !encryption.stdin) {
    dump.kill();
    encryption.kill();
    throw new Error("The encrypted backup pipeline could not be created");
  }
  encryption.stdin.on("error", () => undefined);
  dump.stdout.pipe(encryption.stdin);

  let encryptionDiagnostic = "";
  encryption.stderr?.on("data", (chunk: Buffer) => {
    if (encryptionDiagnostic.length < 16_384) encryptionDiagnostic += chunk.toString("utf8");
  });
  const dumpDone = childCompletion(dump, "pg_dump").catch((error: unknown) => {
    encryption.kill();
    throw error;
  });
  const encryptionDone = childCompletion(encryption, "gpg encryption").catch((error: unknown) => {
    dump.kill();
    const diagnostic = encryptionDiagnostic.toLowerCase();
    if (
      diagnostic.includes("can't create") ||
      diagnostic.includes("cannot create") ||
      diagnostic.includes("failed to create") ||
      diagnostic.includes("no such file") ||
      diagnostic.includes("not a directory")
    ) {
      throw new Error("gpg encryption output path failed");
    }
    if (diagnostic.includes("broken pipe") || diagnostic.includes("write error")) {
      throw new Error("gpg encryption stream failed");
    }
    if (diagnostic.includes("agent")) throw new Error("gpg encryption agent failed");
    if (diagnostic.includes("already exists")) throw new Error("gpg encryption output exists");
    if (diagnostic.includes("permission denied"))
      throw new Error("gpg encryption permission failed");
    throw error;
  });
  await Promise.all([dumpDone, encryptionDone]);
}

async function verifyEncryptedDump(
  encryptedPath: string,
  passphraseFd: number,
  gnupgHome: string,
): Promise<void> {
  const decryption = spawn(
    process.env.GPG_BIN?.trim() || "gpg",
    [
      "--batch",
      "--no-tty",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "3",
      "--decrypt",
      encryptedPath,
    ],
    {
      env: safeToolEnvironment({ GNUPGHOME: gnupgHome }),
      stdio: ["ignore", "pipe", "ignore", passphraseFd],
    },
  );
  const listing = spawn(process.env.PG_RESTORE_BIN?.trim() || "pg_restore", ["--list"], {
    env: safeToolEnvironment(),
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (!decryption.stdout || !listing.stdin || !listing.stdout) {
    decryption.kill();
    listing.kill();
    throw new Error("The encrypted backup verification pipeline could not be created");
  }
  listing.stdin.on("error", () => undefined);
  decryption.stdout.pipe(listing.stdin);
  let listingBytes = 0;
  let listingText = "";
  listing.stdout.on("data", (chunk: Buffer) => {
    listingBytes += chunk.length;
    if (listingBytes <= MAX_ARCHIVE_LISTING_BYTES) listingText += chunk.toString("utf8");
  });

  const decryptionDone = childCompletion(decryption, "gpg decryption").catch((error: unknown) => {
    listing.kill();
    throw error;
  });
  const listingDone = childCompletion(listing, "pg_restore listing").catch((error: unknown) => {
    decryption.kill();
    throw error;
  });
  await Promise.all([decryptionDone, listingDone]);
  if (listingBytes === 0) throw new Error("The encrypted backup archive listing is empty");
  if (listingBytes > MAX_ARCHIVE_LISTING_BYTES) {
    throw new Error("The encrypted backup archive listing is unexpectedly large");
  }
  validateBackupArchiveListing(listingText);
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const formerUmask = process.umask(0o077);
  let cleanupPath: string | undefined;
  let temporaryDirectory: string | undefined;
  try {
    await ensurePrivateDirectory(PRIVATE_ROOT);
    await ensurePrivateDirectory(BACKUP_DIRECTORY);
    await ensurePassphraseFile();
    const { ca, connectionString } = await readBackupInputs();
    const connection = parsePostgresConnectionString(connectionString);
    assertPinnedBackupConnection(connection);
    // Keep the GnuPG home path short: macOS Unix-domain sockets have a small path limit.
    temporaryDirectory = await mkdtemp(join(tmpdir(), "tf-bak-"));
    await chmod(temporaryDirectory, PRIVATE_DIRECTORY_MODE);
    const gnupgHome = join(temporaryDirectory, "gnupg");
    await ensurePrivateDirectory(gnupgHome);
    const caPath = join(temporaryDirectory, "database-ca.pem");
    const caHandle = await open(caPath, "wx", PRIVATE_FILE_MODE);
    try {
      await caHandle.writeFile(ca, { encoding: "utf8" });
      await caHandle.sync();
    } finally {
      await caHandle.close();
    }

    const timestamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
    const basename = `trendsfast-app-${timestamp}-${randomBytes(6).toString("hex")}.dump.gpg`;
    const finalPath = join(BACKUP_DIRECTORY, basename);
    const partialPath = `${finalPath}.partial`;
    cleanupPath = partialPath;
    const encryptionPassphrase = await open(PASSPHRASE_FILE, "r");
    try {
      await createEncryptedDump(
        partialPath,
        postgresBackupEnvironment(connection, caPath),
        encryptionPassphrase.fd,
        gnupgHome,
      );
    } finally {
      await encryptionPassphrase.close();
    }
    await chmod(partialPath, PRIVATE_FILE_MODE);
    const encrypted = await stat(partialPath);
    if (!encrypted.isFile() || encrypted.size === 0 || mode(encrypted) !== PRIVATE_FILE_MODE) {
      throw new Error("The encrypted backup artifact is unsafe or empty");
    }
    await syncFile(partialPath);
    const verificationPassphrase = await open(PASSPHRASE_FILE, "r");
    try {
      await verifyEncryptedDump(partialPath, verificationPassphrase.fd, gnupgHome);
    } finally {
      await verificationPassphrase.close();
    }
    await rename(partialPath, finalPath);
    cleanupPath = finalPath;
    await syncFile(finalPath);
    const accepted = await lstat(finalPath);
    if (accepted.isSymbolicLink() || !accepted.isFile() || mode(accepted) !== PRIVATE_FILE_MODE) {
      throw new Error("The accepted encrypted backup artifact is unsafe");
    }
    cleanupPath = undefined;
    console.info(
      JSON.stringify({
        ok: true,
        artifact: `.var/private/backups/${basename}`,
        encrypted: true,
        archiveFormat: "pg_dump-custom",
        schemas: BACKUP_SCHEMAS,
        mode: "0600",
        readabilityVerified: true,
        plaintextWrittenToDisk: false,
        connectionUrlPrinted: false,
        passphrasePrinted: false,
      }),
    );
  } finally {
    process.umask(formerUmask);
    if (cleanupPath) await unlink(cleanupPath).catch(() => undefined);
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const stage = message.startsWith("pg_dump")
      ? "PG_DUMP_FAILED"
      : message.startsWith("gpg encryption agent")
        ? "ENCRYPTION_AGENT_FAILED"
        : message.startsWith("gpg encryption output path")
          ? "ENCRYPTION_OUTPUT_PATH_FAILED"
          : message.startsWith("gpg encryption stream")
            ? "ENCRYPTION_STREAM_FAILED"
            : message.startsWith("gpg encryption output")
              ? "ENCRYPTION_OUTPUT_EXISTS"
              : message.startsWith("gpg encryption permission")
                ? "ENCRYPTION_PERMISSION_FAILED"
                : message.startsWith("gpg encryption")
                  ? "ENCRYPTION_FAILED"
                  : message.startsWith("gpg decryption")
                    ? "DECRYPTION_FAILED"
                    : message.startsWith("pg_restore")
                      ? "ARCHIVE_LIST_FAILED"
                      : "PRIVATE_BACKUP_GUARD_FAILED";
    console.error(`Encrypted logical backup failed; no backup was accepted. [${stage}]`);
    process.exitCode = 1;
  });
}

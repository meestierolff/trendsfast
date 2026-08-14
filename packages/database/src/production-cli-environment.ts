import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MAX_PRIVATE_INVENTORY_BYTES = 512 * 1024;

const MIGRATOR_PATH = ".var/private/migrator-database-url.env";
const RUNTIME_URLS_PATH = ".var/private/runtime-role-urls.env";
const RUNTIME_SECRETS_PATH = ".var/private/runtime-role-secrets.env";
const ROLE_ADMIN_PATH = ".var/private/role-admin-database-url.env";
const PRODUCTION_INVENTORY_PATH = ".env.production.local";

const RUNTIME_URL_NAMES = [
  "DATABASE_URL",
  "MEMBER_DATABASE_URL",
  "OPS_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "BILLING_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "RETENTION_DATABASE_URL",
] as const;

const RUNTIME_SECRET_NAMES = [
  "TRENDSFAST_MIGRATOR_PASSWORD",
  "TRENDSFAST_PUBLIC_RUNTIME_PASSWORD",
  "TRENDSFAST_MEMBER_RUNTIME_PASSWORD",
  "TRENDSFAST_OPS_RUNTIME_PASSWORD",
  "TRENDSFAST_WORKER_RUNTIME_PASSWORD",
  "TRENDSFAST_BILLING_RUNTIME_PASSWORD",
  "TRENDSFAST_AUTH_RUNTIME_PASSWORD",
  "TRENDSFAST_RETENTION_RUNTIME_PASSWORD",
] as const;

export type ProductionDatabaseCliProfile =
  "migrate" | "provision-runtime-roles" | "verify-hosted" | "verify-runtime-roles";

export interface PinnedProductionEnvironmentOptions {
  readonly ambient?: Readonly<Record<string, string | undefined>>;
  readonly isIgnored?: (relativePath: string) => boolean;
  readonly repositoryRoot?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function defaultIgnored(root: string, relativePath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--", relativePath], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0;
}

function assignmentNames(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
}

function readPrivateInventory(input: {
  readonly exactNames?: readonly string[];
  readonly isIgnored: (relativePath: string) => boolean;
  readonly relativePath: string;
  readonly repositoryRoot: string;
  readonly selectedNames: readonly string[];
}): Record<string, string> {
  if (!input.isIgnored(input.relativePath)) {
    fail("Every production database inventory must remain ignored");
  }
  const absolutePath = resolve(input.repositoryRoot, input.relativePath);
  let descriptor: number | undefined;
  let source: string;
  try {
    descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    const currentUid = process.getuid?.();
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size < 1 ||
      metadata.size > MAX_PRIVATE_INVENTORY_BYTES ||
      (currentUid !== undefined && metadata.uid !== currentUid)
    ) {
      throw new Error("unsafe private inventory");
    }
    source = readFileSync(descriptor, "utf8");
  } catch {
    fail("Every production database inventory must be a bounded owner-only mode-0600 file");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  const names = assignmentNames(source);
  const expectedNames = input.exactNames ? [...input.exactNames].sort() : undefined;
  if (expectedNames && JSON.stringify([...names].sort()) !== JSON.stringify(expectedNames)) {
    fail("A production database inventory has an unexpected variable shape");
  }
  for (const name of input.selectedNames) {
    if (names.filter((candidate) => candidate === name).length !== 1) {
      fail("A production database inventory is missing or duplicates a required variable");
    }
  }

  const parsed = parse(source);
  const selected: Record<string, string> = {};
  for (const name of input.selectedNames) {
    const value = parsed[name];
    if (!value?.trim()) fail("A production database inventory contains an empty required value");
    selected[name] = value;
  }
  return selected;
}

function mergePinnedValues(
  destination: Record<string, string>,
  pinned: Readonly<Record<string, string>>,
  ambient: Readonly<Record<string, string | undefined>>,
): void {
  for (const [name, value] of Object.entries(pinned)) {
    const ambientValue = ambient[name];
    if (ambientValue?.trim() && ambientValue !== value) {
      fail("An ambient production database value conflicts with its pinned private inventory");
    }
    destination[name] = value;
  }
}

export function loadPinnedProductionDatabaseEnvironment(
  profile: ProductionDatabaseCliProfile,
  options: PinnedProductionEnvironmentOptions = {},
): Readonly<Record<string, string>> {
  const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const ambient = options.ambient ?? process.env;
  const isIgnored = options.isIgnored ?? ((path: string) => defaultIgnored(repositoryRoot, path));
  const values: Record<string, string> = {};
  const read = (input: {
    exactNames?: readonly string[];
    relativePath: string;
    selectedNames: readonly string[];
  }) =>
    readPrivateInventory({
      ...input,
      isIgnored,
      repositoryRoot,
    });

  mergePinnedValues(
    values,
    read({
      exactNames: ["DIRECT_DATABASE_URL"],
      relativePath: MIGRATOR_PATH,
      selectedNames: ["DIRECT_DATABASE_URL"],
    }),
    ambient,
  );
  mergePinnedValues(
    values,
    read({
      relativePath: PRODUCTION_INVENTORY_PATH,
      selectedNames: ["DATABASE_SSL_CA"],
    }),
    ambient,
  );

  if (profile === "verify-runtime-roles") {
    mergePinnedValues(
      values,
      read({
        exactNames: RUNTIME_URL_NAMES,
        relativePath: RUNTIME_URLS_PATH,
        selectedNames: RUNTIME_URL_NAMES,
      }),
      ambient,
    );
  }
  if (profile === "provision-runtime-roles") {
    if (ambient.RUNTIME_ROLE_SECRETS_FILE?.trim()) {
      fail("RUNTIME_ROLE_SECRETS_FILE overrides are not accepted for production role provisioning");
    }
    mergePinnedValues(
      values,
      read({
        exactNames: RUNTIME_SECRET_NAMES,
        relativePath: RUNTIME_SECRETS_PATH,
        selectedNames: RUNTIME_SECRET_NAMES,
      }),
      ambient,
    );
  }

  if (profile === "provision-runtime-roles" || profile === "verify-runtime-roles") {
    const roleAdminAbsolutePath = resolve(repositoryRoot, ROLE_ADMIN_PATH);
    if (existsSync(roleAdminAbsolutePath)) {
      mergePinnedValues(
        values,
        read({
          exactNames: ["ROLE_ADMIN_DATABASE_URL"],
          relativePath: ROLE_ADMIN_PATH,
          selectedNames: ["ROLE_ADMIN_DATABASE_URL"],
        }),
        ambient,
      );
    } else if (ambient.ROLE_ADMIN_DATABASE_URL?.trim()) {
      fail("ROLE_ADMIN_DATABASE_URL requires its pinned private inventory");
    }
  }

  return Object.freeze(values);
}

export const PINNED_PRODUCTION_DATABASE_PATHS = Object.freeze({
  migrator: MIGRATOR_PATH,
  productionInventory: PRODUCTION_INVENTORY_PATH,
  roleAdmin: ROLE_ADMIN_PATH,
  runtimeSecrets: RUNTIME_SECRETS_PATH,
  runtimeUrls: RUNTIME_URLS_PATH,
});

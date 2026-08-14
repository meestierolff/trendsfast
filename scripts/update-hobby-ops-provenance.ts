import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseProductionInventory } from "./staged-production-env";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const inventoryName = ".env.production.local";
const defaultInventoryPath = resolve(repositoryRoot, inventoryName);

export class HobbyOpsProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HobbyOpsProvenanceError";
  }
}

function fail(message: string): never {
  throw new HobbyOpsProvenanceError(message);
}

function replaceSingleAssignment(source: string, name: string, value: string): string {
  const expression = new RegExp(`^[\\t ]*${name}[\\t ]*=.*$`, "gmu");
  const matches = source.match(expression);
  if (matches?.length !== 1) {
    fail(`The private production inventory must contain exactly one ${name} assignment`);
  }
  return source.replace(expression, `${name}=${JSON.stringify(value)}`);
}

export function renderHobbyOpsProvenanceInventory(
  source: string,
  publicDeploymentHost: string,
  publicDeploymentId: string,
): string {
  if (!/^(?:[a-z0-9-]+\.)*vercel\.app$/u.test(publicDeploymentHost)) {
    fail("The public deployment host provenance is malformed");
  }
  if (!/^dpl_[A-Za-z0-9]+$/u.test(publicDeploymentId)) {
    fail("The public deployment ID provenance is malformed");
  }

  const withHost = replaceSingleAssignment(
    source,
    "SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST",
    publicDeploymentHost,
  );
  const updated = replaceSingleAssignment(
    withHost,
    "SOL_HOBBY_PUBLIC_DEPLOYMENT_ID",
    publicDeploymentId,
  );
  let parsed;
  try {
    parsed = parseProductionInventory(updated);
  } catch {
    fail("The updated private production inventory could not be parsed safely");
  }
  if (
    parsed.values.SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST !== publicDeploymentHost ||
    parsed.values.SOL_HOBBY_PUBLIC_DEPLOYMENT_ID !== publicDeploymentId
  ) {
    fail("The updated private production inventory lost deployment provenance");
  }
  return updated;
}

function defaultIgnoredCheck(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--", path], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  return result.status === 0;
}

function assertPrivateInventory(path: string, isIgnored: (path: string) => boolean): void {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    fail("The private production inventory is unavailable");
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    fail("The private production inventory must be a regular mode-0600 file");
  }
  if (!isIgnored(path)) fail("The private production inventory must remain ignored by Git");
}

export function updateHobbyOpsProvenanceInventory(
  publicDeploymentHost: string,
  publicDeploymentId: string,
  path = defaultInventoryPath,
  isIgnored: (path: string) => boolean = defaultIgnoredCheck,
): void {
  assertPrivateInventory(path, isIgnored);
  const updated = renderHobbyOpsProvenanceInventory(
    readFileSync(path, "utf8"),
    publicDeploymentHost,
    publicDeploymentId,
  );
  const temporaryPath = resolve(
    dirname(path),
    `.${inventoryName}.${process.pid}.${randomBytes(8).toString("hex")}.partial`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, updated, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporaryPath);
    } catch {}
    throw error;
  }
  assertPrivateInventory(path, isIgnored);
}

function main(): void {
  const [publicDeploymentHost, publicDeploymentId] = process.argv.slice(2);
  if (!publicDeploymentHost || !publicDeploymentId || process.argv.length !== 4) {
    fail("Usage: pnpm env:update-ops-provenance -- <vercel-host> <deployment-id>");
  }
  updateHobbyOpsProvenanceInventory(publicDeploymentHost, publicDeploymentId);
  console.info("Updated private ops deployment provenance atomically; values withheld.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof HobbyOpsProvenanceError
        ? error.message
        : "Private ops provenance update failed; details withheld",
    );
    process.exitCode = 1;
  }
}

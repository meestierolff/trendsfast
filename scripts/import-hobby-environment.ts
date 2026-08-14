import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HobbyEnvironmentError,
  buildHobbyEnvironmentPlan,
  createHobbyEnvironmentAttestation,
  executeHobbyEnvironmentImport,
  preflightHobbyEnvironmentImport,
  resolveHobbyEnvironmentPhase,
  verifyHobbyEnvironmentAttestation,
  type CommandResult,
  type HobbyScanEnablementContext,
  type HobbySurface,
  type VercelCommandRunner,
} from "./hobby-environments";
import { readPrivateHobbyScanEnablementContext } from "./hobby-scan-enablement";
import { parseProductionInventory } from "./staged-production-env";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const inventoryName = ".env.production.local";
const inventoryPath = resolve(repositoryRoot, inventoryName);

export const HOBBY_ENVIRONMENT_ATTESTATION_PATHS = {
  public: ".var/private/hobby-env-attestation-public.json",
  ops: ".var/private/hobby-env-attestation-ops.json",
} as const;

export function hobbyEnvironmentAttestationPath(
  surface: HobbySurface,
  root = repositoryRoot,
): string {
  return resolve(root, HOBBY_ENVIRONMENT_ATTESTATION_PATHS[surface]);
}

function commandResult(args: readonly string[], stdin?: string): CommandResult {
  const result = spawnSync("vercel", [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: stdin,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { status: result.status, stdout: result.stdout };
}

const runner: VercelCommandRunner = { run: commandResult };

function assertPrivateInventory(): void {
  const metadata = lstatSync(inventoryPath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw new HobbyEnvironmentError(`${inventoryName} must be a regular mode-0600 file`);
  }
  const ignored = spawnSync("git", ["check-ignore", "-q", "--", inventoryName], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  if (ignored.status !== 0) {
    throw new HobbyEnvironmentError(`${inventoryName} must remain ignored by Git`);
  }
}

function assertIgnoredAttestation(surface: HobbySurface): void {
  const relativePath = HOBBY_ENVIRONMENT_ATTESTATION_PATHS[surface];
  const ignored = spawnSync("git", ["check-ignore", "-q", "--", relativePath], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  if (ignored.status !== 0) {
    throw new HobbyEnvironmentError("The private Hobby environment attestation must be ignored");
  }
}

function assertPrivateAttestationFile(path: string): void {
  if (!existsSync(path)) {
    throw new HobbyEnvironmentError(
      "The private Hobby environment attestation is missing; run an explicit --apply",
    );
  }
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw new HobbyEnvironmentError(
      "The private Hobby environment attestation must be a regular mode-0600 file",
    );
  }
}

export function writePrivateHobbyEnvironmentAttestation(path: string, source: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = lstatSync(parent);
  if (directory.isSymbolicLink() || !directory.isDirectory() || (directory.mode & 0o077) !== 0) {
    throw new HobbyEnvironmentError(
      "The private Hobby environment attestation directory must be mode-0700 or stricter",
    );
  }
  if (existsSync(path)) assertPrivateAttestationFile(path);
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.partial`;
  writeFileSync(temporaryPath, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
  assertPrivateAttestationFile(path);
}

export function readPrivateHobbyEnvironmentAttestation(path: string): string {
  assertPrivateAttestationFile(path);
  return readFileSync(path, "utf8");
}

function usage(surface: HobbySurface): void {
  console.info(
    `Usage: pnpm env:import-${surface === "public" ? "production" : "ops"} [--check | --apply]\n` +
      "  --check  Validate local and remote state without mutation (default).\n" +
      "  --apply  Replace the exact allowlisted Production values through stdin.",
  );
}

export function runHobbyEnvironmentImport(surface: HobbySurface): void {
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes("--help")) {
    usage(surface);
    return;
  }
  if (
    arguments_.some((argument) => !["--check", "--apply"].includes(argument)) ||
    (arguments_.includes("--check") && arguments_.includes("--apply"))
  ) {
    throw new HobbyEnvironmentError("Use exactly one of --check or --apply");
  }
  assertPrivateInventory();
  const inventorySource = readFileSync(inventoryPath, "utf8");
  const inventory = parseProductionInventory(inventorySource);
  const scanEnablement: HobbyScanEnablementContext | undefined =
    resolveHobbyEnvironmentPhase(inventory.values) === "canonical-origin-scans-on" &&
    surface === "public"
      ? readPrivateHobbyScanEnablementContext()
      : undefined;
  const plan = buildHobbyEnvironmentPlan(surface, inventorySource, scanEnablement);
  console.info(
    `Validated ${plan.names.length} exact ${surface} Production names for ${plan.phase}; values withheld.`,
  );
  console.info(plan.names.join("\n"));
  if (!arguments_.includes("--apply")) {
    const snapshot = preflightHobbyEnvironmentImport(plan, runner, true);
    assertIgnoredAttestation(surface);
    verifyHobbyEnvironmentAttestation(
      plan,
      snapshot,
      readPrivateHobbyEnvironmentAttestation(hobbyEnvironmentAttestationPath(surface)),
    );
    console.info(
      `${surface} exact Production environment and private attestation audit passed; no Vercel mutation performed.`,
    );
    return;
  }
  const snapshot = executeHobbyEnvironmentImport(plan, runner);
  assertIgnoredAttestation(surface);
  writePrivateHobbyEnvironmentAttestation(
    hobbyEnvironmentAttestationPath(surface),
    createHobbyEnvironmentAttestation(plan, snapshot),
  );
  console.info(
    `Configured ${plan.names.length} exact ${surface} Production values and recorded a private attestation; values withheld.`,
  );
}

export function reportHobbyImportError(error: unknown): void {
  console.error(
    error instanceof HobbyEnvironmentError
      ? error.message
      : "Hobby Production environment import failed; details withheld",
  );
  process.exitCode = 1;
}

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  assertStagedProductionLink,
  buildStagedProductionPlan,
  executeStagedProductionImport,
  preflightStagedProductionImport,
  StagedProductionEnvironmentError,
  type CommandResult,
  type VercelCommandRunner,
} from "./staged-production-env";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const inventoryName = ".env.production.local";
const inventoryPath = resolve(repositoryRoot, inventoryName);
const linkedProjectPath = resolve(repositoryRoot, ".vercel/project.json");

function commandResult(command: string, args: readonly string[], stdin?: string): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: stdin,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { status: result.status, stdout: result.stdout };
}

const vercelRunner: VercelCommandRunner = {
  run(args, stdin) {
    return commandResult("vercel", args, stdin);
  },
};

function assertPrivateInventoryFile(): void {
  const metadata = lstatSync(inventoryPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new StagedProductionEnvironmentError(
      `${inventoryName} must be a regular, non-symlink file`,
    );
  }
  if ((metadata.mode & 0o777) !== 0o600) {
    throw new StagedProductionEnvironmentError(`${inventoryName} must have mode 0600`);
  }
  const ignored = commandResult("git", ["check-ignore", "-q", "--", inventoryName]);
  if (ignored.status !== 0) {
    throw new StagedProductionEnvironmentError(`${inventoryName} must be ignored by Git`);
  }
}

function assertLinkedProject(): void {
  let linked: unknown;
  try {
    linked = JSON.parse(readFileSync(linkedProjectPath, "utf8"));
  } catch {
    throw new StagedProductionEnvironmentError("The repository must be linked to Vercel");
  }
  if (!linked || typeof linked !== "object") {
    throw new StagedProductionEnvironmentError("The repository must be linked to Vercel");
  }
  assertStagedProductionLink(linked as Record<string, unknown>);
}

function usage(): void {
  console.info(
    "Usage: pnpm env:import-production [--check | --apply]\n" +
      "  --check  Run every local and remote preflight without mutation (default).\n" +
      "  --apply  Run preflight, then replace the allowlisted Production variables.",
  );
}

function main(): void {
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes("--help")) {
    usage();
    return;
  }
  if (
    arguments_.some((argument) => !["--check", "--apply"].includes(argument)) ||
    (arguments_.includes("--check") && arguments_.includes("--apply"))
  ) {
    throw new StagedProductionEnvironmentError("Use exactly one of --check or --apply");
  }
  const apply = arguments_.includes("--apply");

  assertPrivateInventoryFile();
  assertLinkedProject();
  const plan = buildStagedProductionPlan(readFileSync(inventoryPath, "utf8"));
  console.info(
    `Validated ${plan.names.length} allowlisted Production variable names; values withheld.`,
  );
  console.info(plan.names.join("\n"));
  console.info(
    `Excluded ${plan.ignoredInventoryNameCount} local-only inventory name(s), including ${plan.forbiddenInventoryNames.length} explicitly forbidden name(s).`,
  );

  if (!apply) {
    preflightStagedProductionImport(plan, vercelRunner);
    console.info("Production environment preflight passed; no Vercel mutation performed.");
    return;
  }

  executeStagedProductionImport(plan, vercelRunner);
  console.info(
    `Configured ${plan.names.length} allowlisted Production variables; values withheld.`,
  );
}

try {
  main();
} catch (error) {
  const message =
    error instanceof StagedProductionEnvironmentError
      ? error.message
      : "Production environment import failed; details withheld";
  console.error(message);
  process.exitCode = 1;
}

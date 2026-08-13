import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { config, parse } from "dotenv";

/**
 * CLI-only loader. The application runtime should receive environment variables
 * from its host; local migrate/seed commands additionally honor .env.local then .env.
 */
export function loadCliEnvironment(cwd = process.cwd()): void {
  config({
    path: [resolve(cwd, ".env.local"), resolve(cwd, ".env")],
    override: false,
    quiet: true,
  });
}

export function loadCliEnvironmentFile(path: string): void {
  config({ path, override: false, quiet: true });
}

/** Parse a private CLI env file without mutating ambient process state. */
export function parseCliEnvironmentFile(path: string): Record<string, string> {
  return parse(readFileSync(path, "utf8"));
}

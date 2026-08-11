import { resolve } from "node:path";

import { config } from "dotenv";

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

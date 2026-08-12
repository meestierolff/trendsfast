import { defineConfig } from "drizzle-kit";

import { DEFAULT_DATABASE_URL } from "@trendsfast/config";
import { loadCliEnvironment } from "./src/load-cli-env";

loadCliEnvironment();

export default defineConfig({
  schema: "./packages/database/src/schema.ts",
  out: "./packages/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  },
  strict: true,
  verbose: false,
});

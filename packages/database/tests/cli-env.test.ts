import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCliEnvironment } from "../src/load-cli-env";

const original = process.env.TRENDSFAST_ENV_LOADER_TEST;
let directory: string | undefined;

afterEach(() => {
  if (original === undefined) delete process.env.TRENDSFAST_ENV_LOADER_TEST;
  else process.env.TRENDSFAST_ENV_LOADER_TEST = original;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("database CLI environment loading", () => {
  it("loads .env.local before .env without printing values", () => {
    directory = mkdtempSync(join(tmpdir(), "trendsfast-env-test-"));
    writeFileSync(join(directory, ".env"), "TRENDSFAST_ENV_LOADER_TEST=from-env\n", "utf8");
    writeFileSync(join(directory, ".env.local"), "TRENDSFAST_ENV_LOADER_TEST=from-local\n", "utf8");
    delete process.env.TRENDSFAST_ENV_LOADER_TEST;

    loadCliEnvironment(directory);

    expect(process.env.TRENDSFAST_ENV_LOADER_TEST).toBe("from-local");
  });
});

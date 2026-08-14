import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  REQUIRED_SOURCE_SENTINELS,
  REQUIRED_VERCEL_IGNORE_PATTERNS,
  SENSITIVE_UPLOAD_SENTINELS,
  VercelSourceBoundaryError,
  createVercelUploadMatcher,
  verifyVercelSourceBoundary,
} from "../../../scripts/verify-vercel-source-boundary";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const source = readFileSync(join(repositoryRoot, ".vercelignore"), "utf8");
const gitIgnoreSource = readFileSync(join(repositoryRoot, ".gitignore"), "utf8");
const publicDeployScript = readFileSync(
  join(repositoryRoot, "scripts/deploy-hobby-production.sh"),
  "utf8",
);
const opsDeployScript = readFileSync(join(repositoryRoot, "scripts/deploy-hobby-ops.sh"), "utf8");

function temporaryBoundary(contents = source): string {
  const directory = mkdtempSync(join(tmpdir(), "tf-vercel-boundary-"));
  writeFileSync(join(directory, ".vercelignore"), contents);
  return directory;
}

describe("Vercel source-upload boundary", () => {
  it("mirrors every required private, workstation, cache, and backup exclusion", () => {
    const active = source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(active).toEqual(expect.arrayContaining([...REQUIRED_VERCEL_IGNORE_PATTERNS]));
    expect(active.every((line) => !line.startsWith("!"))).toBe(true);

    for (const gitPrivateRule of [
      ".env",
      ".env.*",
      ".env.*.local",
      ".var/private/",
      ".projects/cache",
      ".projects/vault",
      ".projects/state.test.json",
      ".projects/state.local.test.json",
      ".agents/",
      "supabase/.temp/",
    ]) {
      expect(gitIgnoreSource.split(/\r?\n/u)).toContain(gitPrivateRule);
    }
  });

  it("uses Vercel's gitignore semantics to exclude every sensitive path sentinel", () => {
    const matcher = createVercelUploadMatcher(source);
    for (const path of SENSITIVE_UPLOAD_SENTINELS) expect(matcher.ignores(path)).toBe(true);
    for (const path of REQUIRED_SOURCE_SENTINELS) expect(matcher.ignores(path)).toBe(false);

    expect(verifyVercelSourceBoundary({ repositoryRoot, requireTracked: false })).toEqual({
      requiredRuleCount: REQUIRED_VERCEL_IGNORE_PATTERNS.length,
      protectedSentinelCount: SENSITIVE_UPLOAD_SENTINELS.length,
      requiredSourceCount: REQUIRED_SOURCE_SENTINELS.length,
      tracked: expect.any(Boolean),
    });
  });

  it("fails closed on a missing rule, a negation, a conflict, and a symlink", () => {
    const missingRule = temporaryBoundary(source.replace(".var\n", ""));
    expect(() =>
      verifyVercelSourceBoundary({ repositoryRoot: missingRule, requireTracked: false }),
    ).toThrow("missing a required protection rule");

    const negated = temporaryBoundary(`${source}\n!.var/private/runtime-role-urls.env\n`);
    expect(() =>
      verifyVercelSourceBoundary({ repositoryRoot: negated, requireTracked: false }),
    ).toThrow("Negated .vercelignore rules are not allowed");

    const conflicted = temporaryBoundary();
    writeFileSync(join(conflicted, ".nowignore"), ".var\n");
    expect(() =>
      verifyVercelSourceBoundary({ repositoryRoot: conflicted, requireTracked: false }),
    ).toThrow("conflicting root .nowignore");

    const linked = mkdtempSync(join(tmpdir(), "tf-vercel-boundary-link-"));
    const target = join(linked, "ignore-target");
    writeFileSync(target, source);
    symlinkSync(target, join(linked, ".vercelignore"));
    expect(() =>
      verifyVercelSourceBoundary({ repositoryRoot: linked, requireTracked: false }),
    ).toThrow("regular non-symlink file");
  });

  it("reports only sanitized boundary errors", () => {
    const untracked = temporaryBoundary(source);
    expect(() => verifyVercelSourceBoundary({ repositoryRoot: untracked })).toThrow(
      "not tracked in the accepted Git release",
    );

    expect(() =>
      verifyVercelSourceBoundary({
        repositoryRoot: temporaryBoundary(""),
        requireTracked: false,
      }),
    ).toThrow(VercelSourceBoundaryError);
  });

  it("makes both founder deploy scripts run the boundary check before Vercel deploy", () => {
    const guard = "pnpm --silent vercel:verify-source";
    for (const [script, deployCommand] of [
      [publicDeployScript, "vercel deploy --prod --skip-domain --yes"],
      [opsDeployScript, "vercel deploy --prod --yes"],
    ] as const) {
      expect(script).toContain(guard);
      expect(script.indexOf(guard)).toBeLessThan(script.indexOf(deployCommand));
      expect(script).toContain("for required_command in git vercel node pnpm");
    }
  });
});

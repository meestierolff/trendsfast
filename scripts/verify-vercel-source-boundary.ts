import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ignore, { type Ignore } from "ignore";

/** Keep this aligned with the non-prebuilt defaults in Vercel CLI 58's getVercelIgnore. */
export const VERCEL_DEFAULT_IGNORE_PATTERNS = [
  ".hg",
  ".git",
  ".gitmodules",
  ".svn",
  ".cache",
  ".next",
  ".now",
  ".vercel",
  ".npmignore",
  ".dockerignore",
  ".gitignore",
  ".*.swp",
  ".DS_Store",
  ".wafpicke-*",
  ".lock-wscript",
  ".env.local",
  ".env.*.local",
  ".venv",
  ".yarn/cache",
  ".pnp*",
  "npm-debug.log",
  "config.gypi",
  "node_modules",
  "__pycache__",
  "venv",
  "CVS",
] as const;

export const REQUIRED_VERCEL_IGNORE_PATTERNS = [
  ".env*",
  ".var",
  ".projects",
  ".agents",
  ".codex",
  ".vercel",
  ".wrangler",
  ".local",
  ".pnpm-store",
  ".vite",
  ".idea",
  ".vscode",
  ".fleet",
  ".cursor",
  ".claude",
  ".windsurf",
  ".aws",
  ".ssh",
  ".config/gh",
  ".config/gcloud",
  ".npmrc",
  ".yarnrc*",
  ".netrc",
  ".pgpass",
  ".psql_history",
  ".bash_history",
  ".zsh_history",
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  ".turbo",
  "supabase/.temp",
  "openapi/openapi.json",
  "*.tsbuildinfo",
  "*.log",
  ".DS_Store",
  "AGENTS.md",
  "CLAUDE.md",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "*.mobileprovision",
  "*.db",
  "*.sqlite",
  "*.sqlite3",
  "*.dump",
  "*.dump.gpg",
] as const;

/**
 * These are inert path-only canaries. The verifier never opens any corresponding
 * private file; it asks the same gitignore-compatible matcher used by Vercel
 * whether each possible upload path is excluded.
 */
export const SENSITIVE_UPLOAD_SENTINELS = [
  ".env",
  ".env.example",
  ".env.local",
  ".env.production.local",
  "apps/web/.env.production",
  ".var/private/backup-passphrase",
  ".var/private/hobby-release.json",
  ".var/private/hobby-scan-enablement.json",
  ".var/private/managed-policy.env",
  ".var/private/migrator-database-url.env",
  ".var/private/preview-app-secrets.env",
  ".var/private/provider-prices.env",
  ".var/private/runtime-role-secrets.env",
  ".var/private/runtime-role-urls.env",
  ".var/private/backups/trendsfast-app.dump.gpg",
  ".projects/cache/catalog.json",
  ".projects/state.test.json",
  ".projects/state.local.test.json",
  ".projects/vault/credential.json",
  ".agents/session.json",
  ".codex/config.toml",
  ".vercel/project.json",
  ".wrangler/state.json",
  ".local/share/trendsfast.json",
  ".pnpm-store/v3/files/cache-entry",
  ".vite/deps/metadata.json",
  ".idea/workspace.xml",
  ".vscode/settings.json",
  ".fleet/settings.json",
  ".cursor/rules/local.mdc",
  ".claude/settings.local.json",
  ".windsurf/rules/local.md",
  ".aws/credentials",
  ".ssh/id_ed25519",
  ".config/gh/hosts.yml",
  ".config/gcloud/application_default_credentials.json",
  ".npmrc",
  ".yarnrc.yml",
  ".netrc",
  ".pgpass",
  ".psql_history",
  ".bash_history",
  ".zsh_history",
  "node_modules/private-package/index.js",
  "apps/web/.next/server/app.js",
  "packages/config/dist/index.js",
  "coverage/coverage-final.json",
  "apps/web/playwright-report/index.html",
  "apps/web/test-results/.last-run.json",
  ".turbo/cache/trace.json",
  "supabase/.temp/pooler-url",
  "openapi/openapi.json",
  "packages/config/tsconfig.tsbuildinfo",
  "debug.log",
  ".DS_Store",
  "apps/web/AGENTS.md",
  "apps/web/CLAUDE.md",
  "private-key.pem",
  "signing.key",
  "certificate.p12",
  "certificate.pfx",
  "signing.jks",
  "signing.keystore",
  "profile.mobileprovision",
  "local.db",
  "local.sqlite",
  "local.sqlite3",
  "backup.dump",
  "backup.dump.gpg",
] as const;

export const REQUIRED_SOURCE_SENTINELS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/web/package.json",
  "apps/web/vercel.ts",
  "apps/web/vercel.hobby.json",
  "apps/web/vercel.ops.json",
  "apps/web/app/page.tsx",
  "packages/config/package.json",
] as const;

const defaultRepositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export class VercelSourceBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VercelSourceBoundaryError";
  }
}

export interface VercelSourceBoundaryResult {
  readonly requiredRuleCount: number;
  readonly protectedSentinelCount: number;
  readonly requiredSourceCount: number;
  readonly tracked: boolean;
}

interface VerifyOptions {
  readonly repositoryRoot?: string;
  readonly requireTracked?: boolean;
}

function fail(message: string): never {
  throw new VercelSourceBoundaryError(message);
}

function activeRules(source: string): readonly string[] {
  return source
    .replace(/(^|\n)\.\//gu, "$1")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function createVercelUploadMatcher(vercelIgnoreSource: string): Ignore {
  return ignore().add(VERCEL_DEFAULT_IGNORE_PATTERNS.join("\n")).add(vercelIgnoreSource);
}

function isTracked(repositoryRoot: string): boolean {
  const result = spawnSync("git", ["ls-files", "--error-unmatch", "--", ".vercelignore"], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  return result.status === 0;
}

export function verifyVercelSourceBoundary(
  options: VerifyOptions = {},
): VercelSourceBoundaryResult {
  const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot);
  const vercelIgnorePath = resolve(repositoryRoot, ".vercelignore");
  const nowIgnorePath = resolve(repositoryRoot, ".nowignore");

  let metadata;
  try {
    metadata = lstatSync(vercelIgnorePath);
  } catch {
    fail("The tracked root .vercelignore is missing");
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail("The root .vercelignore must be a regular non-symlink file");
  }
  if (existsSync(nowIgnorePath)) {
    fail("A conflicting root .nowignore is not allowed");
  }

  const source = readFileSync(vercelIgnorePath, "utf8");
  const rules = activeRules(source);
  if (rules.some((rule) => rule.startsWith("!"))) {
    fail("Negated .vercelignore rules are not allowed at the deploy boundary");
  }
  if (!REQUIRED_VERCEL_IGNORE_PATTERNS.every((rule) => rules.includes(rule))) {
    fail("The root .vercelignore is missing a required protection rule");
  }

  const matcher = createVercelUploadMatcher(source);
  if (!SENSITIVE_UPLOAD_SENTINELS.every((path) => matcher.ignores(path))) {
    fail("A private or workstation sentinel would enter the Vercel upload set");
  }
  if (REQUIRED_SOURCE_SENTINELS.some((path) => matcher.ignores(path))) {
    fail("A required build-source sentinel is excluded from the Vercel upload set");
  }

  const tracked = isTracked(repositoryRoot);
  if ((options.requireTracked ?? true) && !tracked) {
    fail("The root .vercelignore is not tracked in the accepted Git release");
  }

  return {
    requiredRuleCount: REQUIRED_VERCEL_IGNORE_PATTERNS.length,
    protectedSentinelCount: SENSITIVE_UPLOAD_SENTINELS.length,
    requiredSourceCount: REQUIRED_SOURCE_SENTINELS.length,
    tracked,
  };
}

function main(): void {
  if (process.argv.length > 2) fail("The Vercel source-boundary preflight accepts no arguments");
  const result = verifyVercelSourceBoundary();
  console.info(
    `Vercel source boundary passed: rules=${result.requiredRuleCount}; protected=${result.protectedSentinelCount}; required=${result.requiredSourceCount}; tracked=yes`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof VercelSourceBoundaryError
        ? error.message
        : "Vercel source-boundary preflight failed; details withheld",
    );
    process.exitCode = 1;
  }
}

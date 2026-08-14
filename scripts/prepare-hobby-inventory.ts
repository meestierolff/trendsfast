import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseProductionInventory } from "./staged-production-env";
import {
  HOBBY_ENVIRONMENT_PHASE_FIELD,
  HOBBY_ENVIRONMENT_PHASES,
  HOBBY_LOCAL_SUPABASE_REF_FIELD,
  HOBBY_PUBLIC_EFFECTS,
  HOBBY_SUPABASE_ORIGIN,
  HOBBY_SUPABASE_PROJECT_REF,
  HobbyEnvironmentError,
  buildHobbyEnvironmentPlan,
  resolveHobbyEnvironmentPhase,
  type HobbyScanEnablementContext,
} from "./hobby-environments";
import { readPrivateHobbyScanEnablementContext } from "./hobby-scan-enablement";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const inventoryPath = resolve(repositoryRoot, ".env.production.local");
const roleInventoryPath = resolve(repositoryRoot, ".var/private/runtime-role-urls.env");
const managedPolicyPath = resolve(repositoryRoot, ".var/private/managed-policy.env");
const providerPricesPath = resolve(repositoryRoot, ".var/private/provider-prices.env");
const ca2021Path = resolve(repositoryRoot, "config/certs/supabase-prod-ca-2021.crt");
const ca2025Path = resolve(repositoryRoot, "config/certs/supabase-prod-ca-2025.crt");

const PINNED_CA_SHA256 = {
  [ca2021Path]: "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
  [ca2025Path]: "5865d2b26f6128e5795a13ae58b6543599bdb82d808f7f62e3c9a8d7e8527970",
} as const;

const BOOTSTRAP_PUBLIC_DEPLOYMENT = {
  host: "trendsfast.vercel.app",
  id: "dpl_9Z3XyyjM7UGtkhJRCVEVfKKUpFm8",
} as const;

const GENERATED_SECRET_NAMES = [
  "SESSION_SECRET",
  "API_KEY_PEPPER",
  "OPS_TOKEN",
  "OPS_ALERT_WEBHOOK_SECRET",
  "SOL_HOBBY_OPS_SESSION_SECRET",
] as const;

const FORBIDDEN_LEGACY_KEY_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

function fail(message: string): never {
  throw new HobbyEnvironmentError(message);
}

function fileMode(path: string): number {
  return lstatSync(path).mode & 0o777;
}

function assertPrivateInput(path: string): void {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || fileMode(path) !== 0o600) {
    fail("Every private Hobby inventory input must be a regular mode-0600 file");
  }
}

function parsePrivateInput(path: string): Readonly<Record<string, string>> {
  assertPrivateInput(path);
  return parseProductionInventory(readFileSync(path, "utf8")).values;
}

function randomSecret(): string {
  return randomBytes(48).toString("base64url");
}

function loadPinnedCaBundle(): string {
  const certificates = [ca2021Path, ca2025Path].map((path) => {
    const certificate = readFileSync(path, "utf8");
    const digest = createHash("sha256").update(certificate).digest("hex");
    if (digest !== PINNED_CA_SHA256[path as keyof typeof PINNED_CA_SHA256]) {
      fail("The tracked Supabase production CA bundle does not match its pinned digest");
    }
    if (
      !certificate.startsWith("-----BEGIN CERTIFICATE-----\n") ||
      !certificate.endsWith("-----END CERTIFICATE-----\n")
    ) {
      fail("The tracked Supabase production CA bundle is malformed");
    }
    return certificate.trimEnd();
  });
  return `${certificates.join("\n")}\n`;
}

type SupabaseApiKey = {
  api_key?: unknown;
  type?: unknown;
  name?: unknown;
};

function fetchPublishableKey(): string {
  const result = spawnSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", HOBBY_SUPABASE_PROJECT_REF, "--output", "json"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) fail("The Supabase publishable-key readback failed; output withheld");
  let keys: unknown;
  try {
    keys = JSON.parse(result.stdout);
  } catch {
    fail("The Supabase publishable-key readback was malformed; output withheld");
  }
  if (!Array.isArray(keys)) fail("The Supabase publishable-key readback was malformed");
  const publishable = (keys as SupabaseApiKey[]).filter(
    (entry) =>
      entry.type === "publishable" &&
      entry.name === "default" &&
      typeof entry.api_key === "string" &&
      entry.api_key.startsWith("sb_publishable_"),
  );
  if (publishable.length !== 1) fail("Exactly one default Supabase publishable key is required");
  return publishable[0]!.api_key as string;
}

function assertIgnoredInventory(): void {
  const result = spawnSync("git", ["check-ignore", "-q", "--", ".env.production.local"], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  if (result.status !== 0) fail(".env.production.local must remain ignored by Git");
}

function serialize(values: Readonly<Record<string, string>>): string {
  const assignments = Object.keys(values)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => `${name}=${JSON.stringify(values[name] ?? "")}`);
  return `# Private inert production inventory. Never source this file.\n${assignments.join("\n")}\n`;
}

function mergeNonempty(
  target: Record<string, string>,
  source: Readonly<Record<string, string>>,
): void {
  for (const [name, value] of Object.entries(source)) {
    if (value.trim()) target[name] = value;
  }
}

export function applyReviewedHobbyEnvironmentPhase(
  target: Record<string, string>,
  reviewedInventory: Readonly<Record<string, string>>,
): void {
  const phase = resolveHobbyEnvironmentPhase(reviewedInventory);
  const explicitPhase = reviewedInventory[HOBBY_ENVIRONMENT_PHASE_FIELD];
  const profile = HOBBY_ENVIRONMENT_PHASES[phase];
  if (explicitPhase === undefined) delete target[HOBBY_ENVIRONMENT_PHASE_FIELD];
  else target[HOBBY_ENVIRONMENT_PHASE_FIELD] = phase;
  target.APP_URL = profile.publicOrigin;
  target.PUBLIC_APP_URL = profile.publicOrigin;
  target.PUBLIC_SCANS_ENABLED = profile.publicScansEnabled;
}

export function resolveHobbyPublicDeploymentProvenance(values: Readonly<Record<string, string>>): {
  readonly host: string;
  readonly id: string;
} {
  const host = values.SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST?.trim();
  const id = values.SOL_HOBBY_PUBLIC_DEPLOYMENT_ID?.trim();
  if (!host && !id) return BOOTSTRAP_PUBLIC_DEPLOYMENT;
  if (
    !host ||
    !id ||
    !/^(?:trendsfast|trendsfast-[a-z0-9-]+)\.vercel\.app$/u.test(host) ||
    !/^dpl_[A-Za-z0-9]+$/u.test(id)
  ) {
    fail("Existing public deployment provenance is incomplete or malformed");
  }
  return { host, id };
}

function main(): void {
  process.umask(0o077);
  assertIgnoredInventory();
  const current = { ...parsePrivateInput(inventoryPath) };
  resolveHobbyEnvironmentPhase(current);
  const roleUrls = parsePrivateInput(roleInventoryPath);
  const managedPolicy = parsePrivateInput(managedPolicyPath);
  const providerPrices = parsePrivateInput(providerPricesPath);
  const values: Record<string, string> = { ...current };
  mergeNonempty(values, roleUrls);
  mergeNonempty(values, managedPolicy);
  mergeNonempty(values, providerPrices);
  const publicDeployment = resolveHobbyPublicDeploymentProvenance(values);

  for (const name of FORBIDDEN_LEGACY_KEY_NAMES) delete values[name];
  for (const name of GENERATED_SECRET_NAMES) {
    if (!values[name] || values[name]!.length < 32) values[name] = randomSecret();
  }
  if (values.SOL_HOBBY_CRON_SECRET_VERSION !== "1") {
    values.CRON_SECRET = randomSecret();
    values.SOL_HOBBY_CRON_SECRET_VERSION = "1";
  }
  if (values.SOL_HOBBY_OPS_SESSION_SECRET === values.SESSION_SECRET) {
    values.SOL_HOBBY_OPS_SESSION_SECRET = randomSecret();
  }
  if (
    !values.MANAGED_POLICY_REVISION ||
    values.MANAGED_POLICY_REVISION.length < 32 ||
    !/^[A-Za-z0-9_-]+$/u.test(values.MANAGED_POLICY_REVISION)
  ) {
    values.MANAGED_POLICY_REVISION = `hobby_${randomBytes(24).toString("base64url")}`;
  }

  Object.assign(values, HOBBY_PUBLIC_EFFECTS, {
    NODE_ENV: "production",
    PROVIDER_CREDENTIAL_MODE: "managed",
    PUBLIC_SCAN_PROCESSING: "inline",
    MAX_SCAN_DURATION_SECONDS: "240",
    TURNSTILE_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: HOBBY_SUPABASE_ORIGIN,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fetchPublishableKey(),
    DATABASE_SSL_CA: loadPinnedCaBundle(),
    [HOBBY_LOCAL_SUPABASE_REF_FIELD]: HOBBY_SUPABASE_PROJECT_REF,
    SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST: publicDeployment.host,
    SOL_HOBBY_PUBLIC_DEPLOYMENT_ID: publicDeployment.id,
  });
  applyReviewedHobbyEnvironmentPhase(values, current);

  const preparedSource = serialize(values);
  const scanEnablement: HobbyScanEnablementContext | undefined =
    resolveHobbyEnvironmentPhase(values) === "canonical-origin-scans-on"
      ? readPrivateHobbyScanEnablementContext()
      : undefined;
  buildHobbyEnvironmentPlan("public", preparedSource, scanEnablement);
  buildHobbyEnvironmentPlan("ops", preparedSource);

  const temporaryPath = `${inventoryPath}.hobby-partial`;
  writeFileSync(temporaryPath, serialize(values), { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, inventoryPath);
  chmodSync(inventoryPath, 0o600);
  assertPrivateInput(inventoryPath);
  assertIgnoredInventory();
  console.info(
    `Prepared ${Object.keys(values).length} inert private inventory names; values withheld.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message =
      error instanceof HobbyEnvironmentError
        ? error.message
        : "Hobby private inventory preparation failed; details withheld";
    console.error(message);
    process.exitCode = 1;
  }
}

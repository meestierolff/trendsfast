import { createHash, timingSafeEqual } from "node:crypto";

import { tryParseEnv } from "@trendsfast/config";

import { parseProductionInventory } from "./staged-production-env";

export type HobbySurface = "public" | "ops";

export const HOBBY_VERCEL_ORG_ID = "team_UVAUfp4G8CmlSNPI9w5FasKj";
export const HOBBY_SUPABASE_PROJECT_REF = "auxienkuufejeakaczlq";
export const HOBBY_SUPABASE_POOLER_HOST = "aws-0-eu-central-1.pooler.supabase.com" as const;
export const HOBBY_PUBLIC_ORIGIN = "https://trendsfast.vercel.app";
export const HOBBY_CANONICAL_PUBLIC_ORIGIN = "https://trendsfast.com";
export const HOBBY_OPS_ORIGIN = "https://trendsfast-ops.vercel.app";
export const HOBBY_SUPABASE_ORIGIN = `https://${HOBBY_SUPABASE_PROJECT_REF}.supabase.co` as const;
export const HOBBY_LOCAL_SUPABASE_REF_FIELD = "SOL_READS_SUPABASE_PRODUCTION_PROJECT_REF" as const;
export const HOBBY_ENVIRONMENT_PHASE_FIELD = "SOL_HOBBY_ENVIRONMENT_PHASE" as const;
export const HOBBY_DATABASE_SSL_CA_SHA256 =
  "6ecd239038a7db063a6619b71742372ecfe06c0b0ec12a9993fee4445bf0d4d6" as const;

export const HOBBY_ENVIRONMENT_PHASES = {
  "generated-origin-scans-off": {
    publicOrigin: HOBBY_PUBLIC_ORIGIN,
    publicScansEnabled: "false",
  },
  "canonical-origin-scans-off": {
    publicOrigin: HOBBY_CANONICAL_PUBLIC_ORIGIN,
    publicScansEnabled: "false",
  },
  "canonical-origin-scans-on": {
    publicOrigin: HOBBY_CANONICAL_PUBLIC_ORIGIN,
    publicScansEnabled: "true",
  },
} as const;

export type HobbyEnvironmentPhase = keyof typeof HOBBY_ENVIRONMENT_PHASES;

export const HOBBY_DEFAULT_ENVIRONMENT_PHASE =
  "generated-origin-scans-off" satisfies HobbyEnvironmentPhase;

export const HOBBY_PROJECTS = {
  public: {
    name: "trendsfast",
    id: "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC",
    origin: HOBBY_PUBLIC_ORIGIN,
  },
  ops: {
    name: "trendsfast-ops",
    id: "prj_EYAjX2Nyd1jUXSjfWVTVoI320nnU",
    origin: HOBBY_OPS_ORIGIN,
  },
} as const;

const COMMON_EFFECTS = {
  PROVIDER_CALLS_ENABLED: "true",
  PUBLIC_SCANS_ENABLED: "false",
  LIVE_API_CREATION_ENABLED: "true",
  BILLING_ENABLED: "false",
  BILLING_CHECKOUT_ENABLED: "false",
  PAID_MONITORING_ENABLED: "false",
  MONITORING_ENABLED: "false",
  FOUNDING_100_ENABLED: "false",
  CLOUD_TRIAL_ENABLED: "false",
  STRIPE_MODE: "test",
} as const;

export const HOBBY_PUBLIC_EFFECTS = {
  ...COMMON_EFFECTS,
  TRENDSFAST_SURFACE: "public",
} as const;

export const HOBBY_OPS_EFFECTS = {
  ...COMMON_EFFECTS,
  TRENDSFAST_SURFACE: "ops",
} as const;

const MANAGED_POLICY_VARIABLES = [
  "MANAGED_POLICY_REVISION",
  "PUBLIC_SCAN_PROCESSING",
  "PUBLIC_SCAN_DAILY_LIMIT",
  "PUBLIC_SCAN_GLOBAL_DAILY_LIMIT",
  "PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD",
  "API_CREATE_RATE_LIMIT_PER_HOUR",
  "API_STATUS_RATE_LIMIT_PER_HOUR",
  "API_AUTH_FAILURE_LIMIT_PER_HOUR",
  "API_PROVIDER_COST_LIMIT_USD_PER_HOUR",
  "SCAN_RETENTION_DAYS",
] as const;

const PROVIDER_VARIABLES = [
  "XAI_API_KEY",
  "XAI_MODEL",
  "XAI_ESTIMATED_COST_USD_PER_SEARCH",
  "XAI_MAX_TOOL_CALLS_PER_SCAN",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "DATAFORSEO_GOOGLE_TRENDS_MODE",
  "DATAFORSEO_ESTIMATED_COST_USD_PER_TASK",
  "TAVILY_API_KEY",
  "TAVILY_ESTIMATED_COST_USD_PER_CREDIT",
  "TAVILY_MAX_CREDITS_PER_SCAN",
  "YOUTUBE_API_KEY",
  "YOUTUBE_INTERNAL_QUOTA_VALUE_USD",
  "YOUTUBE_MAX_SEARCHES_PER_SCAN",
  "GITHUB_TOKEN",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS",
  "LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS",
  "MAX_PROVIDER_COST_USD_PER_SCAN",
  "MAX_SCAN_DURATION_SECONDS",
  "PROVIDER_TIMEOUT_MS",
] as const;

const EFFECT_VARIABLES = Object.keys(COMMON_EFFECTS) as Array<keyof typeof COMMON_EFFECTS>;

export const HOBBY_PUBLIC_ALLOWLIST = [
  "NODE_ENV",
  "APP_URL",
  "PUBLIC_APP_URL",
  "TRENDSFAST_SURFACE",
  "DATABASE_URL",
  "MEMBER_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "DATABASE_SSL_CA",
  "PROVIDER_CREDENTIAL_MODE",
  ...MANAGED_POLICY_VARIABLES,
  ...PROVIDER_VARIABLES,
  "SESSION_SECRET",
  "API_KEY_PEPPER",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "TURNSTILE_ENABLED",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "CRON_SECRET",
  ...EFFECT_VARIABLES,
  "NEXT_PUBLIC_ANNOUNCEMENT_ENABLED",
  "NEXT_PUBLIC_ANNOUNCEMENT_TEXT",
  "DATAFAST_ENABLED",
] as const;

export const HOBBY_OPS_ALLOWLIST = [
  "NODE_ENV",
  "APP_URL",
  "PUBLIC_APP_URL",
  "TRENDSFAST_SURFACE",
  "OPS_DATABASE_URL",
  "DATABASE_SSL_CA",
  "PROVIDER_CREDENTIAL_MODE",
  "OPS_TOKEN",
  "SESSION_SECRET",
  // API key hashes created by ops must be verifiable by the public auth role. This is
  // the sole intentionally shared cross-surface secret; database and session secrets
  // stay independent.
  "API_KEY_PEPPER",
  "PUBLIC_DEPLOYMENT_HOST",
  "PUBLIC_DEPLOYMENT_ID",
  ...MANAGED_POLICY_VARIABLES,
  ...PROVIDER_VARIABLES,
  ...EFFECT_VARIABLES,
] as const;

export const HOBBY_FORBIDDEN_REMOTE_VARIABLES = [
  "DIRECT_DATABASE_URL",
  "ROLE_ADMIN_DATABASE_URL",
  "DATABASE_PASSWORD",
  "POSTGRES_PASSWORD",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_FOUNDER_CLOUD_PRICE_ID",
  "STRIPE_PORTAL_LOGIN_URL",
  "I_UNDERSTAND_LIVE_STRIPE",
  "STRIPE_LIVE_CATALOG_APPROVED",
  "STRIPE_LIVE_ENABLEMENT_APPROVED",
  "PAID_HOSTING_APPROVED",
] as const;

const PUBLIC_FORBIDDEN = [
  ...HOBBY_FORBIDDEN_REMOTE_VARIABLES,
  "OPS_TOKEN",
  "OPS_DATABASE_URL",
  "BILLING_DATABASE_URL",
  "RETENTION_DATABASE_URL",
  "OPS_ALERT_WEBHOOK_URL",
  "OPS_ALERT_WEBHOOK_SECRET",
] as const;

const OPS_FORBIDDEN = [
  ...HOBBY_FORBIDDEN_REMOTE_VARIABLES,
  "DATABASE_URL",
  "MEMBER_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "BILLING_DATABASE_URL",
  "RETENTION_DATABASE_URL",
  "CRON_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "TURNSTILE_ENABLED",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "OPS_ALERT_WEBHOOK_URL",
  "OPS_ALERT_WEBHOOK_SECRET",
] as const;

const PLAIN_VARIABLES = new Set<string>([
  "NODE_ENV",
  "APP_URL",
  "PUBLIC_APP_URL",
  "TRENDSFAST_SURFACE",
  "PROVIDER_CREDENTIAL_MODE",
  "PUBLIC_SCAN_PROCESSING",
  "PUBLIC_DEPLOYMENT_HOST",
  "PUBLIC_DEPLOYMENT_ID",
  "NEXT_PUBLIC_ANNOUNCEMENT_ENABLED",
  "NEXT_PUBLIC_ANNOUNCEMENT_TEXT",
  "DATAFAST_ENABLED",
  ...EFFECT_VARIABLES,
]);

const LOCAL_SOURCE_NAMES: Partial<Record<HobbySurface, Readonly<Record<string, string>>>> = {
  ops: {
    SESSION_SECRET: "SOL_HOBBY_OPS_SESSION_SECRET",
    PUBLIC_DEPLOYMENT_HOST: "SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST",
    PUBLIC_DEPLOYMENT_ID: "SOL_HOBBY_PUBLIC_DEPLOYMENT_ID",
  },
};

export class HobbyEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HobbyEnvironmentError";
  }
}

export interface HobbyVariable {
  readonly name: string;
  readonly value: string;
  readonly sensitivity: "plain" | "sensitive";
}

export interface HobbyEnvironmentPlan {
  readonly surface: HobbySurface;
  readonly phase: HobbyEnvironmentPhase;
  readonly variables: readonly HobbyVariable[];
  readonly names: readonly string[];
}

export interface HobbyScanEnablementContext {
  readonly evidenceSource: string;
  readonly acceptedReleaseSource: string;
}

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
}

export interface VercelCommandRunner {
  run(args: readonly string[], stdin?: string): CommandResult;
}

export interface HobbyRemoteEnvironmentVariable {
  readonly name: string;
  readonly id: string;
  readonly updatedAt: string;
  readonly type: "encrypted" | "sensitive";
  readonly target: readonly ["production"];
  readonly gitBranch: null;
  readonly configurationId: null;
  readonly customEnvironmentIds: readonly [];
}

export interface HobbyRemoteEnvironmentSnapshot {
  readonly surface: HobbySurface;
  readonly projectId: string;
  readonly variables: readonly HobbyRemoteEnvironmentVariable[];
}

export interface HobbyEnvironmentAttestation {
  readonly schemaVersion: 1;
  readonly surface: HobbySurface;
  readonly projectId: string;
  readonly remoteVariables: readonly HobbyRemoteEnvironmentVariable[];
  readonly proofSha256: string;
}

function fail(message: string): never {
  throw new HobbyEnvironmentError(message);
}

const HOBBY_SCAN_ENABLEMENT_HOSTNAMES = [
  "trendsfast.vercel.app",
  "trendsfast.com",
  "www.trendsfast.com",
] as const;

const HOBBY_TURNSTILE_EVIDENCE_OUTCOMES = [
  "valid",
  "missing",
  "forged",
  "replayed",
  "expired",
  "wrongAction",
  "wrongHostname",
] as const;

function isExactObject(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) ===
      JSON.stringify([...expectedKeys].sort())
  );
}

function parsePrivateJson(source: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail(`${label} was not valid JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${label} was malformed`);
  }
  return parsed as Record<string, unknown>;
}

export function validateHobbyScanEnablementEvidence(
  siteKey: string,
  context: HobbyScanEnablementContext | undefined,
): void {
  if (!context) {
    fail(
      "Public scans-on requires the private founder-approved dogfood and Turnstile evidence contract",
    );
  }
  const evidence = parsePrivateJson(
    context.evidenceSource,
    "The private Hobby scan-enablement evidence",
  );
  const release = parsePrivateJson(
    context.acceptedReleaseSource,
    "The private accepted-release contract",
  );
  if (
    !isExactObject(release, [
      "version",
      "acceptedBranch",
      "acceptedSha",
      "publicDeploymentHost",
      "publicDeploymentId",
    ]) ||
    release.version !== 1 ||
    (release.acceptedBranch !== "main" && release.acceptedBranch !== "sol/hobby-launch-dogfood") ||
    typeof release.acceptedSha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(release.acceptedSha) ||
    typeof release.publicDeploymentHost !== "string" ||
    !/^(?:trendsfast|trendsfast-[a-z0-9-]+)\.vercel\.app$/u.test(release.publicDeploymentHost) ||
    typeof release.publicDeploymentId !== "string" ||
    !/^dpl_[A-Za-z0-9]+$/u.test(release.publicDeploymentId)
  ) {
    fail("The private accepted-release contract cannot authorize public scans-on");
  }
  if (
    !isExactObject(evidence, [
      "schemaVersion",
      "acceptedSha",
      "testedPublicDeploymentHost",
      "testedPublicDeploymentId",
      "siteKeySha256",
      "action",
      "hostnames",
      "turnstileMatrix",
      "dogfood",
      "founderApproved",
    ])
  ) {
    fail(
      "The private Hobby scan-enablement evidence does not match the accepted release, Turnstile contract, and dogfood gates",
    );
  }
  const turnstileMatrix = evidence.turnstileMatrix;
  const dogfood = evidence.dogfood;
  if (
    evidence.schemaVersion !== 1 ||
    evidence.acceptedSha !== release.acceptedSha ||
    evidence.testedPublicDeploymentHost !== release.publicDeploymentHost ||
    evidence.testedPublicDeploymentId !== release.publicDeploymentId ||
    evidence.siteKeySha256 !== createHash("sha256").update(siteKey).digest("hex") ||
    evidence.action !== "public_scan" ||
    evidence.founderApproved !== true ||
    !Array.isArray(evidence.hostnames) ||
    JSON.stringify(evidence.hostnames) !== JSON.stringify(HOBBY_SCAN_ENABLEMENT_HOSTNAMES) ||
    !isExactObject(turnstileMatrix, HOBBY_TURNSTILE_EVIDENCE_OUTCOMES) ||
    HOBBY_TURNSTILE_EVIDENCE_OUTCOMES.some((outcome) => turnstileMatrix[outcome] !== "PASS") ||
    !isExactObject(dogfood, ["halio", "shipToUsers"]) ||
    dogfood.halio !== "PASS" ||
    dogfood.shipToUsers !== "PASS"
  ) {
    fail(
      "The private Hobby scan-enablement evidence does not match the accepted release, Turnstile contract, and dogfood gates",
    );
  }
}

export function resolveHobbyEnvironmentPhase(
  values: Readonly<Record<string, string>>,
): HobbyEnvironmentPhase {
  const selected = values[HOBBY_ENVIRONMENT_PHASE_FIELD];
  if (selected === undefined) return HOBBY_DEFAULT_ENVIRONMENT_PHASE;
  if (!Object.hasOwn(HOBBY_ENVIRONMENT_PHASES, selected)) {
    fail(
      `${HOBBY_ENVIRONMENT_PHASE_FIELD} must equal one of: ${Object.keys(
        HOBBY_ENVIRONMENT_PHASES,
      ).join(", ")}`,
    );
  }
  return selected as HobbyEnvironmentPhase;
}

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const repeatedDummy = value.length >= 16 && new Set(value).size <= 2;
  return (
    !normalized ||
    normalized.startsWith("sol_reads_") ||
    normalized.startsWith("replace-with-") ||
    normalized.startsWith("replace_with_") ||
    normalized.startsWith("your-") ||
    normalized.startsWith("your_") ||
    /(?:^|[^a-z0-9])(?:placeholder|change[_-]?me|replace[_-]?me|fill[_-]?me|todo|tbd)(?:$|[^a-z0-9])/u.test(
      normalized,
    ) ||
    /\$\{[A-Za-z_][A-Za-z0-9_]*\}/u.test(value) ||
    repeatedDummy
  );
}

function requireOrigin(value: string, expected: string, name: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be the pinned HTTPS origin`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== expected
  ) {
    fail(`${name} must equal ${expected}`);
  }
}

function requireProductionTurnstileCredential(
  value: string | undefined,
  name: "NEXT_PUBLIC_TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY",
): void {
  const maximumLength = name === "NEXT_PUBLIC_TURNSTILE_SITE_KEY" ? 32 : 128;
  if (
    !value ||
    value.length < 20 ||
    value.length > maximumLength ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    /^[123]x0{10,}/u.test(value)
  ) {
    fail(`${name} must be a non-test production Turnstile credential`);
  }
}

const EXPECTED_DATABASE_IDENTITIES = {
  DATABASE_URL: "trendsfast_public_runtime",
  MEMBER_DATABASE_URL: "trendsfast_member_runtime",
  AUTH_DATABASE_URL: "trendsfast_auth_runtime",
  WORKER_DATABASE_URL: "trendsfast_worker_runtime",
  OPS_DATABASE_URL: "trendsfast_ops_runtime",
} as const;

function requireRuntimeDatabaseUrl(
  value: string,
  name: keyof typeof EXPECTED_DATABASE_IDENTITIES,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be a valid least-privilege PostgreSQL URL`);
  }
  const expectedUser = `${EXPECTED_DATABASE_IDENTITIES[name]}.${HOBBY_SUPABASE_PROJECT_REF}`;
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== HOBBY_SUPABASE_POOLER_HOST ||
    parsed.port !== "6543" ||
    parsed.pathname !== "/postgres" ||
    parsed.search ||
    parsed.hash ||
    !parsed.password ||
    decodeURIComponent(parsed.username) !== expectedUser
  ) {
    fail(`${name} must use its pinned production runtime identity`);
  }
  return parsed.href;
}

function valueForSurface(
  surface: HobbySurface,
  name: string,
  values: Readonly<Record<string, string>>,
  phase: HobbyEnvironmentPhase,
): string | undefined {
  const profile = HOBBY_ENVIRONMENT_PHASES[phase];
  if (name === "APP_URL") {
    return surface === "public" ? profile.publicOrigin : HOBBY_OPS_ORIGIN;
  }
  if (name === "PUBLIC_APP_URL") return profile.publicOrigin;
  if (name === "PUBLIC_SCANS_ENABLED") return profile.publicScansEnabled;
  if (name === "TRENDSFAST_SURFACE") return surface;
  const localSource = LOCAL_SOURCE_NAMES[surface]?.[name];
  return values[localSource ?? name];
}

function validateInventoryPhaseControls(
  values: Readonly<Record<string, string>>,
  phase: HobbyEnvironmentPhase,
): void {
  const profile = HOBBY_ENVIRONMENT_PHASES[phase];
  requireOrigin(values.APP_URL ?? "", profile.publicOrigin, "APP_URL");
  requireOrigin(values.PUBLIC_APP_URL ?? "", profile.publicOrigin, "PUBLIC_APP_URL");
  if (values.PUBLIC_SCANS_ENABLED !== profile.publicScansEnabled) {
    fail(
      `PUBLIC_SCANS_ENABLED must equal ${profile.publicScansEnabled} for Hobby environment phase ${phase}`,
    );
  }
}

function validateSelectedValues(
  surface: HobbySurface,
  values: Readonly<Record<string, string>>,
  phase: HobbyEnvironmentPhase,
): void {
  const profile = HOBBY_ENVIRONMENT_PHASES[phase];
  const effects = surface === "public" ? HOBBY_PUBLIC_EFFECTS : HOBBY_OPS_EFFECTS;
  for (const [name, expected] of Object.entries(effects)) {
    const phaseExpected = name === "PUBLIC_SCANS_ENABLED" ? profile.publicScansEnabled : expected;
    if (values[name] !== phaseExpected) {
      fail(`${name} must equal the Hobby environment phase value ${phaseExpected}`);
    }
  }
  if (values.NODE_ENV !== "production") fail("NODE_ENV must equal production");
  if (values.PROVIDER_CREDENTIAL_MODE !== "managed") {
    fail("PROVIDER_CREDENTIAL_MODE must equal managed");
  }
  if (values.PUBLIC_SCAN_PROCESSING !== "inline") {
    fail("PUBLIC_SCAN_PROCESSING must equal inline");
  }
  if (values.MAX_SCAN_DURATION_SECONDS !== "240") {
    fail("MAX_SCAN_DURATION_SECONDS must equal 240");
  }
  for (const name of ["SESSION_SECRET", "API_KEY_PEPPER"] as const) {
    if ((values[name]?.length ?? 0) < 32) fail(`${name} must contain at least 32 characters`);
  }
  if (
    createHash("sha256")
      .update(values.DATABASE_SSL_CA ?? "")
      .digest("hex") !== HOBBY_DATABASE_SSL_CA_SHA256
  ) {
    fail("DATABASE_SSL_CA must equal the pinned Supabase certificate bundle");
  }
  requireOrigin(
    values.APP_URL ?? "",
    surface === "public" ? profile.publicOrigin : HOBBY_OPS_ORIGIN,
    "APP_URL",
  );
  requireOrigin(values.PUBLIC_APP_URL ?? "", profile.publicOrigin, "PUBLIC_APP_URL");

  const databaseNames =
    surface === "public"
      ? ([
          "DATABASE_URL",
          "MEMBER_DATABASE_URL",
          "AUTH_DATABASE_URL",
          "WORKER_DATABASE_URL",
        ] as const)
      : (["OPS_DATABASE_URL"] as const);
  const databaseUrls = databaseNames.map((name) =>
    requireRuntimeDatabaseUrl(values[name] ?? "", name),
  );
  if (new Set(databaseUrls).size !== databaseUrls.length) {
    fail("Every deployed database role URL must be distinct");
  }

  if (surface === "public") {
    if (values.NEXT_PUBLIC_SUPABASE_URL !== HOBBY_SUPABASE_ORIGIN) {
      fail("NEXT_PUBLIC_SUPABASE_URL must identify the sole production project");
    }
    if (
      !values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_") ||
      values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length < 30
    ) {
      fail("Only a modern Supabase publishable browser key is accepted");
    }
    if (values.TURNSTILE_ENABLED !== "true") fail("TURNSTILE_ENABLED must equal true");
    requireProductionTurnstileCredential(
      values.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    );
    requireProductionTurnstileCredential(values.TURNSTILE_SECRET_KEY, "TURNSTILE_SECRET_KEY");
    if ((values.CRON_SECRET?.length ?? 0) < 64) {
      fail("CRON_SECRET must be generated from at least 48 random bytes");
    }
  } else {
    if ((values.OPS_TOKEN?.length ?? 0) < 64) {
      fail("OPS_TOKEN must be generated from at least 48 random bytes");
    }
    if (!/^(?:[a-z0-9-]+\.)*vercel\.app$/u.test(values.PUBLIC_DEPLOYMENT_HOST ?? "")) {
      fail("PUBLIC_DEPLOYMENT_HOST must be a clean Vercel deployment hostname");
    }
    if (!/^dpl_[A-Za-z0-9]+$/u.test(values.PUBLIC_DEPLOYMENT_ID ?? "")) {
      fail("PUBLIC_DEPLOYMENT_ID must be a Vercel deployment identifier");
    }
  }

  const parsed = tryParseEnv({ ...values, VERCEL_ENV: "production" });
  if (!parsed.success) {
    const paths = [
      ...new Set(parsed.error.issues.map((issue) => issue.path || "environment")),
    ].join(", ");
    fail(`Application environment validation failed for: ${paths}`);
  }
}

function assertNoDuplicates(names: readonly string[], label: string): void {
  if (new Set(names).size !== names.length) fail(`${label} contains a duplicate name`);
}

assertNoDuplicates(HOBBY_PUBLIC_ALLOWLIST, "The public allowlist");
assertNoDuplicates(HOBBY_OPS_ALLOWLIST, "The ops allowlist");
if (PUBLIC_FORBIDDEN.some((name) => new Set<string>(HOBBY_PUBLIC_ALLOWLIST).has(name))) {
  fail("The public allowlist overlaps its forbidden set");
}
if (OPS_FORBIDDEN.some((name) => new Set<string>(HOBBY_OPS_ALLOWLIST).has(name))) {
  fail("The ops allowlist overlaps its forbidden set");
}

export function buildHobbyEnvironmentPlan(
  surface: HobbySurface,
  source: string,
  scanEnablement?: HobbyScanEnablementContext,
): HobbyEnvironmentPlan {
  const inventory = parseProductionInventory(source);
  const phase = resolveHobbyEnvironmentPhase(inventory.values);
  validateInventoryPhaseControls(inventory.values, phase);
  if (inventory.values[HOBBY_LOCAL_SUPABASE_REF_FIELD] !== HOBBY_SUPABASE_PROJECT_REF) {
    fail(`The local Supabase readback must equal ${HOBBY_SUPABASE_PROJECT_REF}`);
  }
  const allowlist = surface === "public" ? HOBBY_PUBLIC_ALLOWLIST : HOBBY_OPS_ALLOWLIST;
  if (
    surface === "ops" &&
    inventory.values.SOL_HOBBY_OPS_SESSION_SECRET === inventory.values.SESSION_SECRET
  ) {
    fail("The public and ops SESSION_SECRET values must be distinct");
  }
  const variables = allowlist.map((name): HobbyVariable => {
    const value = valueForSurface(surface, name, inventory.values, phase);
    if (value === undefined || !value.trim())
      fail(`Required ${surface} variable is missing: ${name}`);
    if (looksLikePlaceholder(value)) fail(`Unresolved placeholder: ${name}`);
    return {
      name,
      value,
      sensitivity: PLAIN_VARIABLES.has(name) ? "plain" : "sensitive",
    };
  });
  const selectedValues = Object.fromEntries(variables.map(({ name, value }) => [name, value]));
  validateSelectedValues(surface, selectedValues, phase);
  if (surface === "public" && phase === "canonical-origin-scans-on") {
    validateHobbyScanEnablementEvidence(
      selectedValues.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
      scanEnablement,
    );
  }
  return { surface, phase, variables, names: variables.map(({ name }) => name) };
}

type RemoteProject = {
  id?: unknown;
  name?: unknown;
  accountId?: unknown;
  rootDirectory?: unknown;
  defaultResourceConfig?: { fluid?: unknown; functionDefaultTimeout?: unknown };
  resourceConfig?: { fluid?: unknown };
  ssoProtection?: { deploymentType?: unknown };
};

function parseProjectReadback(surface: HobbySurface, output: string): void {
  let project: RemoteProject;
  try {
    project = JSON.parse(output) as RemoteProject;
  } catch {
    fail("Vercel project metadata was not valid JSON; output withheld");
  }
  const expected = HOBBY_PROJECTS[surface];
  if (
    project.id !== expected.id ||
    project.name !== expected.name ||
    project.accountId !== HOBBY_VERCEL_ORG_ID ||
    project.rootDirectory !== "apps/web" ||
    project.defaultResourceConfig?.fluid !== true ||
    project.resourceConfig?.fluid !== true ||
    project.defaultResourceConfig.functionDefaultTimeout !== 300
  ) {
    fail(`The ${surface} Vercel project metadata does not match the pinned Hobby contract`);
  }
  if (surface === "ops" && project.ssoProtection?.deploymentType !== "all_except_custom_domains") {
    fail("The ops Vercel project must remain protected by Vercel Authentication");
  }
}

function normalizedUpdatedAt(value: unknown): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !String(value).trim() ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    fail("Vercel environment metadata omitted its revision timestamp");
  }
  return String(value);
}

function parseRemoteEnvironment(
  surface: HobbySurface,
  output: string,
): HobbyRemoteEnvironmentSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    fail("Vercel environment metadata was not valid JSON; output withheld");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("Vercel environment metadata had an unsupported shape");
  }
  const envelope = parsed as Record<string, unknown>;
  const allowedEnvelopeKeys = new Set(["envs", "hiddenProductionEnvCount", "pagination"]);
  if (Object.keys(envelope).some((key) => !allowedEnvelopeKeys.has(key))) {
    fail("Vercel environment metadata had an unsupported shape");
  }
  const entries = envelope.envs;
  if (!Array.isArray(entries)) fail("Vercel environment metadata had an unsupported shape");
  if (envelope.hiddenProductionEnvCount !== 0) {
    fail("Vercel environment metadata was hidden or incomplete");
  }
  if (envelope.pagination !== undefined) {
    if (
      !envelope.pagination ||
      typeof envelope.pagination !== "object" ||
      Array.isArray(envelope.pagination)
    ) {
      fail("Vercel environment metadata was hidden or incomplete");
    }
    const pagination = envelope.pagination as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(pagination).sort()) !==
        JSON.stringify(["count", "next", "prev"]) ||
      pagination.count !== entries.length ||
      pagination.next !== null ||
      pagination.prev !== null
    ) {
      fail("Vercel environment metadata was hidden or incomplete");
    }
  }
  const result = new Map<string, HobbyRemoteEnvironmentVariable>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") fail("Vercel environment metadata was malformed");
    const record = entry as Record<string, unknown>;
    const name = typeof record.key === "string" ? record.key : record.name;
    if (typeof name !== "string" || !name || result.has(name)) {
      fail("Vercel environment metadata contained a missing or duplicate name");
    }
    const id = typeof record.id === "string" ? record.id : record._id;
    if (typeof id !== "string" || !id) {
      fail("Vercel environment metadata omitted its variable identifier");
    }
    const target = record.target;
    const gitBranch = record.gitBranch;
    const configurationId = record.configurationId;
    const customEnvironmentIds = record.customEnvironmentIds;
    const type = record.type;
    if (
      record.decrypted !== false ||
      !Array.isArray(target) ||
      target.length !== 1 ||
      target[0] !== "production" ||
      (gitBranch !== undefined && gitBranch !== null) ||
      (configurationId !== undefined && configurationId !== null) ||
      (customEnvironmentIds !== undefined &&
        customEnvironmentIds !== null &&
        (!Array.isArray(customEnvironmentIds) || customEnvironmentIds.length !== 0)) ||
      (type !== "encrypted" && type !== "sensitive")
    ) {
      fail(`Every ${surface} Vercel variable must target Production only`);
    }
    result.set(name, {
      name,
      id,
      updatedAt: normalizedUpdatedAt(record.updatedAt),
      type,
      target: ["production"],
      gitBranch: null,
      configurationId: null,
      customEnvironmentIds: [],
    });
  }
  return {
    surface,
    projectId: HOBBY_PROJECTS[surface].id,
    variables: [...result.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function requireSuccess(result: CommandResult, label: string): void {
  if (result.status !== 0) fail(`${label} failed; command output withheld`);
}

function projectApiArgs(surface: HobbySurface): readonly string[] {
  return ["api", `/v9/projects/${HOBBY_PROJECTS[surface].id}`, "--raw"];
}

function allEnvironmentArgs(surface: HobbySurface): readonly string[] {
  return [
    "api",
    `/v10/projects/${HOBBY_PROJECTS[surface].id}/env?decrypt=false&teamId=${HOBBY_VERCEL_ORG_ID}`,
    "--raw",
  ];
}

function assertProductionEnvironmentMetadata(
  plan: HobbyEnvironmentPlan,
  snapshot: HobbyRemoteEnvironmentSnapshot,
  requireExactNames: boolean,
): void {
  if (snapshot.surface !== plan.surface || snapshot.projectId !== HOBBY_PROJECTS[plan.surface].id) {
    fail("Vercel environment metadata did not identify the pinned project and surface");
  }
  const remote = new Map(snapshot.variables.map((variable) => [variable.name, variable]));
  const allowlist = new Set<string>(
    plan.surface === "public" ? HOBBY_PUBLIC_ALLOWLIST : HOBBY_OPS_ALLOWLIST,
  );
  const outside = [...remote.keys()].filter((name) => !allowlist.has(name));
  if (outside.length > 0) {
    fail(
      `Vercel has ${outside.length} variable(s) outside the ${plan.surface} allowlist or Production-only scope; no mutation performed`,
    );
  }
  const planByName = new Map(plan.variables.map((variable) => [variable.name, variable]));
  for (const [name, metadata] of remote) {
    const variable = planByName.get(name);
    if (!variable) continue;
    const expectedType = variable.sensitivity === "plain" ? "encrypted" : "sensitive";
    if (metadata.type !== expectedType) {
      fail(`Vercel Production sensitivity readback did not match for ${name}`);
    }
  }
  if (
    requireExactNames &&
    (remote.size !== plan.names.length || plan.names.some((name) => !remote.has(name)))
  ) {
    fail("Vercel Production environment readback did not match the exact allowlist");
  }
}

function assertPlan(plan: HobbyEnvironmentPlan): void {
  const rebuilt = Object.fromEntries(plan.variables.map(({ name, value }) => [name, value]));
  if (
    plan.variables.length !== plan.names.length ||
    plan.names.some((name, index) => name !== plan.variables[index]?.name)
  ) {
    fail("The Hobby environment plan name manifest is inconsistent");
  }
  if (!Object.hasOwn(HOBBY_ENVIRONMENT_PHASES, plan.phase)) {
    fail("The Hobby environment plan phase is unsupported");
  }
  validateSelectedValues(plan.surface, rebuilt, plan.phase);
}

export function preflightHobbyEnvironmentImport(
  plan: HobbyEnvironmentPlan,
  runner: VercelCommandRunner,
  requireExactNames = false,
): HobbyRemoteEnvironmentSnapshot {
  assertPlan(plan);
  requireSuccess(runner.run(["whoami", "--no-color"]), "Vercel authentication preflight");
  const project = runner.run(projectApiArgs(plan.surface));
  requireSuccess(project, "Vercel project readback");
  parseProjectReadback(plan.surface, project.stdout);
  const remote = runner.run(allEnvironmentArgs(plan.surface));
  requireSuccess(remote, "Vercel all-target environment preflight");
  const remoteSnapshot = parseRemoteEnvironment(plan.surface, remote.stdout);
  assertProductionEnvironmentMetadata(plan, remoteSnapshot, requireExactNames);
  const remoteNames = new Set(remoteSnapshot.variables.map(({ name }) => name));
  const planNames = new Set(plan.names);
  const stale = [...remoteNames].filter((name) => !planNames.has(name));
  if (stale.length > 0) {
    fail(`Vercel Production has ${stale.length} stale variable(s); no mutation performed`);
  }
  return remoteSnapshot;
}

export function executeHobbyEnvironmentImport(
  plan: HobbyEnvironmentPlan,
  runner: VercelCommandRunner,
): HobbyRemoteEnvironmentSnapshot {
  preflightHobbyEnvironmentImport(plan, runner, false);
  const projectId = HOBBY_PROJECTS[plan.surface].id;
  for (const variable of plan.variables) {
    const sensitivity = variable.sensitivity === "plain" ? "--no-sensitive" : "--sensitive";
    const result = runner.run(
      [
        "env",
        "add",
        variable.name,
        "production",
        "--force",
        "--yes",
        "--project",
        projectId,
        sensitivity,
        "--no-color",
      ],
      variable.value,
    );
    requireSuccess(result, `Vercel Production write for ${variable.name}`);
  }
  const readback = runner.run(allEnvironmentArgs(plan.surface));
  requireSuccess(readback, "Vercel all-target environment readback");
  const remote = parseRemoteEnvironment(plan.surface, readback.stdout);
  assertProductionEnvironmentMetadata(plan, remote, true);
  return remote;
}

const ATTESTATION_SCHEMA_VERSION = 1 as const;
const ATTESTATION_PROOF_DOMAIN = "trendsfast-hobby-environment-attestation-v1";

function canonicalProofMaterial(
  plan: HobbyEnvironmentPlan,
  snapshot: HobbyRemoteEnvironmentSnapshot,
): string {
  return JSON.stringify({
    domain: ATTESTATION_PROOF_DOMAIN,
    surface: plan.surface,
    projectId: HOBBY_PROJECTS[plan.surface].id,
    variables: plan.variables.map(({ name, sensitivity, value }) => ({
      name,
      sensitivity,
      value,
    })),
    remoteVariables: snapshot.variables,
  });
}

function proofFor(plan: HobbyEnvironmentPlan, snapshot: HobbyRemoteEnvironmentSnapshot): string {
  return createHash("sha256").update(canonicalProofMaterial(plan, snapshot)).digest("hex");
}

function parseAttestedRemoteVariable(value: unknown): HobbyRemoteEnvironmentVariable {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("The private Hobby environment attestation was malformed");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [
    "configurationId",
    "customEnvironmentIds",
    "gitBranch",
    "id",
    "name",
    "target",
    "type",
    "updatedAt",
  ];
  if (
    JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
    typeof record.name !== "string" ||
    !record.name ||
    typeof record.id !== "string" ||
    !record.id ||
    typeof record.updatedAt !== "string" ||
    !record.updatedAt ||
    (record.type !== "encrypted" && record.type !== "sensitive") ||
    !Array.isArray(record.target) ||
    record.target.length !== 1 ||
    record.target[0] !== "production" ||
    record.gitBranch !== null ||
    record.configurationId !== null ||
    !Array.isArray(record.customEnvironmentIds) ||
    record.customEnvironmentIds.length !== 0
  ) {
    fail("The private Hobby environment attestation was malformed");
  }
  return {
    name: record.name,
    id: record.id,
    updatedAt: record.updatedAt,
    type: record.type,
    target: ["production"],
    gitBranch: null,
    configurationId: null,
    customEnvironmentIds: [],
  };
}

function parseHobbyEnvironmentAttestation(source: string): HobbyEnvironmentAttestation {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    fail("The private Hobby environment attestation was malformed");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("The private Hobby environment attestation was malformed");
  }
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
      JSON.stringify(["projectId", "proofSha256", "remoteVariables", "schemaVersion", "surface"]) ||
    record.schemaVersion !== ATTESTATION_SCHEMA_VERSION ||
    (record.surface !== "public" && record.surface !== "ops") ||
    typeof record.projectId !== "string" ||
    !Array.isArray(record.remoteVariables) ||
    typeof record.proofSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.proofSha256)
  ) {
    fail("The private Hobby environment attestation was malformed");
  }
  const remoteVariables = record.remoteVariables.map(parseAttestedRemoteVariable);
  if (
    new Set(remoteVariables.map(({ name }) => name)).size !== remoteVariables.length ||
    remoteVariables.some(
      (variable, index) =>
        index > 0 && remoteVariables[index - 1]!.name.localeCompare(variable.name) >= 0,
    )
  ) {
    fail("The private Hobby environment attestation was malformed");
  }
  return {
    schemaVersion: ATTESTATION_SCHEMA_VERSION,
    surface: record.surface,
    projectId: record.projectId,
    remoteVariables,
    proofSha256: record.proofSha256,
  };
}

export function createHobbyEnvironmentAttestation(
  plan: HobbyEnvironmentPlan,
  snapshot: HobbyRemoteEnvironmentSnapshot,
): string {
  assertPlan(plan);
  assertProductionEnvironmentMetadata(plan, snapshot, true);
  const attestation: HobbyEnvironmentAttestation = {
    schemaVersion: ATTESTATION_SCHEMA_VERSION,
    surface: plan.surface,
    projectId: HOBBY_PROJECTS[plan.surface].id,
    remoteVariables: snapshot.variables,
    proofSha256: proofFor(plan, snapshot),
  };
  return `${JSON.stringify(attestation, null, 2)}\n`;
}

export function verifyHobbyEnvironmentAttestation(
  plan: HobbyEnvironmentPlan,
  snapshot: HobbyRemoteEnvironmentSnapshot,
  source: string,
): void {
  assertPlan(plan);
  assertProductionEnvironmentMetadata(plan, snapshot, true);
  const attestation = parseHobbyEnvironmentAttestation(source);
  if (
    attestation.surface !== plan.surface ||
    attestation.projectId !== HOBBY_PROJECTS[plan.surface].id ||
    JSON.stringify(attestation.remoteVariables) !== JSON.stringify(snapshot.variables)
  ) {
    fail("The private Hobby environment attestation does not match current Vercel metadata");
  }
  const expected = Buffer.from(proofFor(plan, snapshot), "hex");
  const actual = Buffer.from(attestation.proofSha256, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    fail("The private Hobby environment attestation does not match the exact local plan");
  }
}

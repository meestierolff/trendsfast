import { tryParseEnv } from "@trendsfast/config";

export const STAGED_PRODUCTION_PROJECT = "trendsfast";
export const STAGED_PRODUCTION_PROJECT_ID = "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC";
export const STAGED_PRODUCTION_ORG_ID = "team_UVAUfp4G8CmlSNPI9w5FasKj";
export const STAGED_PRODUCTION_ORIGIN = "https://trendsfast.vercel.app";
export const STAGED_PRODUCTION_SUPABASE_REF_FIELD =
  "SOL_READS_SUPABASE_PRODUCTION_PROJECT_REF" as const;

export const STAGED_PRODUCTION_EFFECTS = {
  PROVIDER_CALLS_ENABLED: "false",
  PUBLIC_SCANS_ENABLED: "false",
  LIVE_API_CREATION_ENABLED: "false",
  BILLING_ENABLED: "false",
  BILLING_CHECKOUT_ENABLED: "false",
  PAID_MONITORING_ENABLED: "false",
  MONITORING_ENABLED: "false",
  FOUNDING_100_ENABLED: "false",
  CLOUD_TRIAL_ENABLED: "false",
  STRIPE_MODE: "test",
  TRENDSFAST_SURFACE: "public",
} as const;

const RUNTIME_VARIABLES = [
  "NODE_ENV",
  "APP_URL",
  "PUBLIC_APP_URL",
  "TRENDSFAST_SURFACE",
  "DATABASE_URL",
  "MEMBER_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "DATABASE_SSL_CA",
  "PROVIDER_CREDENTIAL_MODE",
] as const;

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
  "OPENAI_API_KEY",
  "LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS",
  "LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS",
  "MAX_PROVIDER_COST_USD_PER_SCAN",
  "MAX_SCAN_DURATION_SECONDS",
  "PROVIDER_TIMEOUT_MS",
] as const;

const IDENTITY_AND_ABUSE_VARIABLES = [
  "SESSION_SECRET",
  "API_KEY_PEPPER",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "TURNSTILE_ENABLED",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
] as const;

const DISABLED_STRIPE_VARIABLES = [
  "BILLING_ENABLED",
  "BILLING_CHECKOUT_ENABLED",
  "FOUNDING_100_ENABLED",
  "CLOUD_TRIAL_ENABLED",
  "STRIPE_MODE",
  "STRIPE_SANDBOX_KEY_ROTATED",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_FOUNDER_CLOUD_PRICE_ID",
  "STRIPE_PORTAL_LOGIN_URL",
] as const;

const MARKETING_VARIABLES = [
  "NEXT_PUBLIC_ANNOUNCEMENT_ENABLED",
  "NEXT_PUBLIC_ANNOUNCEMENT_TEXT",
  "NEXT_PUBLIC_DEMO_VIDEO_URL",
  "NEXT_PUBLIC_DEMO_CAPTIONS_URL",
  "DATAFAST_ENABLED",
  "DATAFAST_WEBSITE_ID",
] as const;

const CUSTOMER_EFFECT_VARIABLES = [
  "PROVIDER_CALLS_ENABLED",
  "PUBLIC_SCANS_ENABLED",
  "LIVE_API_CREATION_ENABLED",
  "PAID_MONITORING_ENABLED",
  "MONITORING_ENABLED",
] as const;

/** The sole set of private-inventory names that may reach the public project. */
export const STAGED_PRODUCTION_ALLOWLIST = [
  ...RUNTIME_VARIABLES,
  ...MANAGED_POLICY_VARIABLES,
  ...PROVIDER_VARIABLES,
  ...IDENTITY_AND_ABUSE_VARIABLES,
  ...DISABLED_STRIPE_VARIABLES,
  ...MARKETING_VARIABLES,
  ...CUSTOMER_EFFECT_VARIABLES,
] as const;

/** Known operator-only names. The allowlist is also enforced against every other name. */
export const STAGED_PRODUCTION_FORBIDDEN_VARIABLES = [
  "OPS_TOKEN",
  "OPS_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "BILLING_DATABASE_URL",
  "RETENTION_DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "ROLE_ADMIN_DATABASE_URL",
  "DATABASE_PASSWORD",
  "POSTGRES_PASSWORD",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "OPS_ALERT_WEBHOOK_URL",
  "OPS_ALERT_WEBHOOK_SECRET",
] as const;

export const REQUIRED_STAGED_PRODUCTION_VARIABLES = [
  ...new Set<string>([
    ...RUNTIME_VARIABLES,
    ...MANAGED_POLICY_VARIABLES,
    "SESSION_SECRET",
    "API_KEY_PEPPER",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "TURNSTILE_ENABLED",
    ...Object.keys(STAGED_PRODUCTION_EFFECTS),
  ]),
] as const;

const allowlist = new Set<string>(STAGED_PRODUCTION_ALLOWLIST);
const forbiddenVariables = new Set<string>(STAGED_PRODUCTION_FORBIDDEN_VARIABLES);
const plainEffectVariables = new Set<string>(Object.keys(STAGED_PRODUCTION_EFFECTS));

export class StagedProductionEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StagedProductionEnvironmentError";
  }
}

export interface ParsedInventory {
  readonly values: Readonly<Record<string, string>>;
  readonly names: readonly string[];
}

export interface StagedProductionVariable {
  readonly name: string;
  readonly value: string;
  readonly sensitivity: "plain" | "sensitive";
}

export interface StagedProductionPlan {
  readonly variables: readonly StagedProductionVariable[];
  readonly names: readonly string[];
  readonly forbiddenInventoryNames: readonly string[];
  readonly ignoredInventoryNameCount: number;
}

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
}

export interface VercelCommandRunner {
  run(args: readonly string[], stdin?: string): CommandResult;
}

export interface LinkedVercelProject {
  readonly projectName?: unknown;
  readonly projectId?: unknown;
  readonly orgId?: unknown;
}

function fail(message: string): never {
  throw new StagedProductionEnvironmentError(message);
}

export function assertStagedProductionLink(linked: LinkedVercelProject): void {
  if (
    linked.projectName !== STAGED_PRODUCTION_PROJECT ||
    linked.projectId !== STAGED_PRODUCTION_PROJECT_ID ||
    linked.orgId !== STAGED_PRODUCTION_ORG_ID
  ) {
    fail("The repository must be linked to the pinned TrendsFast Vercel project and team");
  }
}

if (new Set(STAGED_PRODUCTION_ALLOWLIST).size !== STAGED_PRODUCTION_ALLOWLIST.length) {
  fail("The staged Production allowlist contains a duplicate name");
}
if (STAGED_PRODUCTION_FORBIDDEN_VARIABLES.some((name) => allowlist.has(name))) {
  fail("The staged Production allowlist overlaps the forbidden-name list");
}

function findClosingQuote(input: string, quote: '"' | "'"): number {
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote === '"' && character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (character === quote && !escaped) return index;
    escaped = false;
  }
  return -1;
}

function decodeDoubleQuotedValue(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (character !== "\\" || next === undefined) {
      decoded += character;
      continue;
    }
    const replacement = ({ n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"' } as const)[
      next as "n" | "r" | "t" | "\\" | '"'
    ];
    if (replacement === undefined) {
      decoded += `\\${next}`;
    } else {
      decoded += replacement;
    }
    index += 1;
  }
  return decoded;
}

function parseQuotedValue(
  lines: readonly string[],
  startingLine: number,
  initial: string,
  name: string,
): { value: string; endingLine: number } {
  const quote = initial[0];
  if (quote !== '"' && quote !== "'") fail(`Invalid quoted value for ${name}`);

  let content = initial.slice(1);
  let line = startingLine;
  while (true) {
    const closing = findClosingQuote(content, quote);
    if (closing >= 0) {
      const suffix = content.slice(closing + 1).trim();
      if (suffix && !suffix.startsWith("#")) {
        fail(`Unexpected content after ${name} on line ${line + 1}`);
      }
      const rawValue = content.slice(0, closing);
      return {
        value: quote === '"' ? decodeDoubleQuotedValue(rawValue) : rawValue,
        endingLine: line,
      };
    }
    line += 1;
    if (line >= lines.length) fail(`Unterminated quoted value for ${name}`);
    content += `\n${lines[line] ?? ""}`;
  }
}

/** Parse dotenv syntax as inert data: no shell, interpolation, or process environment mutation. */
export function parseProductionInventory(source: string): ParsedInventory {
  if (source.includes("\0")) fail("The production inventory contains a NUL byte");

  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const values: Record<string, string> = {};
  const names: string[] = [];

  for (let line = 0; line < lines.length; line += 1) {
    const rawLine = lines[line] ?? "";
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = rawLine.indexOf("=");
    if (separator < 1) fail(`Malformed assignment on line ${line + 1}`);
    const name = rawLine.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      fail(`Invalid variable name on line ${line + 1}`);
    }
    if (Object.hasOwn(values, name)) fail(`Duplicate variable name: ${name}`);

    const rawValue = rawLine.slice(separator + 1).trim();
    let value: string;
    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      const parsed = parseQuotedValue(lines, line, rawValue, name);
      value = parsed.value;
      line = parsed.endingLine;
    } else {
      const comment = rawValue.indexOf("#");
      value = (comment >= 0 ? rawValue.slice(0, comment) : rawValue).trim();
    }

    values[name] = value;
    names.push(name);
  }

  return { values, names };
}

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const compactMarker =
    /(?:^|[^a-z0-9])(?:replace[_-]?(?:with|me)|fill[_-]?me|placeholder|change[_-]?me|changeme|todo|tbd)(?:$|[^a-z0-9])/u;
  const repeatedDummy = value.length >= 16 && new Set(value).size <= 2;
  return (
    /^(?:todo|tbd|changeme|change-me|placeholder|replace[_-]?me|fill[_-]?me|xxx+)(?:[: _-].*)?$/u.test(
      normalized,
    ) ||
    normalized.startsWith("replace-with-") ||
    normalized.startsWith("replace_with_") ||
    normalized.startsWith("your-") ||
    normalized.startsWith("your_") ||
    /\$\{[A-Za-z_][A-Za-z0-9_]*\}/u.test(value) ||
    compactMarker.test(normalized) ||
    repeatedDummy ||
    /^<(?:[^<>]+)>$/u.test(normalized) ||
    /^\[(?:placeholder|todo|tbd|replace[^\]]*)\]$/u.test(normalized)
  );
}

function requireCleanHttpsOrigin(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be a valid HTTPS origin`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    value !== parsed.origin
  ) {
    fail(`${name} must be a clean HTTPS origin`);
  }
  return parsed;
}

const EXPECTED_DATABASE_IDENTITIES = {
  DATABASE_URL: "trendsfast_public_runtime",
  MEMBER_DATABASE_URL: "trendsfast_member_runtime",
  AUTH_DATABASE_URL: "trendsfast_auth_runtime",
} as const;

function requireRuntimePostgresUrl(
  value: string,
  name: keyof typeof EXPECTED_DATABASE_IDENTITIES,
  supabaseProjectRef: string,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be a valid PostgreSQL URL`);
  }
  const expectedIdentity = EXPECTED_DATABASE_IDENTITIES[name];
  const expectedIdentityWithProject = `${expectedIdentity}.${supabaseProjectRef}`;
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname.endsWith(".pooler.supabase.com") ||
    parsed.port !== "6543" ||
    parsed.pathname !== "/postgres" ||
    parsed.search ||
    parsed.hash ||
    !parsed.password ||
    parsed.username !== expectedIdentityWithProject
  ) {
    fail(`${name} must use its credentialed least-privilege runtime identity`);
  }
  return parsed;
}

function validatePlanValues(values: Readonly<Record<string, string>>): void {
  for (const name of REQUIRED_STAGED_PRODUCTION_VARIABLES) {
    if (!values[name]?.trim()) fail(`Required production variable is missing: ${name}`);
  }
  for (const [name, expected] of Object.entries(STAGED_PRODUCTION_EFFECTS)) {
    if (values[name] !== expected) fail(`${name} must equal the Phase 1 value ${expected}`);
  }
  if (values.NODE_ENV !== "production") fail("NODE_ENV must equal production");
  if (values.PROVIDER_CREDENTIAL_MODE !== "managed") {
    fail("PROVIDER_CREDENTIAL_MODE must equal managed for staged production");
  }
  if ((values.SESSION_SECRET?.length ?? 0) < 32) {
    fail("SESSION_SECRET must contain at least 32 characters");
  }
  if ((values.API_KEY_PEPPER?.length ?? 0) < 32) {
    fail("API_KEY_PEPPER must contain at least 32 characters");
  }

  const applicationOrigin = requireCleanHttpsOrigin(values.APP_URL ?? "", "APP_URL");
  const publicOrigin = requireCleanHttpsOrigin(values.PUBLIC_APP_URL ?? "", "PUBLIC_APP_URL");
  if (applicationOrigin.origin !== publicOrigin.origin) {
    fail("APP_URL and PUBLIC_APP_URL must be the same exact origin");
  }
  if (applicationOrigin.origin !== STAGED_PRODUCTION_ORIGIN) {
    fail(`APP_URL and PUBLIC_APP_URL must equal ${STAGED_PRODUCTION_ORIGIN}`);
  }
  const supabaseOrigin = requireCleanHttpsOrigin(
    values.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const supabaseHostMatch = /^([a-z0-9]{20})\.supabase\.co$/u.exec(supabaseOrigin.hostname);
  const supabaseProjectRef = supabaseHostMatch?.[1];
  if (!supabaseProjectRef) {
    fail("NEXT_PUBLIC_SUPABASE_URL must identify the hosted production Supabase project");
  }
  if (
    !values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_") ||
    values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length < 20 ||
    values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length > 2_048
  ) {
    fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must use the modern publishable key format");
  }
  const runtimeDatabaseUrls = (
    Object.keys(EXPECTED_DATABASE_IDENTITIES) as Array<keyof typeof EXPECTED_DATABASE_IDENTITIES>
  ).map((name) => requireRuntimePostgresUrl(values[name] ?? "", name, supabaseProjectRef).href);
  if (new Set(runtimeDatabaseUrls).size !== runtimeDatabaseUrls.length) {
    fail("Public, member, and Auth database URLs must be distinct");
  }

  if (!["true", "false"].includes(values.TURNSTILE_ENABLED ?? "")) {
    fail("TURNSTILE_ENABLED must equal true or false");
  }
  const hasTurnstileSecret = Boolean(values.TURNSTILE_SECRET_KEY?.trim());
  const hasTurnstileSiteKey = Boolean(values.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
  if (hasTurnstileSecret !== hasTurnstileSiteKey) {
    fail("Turnstile keys must be configured as a complete pair");
  }
  if (values.TURNSTILE_ENABLED === "true" && !hasTurnstileSecret) {
    fail("TURNSTILE_ENABLED=true requires both Turnstile keys");
  }

  const hasStripeSecret = Boolean(values.STRIPE_SECRET_KEY?.trim());
  const hasStripeWebhookSecret = Boolean(values.STRIPE_WEBHOOK_SECRET?.trim());
  if (hasStripeSecret !== hasStripeWebhookSecret) {
    fail("Disabled Stripe server credentials must be configured as a complete pair");
  }
  if (hasStripeSecret) {
    if (!values.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      fail("Staged production accepts only a Stripe test secret key");
    }
    if (!values.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
      fail("Staged production requires a Stripe webhook signing secret");
    }
    if (values.STRIPE_SANDBOX_KEY_ROTATED !== "YES") {
      fail("Configured Stripe sandbox credentials require STRIPE_SANDBOX_KEY_ROTATED=YES");
    }
  }

  const environmentResult = tryParseEnv({ ...values, VERCEL_ENV: "production" });
  if (!environmentResult.success) {
    const issues = environmentResult.error.issues
      .map((issue) => issue.path || "environment")
      .filter((name, index, all) => all.indexOf(name) === index)
      .join(", ");
    fail(`Application environment validation failed for: ${issues}`);
  }
}

export function buildStagedProductionPlan(source: string): StagedProductionPlan {
  const inventory = parseProductionInventory(source);
  for (const name of inventory.names) {
    const value = inventory.values[name] ?? "";
    if (value && looksLikePlaceholder(value)) fail(`Unresolved placeholder: ${name}`);
  }

  const productionProjectRef = inventory.values[STAGED_PRODUCTION_SUPABASE_REF_FIELD];
  if (!productionProjectRef) {
    fail(`Required local-only readback is missing: ${STAGED_PRODUCTION_SUPABASE_REF_FIELD}`);
  }
  if (!/^[a-z0-9]{20}$/u.test(productionProjectRef)) {
    fail(`${STAGED_PRODUCTION_SUPABASE_REF_FIELD} must be a 20-character Supabase project ref`);
  }

  const selectedValues: Record<string, string> = {};
  const variables: StagedProductionVariable[] = [];
  for (const name of STAGED_PRODUCTION_ALLOWLIST) {
    const value = inventory.values[name];
    if (value === undefined || value.trim() === "") continue;
    selectedValues[name] = value;
    variables.push({
      name,
      value,
      sensitivity: plainEffectVariables.has(name) ? "plain" : "sensitive",
    });
  }
  validatePlanValues(selectedValues);
  const configuredSupabaseOrigin = new URL(selectedValues.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (configuredSupabaseOrigin.hostname !== `${productionProjectRef}.supabase.co`) {
    fail("Supabase Auth configuration does not match the production project readback");
  }

  const selectedNames = new Set(variables.map(({ name }) => name));
  const forbiddenInventoryNames = inventory.names.filter((name) => forbiddenVariables.has(name));
  const ignoredInventoryNameCount = inventory.names.filter(
    (name) => !selectedNames.has(name),
  ).length;
  return {
    variables,
    names: variables.map(({ name }) => name),
    forbiddenInventoryNames,
    ignoredInventoryNameCount,
  };
}

function parseRemoteEnvironmentMetadata(output: string): ReadonlyMap<string, string | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    fail("Vercel Production environment inventory was not valid JSON; output withheld");
  }

  let entries: unknown;
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    entries = record.envs ?? record.variables;
  }
  if (!Array.isArray(entries)) {
    fail("Vercel Production environment inventory had an unsupported shape; output withheld");
  }

  const variables = new Map<string, string | undefined>();
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (variables.has(entry)) fail("Vercel Production has a duplicate variable name");
      variables.set(entry, undefined);
      continue;
    }
    if (!entry || typeof entry !== "object") {
      fail("Vercel Production environment inventory contained an invalid entry");
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record.key === "string" ? record.key : record.name;
    if (typeof name !== "string" || !name) {
      fail("Vercel Production environment inventory contained a nameless entry");
    }
    if (variables.has(name)) fail("Vercel Production has a duplicate variable name");
    variables.set(name, typeof record.type === "string" ? record.type : undefined);
  }
  return variables;
}

function requireCommandSuccess(result: CommandResult, label: string): void {
  if (result.status !== 0) fail(`${label} failed; command output withheld`);
}

function assertPlanIntegrity(plan: StagedProductionPlan): void {
  const values: Record<string, string> = {};
  for (const variable of plan.variables) {
    if (!allowlist.has(variable.name)) fail("The mutation plan contains a non-allowlisted name");
    if (Object.hasOwn(values, variable.name)) fail("The mutation plan contains a duplicate name");
    if (!variable.value.trim()) fail(`The mutation plan contains an empty value: ${variable.name}`);
    const expectedSensitivity = plainEffectVariables.has(variable.name) ? "plain" : "sensitive";
    if (variable.sensitivity !== expectedSensitivity) {
      fail(`The mutation plan has invalid sensitivity metadata: ${variable.name}`);
    }
    values[variable.name] = variable.value;
  }
  if (
    plan.names.length !== plan.variables.length ||
    plan.names.some((name, index) => name !== plan.variables[index]?.name)
  ) {
    fail("The mutation plan name manifest is inconsistent");
  }
  validatePlanValues(values);
}

function productionEnvironmentInventoryArgs(projectId: string): readonly string[] {
  return ["env", "ls", "production", "--format", "json", "--project", projectId, "--no-color"];
}

/** Run every local and remote read-only check. Captured CLI output is never forwarded. */
export function preflightStagedProductionImport(
  plan: StagedProductionPlan,
  runner: VercelCommandRunner,
  projectId = STAGED_PRODUCTION_PROJECT_ID,
): void {
  if (projectId !== STAGED_PRODUCTION_PROJECT_ID) {
    fail(`The staged Production importer may target only ${STAGED_PRODUCTION_PROJECT_ID}`);
  }
  assertPlanIntegrity(plan);
  requireCommandSuccess(runner.run(["whoami", "--no-color"]), "Vercel authentication preflight");
  requireCommandSuccess(
    runner.run(["project", "inspect", projectId, "--no-color"]),
    "Vercel project preflight",
  );
  const remoteInventory = runner.run(productionEnvironmentInventoryArgs(projectId));
  requireCommandSuccess(remoteInventory, "Vercel Production environment preflight");
  const remoteVariables = parseRemoteEnvironmentMetadata(remoteInventory.stdout);
  const planNames = new Set(plan.names);
  const outsideAllowlist = [...remoteVariables.keys()].filter((name) => !allowlist.has(name));
  const staleAllowlisted = [...remoteVariables.keys()].filter((name) => !planNames.has(name));
  if (outsideAllowlist.length > 0) {
    fail(
      `Vercel Production has ${outsideAllowlist.length} variable(s) outside the public allowlist; no mutation performed`,
    );
  }
  if (staleAllowlisted.length > 0) {
    fail(
      `Vercel Production has ${staleAllowlisted.length} stale allowlisted variable(s); no mutation performed`,
    );
  }
}

/**
 * Preflight, upload each value exclusively on stdin, then verify redacted name/type metadata.
 * Captured Vercel output is never forwarded because CLI 58 can reveal plain values.
 */
export function executeStagedProductionImport(
  plan: StagedProductionPlan,
  runner: VercelCommandRunner,
  projectId = STAGED_PRODUCTION_PROJECT_ID,
): void {
  preflightStagedProductionImport(plan, runner, projectId);

  for (const variable of plan.variables) {
    const sensitivityFlag = variable.sensitivity === "plain" ? "--no-sensitive" : "--sensitive";
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
        sensitivityFlag,
        "--no-color",
      ],
      variable.value,
    );
    requireCommandSuccess(result, `Vercel Production write for ${variable.name}`);
  }

  const readback = runner.run(productionEnvironmentInventoryArgs(projectId));
  requireCommandSuccess(readback, "Vercel Production environment readback");
  const remoteVariables = parseRemoteEnvironmentMetadata(readback.stdout);
  if (
    remoteVariables.size !== plan.variables.length ||
    plan.variables.some(({ name }) => !remoteVariables.has(name))
  ) {
    fail("Vercel Production environment readback did not match the exact allowlisted name set");
  }
  for (const variable of plan.variables) {
    const expectedRemoteType = variable.sensitivity === "plain" ? "encrypted" : "sensitive";
    if (remoteVariables.get(variable.name) !== expectedRemoteType) {
      fail(`Vercel Production sensitivity readback did not match for ${variable.name}`);
    }
  }
}

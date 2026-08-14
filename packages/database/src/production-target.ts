import { createHash } from "node:crypto";

import { DATABASE_ROLES } from "./runtime-roles";

export const PRODUCTION_SUPABASE_PROJECT_REF = "auxienkuufejeakaczlq" as const;
export const PRODUCTION_SUPABASE_POOLER_HOST = "aws-0-eu-central-1.pooler.supabase.com" as const;
export const PRODUCTION_DATABASE_NAME = "postgres" as const;
export const PRODUCTION_DATABASE_CA_SHA256 =
  "6ecd239038a7db063a6619b71742372ecfe06c0b0ec12a9993fee4445bf0d4d6" as const;

const ALLOWED_IDENTITIES = new Set<string>([...Object.values(DATABASE_ROLES), "postgres"]);

export type ProductionDatabaseIdentity =
  (typeof DATABASE_ROLES)[keyof typeof DATABASE_ROLES] | "postgres";
export type ProductionDatabaseEndpoint = "direct-or-session" | "transaction-pooler";

export type ProductionDatabaseTarget = {
  readonly connectionString: string;
  readonly endpoint: ProductionDatabaseEndpoint;
  readonly expectedRole: ProductionDatabaseIdentity;
  readonly sslCa: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return fail("The production database URL has invalid percent encoding");
  }
}

/**
 * Proves a launch command can reach only the sole TrendsFast Supabase project.
 * The returned values are unchanged and safe to pass to the database client.
 */
export function assertProductionDatabaseTarget(input: {
  readonly connectionString: string | undefined;
  readonly endpoint: ProductionDatabaseEndpoint;
  readonly expectedRole: ProductionDatabaseIdentity;
  readonly sslCa: string | undefined;
}): ProductionDatabaseTarget {
  const { connectionString, endpoint, expectedRole, sslCa } = input;
  if (!connectionString || connectionString !== connectionString.trim()) {
    fail("The production database URL is missing or has surrounding whitespace");
  }
  if (!ALLOWED_IDENTITIES.has(expectedRole)) {
    fail("The production database identity is not approved");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return fail("The production database URL is malformed");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    fail("The production database URL must use PostgreSQL");
  }
  if (url.search || url.hash) {
    fail("The production database URL must not contain query parameters or a fragment");
  }

  const username = decoded(url.username);
  const password = decoded(url.password);
  const database = decoded(url.pathname.replace(/^\//u, ""));
  if (!username || !password || database !== PRODUCTION_DATABASE_NAME) {
    fail("The production database URL does not use the pinned database shape");
  }

  const port = url.port || "5432";
  const direct =
    endpoint === "direct-or-session" &&
    url.hostname === `db.${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` &&
    port === "5432" &&
    username === expectedRole;
  const sessionPooler =
    endpoint === "direct-or-session" &&
    url.hostname === PRODUCTION_SUPABASE_POOLER_HOST &&
    port === "5432" &&
    username === `${expectedRole}.${PRODUCTION_SUPABASE_PROJECT_REF}`;
  const transactionPooler =
    endpoint === "transaction-pooler" &&
    url.hostname === PRODUCTION_SUPABASE_POOLER_HOST &&
    port === "6543" &&
    username === `${expectedRole}.${PRODUCTION_SUPABASE_PROJECT_REF}`;
  if (!direct && !sessionPooler && !transactionPooler) {
    fail("The production database URL does not identify the pinned project, role, and endpoint");
  }

  if (
    !sslCa ||
    !sslCa.startsWith("-----BEGIN CERTIFICATE-----\n") ||
    !sslCa.endsWith("-----END CERTIFICATE-----\n") ||
    createHash("sha256").update(sslCa).digest("hex") !== PRODUCTION_DATABASE_CA_SHA256
  ) {
    fail("DATABASE_SSL_CA is not the pinned Supabase production certificate bundle");
  }

  return { connectionString, endpoint, expectedRole, sslCa };
}

export function assertLiveProductionDatabaseIdentity(
  record: { readonly current_database?: unknown; readonly current_user?: unknown } | undefined,
  expectedRole: ProductionDatabaseIdentity,
): asserts record is {
  readonly current_database: typeof PRODUCTION_DATABASE_NAME;
  readonly current_user: ProductionDatabaseIdentity;
} {
  if (
    !ALLOWED_IDENTITIES.has(expectedRole) ||
    record?.current_user !== expectedRole ||
    record.current_database !== PRODUCTION_DATABASE_NAME
  ) {
    fail("The live PostgreSQL identity does not match the pinned production target");
  }
}

import "server-only";

import {
  createDatabaseClient,
  createRepositories,
  type DatabaseClient,
  type DatabaseRuntimeRole,
  databaseConnectionStringForRole,
} from "@trendsfast/database";
import { loadEnv } from "@trendsfast/config";

const databaseGlobal = globalThis as typeof globalThis & {
  trendsFastDatabases?: Partial<Record<DatabaseRuntimeRole, DatabaseClient>>;
};

export function getDatabaseClient(role: DatabaseRuntimeRole = "public"): DatabaseClient {
  databaseGlobal.trendsFastDatabases ??= {};
  if (!databaseGlobal.trendsFastDatabases[role]) {
    const env = loadEnv();
    databaseGlobal.trendsFastDatabases[role] = createDatabaseClient({
      connectionString: databaseConnectionStringForRole(env, role),
      ...(env.DATABASE_SSL_CA ? { sslCa: env.DATABASE_SSL_CA } : {}),
      maxConnections: process.env.NODE_ENV === "production" ? 3 : 5,
      applicationName: `trendsfast-${role}`,
    });
  }
  return databaseGlobal.trendsFastDatabases[role]!;
}

function repositoriesFor(role: DatabaseRuntimeRole) {
  const env = loadEnv();
  return createRepositories(getDatabaseClient(role).db, {
    ...(env.API_KEY_PEPPER ? { apiKeyPepper: env.API_KEY_PEPPER } : {}),
  });
}

/** Public HTTP/API data plane. Its database login has the narrow public ACL. */
export function getPublicRepositories() {
  return repositoriesFor("public");
}

/** Verified member dashboard and single-use project-claim control plane. */
export function getMemberRepositories() {
  return repositoriesFor("member");
}

/** Founder-only control plane. */
export function getOpsRepositories() {
  return repositoriesFor("ops");
}

/** Scan/monitoring executor. */
export function getWorkerRepositories() {
  return repositoriesFor("worker");
}

/** Signed Stripe projection and one-time Checkout claim/key issuance only. */
export function getBillingRepositories() {
  return repositoriesFor("billing");
}

/** API-key verification and durable authentication/rate-audit operations only. */
export function getAuthRepositories() {
  return repositoriesFor("auth");
}

/** Scheduled retention and its bounded operational-health write path only. */
export function getRetentionRepositories() {
  return repositoriesFor("retention");
}

/** Backward-compatible public alias; privileged code must choose its role explicitly. */
export const getRepositories = getPublicRepositories;

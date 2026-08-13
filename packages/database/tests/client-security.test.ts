import { describe, expect, it } from "vitest";

import { secureDatabasePoolConfig } from "../src/index";

const testCa = "-----BEGIN CERTIFICATE-----\nfixture-ca-only\n-----END CERTIFICATE-----";

describe("PostgreSQL transport policy", () => {
  it("keeps loopback fixtures plaintext when no CA is configured", () => {
    const config = secureDatabasePoolConfig({
      connectionString: "postgresql://fixture:fixture@127.0.0.1:5432/trendsfast",
    });
    expect(config.ssl).toBe(false);
  });

  it("fails closed for a hosted database without a CA", () => {
    expect(() =>
      secureDatabasePoolConfig({
        connectionString: "postgresql://runtime:secret@db.example.test:5432/trendsfast",
      }),
    ).toThrow(/DATABASE_SSL_CA/);
  });

  it.each([
    "host=db.example.test",
    "host=%2Ftmp",
    "port=4444",
    "user=other",
    "password=other",
    "database=other",
  ])("rejects authority/path override query parameter %s", (query) => {
    expect(() =>
      secureDatabasePoolConfig({
        connectionString: `postgresql://fixture:fixture@127.0.0.1:5432/trendsfast?${query}`,
      }),
    ).toThrow(/URL authority\/path/);
  });

  it("removes URL TLS overrides and enforces verified TLS", () => {
    const config = secureDatabasePoolConfig({
      connectionString:
        "postgresql://runtime:secret@db.example.test:5432/trendsfast?ssl=0&sslmode=no-verify&sslcert=bad&sslkey=bad&sslrootcert=bad&sslnegotiation=direct",
      sslCa: testCa,
    });
    const parsed = new URL(String(config.connectionString));
    for (const parameter of [
      "ssl",
      "sslmode",
      "sslcert",
      "sslkey",
      "sslrootcert",
      "sslnegotiation",
    ]) {
      expect(parsed.searchParams.has(parameter)).toBe(false);
    }
    expect([...parsed.searchParams]).toEqual([]);
    expect(config.ssl).toMatchObject({
      ca: testCa,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
  });

  it.each([
    "options=-csearch_path%3Dattacker",
    "replication=database",
    "statement_timeout=0",
    "application_name=override",
    "pgbouncer=true",
  ])("rejects unsupported PostgreSQL query parameter %s", (query) => {
    expect(() =>
      secureDatabasePoolConfig({
        connectionString: `postgresql://runtime:secret@db.example.test:5432/trendsfast?${query}`,
        sslCa: testCa,
      }),
    ).toThrow(/unsupported PostgreSQL query parameters/);
  });

  it("rejects non-certificate CA material", () => {
    expect(() =>
      secureDatabasePoolConfig({
        connectionString: "postgresql://runtime:secret@db.example.test:5432/trendsfast",
        sslCa: "not a certificate",
      }),
    ).toThrow(/PEM-encoded/);
  });
});

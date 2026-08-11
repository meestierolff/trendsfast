import { randomUUID } from "node:crypto";

import { like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDatabaseClient } from "../src/client";
import { AuthAdmissionRepository } from "../src/repositories/auth-admission";
import { apiAuthAdmissionBuckets } from "../src/schema";

const integration = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

integration("durable API authentication admission", () => {
  it("bounds rotating fingerprints globally and each fingerprint independently", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const client = createDatabaseClient({ connectionString: databaseUrl });
    const repository = new AuthAdmissionRepository(client.db);
    const namespace = `test-${randomUUID()}`;
    const policy = {
      namespace,
      now: new Date("2026-08-11T12:00:00.000Z"),
      windowMs: 60_000,
      maxAttemptsPerFingerprint: 1,
      maxAttemptsGlobal: 2,
      maxFingerprintBuckets: 10,
    } as const;
    try {
      await expect(repository.admit({ ...policy, fingerprintHash: "fingerprint_a" })).resolves.toBe(
        true,
      );
      await expect(repository.admit({ ...policy, fingerprintHash: "fingerprint_a" })).resolves.toBe(
        false,
      );
      await expect(repository.admit({ ...policy, fingerprintHash: "fingerprint_b" })).resolves.toBe(
        true,
      );
      await expect(repository.admit({ ...policy, fingerprintHash: "fingerprint_c" })).resolves.toBe(
        false,
      );
      await expect(
        repository.admit({
          ...policy,
          fingerprintHash: "fingerprint_c",
          now: new Date("2026-08-11T12:01:00.000Z"),
        }),
      ).resolves.toBe(true);
    } finally {
      await client.db
        .delete(apiAuthAdmissionBuckets)
        .where(like(apiAuthAdmissionBuckets.scopeHash, `${namespace}:%`));
      await client.close();
    }
  });
});

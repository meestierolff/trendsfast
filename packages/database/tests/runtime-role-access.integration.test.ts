import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, createRepositories } from "../src/index";

const roleDescribe = process.env.RUN_DATABASE_ROLE_INTEGRATION === "1" ? describe : describe.skip;
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for runtime-role integration tests`);
  return value;
};

roleDescribe("real PostgreSQL runtime-role behavior", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let retentionClient: ReturnType<typeof createDatabaseClient>;
  let adminClient: ReturnType<typeof createDatabaseClient>;
  let repositories: ReturnType<typeof createRepositories>;
  const verificationId = randomUUID();
  const publicRequestId = randomUUID();
  const publicRunId = randomUUID();
  const publicSourceRunId = randomUUID();
  const publicSignalId = randomUUID();
  const publicToken = `role_public_${randomUUID().replaceAll("-", "")}`;
  const verificationTarget = {
    releaseSha: "9afad5e123456789",
    deploymentHost: "role-test.trendsfast.invalid",
    deploymentId: "dpl_role_test",
  };

  beforeAll(async () => {
    client = createDatabaseClient({
      connectionString: required("DATABASE_URL"),
      ...(process.env.DATABASE_SSL_CA?.trim() ? { sslCa: process.env.DATABASE_SSL_CA.trim() } : {}),
      maxConnections: 1,
      applicationName: "trendsfast-public-role-integration",
    });
    repositories = createRepositories(client.db, {
      apiKeyPepper: "runtime-role-integration-pepper-at-least-32-characters",
    });
    retentionClient = createDatabaseClient({
      connectionString: required("RETENTION_DATABASE_URL"),
      ...(process.env.DATABASE_SSL_CA?.trim() ? { sslCa: process.env.DATABASE_SSL_CA.trim() } : {}),
      maxConnections: 1,
      applicationName: "trendsfast-retention-role-integration",
    });
    adminClient = createDatabaseClient({
      connectionString: required(
        process.env.ROLE_ADMIN_DATABASE_URL?.trim()
          ? "ROLE_ADMIN_DATABASE_URL"
          : "DIRECT_DATABASE_URL",
      ),
      ...(process.env.DATABASE_SSL_CA?.trim() ? { sslCa: process.env.DATABASE_SSL_CA.trim() } : {}),
      maxConnections: 1,
      applicationName: "trendsfast-runtime-role-integration-setup",
    });
    await adminClient.pool.query(
      `insert into public.provider_verification_records(
         id, source, provider, state, credential_mode, deployment_environment,
         release_sha, deployment_host, deployment_id, health_status,
         readback_verified, canonical_urls, limitations, initiated_by,
         started_at, checked_at, completed_at
       ) values (
         $1, 'website', 'Runtime role verifier', 'VERIFIED', 'fixture', 'production',
         $2, $3, $4, 'HEALTHY', true, '["https://private.invalid/evidence"]'::jsonb,
         '[]'::jsonb, 'system:runtime-role-test', now(), now(), now()
       )`,
      [
        verificationId,
        verificationTarget.releaseSha,
        verificationTarget.deploymentHost,
        verificationTarget.deploymentId,
      ],
    );
    await adminClient.pool.query(
      `insert into public.scan_requests(
         id, public_id, origin, state, submitted_url, normalized_url, submitted_at
       ) values ($1, $2, 'FIXTURE', 'RUNNING', 'https://role-test.invalid',
         'https://role-test.invalid', now())`,
      [publicRequestId, publicToken],
    );
    await adminClient.pool.query(
      `insert into public.scan_runs(id, scan_request_id, attempt, state, query_plan)
       values ($1, $2, 1, 'RUNNING', $3::jsonb)`,
      [publicRunId, publicRequestId, null],
    );
    await adminClient.pool.query(
      `insert into public.source_runs(
         id, scan_run_id, source, provider, state, max_calls
       ) values ($1, $2, 'website', 'role-test', 'SUCCEEDED', 1)`,
      [publicSourceRunId, publicRunId],
    );
    await adminClient.pool.query(
      `insert into public.signals(
         id, source_run_id, source, source_id, canonical_url, title, text_excerpt,
         observed_at, metrics, query_id, provider, retrieved_at, cached, provenance
       ) values ($1, $2, 'website', 'role-signal', 'https://role-test.invalid/evidence',
         'Role test evidence', 'Bounded evidence', now(), '{}'::jsonb, 'query-role',
         'role-test', now(), false,
         '{"provider":"role-test","retrievedAt":"2026-08-13T00:00:00.000Z","cached":false}'::jsonb)`,
      [publicSignalId, publicSourceRunId],
    );
  });

  afterAll(async () => {
    await adminClient?.pool.query(
      "delete from public.provider_verification_records where id = $1",
      [verificationId],
    );
    await adminClient?.pool.query("delete from public.scan_requests where id = $1", [
      publicRequestId,
    ]);
    await client?.close();
    await retentionClient?.close();
    await adminClient?.close();
  });

  it("repeats public admission and accepts safe analytics without privilege errors", async () => {
    const scope = `role-${randomUUID()}`;
    await expect(
      repositories.authAdmission.admit({
        namespace: scope,
        fingerprintHash: "a".repeat(64),
        maxAttemptsPerFingerprint: 3,
        maxAttemptsGlobal: 30,
      }),
    ).resolves.toBe(true);
    await expect(
      repositories.authAdmission.admit({
        namespace: scope,
        fingerprintHash: "a".repeat(64),
        maxAttemptsPerFingerprint: 3,
        maxAttemptsGlobal: 30,
      }),
    ).resolves.toBe(true);
    await expect(
      repositories.analytics.append({
        name: "pricing_viewed",
        anonymousSessionHash: "b".repeat(64),
        properties: { source: "runtime-role-integration" },
      }),
    ).resolves.toMatchObject({ name: "pricing_viewed" });
  });

  it("denies public key issuance, grants, review edits, verification, and billing projection", async () => {
    for (const statement of [
      "insert into public.api_keys default values",
      "insert into public.founder_entitlement_grants default values",
      "insert into public.review_events default values",
      "insert into public.provider_verification_records default values",
      "insert into public.billing_webhook_events default values",
    ]) {
      await expect(client.pool.query(statement)).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("exposes only the exact safe provider projection and no raw verification row", async () => {
    const exact = await client.pool.query(
      `select * from public.trendsfast_public_provider_verifications($1, $2, $3)`,
      [
        verificationTarget.releaseSha,
        verificationTarget.deploymentHost,
        verificationTarget.deploymentId,
      ],
    );
    expect(exact.rows).toEqual([
      expect.objectContaining({
        source: "website",
        state: "VERIFIED",
        canonical_url_count: 1,
      }),
    ]);
    expect(Object.keys(exact.rows[0] ?? {})).not.toEqual(
      expect.arrayContaining([
        "release_sha",
        "deployment_host",
        "deployment_id",
        "canonical_urls",
        "actual_cost_usd",
        "failure_message",
        "initiated_by",
      ]),
    );
    const mismatch = await client.pool.query(
      `select * from public.trendsfast_public_provider_verifications($1, $2, $3)`,
      [verificationTarget.releaseSha, verificationTarget.deploymentHost, "dpl_wrong"],
    );
    expect(mismatch.rows).toEqual([]);
    await expect(
      client.pool.query("select canonical_urls from public.provider_verification_records"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("executes capability-safe public status and evidence projections", async () => {
    const status = await repositories.scans.getPublicStatusByPublicId(publicToken);
    if (!status) throw new Error("The runtime-role fixture status was not found");
    expect(status).toMatchObject({
      request: { id: publicRequestId },
      run: { id: publicRunId, attempt: 1 },
    });
    expect(await repositories.scanData.listPublicSourceStatesForRun(publicRunId)).toEqual([
      { source: "website", state: "SUCCEEDED" },
    ]);
    const signals = await repositories.scanData.listPublicSignalsForRun(publicRunId);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.signal).toMatchObject({
      id: publicSignalId,
      canonicalUrl: "https://role-test.invalid/evidence",
      providerRequestId: null,
      rawPayloadHash: null,
    });
    // The server-only public repository role needs cost columns for atomic
    // admission. Capability responses remain explicitly projected and must
    // never serialize those internal economics fields to the browser.
    expect(status.run).not.toHaveProperty("estimatedCostUsd");
    expect(status.run).not.toHaveProperty("actualCostUsd");
    await expect(
      client.pool.query("select provider_payload_fragment from public.source_runs where false"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps retention function-only and revision-fenced", async () => {
    await expect(
      retentionClient.pool.query("select * from public.trendsfast_purge_retained_data('invalid')"),
    ).rejects.toMatchObject({ code: "22023" });
    for (const statement of [
      "select id from public.analytics_events where false",
      "select id from public.delivery_tokens where false",
      "select id from public.founder_launch_interests where false",
      "select id from public.operations_alert_queue where false",
      "select check_type from public.operations_health_checks where false",
      "select id from public.projects where false",
      "select id from public.scan_requests where false",
      "select secret_hash from public.api_keys where false",
      "select email from public.founder_launch_interests where false",
      "select url from public.projects where false",
      "select submitted_url from public.scan_requests where false",
      "insert into public.provider_verification_records default values",
    ]) {
      await expect(retentionClient.pool.query(statement)).rejects.toMatchObject({ code: "42501" });
    }
  });
});

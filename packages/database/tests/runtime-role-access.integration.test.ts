import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, createRepositories, DATABASE_ROLES } from "../src/index";
import {
  assertLiveDatabaseCliIdentity,
  databaseCliTarget,
  resolveRuntimeRoleIntegrationEnvironment,
  type DatabaseCliTarget,
} from "../src/production-cli-environment";

const roleDescribe = process.env.RUN_DATABASE_ROLE_INTEGRATION === "1" ? describe : describe.skip;

async function assertExactLocalIdentity(
  client: ReturnType<typeof createDatabaseClient>,
  target: DatabaseCliTarget,
) {
  const identity = await client.pool.query<{
    current_database: string;
    current_user: string;
    ssl: boolean;
  }>(`select current_user,
             current_database() as current_database,
             coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as ssl`);
  const record = identity.rows[0];
  assertLiveDatabaseCliIdentity(record, target);
  if (record.ssl) throw new Error("Runtime-role integration unexpectedly negotiated TLS");
}

roleDescribe("real PostgreSQL runtime-role behavior", () => {
  let client: ReturnType<typeof createDatabaseClient>;
  let memberClient: ReturnType<typeof createDatabaseClient>;
  let retentionClient: ReturnType<typeof createDatabaseClient>;
  let adminClient: ReturnType<typeof createDatabaseClient>;
  let repositories: ReturnType<typeof createRepositories>;
  let memberRepositories: ReturnType<typeof createRepositories>;
  const verificationId = randomUUID();
  const publicRequestId = randomUUID();
  const publicRunId = randomUUID();
  const publicSourceRunId = randomUUID();
  const publicSignalId = randomUUID();
  const publicToken = `role_public_${randomUUID().replaceAll("-", "")}`;
  const memberAuthUserId = randomUUID();
  const memberUrl = `https://member-project-${randomUUID()}.example`;
  const verificationTarget = {
    releaseSha: "9afad5e123456789",
    deploymentHost: "role-test.trendsfast.invalid",
    deploymentId: "dpl_role_test",
  };

  beforeAll(async () => {
    const execution = resolveRuntimeRoleIntegrationEnvironment();
    const publicTarget = databaseCliTarget({
      execution,
      variable: "DATABASE_URL",
      productionEndpoint: "transaction-pooler",
      productionRole: DATABASE_ROLES.public,
      ciRole: DATABASE_ROLES.public,
    });
    const retentionTarget = databaseCliTarget({
      execution,
      variable: "RETENTION_DATABASE_URL",
      productionEndpoint: "transaction-pooler",
      productionRole: DATABASE_ROLES.retention,
      ciRole: DATABASE_ROLES.retention,
    });
    const memberTarget = databaseCliTarget({
      execution,
      variable: "MEMBER_DATABASE_URL",
      productionEndpoint: "transaction-pooler",
      productionRole: DATABASE_ROLES.member,
      ciRole: DATABASE_ROLES.member,
    });
    const adminTarget = databaseCliTarget({
      execution,
      variable: "DIRECT_DATABASE_URL",
      productionEndpoint: "direct-or-session",
      productionRole: DATABASE_ROLES.migrator,
      ciRole: DATABASE_ROLES.migrator,
    });
    client = createDatabaseClient({
      connectionString: publicTarget.connectionString,
      maxConnections: 1,
      applicationName: "trendsfast-public-role-integration",
    });
    repositories = createRepositories(client.db, {
      apiKeyPepper: "runtime-role-integration-pepper-at-least-32-characters",
    });
    memberClient = createDatabaseClient({
      connectionString: memberTarget.connectionString,
      maxConnections: 1,
      applicationName: "trendsfast-member-role-integration",
    });
    memberRepositories = createRepositories(memberClient.db, {
      apiKeyPepper: "runtime-role-integration-pepper-at-least-32-characters",
    });
    retentionClient = createDatabaseClient({
      connectionString: retentionTarget.connectionString,
      maxConnections: 1,
      applicationName: "trendsfast-retention-role-integration",
    });
    adminClient = createDatabaseClient({
      connectionString: adminTarget.connectionString,
      maxConnections: 1,
      applicationName: "trendsfast-runtime-role-integration-setup",
    });
    await Promise.all([
      assertExactLocalIdentity(client, publicTarget),
      assertExactLocalIdentity(memberClient, memberTarget),
      assertExactLocalIdentity(retentionClient, retentionTarget),
      assertExactLocalIdentity(adminClient, adminTarget),
    ]);
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
    await adminClient?.pool.query("delete from public.projects where normalized_url = $1", [
      `${memberUrl}/`,
    ]);
    await adminClient?.pool.query("delete from public.user_profiles where auth_user_id = $1", [
      memberAuthUserId,
    ]);
    await adminClient?.pool.query(
      "delete from public.provider_verification_records where id = $1",
      [verificationId],
    );
    await adminClient?.pool.query("delete from public.scan_requests where id = $1", [
      publicRequestId,
    ]);
    await client?.close();
    await memberClient?.close();
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

  it("creates and reuses an owner project through the exact member-runtime column ACL", async () => {
    const identity = {
      authUserId: memberAuthUserId,
      email: `member-project-${randomUUID()}@example.com`,
      projectEntryEligible: true,
    };
    const first = await memberRepositories.members.createOrReuseOwnedProject({
      identity,
      url: memberUrl,
    });

    expect(first.created).toBe(true);
    expect(first.contextVersion).toBeNull();
    expect(first.project).toMatchObject({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      status: "ACTIVE",
      publicCaseStudyConsent: false,
      archivedAt: null,
    });
    expect(first.project.createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite(first.project.createdAt.getTime())).toBe(true);
    expect(first.project.updatedAt).toBeInstanceOf(Date);
    expect(Number.isFinite(first.project.updatedAt.getTime())).toBe(true);

    const second = await memberRepositories.members.createOrReuseOwnedProject({
      identity,
      url: `${memberUrl}/`,
    });
    expect(second).toMatchObject({
      created: false,
      project: { id: first.project.id },
    });

    const storedProjects = await memberClient.pool.query<{
      id: string;
      status: string;
      public_case_study_consent: boolean;
      created_at: Date;
      updated_at: Date;
      archived_at: Date | null;
    }>(
      `select id, status, public_case_study_consent, created_at, updated_at, archived_at
         from public.projects
        where normalized_url = $1`,
      [`${memberUrl}/`],
    );
    expect(storedProjects.rows).toEqual([
      {
        id: first.project.id,
        status: "ACTIVE",
        public_case_study_consent: false,
        created_at: expect.any(Date),
        updated_at: expect.any(Date),
        archived_at: null,
      },
    ]);
    const owners = await memberClient.pool.query<{ owner_count: string }>(
      `select count(*)::text as owner_count
         from public.project_memberships pm
         inner join public.user_profiles up on up.id = pm.user_profile_id
        where pm.project_id = $1 and pm.role = 'OWNER' and up.auth_user_id = $2`,
      [first.project.id, memberAuthUserId],
    );
    expect(owners.rows).toEqual([{ owner_count: "1" }]);

    const duplicates = await memberClient.pool.query<{ project_count: string }>(
      `select count(*)::text as project_count
         from public.projects
        where normalized_url = $1`,
      [`${memberUrl}/`],
    );
    expect(duplicates.rows).toEqual([{ project_count: "1" }]);

    const forbiddenInserts: ReadonlyArray<{ text: string; value: unknown }> = [
      {
        text: `insert into public.projects(public_id, name, url, normalized_url, id)
               values ($1, $2, $3, $4, $5)`,
        value: randomUUID(),
      },
      {
        text: `insert into public.projects(public_id, name, url, normalized_url, status)
               values ($1, $2, $3, $4, $5)`,
        value: "ACTIVE",
      },
      {
        text: `insert into public.projects(
                 public_id, name, url, normalized_url, public_case_study_consent
               ) values ($1, $2, $3, $4, $5)`,
        value: false,
      },
      {
        text: `insert into public.projects(public_id, name, url, normalized_url, created_at)
               values ($1, $2, $3, $4, $5)`,
        value: new Date(),
      },
      {
        text: `insert into public.projects(public_id, name, url, normalized_url, updated_at)
               values ($1, $2, $3, $4, $5)`,
        value: new Date(),
      },
      {
        text: `insert into public.projects(public_id, name, url, normalized_url, archived_at)
               values ($1, $2, $3, $4, $5)`,
        value: null,
      },
    ];
    for (const [index, attempt] of forbiddenInserts.entries()) {
      const url = `https://member-forbidden-${index}-${randomUUID()}.example/`;
      await expect(
        memberClient.pool.query(attempt.text, [
          `project_${randomUUID().replaceAll("-", "")}`,
          "Forbidden member insert",
          url,
          url,
          attempt.value,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    }
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

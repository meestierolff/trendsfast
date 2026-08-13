import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getVerifiedAuthSubject: vi.fn(),
  acceptsPrivateMutation: vi.fn(),
  issueProjectApiKey: vi.fn(),
  revokeProjectApiKey: vi.fn(),
  reissueProjectApiKey: vi.fn(),
  requestProjectRefresh: vi.fn(),
  recordProjectOutcome: vi.fn(),
  getProjectDashboard: vi.fn(),
  updateProjectContext: vi.fn(),
  updateProjectUrl: vi.fn(),
  listOwnedProjects: vi.fn(),
  loadEnv: vi.fn(),
  resolveApiRateLimit: vi.fn(),
  resolveApiProviderCostLimitUsdPerHour: vi.fn(),
  resolveProviderCosts: vi.fn(),
  runPersistedScan: vi.fn(),
  after: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  getVerifiedAuthSubject: mocks.getVerifiedAuthSubject,
}));
vi.mock("@/lib/private-scan-api", () => ({
  acceptsPrivateMutation: mocks.acceptsPrivateMutation,
  PRIVATE_RESPONSE_HEADERS: { "cache-control": "private, no-store" },
}));
vi.mock("@/lib/server-database", () => ({
  getMemberRepositories: () => ({
    members: {
      issueProjectApiKey: mocks.issueProjectApiKey,
      revokeProjectApiKey: mocks.revokeProjectApiKey,
      reissueProjectApiKey: mocks.reissueProjectApiKey,
      requestProjectRefresh: mocks.requestProjectRefresh,
      recordProjectOutcome: mocks.recordProjectOutcome,
      getProjectDashboard: mocks.getProjectDashboard,
      updateProjectContext: mocks.updateProjectContext,
      updateProjectUrl: mocks.updateProjectUrl,
      listOwnedProjects: mocks.listOwnedProjects,
    },
  }),
}));
vi.mock("@trendsfast/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@trendsfast/config")>();
  return {
    ...original,
    loadEnv: mocks.loadEnv,
    resolveApiRateLimit: mocks.resolveApiRateLimit,
    resolveApiProviderCostLimitUsdPerHour: mocks.resolveApiProviderCostLimitUsdPerHour,
    resolveProviderCosts: mocks.resolveProviderCosts,
  };
});
vi.mock("@/lib/scan-processing", () => ({ runPersistedScan: mocks.runPersistedScan }));
vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>();
  return { ...original, after: mocks.after };
});

import { POST as issueKey } from "../../app/api/dashboard/projects/[projectId]/api-keys/route";
import { POST as mutateKey } from "../../app/api/dashboard/projects/[projectId]/api-keys/[keyId]/[action]/route";
import { POST as updateContext } from "../../app/api/dashboard/projects/[projectId]/context/route";
import { POST as updateProjectUrl } from "../../app/api/dashboard/projects/[projectId]/url/route";
import { POST as recordOutcome } from "../../app/api/dashboard/projects/[projectId]/outcomes/route";
import { POST as refreshProject } from "../../app/api/dashboard/projects/[projectId]/refresh/route";
import { resolveDashboardProject } from "../../lib/dashboard-service";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";
const keyId = "33333333-3333-4333-8333-333333333333";
const authUserId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-08-13T07:00:00.000Z");

function jsonRequest(path: string, body: Record<string, unknown>) {
  return new Request(`https://trendsfast.example${path}`, {
    method: "POST",
    headers: { origin: "https://trendsfast.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function contextBody() {
  return {
    context: {
      name: "Acme",
      url: "https://acme.example",
      category: "Research",
      audience: "Technical founders",
      problem: "Trend research takes too long",
      desiredOutcome: "Choose one credible move",
      credibleClaims: [],
      alternatives: [],
      competitors: [],
      markets: [],
      language: "en",
      suitableChannels: [],
      availableFormats: [],
      credibleTopics: [],
      assumptions: ["The founder writes posts"],
    },
    entityType: "PRODUCT",
    contextProvenance: {
      inferred_context: [
        {
          field: "audience",
          value: "Technical founders",
          rationale: "The positioning addresses engineering teams",
        },
      ],
      assumptions: ["The founder writes posts"],
    },
    voiceProfile: {
      traits: [],
      preferred_phrases: [],
      avoid_phrases: [],
      sample_texts: [],
      sample_urls: [],
    },
    contentCapabilities: {
      founder_text: true,
      founder_on_camera: false,
      screen_recording: false,
      ai_avatar: false,
      carousel: false,
      product_demo: false,
      long_form: false,
    },
  };
}

describe("member dashboard authorization and policy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptsPrivateMutation.mockReturnValue(true);
    mocks.getVerifiedAuthSubject.mockResolvedValue(authUserId);
    mocks.loadEnv.mockReturnValue({
      LIVE_API_CREATION_ENABLED: true,
      PROVIDER_CREDENTIAL_MODE: "managed",
      PROVIDER_CALLS_ENABLED: true,
    });
    mocks.resolveApiRateLimit.mockReturnValue(71);
    mocks.resolveApiProviderCostLimitUsdPerHour.mockReturnValue(8.731);
    mocks.resolveProviderCosts.mockReturnValue({ maximumProviderCostUsdPerScan: 0.317 });
    mocks.runPersistedScan.mockResolvedValue(undefined);
  });

  it("does not allow a requested project outside the verified subject's membership list", async () => {
    mocks.listOwnedProjects.mockResolvedValue([
      {
        project: {
          id: projectA,
          name: "Owned project",
          url: "https://owned.example",
          status: "ACTIVE",
        },
        role: "OWNER",
      },
    ]);
    const resolved = await resolveDashboardProject({ authUserId, requestedProjectId: projectB });
    expect(resolved.selected?.project.id).toBe(projectA);
  });

  it("preserves server-trusted observed facts while accepting editable inferred context", async () => {
    const observedFacts = [
      {
        field: "headline",
        value: "Move while the signal is early",
        source_url: "https://acme.example",
      },
    ];
    mocks.getProjectDashboard.mockResolvedValue({
      context: {
        contextProvenance: {
          observed_facts: observedFacts,
          inferred_context: [],
          assumptions: [],
        },
      },
    });
    mocks.updateProjectContext.mockResolvedValue({ version: 2 });
    const response = await updateContext(
      jsonRequest(`/api/dashboard/projects/${projectA}/context`, contextBody()),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(response.status).toBe(201);
    expect(mocks.updateProjectContext).toHaveBeenCalledWith(
      expect.objectContaining({
        authUserId,
        projectId: projectA,
        contextProvenance: expect.objectContaining({ observed_facts: observedFacts }),
      }),
    );
  });

  it("rejects a client attempt to overwrite observed provenance", async () => {
    const forged = {
      ...contextBody(),
      contextProvenance: {
        ...contextBody().contextProvenance,
        observed_facts: [
          {
            field: "headline",
            value: "A forged observation",
            source_url: "https://attacker.example",
          },
        ],
      },
    };
    const response = await updateContext(
      jsonRequest(`/api/dashboard/projects/${projectA}/context`, forged),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.getProjectDashboard).not.toHaveBeenCalled();
    expect(mocks.updateProjectContext).not.toHaveBeenCalled();
  });

  it("updates a project URL only through the verified owner-scoped repository boundary", async () => {
    mocks.updateProjectUrl.mockResolvedValue({
      changed: true,
      project: { id: projectA, url: "https://new.example/product" },
    });
    const response = await updateProjectUrl(
      jsonRequest(`/api/dashboard/projects/${projectA}/url`, {
        url: "https://new.example/product",
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      changed: true,
      url: "https://new.example/product",
      requiresRefresh: true,
    });
    expect(mocks.updateProjectUrl).toHaveBeenCalledWith({
      authUserId,
      projectId: projectA,
      url: "https://new.example/product",
    });

    const forged = await updateProjectUrl(
      jsonRequest(`/api/dashboard/projects/${projectA}/url`, {
        url: "https://new.example/product",
        authUserId: "99999999-9999-4999-8999-999999999999",
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(forged.status).toBe(400);
    expect(mocks.updateProjectUrl).toHaveBeenCalledTimes(1);

    const local = await updateProjectUrl(
      jsonRequest(`/api/dashboard/projects/${projectA}/url`, {
        url: "http://127.0.0.1:54321/private",
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(local.status).toBe(400);
    expect(mocks.updateProjectUrl).toHaveBeenCalledTimes(1);
  });

  it("issues one-time raw keys with server-derived policy and rejects browser policy fields", async () => {
    mocks.issueProjectApiKey.mockResolvedValue({
      record: {
        id: keyId,
        projectId: projectA,
        name: "Codex",
        visiblePrefix: "visible",
        scopes: ["next_move:read", "next_move:write"],
        environment: "live",
        status: "ACTIVE",
        createdAt: now,
        lastUsedAt: null,
        expiresAt: new Date("2026-09-13T00:00:00.000Z"),
        revokedAt: null,
      },
      rawKey: "tf_live_visible.one-time-secret",
    });
    const response = await issueKey(
      jsonRequest(`/api/dashboard/projects/${projectA}/api-keys`, {
        name: "Codex",
        scopes: ["next_move:read", "next_move:write"],
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      rawKey: "tf_live_visible.one-time-secret",
      secretShownOnce: true,
    });
    expect(mocks.issueProjectApiKey).toHaveBeenCalledWith({
      authUserId,
      projectId: projectA,
      name: "Codex",
      scopes: ["next_move:read", "next_move:write"],
      policy: { rateLimitPerHour: 71, providerCostLimitUsd: 8.731 },
    });

    const forged = await issueKey(
      jsonRequest(`/api/dashboard/projects/${projectA}/api-keys`, {
        name: "Forged",
        scopes: ["next_move:read"],
        rateLimitPerHour: 999999,
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(forged.status).toBe(400);
  });

  it("scopes revoke/reissue to the verified subject, project, and key", async () => {
    mocks.revokeProjectApiKey.mockResolvedValue({ id: keyId, status: "REVOKED" });
    const response = await mutateKey(
      jsonRequest(`/api/dashboard/projects/${projectA}/api-keys/${keyId}/revoke`, {}),
      { params: Promise.resolve({ projectId: projectA, keyId, action: "revoke" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.revokeProjectApiKey).toHaveBeenCalledWith({
      authUserId,
      projectId: projectA,
      apiKeyId: keyId,
    });

    mocks.reissueProjectApiKey.mockResolvedValue({
      record: { id: "88888888-8888-4888-8888-888888888888", status: "ACTIVE" },
      rawKey: "tf_live_reissued.one-time-secret",
    });
    const reissued = await mutateKey(
      jsonRequest(`/api/dashboard/projects/${projectA}/api-keys/${keyId}/reissue`, {}),
      { params: Promise.resolve({ projectId: projectA, keyId, action: "reissue" }) },
    );
    expect(reissued.status).toBe(200);
    expect(mocks.reissueProjectApiKey).toHaveBeenCalledWith({
      authUserId,
      projectId: projectA,
      apiKeyId: keyId,
      policy: { rateLimitPerHour: 71, providerCostLimitUsd: 8.731 },
    });
    expect(await reissued.json()).toMatchObject({
      rawKey: "tf_live_reissued.one-time-secret",
      secretShownOnce: true,
      replacedKey: { id: keyId, status: "REVOKED" },
    });
  });

  it("uses the project-level refresh allowance and ignores no browser-supplied money", async () => {
    mocks.requestProjectRefresh.mockResolvedValue({
      status: "CREATED",
      publicId: "scan_project_refresh",
    });
    mocks.after.mockImplementation((callback: () => Promise<void>) => void callback());
    const response = await refreshProject(
      jsonRequest(`/api/dashboard/projects/${projectA}/refresh`, {
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
        objective: "Reach technical founders",
        preferredChannels: ["x", "linkedin"],
        contentCapabilities: ["founder_text"],
        generationLevel: "brief",
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(response.status).toBe(202);
    expect(mocks.requestProjectRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        authUserId,
        projectId: projectA,
        costReservationUsd: 0.317,
      }),
    );

    const forged = await refreshProject(
      jsonRequest(`/api/dashboard/projects/${projectA}/refresh`, {
        idempotencyKey: "66666666-6666-4666-8666-666666666666",
        costReservationUsd: 0,
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(forged.status).toBe(400);
  });

  it("keeps member refresh independent of the external v1 creation rollout gate", async () => {
    mocks.loadEnv.mockReturnValue({
      LIVE_API_CREATION_ENABLED: false,
      PROVIDER_CREDENTIAL_MODE: "managed",
      PROVIDER_CALLS_ENABLED: true,
    });
    mocks.requestProjectRefresh.mockResolvedValue({
      status: "REUSED",
      publicId: "scan_member_refresh",
    });
    const response = await refreshProject(
      jsonRequest(`/api/dashboard/projects/${projectA}/refresh`, {
        idempotencyKey: "12121212-1212-4212-8212-121212121212",
        objective: "Reach technical founders",
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.requestProjectRefresh).toHaveBeenCalledOnce();
  });

  it("enforces the claimed-project contract's 100-character objective bound", async () => {
    const response = await refreshProject(
      jsonRequest(`/api/dashboard/projects/${projectA}/refresh`, {
        idempotencyKey: "13131313-1313-4313-8313-131313131313",
        objective: "x".repeat(101),
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.requestProjectRefresh).not.toHaveBeenCalled();
  });

  it("does not schedule a reused refresh and preserves the caller's stable UUID", async () => {
    const idempotencyKey = "99999999-9999-4999-8999-999999999999";
    mocks.requestProjectRefresh.mockResolvedValue({
      status: "REUSED",
      publicId: "scan_existing_refresh",
    });
    const response = await refreshProject(
      jsonRequest(`/api/dashboard/projects/${projectA}/refresh`, {
        idempotencyKey,
        generationLevel: "brief",
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.requestProjectRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey }),
    );
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runPersistedScan).not.toHaveBeenCalled();
  });

  it.each([
    {
      result: { status: "USAGE_LIMITED", reason: "ON_DEMAND_MONTHLY_LIMIT" },
      expectedStatus: 403,
      message: "ten on-demand refreshes",
    },
    {
      result: { status: "USAGE_LIMITED", reason: "ENTITLEMENT_INACTIVE" },
      expectedStatus: 403,
      message: "active Founder entitlement",
    },
    {
      result: { status: "IDEMPOTENCY_CONFLICT" },
      expectedStatus: 409,
      message: "already used for another request",
    },
  ])(
    "returns an honest refresh error for $result.status/$result.reason",
    async ({ result, expectedStatus, message }) => {
      mocks.requestProjectRefresh.mockResolvedValue(result);
      const response = await refreshProject(
        jsonRequest(`/api/dashboard/projects/${projectA}/refresh`, {
          idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          generationLevel: "brief",
        }),
        { params: Promise.resolve({ projectId: projectA }) },
      );
      expect(response.status).toBe(expectedStatus);
      expect((await response.json()).error).toContain(message);
      expect(mocks.after).not.toHaveBeenCalled();
    },
  );

  it("rejects dashboard mutations without a verified Auth subject", async () => {
    mocks.getVerifiedAuthSubject.mockResolvedValue(null);
    const response = await recordOutcome(
      jsonRequest(`/api/dashboard/projects/${projectA}/outcomes`, {
        nextMoveId: "77777777-7777-4777-8777-777777777777",
        kind: "USED",
      }),
      { params: Promise.resolve({ projectId: projectA }) },
    );
    expect(response.status).toBe(401);
    expect(mocks.recordProjectOutcome).not.toHaveBeenCalled();
  });
});

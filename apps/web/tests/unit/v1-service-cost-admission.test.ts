import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const repositoryMocks = vi.hoisted(() => ({
  usageSince: vi.fn(),
  recordLimited: vi.fn(),
  resolveApiIdempotency: vi.fn(),
  admitApiRequest: vi.fn(),
  getStatusByPublicId: vi.fn(),
  appendAnalytics: vi.fn(),
  getProject: vi.fn(),
  getCurrentProjectProfile: vi.fn(),
  listSignalsForRun: vi.fn(),
  isProjectEntitled: vi.fn(),
}));

vi.mock("@trendsfast/config", () => ({
  loadEnv: () => ({
    APP_URL: "https://app.example",
    PROVIDER_CREDENTIAL_MODE: "managed",
    PROVIDER_CALLS_ENABLED: true,
    LIVE_API_CREATION_ENABLED: true,
    MAX_PROVIDER_COST_USD_PER_SCAN: 91.333,
    API_CREATE_RATE_LIMIT_PER_HOUR: 31,
    API_STATUS_RATE_LIMIT_PER_HOUR: 317,
  }),
  resolveProviderCosts: () => ({ maximumProviderCostUsdPerScan: 91.333 }),
  resolveApiRateLimit: (_env: unknown, field: string) =>
    field === "API_STATUS_RATE_LIMIT_PER_HOUR" ? 317 : 31,
}));

vi.mock("../../lib/server-database", () => ({
  getAuthRepositories: () => ({
    apiKeys: {
      usageSince: repositoryMocks.usageSince,
      recordLimited: repositoryMocks.recordLimited,
    },
  }),
  getRepositories: () => ({
    scans: {
      resolveApiIdempotency: repositoryMocks.resolveApiIdempotency,
      admitApiRequest: repositoryMocks.admitApiRequest,
      getStatusByPublicId: repositoryMocks.getStatusByPublicId,
      getPublicStatusByPublicId: repositoryMocks.getStatusByPublicId,
    },
    analytics: { append: repositoryMocks.appendAnalytics },
    scanData: {
      getProject: repositoryMocks.getProject,
      getCurrentProjectProfile: repositoryMocks.getCurrentProjectProfile,
      listSignalsForRun: repositoryMocks.listSignalsForRun,
      listPublicSignalsForRun: repositoryMocks.listSignalsForRun,
    },
    founderUsage: { isProjectEntitled: repositoryMocks.isProjectEntitled },
  }),
}));

import { createV1Service, isWithinFounderResultHistory } from "../../lib/v1-service";

describe("v1 service cost admission wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.usageSince.mockResolvedValue({
      successfulRequests: 1,
      createRequests: 1,
      statusRequests: 1,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
    });
    repositoryMocks.resolveApiIdempotency.mockResolvedValue(null);
    repositoryMocks.appendAnalytics.mockResolvedValue(undefined);
    repositoryMocks.isProjectEntitled.mockResolvedValue(true);
    repositoryMocks.getProject.mockResolvedValue({
      id: "project_1",
      normalizedUrl: "https://example.com/",
    });
    repositoryMocks.getCurrentProjectProfile.mockResolvedValue(null);
    repositoryMocks.listSignalsForRun.mockResolvedValue([]);
  });

  it("reserves the live per-scan ceiling atomically and schedules only a created request", async () => {
    const persistedRequest = {
      id: "request_1",
      publicId: "scan_1",
      apiKeyId: "key_1",
      projectId: "project_1",
      state: "QUEUED",
      createdAt: new Date(),
    };
    repositoryMocks.admitApiRequest.mockResolvedValue({
      status: "CREATED",
      request: persistedRequest,
    });
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: persistedRequest,
      run: null,
      move: null,
      context: null,
      project: null,
      delivery: null,
      evidence: [],
    });
    const schedule = vi.fn();
    const service = createV1Service({ schedule });

    await expect(
      service.createOrReuse({
        principal: {
          apiKeyId: "key_1",
          projectId: "project_1",
          environment: "live",
          scopes: ["next_move:write"],
          rateLimitPerHour: 31,
          providerCostLimitUsd: 7.25,
        },
        idempotencyKey: "5c55b81c-bd64-4bdb-b579-91017b476b7f",
        request: { product_url: "https://example.com" },
      }),
    ).resolves.toMatchObject({ id: "scan_1", status: "QUEUED" });

    expect(repositoryMocks.admitApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: "key_1",
        idempotencyKey: "5c55b81c-bd64-4bdb-b579-91017b476b7f",
        costReservationUsd: 91.333,
        projectId: "project_1",
        since: expect.any(Date),
        now: expect.any(Date),
      }),
    );
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith("scan_1");
  });

  it("rejects legacy unbound keys before they can queue work for another project's URL", async () => {
    const schedule = vi.fn();
    const service = createV1Service({ schedule });

    await expect(
      service.createOrReuse({
        principal: {
          apiKeyId: "legacy_unbound_key",
          environment: "test",
          scopes: ["next_move:write"],
          rateLimitPerHour: 31,
          providerCostLimitUsd: 7.25,
        },
        idempotencyKey: "2ba11c23-29cc-46e1-befe-b0d249d08016",
        request: { product_url: "https://claimed.example" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    expect(repositoryMocks.getProject).not.toHaveBeenCalled();
    expect(repositoryMocks.admitApiRequest).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("builds claimed-project work from the saved URL, context, and capability ceiling", async () => {
    const persistedRequest = {
      id: "request_project",
      publicId: "scan_project",
      apiKeyId: "key_1",
      projectId: "project_1",
      state: "QUEUED",
      createdAt: new Date(),
    };
    repositoryMocks.getCurrentProjectProfile.mockResolvedValue({
      project: { id: "project_1", url: "https://saved.example/product", status: "ACTIVE" },
      contextVersion: {
        context: {
          name: "Saved Product",
          url: "https://saved.example/product",
          category: "distribution intelligence",
          audience: "technical founders",
          problem: "Research takes too long.",
          desiredOutcome: "Choose one move.",
          credibleClaims: ["Uses evidence receipts"],
          alternatives: ["manual research"],
          competitors: [],
          markets: ["US"],
          language: "en",
          suitableChannels: ["x", "linkedin"],
          availableFormats: ["founder_text", "screen_recording"],
          credibleTopics: ["evidence-led distribution"],
          assumptions: [],
        },
        contentCapabilities: {
          founder_text: true,
          founder_on_camera: false,
          screen_recording: true,
          ai_avatar: false,
          carousel: false,
          product_demo: false,
          long_form: false,
        },
      },
    });
    repositoryMocks.getProject.mockResolvedValue({
      id: "project_1",
      normalizedUrl: "https://saved.example/product",
    });
    repositoryMocks.admitApiRequest.mockResolvedValue({
      status: "CREATED",
      request: persistedRequest,
    });
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: persistedRequest,
      run: null,
      move: null,
      context: null,
      project: null,
      delivery: null,
      evidence: [],
    });
    const service = createV1Service({ schedule: vi.fn() });

    await service.createOrReuseForProject({
      principal: {
        apiKeyId: "key_1",
        projectId: "project_1",
        environment: "live",
        scopes: ["next_move:write"],
      },
      projectId: "project_1",
      idempotencyKey: "5c55b81c-bd64-4bdb-b579-91017b476b7f",
      request: {
        objective: "Grow among technical founders",
        preferred_channels: ["x"],
        content_capabilities: ["screen_recording"],
        generation_level: "draft",
      },
    });

    expect(repositoryMocks.admitApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        request: {
          product_url: "https://saved.example/product",
          objective: "Grow among technical founders",
          market: "US",
          language: "en",
          preferred_channels: ["x"],
          available_formats: ["founder_text", "screen_recording"],
          content_capabilities: ["screen_recording"],
          generation_level: "draft",
        },
      }),
    );

    await expect(
      service.createOrReuseForProject({
        principal: {
          apiKeyId: "key_1",
          projectId: "project_1",
          environment: "live",
          scopes: ["next_move:write"],
        },
        projectId: "project_1",
        idempotencyKey: "fcf511c5-a205-4b86-9ca0-e62938ccb066",
        request: { content_capabilities: ["ai_avatar"] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 422 });
  });

  it("exposes live results only inside the exact 30-day Founder history window", () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    expect(isWithinFounderResultHistory(new Date("2026-08-01T12:00:00.000Z"), now)).toBe(true);
    expect(isWithinFounderResultHistory(new Date("2026-08-01T11:59:59.999Z"), now)).toBe(false);
    expect(isWithinFounderResultHistory(new Date("2026-08-31T12:00:00.001Z"), now)).toBe(false);
  });

  it("hides live results when entitlement is inactive or the request is older than 30 days", async () => {
    const service = createV1Service({ schedule: vi.fn() });
    const principal = {
      apiKeyId: "key_1",
      projectId: "project_1",
      environment: "live" as const,
      scopes: ["next_move:read"],
    };
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: {
        id: "request_old",
        publicId: "scan_old",
        apiKeyId: "key_1",
        projectId: "project_1",
        state: "READY",
        createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000),
      },
      run: null,
      move: null,
      context: null,
      project: null,
      delivery: null,
      evidence: [],
    });

    await expect(service.getStatus({ principal, id: "scan_old" })).resolves.toBeNull();
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: {
        id: "request_current",
        publicId: "scan_current",
        apiKeyId: "key_1",
        projectId: "project_1",
        state: "QUEUED",
        createdAt: new Date(),
      },
      run: null,
      move: null,
      context: null,
      project: null,
      delivery: null,
      evidence: [],
    });
    repositoryMocks.isProjectEntitled.mockResolvedValue(false);
    await expect(service.getStatus({ principal, id: "scan_current" })).resolves.toBeNull();
  });

  it("surfaces a durable Founder monthly admission limit without scheduling work", async () => {
    repositoryMocks.getProject.mockResolvedValue({
      id: "project_1",
      normalizedUrl: "https://example.com/",
    });
    repositoryMocks.admitApiRequest.mockResolvedValue({
      status: "USAGE_LIMITED",
      reason: "ON_DEMAND_MONTHLY_LIMIT",
    });
    const schedule = vi.fn();
    const service = createV1Service({ schedule });

    await expect(
      service.createOrReuse({
        principal: {
          apiKeyId: "key_1",
          projectId: "project_1",
          environment: "live",
          scopes: ["next_move:write"],
        },
        idempotencyKey: "5c55b81c-bd64-4bdb-b579-91017b476b7f",
        request: { product_url: "https://example.com" },
      }),
    ).rejects.toMatchObject({ code: "USAGE_LIMITED", status: 429 });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("projects a strict evidence-bound ready contract without internal fields", async () => {
    const validUntil = new Date("2036-08-14T10:00:00.000Z");
    const observedAt = new Date("2026-08-13T09:00:00.000Z");
    const publishedAt = new Date("2026-08-13T07:00:00.000Z");
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: {
        id: "request_ready",
        publicId: "scan_ready",
        apiKeyId: "key_1",
        projectId: "project_1",
        state: "READY",
        createdAt: new Date(),
      },
      run: { id: "run_1" },
      move: {
        id: "internal_move_uuid",
        publicId: "move_public",
        scanRunId: "run_1",
        state: "READY",
        action: "REPLY",
        channel: "x",
        topic: "A stored founder conversation",
        angle: "Contribute a useful evidence framework.",
        format: "technical_reply",
        hook: "Separate evidence from assumptions.",
        outline: ["Answer directly", "Show the rule"],
        cta: "Offer an example only if useful.",
        priority: 74,
        confidence: "0.74000",
        whyNow: "One exact current conversation is exceptionally relevant.",
        signalClass: "EMERGING_SIGNAL",
        independentSourceCount: 1,
        saturation: "low",
        limitations: ["One-source inference supports REPLY only."],
        founderReviewed: true,
        autoPublish: false,
        proposalStale: false,
        decisionContractVersion: "next-move-v1",
        generationLevel: "brief",
        draftContent: null,
        validUntil,
        actionDetails: {
          action: "REPLY",
          primary_target: {
            source: "x",
            url: "https://x.com/stored/status/1",
            author: "stored-author",
            title_or_excerpt: "Stored source title",
            published_at: publishedAt.toISOString(),
            observed_at: observedAt.toISOString(),
            why_this_target: "This exact stored conversation matches the audience problem.",
            credibility_reason: "The product has a concrete framework to contribute.",
            reply_objective: "Help participants make the next decision.",
            reply_angle: "Separate observed evidence from assumptions.",
            suggested_reply: "Separate evidence from assumptions, then show the trade-off.",
            tone: ["helpful", "non-promotional"],
            reply_by: validUntil.toISOString(),
          },
          secondary_targets: [],
        },
        trendWindow: {
          state: "EARLY",
          basis: "SINGLE_SIGNAL_INFERENCE",
          observed_since: publishedAt.toISOString(),
          last_confirmed_at: observedAt.toISOString(),
          recommended_action_by: validUntil.toISOString(),
          valid_until: validUntil.toISOString(),
          recheck_at: "2026-08-13T14:00:00.000Z",
          estimated_remaining_hours: { min: 4, max: 12 },
          confidence: 0.55,
          explanation: "One current source supports only a short inferred reply window.",
        },
        breakoutPotential: {
          level: "medium",
          basis: "HEURISTIC",
          factors: {
            audience_relevance: 0.9,
            timing: 0.8,
            novelty: 0.6,
            product_credibility: 0.72,
            format_fit: 0.8,
            saturation_risk: 0.2,
          },
          explanation: "A categorical heuristic label, not a probability.",
        },
      },
      context: {
        name: "Example",
        url: "https://example.com",
        category: "distribution intelligence",
        audience: "technical founders",
        problem: "Distribution research takes too long.",
        desiredOutcome: "Choose one timely move.",
        credibleClaims: ["Uses evidence receipts"],
        alternatives: ["manual research"],
        competitors: [],
        markets: ["US"],
        language: "en",
        suitableChannels: ["x"],
        availableFormats: ["founder_text"],
        credibleTopics: ["evidence-led distribution"],
        assumptions: [],
      },
      project: { id: "project_1", url: "https://example.com" },
      delivery: null,
      evidence: [
        {
          signalId: "signal_1",
          source: "x",
          canonicalUrl: "https://x.com/stored/status/1",
          title: "Stored source title",
          publishedAt,
          observedAt,
          reason: "The exact current conversation supports the reply.",
          provider: "fixture:x",
          bindingRole: "DECISION_SUPPORT",
          verified: true,
          availability: "AVAILABLE",
        },
      ],
    });
    repositoryMocks.listSignalsForRun.mockResolvedValue([
      {
        signal: {
          id: "signal_1",
          source: "x",
          sourceId: "stored-1",
          canonicalUrl: "https://x.com/stored/status/1",
          title: "Stored source title",
          textExcerpt: "Stored source excerpt",
          author: { handle: "stored-author" },
          publishedAt,
          observedAt,
          language: "en",
          metrics: { likes: 29 },
          queryId: "query_1",
          provider: "fixture:x",
          providerRequestId: "request_1",
          retrievedAt: observedAt,
          cached: false,
          rawPayloadHash: "sha256:stored",
          provenance: {},
        },
        sourceRun: {},
      },
    ]);
    const service = createV1Service({ schedule: vi.fn() });

    const response = await service.getStatus({
      principal: {
        apiKeyId: "key_1",
        projectId: "project_1",
        environment: "test",
        scopes: ["next_move:read"],
      },
      id: "scan_ready",
    });

    expect(response).toMatchObject({
      id: "scan_ready",
      status: "READY",
      contract_version: "next-move-v1",
      generation_level: "brief",
      action_details: {
        action: "REPLY",
        primary_target: {
          url: "https://x.com/stored/status/1",
          author: "stored-author",
        },
      },
      freshness: { state: "CURRENT", requires_new_scan: false },
      founder_reviewed: true,
      auto_publish: false,
    });
    expect(JSON.stringify(response)).not.toMatch(
      /internal_move_uuid|signal_1|request_1|actualCost|providerCost/i,
    );
  });

  it("returns a controlled new-scan response when a READY row has no enhanced contract", async () => {
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: {
        id: "legacy_request",
        publicId: "legacy_scan",
        apiKeyId: "key_1",
        projectId: "project_1",
        state: "READY",
        createdAt: new Date(),
      },
      run: null,
      move: {
        state: "READY",
        founderReviewed: true,
        autoPublish: false,
        decisionContractVersion: null,
        actionDetails: null,
        trendWindow: null,
        breakoutPotential: null,
      },
      context: {},
      project: { id: "project_1", url: "https://example.com" },
      delivery: null,
      evidence: [],
    });
    const service = createV1Service({ schedule: vi.fn() });

    await expect(
      service.getStatus({
        principal: {
          apiKeyId: "key_1",
          projectId: "project_1",
          environment: "test",
          scopes: ["next_move:read"],
        },
        id: "legacy_scan",
      }),
    ).resolves.toEqual({
      id: "legacy_scan",
      status: "FAILED",
      error: {
        code: "NEW_SCAN_REQUIRED",
        message: "This result predates the current decision contract. Request a new scan.",
        retryable: true,
      },
    });
  });
});

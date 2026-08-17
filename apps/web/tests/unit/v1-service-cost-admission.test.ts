import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextMoveReadyResponseSchema, VersionedNextMoveSchema } from "@trendsfast/schemas";

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

const configMocks = vi.hoisted(() => ({
  env: {
    APP_URL: "https://app.example",
    PROVIDER_CREDENTIAL_MODE: "managed" as const,
    PROVIDER_CALLS_ENABLED: true,
    LIVE_API_CREATION_ENABLED: true,
    MAX_PROVIDER_COST_USD_PER_SCAN: 91.333,
    API_CREATE_RATE_LIMIT_PER_HOUR: 31,
    API_STATUS_RATE_LIMIT_PER_HOUR: 317,
  },
}));

vi.mock("@trendsfast/config", () => ({
  loadEnv: () => configMocks.env,
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
import {
  mapNextDistributionContentProposalV1,
  mapPersistedDashboardProposalV1,
} from "../../lib/next-distribution-content-proposal";

describe("v1 service cost admission wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMocks.env.PROVIDER_CALLS_ENABLED = true;
    configMocks.env.LIVE_API_CREATION_ENABLED = true;
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

  it("returns a controlled 503 before admission when provider work is disabled", async () => {
    configMocks.env.PROVIDER_CALLS_ENABLED = false;
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
    ).rejects.toMatchObject({ code: "UNAVAILABLE", status: 503 });
    expect(repositoryMocks.resolveApiIdempotency).not.toHaveBeenCalled();
    expect(repositoryMocks.admitApiRequest).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("returns a controlled 409 for an incompatible idempotency replay", async () => {
    repositoryMocks.resolveApiIdempotency.mockResolvedValue({
      idempotencyConflict: true,
      request: { publicId: "scan_prior" },
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
        request: { product_url: "https://example.com", objective: "Different input" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(repositoryMocks.admitApiRequest).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("returns controlled rate and provider-cost limits without scheduling work", async () => {
    const schedule = vi.fn();
    const service = createV1Service({ schedule });
    const request = {
      principal: {
        apiKeyId: "key_1",
        projectId: "project_1",
        environment: "live" as const,
        scopes: ["next_move:write", "next_move:read"],
      },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      request: { product_url: "https://example.com" },
    };

    repositoryMocks.usageSince.mockResolvedValueOnce({
      successfulRequests: 32,
      createRequests: 32,
      statusRequests: 0,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
    });
    await expect(service.createOrReuse(request)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });

    repositoryMocks.admitApiRequest.mockResolvedValueOnce({ status: "COST_LIMITED" });
    await expect(
      service.createOrReuse({ ...request, idempotencyKey: "22222222-2222-4222-8222-222222222222" }),
    ).rejects.toMatchObject({ code: "COST_LIMITED", status: 429 });
    expect(repositoryMocks.recordLimited).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: "key_1", outcome: "COST_LIMITED" }),
    );
    expect(schedule).not.toHaveBeenCalled();
  });

  it("returns a controlled project single-flight conflict without scheduling or charging again", async () => {
    repositoryMocks.admitApiRequest.mockResolvedValueOnce({
      status: "PROJECT_BUSY",
      request: {
        id: "request_active",
        publicId: "scan_active",
        projectId: "project_1",
        state: "RUNNING",
      },
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
        idempotencyKey: "99999999-9999-4999-8999-999999999999",
        request: { product_url: "https://example.com" },
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: expect.stringMatching(/already queued or running/i),
    });
    expect(schedule).not.toHaveBeenCalled();
    expect(repositoryMocks.appendAnalytics).not.toHaveBeenCalled();
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
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
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
        createdBy: "member:11111111-1111-4111-8111-111111111111",
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
        scopes: ["next_move:write", "next_move:read"],
      },
      projectId: "project_1",
      idempotencyKey: "5c55b81c-bd64-4bdb-b579-91017b476b7f",
      request: {},
    });

    expect(repositoryMocks.admitApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        request: {
          product_url: "https://saved.example/product",
          objective: "Choose one move.",
          market: "US",
          language: "en",
          preferred_channels: ["x", "linkedin"],
          available_formats: ["founder_text", "screen_recording"],
          content_capabilities: ["founder_text", "screen_recording"],
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
          scopes: ["next_move:write", "next_move:read"],
        },
        projectId: "project_1",
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
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

  it("never exposes status across project-key boundaries", async () => {
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: {
        id: "request_other_project",
        publicId: "scan_other_project",
        apiKeyId: "key_1",
        projectId: "project_2",
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
    const service = createV1Service({ schedule: vi.fn() });

    await expect(
      service.getStatus({
        principal: {
          apiKeyId: "key_1",
          projectId: "project_1",
          environment: "test",
          scopes: ["next_move:read"],
        },
        id: "scan_other_project",
      }),
    ).resolves.toBeNull();
    expect(repositoryMocks.isProjectEntitled).not.toHaveBeenCalled();
  });

  it("lets the exact project key read an owner-dashboard scan without weakening project isolation", async () => {
    const dashboardStatus = {
      request: {
        id: "request_dashboard",
        publicId: "scan_dashboard",
        apiKeyId: null,
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
    };
    repositoryMocks.getStatusByPublicId.mockResolvedValue(dashboardStatus);
    const service = createV1Service({ schedule: vi.fn() });
    const principal = {
      apiKeyId: "key_project_1",
      projectId: "project_1",
      environment: "test" as const,
      scopes: ["next_move:read"],
    };

    await expect(service.getStatus({ principal, id: "scan_dashboard" })).resolves.toMatchObject({
      id: "scan_dashboard",
      status: "QUEUED",
    });

    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      ...dashboardStatus,
      request: { ...dashboardStatus.request, projectId: "project_2" },
    });
    await expect(service.getStatus({ principal, id: "scan_dashboard" })).resolves.toBeNull();

    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      ...dashboardStatus,
      request: { ...dashboardStatus.request, apiKeyId: "key_other" },
    });
    await expect(service.getStatus({ principal, id: "scan_dashboard" })).resolves.toBeNull();
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
        generationLevel: "draft",
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
      generation_level: "draft",
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
    const ready = NextMoveReadyResponseSchema.parse(response);
    expect(ready.next_move.action).toBe(ready.action_details.action);
    expect(ready.evidence).toEqual([
      expect.objectContaining({
        source: "x",
        url: "https://x.com/stored/status/1",
        role: "DECISION_SUPPORT",
        verified: true,
      }),
    ]);
    const apiProjection = mapNextDistributionContentProposalV1(ready);
    if (!ready.next_move.cta) throw new Error("ready test fixture is missing its CTA");
    const dashboardProjection = mapPersistedDashboardProposalV1({
      versionedMove: VersionedNextMoveSchema.parse({
        contractVersion: ready.contract_version,
        generationLevel: ready.generation_level,
        action: ready.next_move.action,
        channel: ready.next_move.channel,
        topic: ready.next_move.topic,
        angle: ready.next_move.angle,
        format: ready.next_move.format,
        hook: ready.next_move.hook,
        outline: ready.next_move.outline,
        cta: ready.next_move.cta,
        priority: ready.next_move.priority,
        confidence: ready.next_move.confidence,
        validUntil: ready.next_move.valid_until,
        trendWindow: ready.trend_window,
        breakoutPotential: ready.breakout_potential,
        details: ready.action_details,
        ...(ready.draft_content === undefined ? {} : { draftContent: ready.draft_content }),
      }),
      whyNow: ready.why_now.summary,
      evidence: ready.evidence.map((receipt) => ({
        source: receipt.source,
        canonicalUrl: receipt.url,
        title: receipt.title ?? null,
        publishedAt: receipt.published_at ? new Date(receipt.published_at) : null,
        observedAt: new Date(receipt.observed_at),
        reason: receipt.reason,
        provider: receipt.provider,
        bindingRole: receipt.role,
        verified: receipt.verified,
        availability: receipt.availability,
      })),
      limitations: ready.limitations,
      founderReviewed: ready.founder_reviewed,
    });
    expect(apiProjection).toEqual(dashboardProjection);
    expect(apiProjection).toMatchObject({
      action: "REPLY",
      destination: "https://x.com/stored/status/1",
      content: "Separate evidence from assumptions, then show the trade-off.",
      founder_reviewed: true,
      auto_publish: false,
    });
    expect(apiProjection.evidence).toBe(ready.evidence);
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

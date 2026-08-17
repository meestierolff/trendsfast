import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  acceptsPrivateMutation: vi.fn(),
  admitWebsiteContextRead: vi.fn(),
  createOrReuseOwnedProject: vi.fn(),
  getVerifiedAuthIdentity: vi.fn(),
  resolveWebsiteOnlyContext: vi.fn(),
  saveOwnedWebsiteContext: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  getVerifiedAuthIdentity: mocks.getVerifiedAuthIdentity,
}));
vi.mock("@/lib/private-scan-api", () => ({
  acceptsPrivateMutation: mocks.acceptsPrivateMutation,
  PRIVATE_RESPONSE_HEADERS: { "cache-control": "private, no-store" },
}));
vi.mock("@/lib/server-database", () => ({
  getMemberRepositories: () => ({
    members: {
      createOrReuseOwnedProject: mocks.createOrReuseOwnedProject,
      saveOwnedWebsiteContext: mocks.saveOwnedWebsiteContext,
    },
  }),
  getPublicRepositories: () => ({
    authAdmission: { admit: mocks.admitWebsiteContextRead },
  }),
}));
vi.mock("@/lib/website-context-service", () => ({
  resolveWebsiteOnlyContext: mocks.resolveWebsiteOnlyContext,
  WebsiteContextResolutionError: class WebsiteContextResolutionError extends Error {},
}));

import { POST } from "../../app/api/dashboard/projects/route";
import {
  MemberProjectEntryAdmissionError,
  ProjectOwnershipConflictError,
} from "@trendsfast/database";

const authUserId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";

function request(body: Record<string, unknown>) {
  return new Request("https://trendsfast.com/api/dashboard/projects", {
    method: "POST",
    headers: { origin: "https://trendsfast.com", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("authenticated project entry route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptsPrivateMutation.mockReturnValue(true);
    mocks.admitWebsiteContextRead.mockResolvedValue(true);
    mocks.getVerifiedAuthIdentity.mockResolvedValue({
      authUserId,
      email: "founder@example.com",
      projectEntryEligible: true,
    });
  });

  it("requires an authenticated identity before project creation", async () => {
    mocks.getVerifiedAuthIdentity.mockResolvedValue(null);
    const response = await POST(request({ product_url: "https://example.com" }));

    expect(response.status).toBe(401);
    expect(mocks.createOrReuseOwnedProject).not.toHaveBeenCalled();
  });

  it("creates ownership, resolves only website context, and requires confirmation", async () => {
    mocks.createOrReuseOwnedProject.mockResolvedValue({
      created: true,
      project: {
        id: projectId,
        url: "https://example.com/",
        normalizedUrl: "https://example.com/",
      },
      contextVersion: null,
    });
    mocks.resolveWebsiteOnlyContext.mockResolvedValue({
      context: { name: "Example" },
      profile: {
        entityType: "PRODUCT",
        contextProvenance: { observed_facts: [], inferred_context: [], assumptions: [] },
        voiceProfile: {
          traits: [],
          preferred_phrases: [],
          avoid_phrases: [],
          sample_texts: [],
          sample_urls: [],
        },
        contentCapabilities: {},
      },
      sourceContentHash: "a".repeat(64),
      observedPageCount: 2,
    });
    mocks.saveOwnedWebsiteContext.mockResolvedValue({
      contextVersion: { createdBy: "system:website-context" },
    });

    const response = await POST(request({ product_url: "https://example.com" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      projectId,
      contextStatus: "CONFIRMATION_REQUIRED",
      destination: `/dashboard/projects?project=${projectId}&confirm=1`,
    });
    expect(mocks.resolveWebsiteOnlyContext).toHaveBeenCalledWith("https://example.com/");
    expect(mocks.admitWebsiteContextRead).toHaveBeenCalledTimes(2);
    expect(mocks.admitWebsiteContextRead).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        namespace: "member-website-url-v1",
        maxAttemptsPerFingerprint: 3,
      }),
    );
    expect(mocks.admitWebsiteContextRead).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        namespace: "member-website-user-v1",
        maxAttemptsPerFingerprint: 3,
      }),
    );
    expect(mocks.saveOwnedWebsiteContext).toHaveBeenCalledWith(
      expect.objectContaining({ authUserId, projectId, sourceContentHash: "a".repeat(64) }),
    );
  });

  it("reuses saved context without re-reading the website", async () => {
    mocks.createOrReuseOwnedProject.mockResolvedValue({
      created: false,
      project: {
        id: projectId,
        url: "https://example.com/",
        normalizedUrl: "https://example.com/",
      },
      contextVersion: { createdBy: `member:${authUserId}` },
    });

    const response = await POST(request({ product_url: "https://example.com" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ contextStatus: "CONFIRMED" });
    expect(mocks.resolveWebsiteOnlyContext).not.toHaveBeenCalled();
  });

  it("denies a duplicate website crawl through the durable admission boundary", async () => {
    mocks.createOrReuseOwnedProject.mockResolvedValue({
      created: false,
      project: {
        id: projectId,
        url: "https://example.com/",
        normalizedUrl: "https://example.com/",
      },
      contextVersion: null,
    });
    mocks.admitWebsiteContextRead.mockResolvedValueOnce(false);

    const response = await POST(request({ product_url: "https://example.com" }));

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/read limit has been reached/i),
    });
    expect(mocks.resolveWebsiteOnlyContext).not.toHaveBeenCalled();
    expect(mocks.saveOwnedWebsiteContext).not.toHaveBeenCalled();
  });

  it("permits one durably admitted context read after an owned URL change", async () => {
    mocks.createOrReuseOwnedProject.mockResolvedValue({
      created: false,
      project: {
        id: projectId,
        url: "https://changed.example/",
        normalizedUrl: "https://changed.example/",
      },
      contextVersion: null,
    });
    mocks.resolveWebsiteOnlyContext.mockResolvedValue({
      context: { name: "Changed" },
      profile: {
        entityType: "PRODUCT",
        contextProvenance: { observed_facts: [], inferred_context: [], assumptions: [] },
        voiceProfile: {
          traits: [],
          preferred_phrases: [],
          avoid_phrases: [],
          sample_texts: [],
          sample_urls: [],
        },
        contentCapabilities: {},
      },
      sourceContentHash: "b".repeat(64),
      observedPageCount: 1,
    });
    mocks.saveOwnedWebsiteContext.mockResolvedValue({
      contextVersion: { createdBy: "system:website-context" },
    });

    const response = await POST(request({ product_url: "https://changed.example" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reused: true,
      contextStatus: "CONFIRMATION_REQUIRED",
    });
    expect(mocks.resolveWebsiteOnlyContext).toHaveBeenCalledOnce();
    expect(mocks.saveOwnedWebsiteContext).toHaveBeenCalledOnce();
  });

  it("allows one bounded retry when a transient read fails before context is saved", async () => {
    mocks.createOrReuseOwnedProject
      .mockResolvedValueOnce({
        created: true,
        project: {
          id: projectId,
          url: "https://retry.example/",
          normalizedUrl: "https://retry.example/",
        },
        contextVersion: null,
      })
      .mockResolvedValueOnce({
        created: false,
        project: {
          id: projectId,
          url: "https://retry.example/",
          normalizedUrl: "https://retry.example/",
        },
        contextVersion: null,
      });
    mocks.resolveWebsiteOnlyContext
      .mockRejectedValueOnce(new Error("transient upstream failure"))
      .mockResolvedValueOnce({
        context: { name: "Retry" },
        profile: {
          entityType: "PRODUCT",
          contextProvenance: { observed_facts: [], inferred_context: [], assumptions: [] },
          voiceProfile: {
            traits: [],
            preferred_phrases: [],
            avoid_phrases: [],
            sample_texts: [],
            sample_urls: [],
          },
          contentCapabilities: {},
        },
        sourceContentHash: "c".repeat(64),
        observedPageCount: 1,
      });
    mocks.saveOwnedWebsiteContext.mockResolvedValue({
      contextVersion: { createdBy: "system:website-context" },
    });

    const first = await POST(request({ product_url: "https://retry.example" }));
    expect(first.status).toBe(500);
    const second = await POST(request({ product_url: "https://retry.example" }));
    expect(second.status).toBe(200);
    expect(mocks.resolveWebsiteOnlyContext).toHaveBeenCalledTimes(2);
    expect(mocks.saveOwnedWebsiteContext).toHaveBeenCalledOnce();
  });

  it("rejects ineligible, daily-limited, and capacity-limited entry before any crawl", async () => {
    mocks.createOrReuseOwnedProject.mockRejectedValueOnce(
      new MemberProjectEntryAdmissionError("DESIGN_PARTNER_REQUIRED"),
    );
    const ineligible = await POST(request({ product_url: "https://ineligible.example" }));
    expect(ineligible.status).toBe(403);

    mocks.createOrReuseOwnedProject.mockRejectedValueOnce(
      new MemberProjectEntryAdmissionError("DAILY_LIMIT", 731),
    );
    const daily = await POST(request({ product_url: "https://daily.example" }));
    expect(daily.status).toBe(429);
    expect(daily.headers.get("retry-after")).toBe("731");

    mocks.createOrReuseOwnedProject.mockRejectedValueOnce(
      new MemberProjectEntryAdmissionError("TOTAL_CAPACITY"),
    );
    const capacity = await POST(request({ product_url: "https://capacity.example" }));
    expect(capacity.status).toBe(409);

    expect(mocks.resolveWebsiteOnlyContext).not.toHaveBeenCalled();
    expect(mocks.saveOwnedWebsiteContext).not.toHaveBeenCalled();
  });

  it("does not claim a URL outside the authenticated ownership boundary", async () => {
    mocks.createOrReuseOwnedProject.mockRejectedValue(new ProjectOwnershipConflictError());

    const response = await POST(request({ product_url: "https://example.com" }));

    expect(response.status).toBe(409);
    expect(mocks.resolveWebsiteOnlyContext).not.toHaveBeenCalled();
  });
});

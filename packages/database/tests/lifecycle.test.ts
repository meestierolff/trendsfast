import { describe, expect, it } from "vitest";

import {
  assertScanStateTransition,
  decideScanClaim,
  ScanRepository,
  isScanStateTransitionAllowed,
  isSameIdempotentRequest,
  sanitizeAnalyticsAttribution,
  sanitizeAnalyticsEventProperties,
  sanitizeProcessingFailure,
  sanitizeProviderPayloadFragment,
  sanitizeAnalyticsProperties,
} from "../src/index";

describe("scan lifecycle", () => {
  it("permits resumable forward progress and a bounded retry", () => {
    expect(isScanStateTransitionAllowed("QUEUED", "RUNNING")).toBe(true);
    expect(isScanStateTransitionAllowed("RUNNING", "REVIEW_REQUIRED")).toBe(true);
    expect(isScanStateTransitionAllowed("REVIEW_REQUIRED", "READY")).toBe(true);
    expect(isScanStateTransitionAllowed("FAILED", "QUEUED")).toBe(true);
    expect(isScanStateTransitionAllowed("READY", "RUNNING")).toBe(false);
    expect(() => assertScanStateTransition("READY", "RUNNING")).toThrow(
      "Invalid scan state transition",
    );
    expect(typeof ScanRepository.prototype.claimForProcessing).toBe("function");
    expect(typeof ScanRepository.prototype.requeueFailed).toBe("function");
    expect(typeof ScanRepository.prototype.requireReview).toBe("function");
    expect(typeof ScanRepository.prototype.failProcessing).toBe("function");
    expect(typeof ScanRepository.prototype.resolveApiIdempotency).toBe("function");
    const now = new Date("2026-08-11T12:00:00.000Z");
    expect(
      decideScanClaim(
        "RUNNING",
        {
          state: "RUNNING",
          hardDeadlineAt: new Date("2026-08-11T12:01:00.000Z"),
        },
        now,
      ),
    ).toBe("ALREADY_CLAIMED");
    expect(
      decideScanClaim(
        "RUNNING",
        {
          state: "RUNNING",
          hardDeadlineAt: new Date("2026-08-11T11:59:00.000Z"),
        },
        now,
      ),
    ).toBe("RESUME_RUN");
    expect(decideScanClaim("FAILED", null, now)).toBe("NOT_CLAIMABLE");
    expect(decideScanClaim("QUEUED", null, now)).toBe("CLAIM_NEW_RUN");
  });

  it("redacts raw credentials from persisted lifecycle failures", () => {
    const failure = sanitizeProcessingFailure(
      "PROVIDER_FAILED",
      "Authorization: Bearer provider-secret; tf_live_prefix.raw-secret",
    );
    expect(failure.code).toBe("PROVIDER_FAILED");
    expect(failure.message).not.toContain("provider-secret");
    expect(failure.message).not.toContain("raw-secret");
  });

  it("distinguishes semantic idempotency repeats from payload conflicts", () => {
    const stored = {
      requestPayloadHash: null,
      submittedUrl: "https://example.com/?a=1&b=2",
      goal: "qualified_signups",
      market: "US",
      language: "en",
      preferredChannels: ["x", "linkedin"],
      availableFormats: ["founder_text"],
      generationLevel: "brief" as const,
      requestedContentCapabilities: null,
    };
    expect(
      isSameIdempotentRequest(stored, {
        product_url: "https://EXAMPLE.com/?a=1&b=2#ignored",
        goal: "qualified_signups",
        market: "US",
        language: "en",
        preferred_channels: ["x", "linkedin"],
        available_formats: ["founder_text"],
      }),
    ).toBe(true);
    expect(
      isSameIdempotentRequest(stored, {
        product_url: "https://example.com/?a=1&b=2",
        goal: "awareness",
        market: "US",
        language: "en",
        preferred_channels: ["x", "linkedin"],
        available_formats: ["founder_text"],
      }),
    ).toBe(false);
  });

  it("drops forbidden analytics fields instead of leaking private data", () => {
    expect(
      sanitizeAnalyticsProperties({
        source: "github_readme",
        campaign: "alpha",
        email: "private@example.com",
        api_key: "tf_live_prefix.secret",
        evidence_text: "private evidence",
        product_url: "https://example.com/private?secret=yes",
        provider_cost_usd: 0.317,
        margin_eur: "must-not-persist",
        revenue: 123.456,
      }),
    ).toEqual({ source: "github_readme", campaign: "alpha" });
    expect(
      sanitizeAnalyticsAttribution({
        landing_path: "/scan/private?token=secret",
        source: "reddit",
        api_key: "tf_live_prefix.secret",
      }),
    ).toEqual({ landing_path: "/other", source: "reddit" });
    expect(
      sanitizeAnalyticsAttribution({
        first_landing: "/scan/scan_this-private-capability-must-never-persist",
      }),
    ).toEqual({ first_landing: "/other" });
    expect(
      sanitizeAnalyticsEventProperties("hero_cta_clicked", {
        placement: "homepage_hero",
        campaign: "arbitrary",
        email: "private@example.com",
      }),
    ).toEqual({ placement: "homepage_hero" });
    expect(
      sanitizeAnalyticsEventProperties("scan_review_required", {
        state: "REVIEW_REQUIRED",
        credentialMode: "managed",
        costUsd: 0.317,
        providerCostUsd: 0.113,
        marginUsd: "must-not-persist",
        revenueEur: 123.456,
      }),
    ).toEqual({ state: "REVIEW_REQUIRED", credentialMode: "managed" });
  });

  it("redacts and bounds persisted provider fragments", () => {
    expect(
      sanitizeProviderPayloadFragment({
        request_id: "safe-id",
        api_key: "provider-secret",
      }),
    ).toEqual({ request_id: "safe-id", api_key: "[REDACTED]" });
    expect(() => sanitizeProviderPayloadFragment({ data: "x".repeat(1_000) }, 100)).toThrow(
      "storage limit",
    );
  });
});

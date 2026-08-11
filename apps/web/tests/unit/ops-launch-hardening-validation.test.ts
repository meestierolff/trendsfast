import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ApiKeyIssueBodySchema,
  ApiKeyReplacementBodySchema,
  parseBoundedFutureExpiry,
} from "../../app/api/ops/api-keys/_validation";
import { ManualEvidenceBodySchema } from "../../app/api/ops/scans/[scanId]/manual-evidence/_validation";
import { ProviderVerificationBodySchema } from "../../app/api/ops/providers/[provider]/verify/_validation";

describe("launch-hardening ops validation", () => {
  it("requires a project, bounded controls, known scopes, and expiry", () => {
    const valid = {
      projectId: "00000000-0000-4000-8000-000000000001",
      name: "Founder agent",
      environment: "test",
      scopes: ["next_move:read", "next_move:write"],
      rateLimitPerHour: 20,
      providerCostLimitUsd: 5,
      expiresAt: "2026-09-11T12:00:00.000Z",
    };
    expect(ApiKeyIssueBodySchema.safeParse(valid).success).toBe(true);
    expect(ApiKeyIssueBodySchema.safeParse({ ...valid, projectId: undefined }).success).toBe(false);
    expect(ApiKeyIssueBodySchema.safeParse({ ...valid, scopes: ["admin"] }).success).toBe(false);
    expect(ApiKeyIssueBodySchema.safeParse({ ...valid, rateLimitPerHour: 0 }).success).toBe(false);
  });

  it("bounds replacement expiry against a trusted current time", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    expect(parseBoundedFutureExpiry("2026-08-12T12:00:00.000Z", now)).toBeInstanceOf(Date);
    expect(parseBoundedFutureExpiry("2026-08-11T12:01:00.000Z", now)).toBeNull();
    expect(ApiKeyReplacementBodySchema.safeParse({ unknown: true }).success).toBe(false);
  });

  it("strictly bounds manual evidence and provider verification inputs", () => {
    expect(
      ManualEvidenceBodySchema.safeParse({
        url: "https://example.com/original",
        sourceLabel: "Founder observation",
        title: "Original public post",
        reason: "This is relevant enough to retain as supplemental context.",
      }).success,
    ).toBe(true);
    expect(
      ManualEvidenceBodySchema.safeParse({
        url: "https://example.com/original",
        sourceLabel: "Founder observation",
        title: "Original public post",
        reason: "too short",
        injected: true,
      }).success,
    ).toBe(false);
    expect(
      ProviderVerificationBodySchema.safeParse({ query: "founder distribution", extra: true })
        .success,
    ).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  analyticsDedupeKey,
  derivePrivacyHash,
  parsePublicAnalyticsBody,
  publicRequestFingerprint,
  recordPublicBrowserAnalytics,
  strictSameOrigin,
} from "../../lib/first-party-analytics";

const secret = "first-party-analytics-test-secret-at-least-32-characters";

describe("first-party analytics privacy contract", () => {
  it("accepts only the bounded browser event and placement pairs", () => {
    expect(
      parsePublicAnalyticsBody({ event: "hero_cta_clicked", placement: "homepage_hero" }),
    ).toEqual({ event: "hero_cta_clicked", placement: "homepage_hero" });
    expect(parsePublicAnalyticsBody({ event: "scan_delivered", placement: "homepage" })).toBeNull();
    expect(
      parsePublicAnalyticsBody({
        event: "landing_viewed",
        placement: "homepage",
        token: "private-token",
      }),
    ).toBeNull();
    expect(
      parsePublicAnalyticsBody({ event: "docs_viewed", placement: "made-up", note: "free text" }),
    ).toBeNull();
  });

  it("requires an explicit matching browser origin", () => {
    const accepted = new Request("https://trendsfast.test/api/analytics/events", {
      headers: { origin: "https://trendsfast.test", "sec-fetch-site": "same-origin" },
    });
    const absent = new Request("https://trendsfast.test/api/analytics/events");
    const crossSite = new Request("https://trendsfast.test/api/analytics/events", {
      headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
    });

    expect(strictSameOrigin(accepted, "https://trendsfast.test")).toBe(true);
    expect(strictSameOrigin(absent, "https://trendsfast.test")).toBe(false);
    expect(strictSameOrigin(crossSite, "https://trendsfast.test")).toBe(false);
  });

  it("uses domain-separated HMACs and never returns the raw fingerprint material", () => {
    const request = new Request("https://trendsfast.test", {
      headers: {
        "user-agent": "Private browser detail",
        "x-forwarded-for": "203.0.113.44",
      },
    });
    const fingerprint = publicRequestFingerprint(request.headers, secret);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("203.0.113.44");
    expect(derivePrivacyHash(secret, "analytics-session:v1", "same-value")).not.toBe(
      derivePrivacyHash(secret, "founder-launch-email:v1", "same-value"),
    );
  });

  it("deduplicates one event per session, entity scope, and fixed time window", () => {
    const sessionHash = derivePrivacyHash(secret, "analytics-session:v1", "session");
    const first = analyticsDedupeKey({
      secret,
      sessionHash,
      event: "scan_status_viewed",
      entityScope: "scan:7f67cbbc",
      now: new Date("2026-08-11T10:05:00.000Z"),
      windowMs: 24 * 60 * 60 * 1_000,
    });
    const sameWindow = analyticsDedupeKey({
      secret,
      sessionHash,
      event: "scan_status_viewed",
      entityScope: "scan:7f67cbbc",
      now: new Date("2026-08-11T19:55:00.000Z"),
      windowMs: 24 * 60 * 60 * 1_000,
    });
    const otherScan = analyticsDedupeKey({
      secret,
      sessionHash,
      event: "scan_status_viewed",
      entityScope: "scan:other",
      now: new Date("2026-08-11T19:55:00.000Z"),
      windowMs: 24 * 60 * 60 * 1_000,
    });

    expect(first).toBe(sameWindow);
    expect(first).not.toBe(otherScan);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("admits and appends only HMAC identity plus server-validated dimensions", async () => {
    const admit = vi.fn().mockResolvedValue(true);
    const appendOnce = vi.fn().mockResolvedValue({ created: true });
    const request = new Request("https://trendsfast.test/api/analytics/events", {
      method: "POST",
      headers: {
        cookie: "tf_analytics_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "user-agent": "Private browser detail",
        "x-forwarded-for": "203.0.113.44",
      },
    });

    await recordPublicBrowserAnalytics(
      request,
      { event: "docs_viewed", placement: "docs" },
      {
        secret,
        admission: { admit },
        analytics: { appendOnce },
        now: new Date("2026-08-11T12:00:00.000Z"),
      },
    );

    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "public-analytics-v1",
        fingerprintHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(appendOnce).toHaveBeenCalledWith({
      name: "docs_viewed",
      anonymousSessionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      properties: { placement: "docs" },
      occurredAt: new Date("2026-08-11T12:00:00.000Z"),
    });
    const persisted = JSON.stringify(appendOnce.mock.calls);
    expect(persisted).not.toContain("203.0.113.44");
    expect(persisted).not.toContain("Private browser detail");
  });
});

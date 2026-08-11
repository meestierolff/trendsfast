import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { admit, appendOnce, createInterest, getRepositories } = vi.hoisted(() => {
  const admit = vi.fn().mockResolvedValue(true);
  const appendOnce = vi.fn().mockResolvedValue({ created: true });
  const createInterest = vi.fn().mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000014",
    created: true,
  });
  return {
    admit,
    appendOnce,
    createInterest,
    getRepositories: vi.fn(() => ({
      analytics: { appendOnce },
      authAdmission: { admit },
      founderLaunchInterests: { create: createInterest },
    })),
  };
});

vi.mock("../../lib/server-database", () => ({ getRepositories }));

import { POST as postAnalytics } from "../../app/api/analytics/events/route";
import { POST as postLaunchInterest } from "../../app/api/founder-launch-interest/route";

const origin = "https://trendsfast.test";
const secret = "public-analytics-route-test-secret-at-least-32-characters";

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.14",
      "user-agent": "private browser detail",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("SESSION_SECRET", secret);
  admit.mockReset().mockResolvedValue(true);
  appendOnce.mockReset().mockResolvedValue({ created: true });
  createInterest.mockReset().mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000014",
    created: true,
  });
  getRepositories.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("bounded public analytics route", () => {
  it("stores only allowlisted dimensions behind durable admission and an HttpOnly session", async () => {
    const response = await postAnalytics(
      request("/api/analytics/events", {
        event: "hero_cta_clicked",
        placement: "homepage_hero",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(
      /^tf_analytics_session=[A-Za-z0-9_-]+; Path=\/; Max-Age=1800; HttpOnly; SameSite=Lax; Secure$/,
    );
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "public-analytics-v1" }),
    );
    expect(appendOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "hero_cta_clicked",
        anonymousSessionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        properties: { placement: "homepage_hero" },
      }),
    );
    const persisted = JSON.stringify(appendOnce.mock.calls);
    expect(persisted).not.toContain("203.0.113.14");
    expect(persisted).not.toContain("private browser detail");
  });

  it("rejects cross-site, extra-field, and actual oversized requests before persistence", async () => {
    expect(
      (
        await postAnalytics(
          request(
            "/api/analytics/events",
            { event: "landing_viewed", placement: "homepage" },
            { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await postAnalytics(
          request("/api/analytics/events", {
            event: "landing_viewed",
            placement: "homepage",
            token: "private-token",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await postAnalytics(
          request("/api/analytics/events", {
            event: "landing_viewed",
            placement: "homepage",
            padding: "x".repeat(1_000),
          }),
        )
      ).status,
    ).toBe(413);
    expect(getRepositories).not.toHaveBeenCalled();
  });
});

describe("functional Founder launch-interest route", () => {
  it("persists consent before success and never returns or analyzes the email", async () => {
    const response = await postLaunchInterest(
      request("/api/founder-launch-interest", {
        email: "Founder@Example.com",
        consent: true,
        source: "pricing",
        website: "",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ joined: true });
    expect(JSON.stringify(payload)).not.toContain("Founder@Example.com");
    expect(createInterest).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedEmail: "founder@example.com",
        emailHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(appendOnce.mock.calls)).not.toContain("founder@example.com");
  });

  it("returns no fake success when durable admission or storage fails", async () => {
    admit.mockResolvedValueOnce(false);
    const limited = await postLaunchInterest(
      request("/api/founder-launch-interest", {
        email: "founder@example.com",
        consent: true,
        source: "homepage",
        website: "",
      }),
    );
    expect(limited.status).toBe(429);
    expect(createInterest).not.toHaveBeenCalled();

    createInterest.mockRejectedValueOnce(new Error("database unavailable"));
    const unavailable = await postLaunchInterest(
      request("/api/founder-launch-interest", {
        email: "founder@example.com",
        consent: true,
        source: "homepage",
        website: "",
      }),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).not.toHaveProperty("joined", true);
  });
});

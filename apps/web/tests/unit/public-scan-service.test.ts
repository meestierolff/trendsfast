import { describe, expect, it, vi } from "vitest";
import {
  acceptPublicScan,
  isSameOrigin,
  publicScanCredentialModeAvailable,
  PublicScanError,
  type PublicScanRepository,
} from "../../lib/public-scan-service";

function repository(overrides: Partial<PublicScanRepository> = {}): PublicScanRepository {
  return {
    admitPublicRequest: vi.fn(async () => ({
      status: "CREATED" as const,
      scanRequestId: "request_1",
      publicToken: "scan_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    })),
    ...overrides,
  };
}

const globalPolicy = {
  globalDailyLimit: 23,
  globalDailyBudgetUsd: 7.25,
  costReservationUsd: 0.317,
} as const;

describe("public scan acceptance", () => {
  it("fails closed for fixture mode on every non-loopback public origin", () => {
    expect(publicScanCredentialModeAvailable("fixture", "https://trendsfast.com")).toBe(false);
    expect(publicScanCredentialModeAvailable("fixture", "https://preview.vercel.app")).toBe(false);
    expect(publicScanCredentialModeAvailable("fixture", "http://localhost:3000")).toBe(true);
    expect(publicScanCredentialModeAvailable("fixture", "http://127.0.0.1:3000")).toBe(true);
    expect(publicScanCredentialModeAvailable("fixture", "http://[::1]:3000")).toBe(true);
    expect(
      publicScanCredentialModeAvailable("fixture", "https://localhost:3000", "production"),
    ).toBe(false);
    expect(publicScanCredentialModeAvailable("fixture", "https://127.0.0.1:3000", "preview")).toBe(
      false,
    );
    expect(
      publicScanCredentialModeAvailable("fixture", "https://localhost:3000", undefined, true),
    ).toBe(false);
    expect(publicScanCredentialModeAvailable("managed", "https://trendsfast.com")).toBe(false);
    expect(publicScanCredentialModeAvailable("byok", "https://trendsfast.com")).toBe(false);
    expect(
      publicScanCredentialModeAvailable(
        "managed",
        "https://trendsfast.com",
        "production",
        true,
        true,
      ),
    ).toBe(true);
  });

  it("stores only a keyed requester hash and creates an unguessable token", async () => {
    const repo = repository();
    const accepted = await acceptPublicScan(
      { productUrl: "https://example.com", address: "203.0.113.10" },
      {
        repository: repo,
        fingerprintPepper: "pepper-pepper-pepper-pepper-pepper",
        anonymousSessionHash: "a".repeat(64),
        dailyLimit: 31,
        ...globalPolicy,
      },
    );
    expect(accepted.token).toMatch(/^scan_[A-Za-z0-9_-]{43}$/);
    expect(repo.admitPublicRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedUrl: "https://example.com/",
        anonymousSessionHash: "a".repeat(64),
      }),
    );
    expect(JSON.stringify(vi.mocked(repo.admitPublicRequest).mock.calls)).not.toContain(
      "203.0.113.10",
    );
  });

  it("reuses a recent duplicate without duplicating delivery", async () => {
    const repo = repository({
      admitPublicRequest: vi.fn(async () => ({
        status: "REUSED" as const,
        scanRequestId: "request_1",
        publicToken: "scan_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      })),
    });
    const accepted = await acceptPublicScan(
      { productUrl: "https://example.com", address: "203.0.113.10" },
      {
        repository: repo,
        fingerprintPepper: "pepper-pepper-pepper-pepper-pepper",
        dailyLimit: 31,
        ...globalPolicy,
      },
    );
    expect(accepted.reused).toBe(true);
  });

  it("routes an existing product to its authenticated owner instead of starting a public refresh", async () => {
    await expect(
      acceptPublicScan(
        { productUrl: "https://claimed.example", address: "203.0.113.10" },
        {
          repository: repository({
            admitPublicRequest: vi.fn(async () => ({
              status: "PROJECT_ALREADY_EXISTS" as const,
            })),
          }),
          fingerprintPepper: "pepper-pepper-pepper-pepper-pepper",
          dailyLimit: 31,
          ...globalPolicy,
        },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ALREADY_EXISTS", status: 409 });
  });

  it("rejects honeypot and rate-limit abuse", async () => {
    await expect(
      acceptPublicScan(
        { productUrl: "https://example.com", address: "203.0.113.10", honeypot: "bot" },
        {
          repository: repository(),
          fingerprintPepper: "pepper-pepper-pepper-pepper-pepper",
          dailyLimit: 31,
          ...globalPolicy,
        },
      ),
    ).rejects.toMatchObject({ code: "ABUSE_REJECTED" });

    await expect(
      acceptPublicScan(
        { productUrl: "https://example.com", address: "203.0.113.10" },
        {
          repository: repository({
            admitPublicRequest: vi.fn(async () => ({ status: "RATE_LIMITED" as const })),
          }),
          fingerprintPepper: "pepper-pepper-pepper-pepper-pepper",
          dailyLimit: 31,
          ...globalPolicy,
        },
      ),
    ).rejects.toBeInstanceOf(PublicScanError);
  });

  it("rejects an invalid URL before redeeming a one-time Turnstile token", async () => {
    const verify = vi.fn(async () => true);
    await expect(
      acceptPublicScan(
        { productUrl: "not-a-public-url", address: "203.0.113.10", turnstileToken: "one-time" },
        {
          repository: repository(),
          fingerprintPepper: "pepper-pepper-pepper-pepper-pepper",
          dailyLimit: 31,
          turnstile: { verify },
          ...globalPolicy,
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_URL" });
    expect(verify).not.toHaveBeenCalled();
  });

  it.each(["GLOBAL_CAPACITY_REACHED", "GLOBAL_BUDGET_REACHED"] as const)(
    "returns the stable founder-capacity error for %s",
    async (status) => {
      await expect(
        acceptPublicScan(
          { productUrl: "https://example.com", address: "203.0.113.10" },
          {
            repository: repository({
              admitPublicRequest: vi.fn(async () => ({ status })),
            }),
            fingerprintPepper: "pepper-pepper-pepper-pepper-pepper",
            dailyLimit: 3,
            now: new Date("2026-08-12T12:00:00.000Z"),
            ...globalPolicy,
          },
        ),
      ).rejects.toMatchObject({
        code: "TODAYS_FOUNDER_REVIEW_CAPACITY_REACHED",
        message: "Today's free founder-reviewed scan slots are full.",
        status: 429,
        retryAfterSeconds: 43_200,
      });
    },
  );
});

describe("browser mutation origin boundary", () => {
  const appUrl = "https://trendsfast.com";

  it("accepts an explicit matching tuple Origin and rejects a mismatch", () => {
    expect(
      isSameOrigin(
        new Request(`${appUrl}/auth/magic-link`, {
          method: "POST",
          headers: { origin: appUrl, "sec-fetch-site": "same-origin" },
        }),
        appUrl,
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request(`${appUrl}/auth/magic-link`, {
          method: "POST",
          headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
        }),
        appUrl,
      ),
    ).toBe(false);
  });

  it("keeps opaque and malformed Origin values fail-closed", () => {
    for (const origin of ["null", "not-an-origin"]) {
      expect(
        isSameOrigin(
          new Request(`${appUrl}/auth/magic-link`, {
            method: "POST",
            headers: { origin, "sec-fetch-site": "same-origin" },
          }),
          appUrl,
        ),
      ).toBe(false);
    }
  });

  it("uses Fetch Metadata only when Origin is absent", () => {
    expect(
      isSameOrigin(
        new Request(`${appUrl}/auth/magic-link`, {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin" },
        }),
        appUrl,
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request(`${appUrl}/auth/magic-link`, {
          method: "POST",
          headers: { "sec-fetch-site": "cross-site" },
        }),
        appUrl,
      ),
    ).toBe(false);
  });
});

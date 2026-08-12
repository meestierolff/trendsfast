import { describe, expect, it, vi } from "vitest";
import {
  acceptPublicScan,
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
  globalDailyLimit: 20,
  globalDailyBudgetUsd: 5,
  costReservationUsd: 0.25,
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
    expect(publicScanCredentialModeAvailable("managed", "https://trendsfast.com")).toBe(true);
    expect(publicScanCredentialModeAvailable("byok", "https://trendsfast.com")).toBe(true);
  });

  it("stores only a keyed requester hash and creates an unguessable token", async () => {
    const repo = repository();
    const accepted = await acceptPublicScan(
      { productUrl: "https://example.com", address: "203.0.113.10" },
      {
        repository: repo,
        fingerprintPepper: "pepper-pepper-pepper-pepper-pepper",
        anonymousSessionHash: "a".repeat(64),
        dailyLimit: 20,
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
        dailyLimit: 20,
        ...globalPolicy,
      },
    );
    expect(accepted.reused).toBe(true);
  });

  it("rejects honeypot and rate-limit abuse", async () => {
    await expect(
      acceptPublicScan(
        { productUrl: "https://example.com", address: "203.0.113.10", honeypot: "bot" },
        {
          repository: repository(),
          fingerprintPepper: "pepper-pepper-pepper-pepper-pepper",
          dailyLimit: 20,
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
          dailyLimit: 20,
          ...globalPolicy,
        },
      ),
    ).rejects.toBeInstanceOf(PublicScanError);
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
            dailyLimit: 1,
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

import { describe, expect, it, vi } from "vitest";
import {
  acceptPublicScan,
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

describe("public scan acceptance", () => {
  it("stores only a keyed requester hash and creates an unguessable token", async () => {
    const repo = repository();
    const accepted = await acceptPublicScan(
      { productUrl: "https://example.com", address: "203.0.113.10" },
      { repository: repo, fingerprintPepper: "pepper-pepper-pepper-pepper-pepper", dailyLimit: 20 },
    );
    expect(accepted.token).toMatch(/^scan_[A-Za-z0-9_-]{43}$/);
    expect(repo.admitPublicRequest).toHaveBeenCalledWith(
      expect.objectContaining({ normalizedUrl: "https://example.com/" }),
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
      { repository: repo, fingerprintPepper: "pepper-pepper-pepper-pepper-pepper", dailyLimit: 20 },
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
        },
      ),
    ).rejects.toBeInstanceOf(PublicScanError);
  });
});

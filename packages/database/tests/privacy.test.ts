import { describe, expect, it, vi } from "vitest";

import { PrivacyRepository, retentionCutoff } from "../src/index";

describe("retention and deletion contract", () => {
  it("computes an exact UTC retention cutoff", () => {
    expect(retentionCutoff(new Date("2026-08-11T12:00:00.000Z"), 30).toISOString()).toBe(
      "2026-07-12T12:00:00.000Z",
    );
  });

  it("rejects unsafe retention ranges", () => {
    expect(() => retentionCutoff(new Date(), 0)).toThrow();
    expect(() => retentionCutoff(new Date(), 366)).toThrow();
    expect(() => retentionCutoff(new Date("invalid"), 30)).toThrow();
  });

  it("exports executable exact-target and expiry operations", () => {
    expect(typeof PrivacyRepository.prototype.deleteProjectData).toBe("function");
    expect(typeof PrivacyRepository.prototype.purgeManaged).toBe("function");
    expect(typeof PrivacyRepository.prototype.purgeExpired).toBe("function");
  });

  it("maps only the aggregate result from the revision-fenced managed purge", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          retention_cutoff: "2026-07-12T12:00:00.000Z",
          deleted_scan_requests: "2",
          deleted_delivery_tokens: "3",
          deleted_analytics_events: "5",
          deleted_founder_launch_interests: "7",
          remaining_expired_founder_launch_interests: "0",
          deleted_orphan_projects: "11",
        },
      ],
    });
    const repository = new PrivacyRepository({ execute } as never);

    await expect(repository.purgeManaged("r".repeat(32))).resolves.toEqual({
      cutoff: new Date("2026-07-12T12:00:00.000Z"),
      deletedScanRequests: 2,
      deletedDeliveryTokens: 3,
      deletedAnalyticsEvents: 5,
      deletedFounderLaunchInterests: 7,
      remainingExpiredFounderLaunchInterests: 0,
      deletedOrphanProjects: 11,
    });
    await expect(repository.purgeManaged("invalid")).rejects.toThrow(
      "Managed runtime policy revision is invalid",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

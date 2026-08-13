import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { appendOnce, getRepositories, getStatusByPublicId } = vi.hoisted(() => {
  const appendOnce = vi.fn().mockResolvedValue({ created: true });
  const getStatusByPublicId = vi.fn().mockResolvedValue({
    request: {
      id: "00000000-0000-4000-8000-000000000021",
      state: "QUEUED",
      submittedUrl: "https://private-product.example/secret",
      submittedAt: new Date("2026-08-11T10:00:00.000Z"),
      failureCode: null,
    },
    run: null,
    move: null,
    context: null,
    project: null,
    delivery: null,
    evidence: [],
  });
  return {
    appendOnce,
    getStatusByPublicId,
    getRepositories: vi.fn(() => ({
      analytics: { appendOnce },
      scans: {
        getStatusByPublicId,
        getPublicStatusByPublicId: getStatusByPublicId,
      },
      scanData: {
        listSourceRuns: vi.fn().mockResolvedValue([]),
        listPublicSourceStatesForRun: vi.fn().mockResolvedValue([]),
      },
    })),
  };
});

vi.mock("../../lib/server-database", () => ({ getRepositories }));

import { getScanStatusByToken } from "../../lib/scan-view-service";

const context = {
  anonymousSessionHash: "a".repeat(64),
  secret: "scan-analytics-dedupe-secret-at-least-32-characters",
  now: new Date("2026-08-11T12:00:00.000Z"),
};

beforeEach(() => {
  appendOnce.mockClear();
  getStatusByPublicId.mockClear();
});

describe("scan analytics dedupe", () => {
  it("uses one durable key per HMAC session and scan while polling stays silent", async () => {
    await getScanStatusByToken("scan_private-capability", context);
    await getScanStatusByToken("scan_private-capability", context);
    await getScanStatusByToken("scan_private-capability");

    expect(appendOnce).toHaveBeenCalledTimes(2);
    expect(appendOnce.mock.calls[0]?.[0].dedupeKey).toBe(appendOnce.mock.calls[1]?.[0].dedupeKey);
    expect(appendOnce.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        name: "scan_status_viewed",
        anonymousSessionHash: "a".repeat(64),
        scanRequestId: "00000000-0000-4000-8000-000000000021",
        properties: { state: "QUEUED" },
      }),
    );
    const persisted = JSON.stringify(appendOnce.mock.calls);
    expect(persisted).not.toContain("scan_private-capability");
    expect(persisted).not.toContain("private-product.example");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  surface: "ops" as "ops" | "public",
  env: { CRON_SECRET: "retention-cron-secret-that-is-at-least-32-characters" },
  runRetentionPurge: vi.fn(),
}));

vi.mock("@trendsfast/config", () => ({
  deploymentSurface: () => mocks.surface,
  loadEnv: () => mocks.env,
}));
vi.mock("../../lib/retention-service", () => ({
  runRetentionPurge: mocks.runRetentionPurge,
}));

import { GET, maxDuration } from "../../app/api/cron/retention/route";

function request(token = mocks.env.CRON_SECRET) {
  return new Request("https://ops.trendsfast.example/api/cron/retention", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("retention cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.surface = "ops";
    mocks.runRetentionPurge.mockResolvedValue({
      cutoff: "2026-05-14T00:00:00.000Z",
      deletedScanRequests: 3,
      deletedDeliveryTokens: 2,
      deletedAnalyticsEvents: 4,
      deletedFounderLaunchInterests: 1,
      remainingExpiredFounderLaunchInterests: 0,
      deletedOrphanProjects: 1,
    });
  });

  it("returns an early 404 on the public surface without invoking retention", async () => {
    mocks.surface = "public";
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(mocks.runRetentionPurge).not.toHaveBeenCalled();
  });

  it("requires the exact bearer secret before database work", async () => {
    expect((await GET(request("wrong-secret"))).status).toBe(401);
    expect(mocks.runRetentionPurge).not.toHaveBeenCalled();
  });

  it("returns only bounded purge counts and fails a remaining backlog", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      retention: {
        cutoff: "2026-05-14T00:00:00.000Z",
        deletedScanRequests: 3,
        deletedDeliveryTokens: 2,
        deletedAnalyticsEvents: 4,
        deletedFounderLaunchInterests: 1,
        remainingExpiredFounderLaunchInterests: 0,
        deletedOrphanProjects: 1,
      },
    });

    mocks.runRetentionPurge.mockResolvedValueOnce({
      cutoff: "2026-05-14T00:00:00.000Z",
      deletedScanRequests: 0,
      deletedDeliveryTokens: 0,
      deletedAnalyticsEvents: 0,
      deletedFounderLaunchInterests: 10_000,
      remainingExpiredFounderLaunchInterests: 1,
      deletedOrphanProjects: 0,
    });
    expect((await GET(request())).status).toBe(500);
  });

  it("keeps the schedule in the ops template and out of the Hobby config", () => {
    const ops = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../vercel.ops.json", import.meta.url)), "utf8"),
    );
    const hobby = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../vercel.hobby.json", import.meta.url)), "utf8"),
    );
    expect(maxDuration).toBe(300);
    expect(ops.crons).toEqual([{ path: "/api/cron/retention", schedule: "17 3 * * *" }]);
    expect(hobby.crons).toBeUndefined();
  });
});

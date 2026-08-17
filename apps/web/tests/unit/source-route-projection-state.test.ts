import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadPublicSourceProjection: vi.fn() }));

vi.mock("../../lib/source-projection-service", () => ({
  loadPublicSourceProjection: mocks.loadPublicSourceProjection,
}));

import { GET } from "../../app/api/sources/route";

describe("public source projection diagnostic header", () => {
  it.each([
    "identity_unavailable",
    "lookup_failed",
    "lookup_succeeded_empty",
    "available",
  ] as const)("exposes only the fixed %s state", async (state) => {
    mocks.loadPublicSourceProjection.mockResolvedValueOnce({
      sources: [],
      state,
      debug: {
        deploymentId: "dpl_PrivateSentinel",
        deploymentHost: "private.trendsfast.example",
        error: "private detail",
      },
    });

    const response = await GET();
    const serialized = JSON.stringify({
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.json(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-trendsfast-source-projection-state")).toBe(state);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(JSON.parse(serialized).body).toEqual({ sources: [] });
    expect(serialized).not.toContain("dpl_");
    expect(serialized).not.toContain("trendsfast.example");
    expect(serialized).not.toContain("private detail");
  });
});

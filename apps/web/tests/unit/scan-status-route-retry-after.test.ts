import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getScanStatusByToken: vi.fn(),
}));

vi.mock("../../lib/private-scan-api", () => ({
  PRIVATE_RESPONSE_HEADERS: { "cache-control": "private, no-store" },
}));
vi.mock("../../lib/scan-view-service", () => ({
  getScanStatusByToken: mocks.getScanStatusByToken,
}));

import { GET } from "../../app/api/scans/[token]/status/route";

describe("private scan status Retry-After", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["QUEUED", "RUNNING", "REVIEW_REQUIRED"])(
    "returns the normal polling interval for %s",
    async (state) => {
      mocks.getScanStatusByToken.mockResolvedValue({ found: true, state });

      const response = await GET(new Request("https://trendsfast.com/api/scans/token/status"), {
        params: Promise.resolve({ token: "token" }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("retry-after")).toBe("30");
    },
  );

  it.each(["READY", "FAILED"])("omits Retry-After from terminal %s", async (state) => {
    mocks.getScanStatusByToken.mockResolvedValue({ found: true, state });

    const response = await GET(new Request("https://trendsfast.com/api/scans/token/status"), {
      params: Promise.resolve({ token: "token" }),
    });

    expect(response.headers.get("retry-after")).toBeNull();
  });
});

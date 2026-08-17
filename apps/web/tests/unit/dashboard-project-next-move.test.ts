import { describe, expect, it, vi } from "vitest";

import {
  readDashboardProjectNextMove,
  requestDashboardProjectNextMove,
} from "../../lib/dashboard-project-next-move";

const projectId = "21437295-6781-41a0-a42b-e6db11c553b2";
const rawKey = "tf_live_prefix12.abcdefghijklmnopqrstuvwxyz123456";
const idempotencyKey = "00000000-0000-4000-8000-000000000001";

describe("dashboard project Next Move REST client", () => {
  it("posts the exact confirmed draft request with an in-memory bearer key", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        Response.json(
          {
            id: "scan_dashboard",
            status: "QUEUED",
            status_url: "/v1/next-moves/scan_dashboard",
            poll_after_seconds: 30,
          },
          {
            status: 202,
            headers: {
              location: "/v1/next-moves/scan_dashboard",
              "retry-after": "30",
            },
          },
        ),
    );

    await expect(
      requestDashboardProjectNextMove({
        projectId,
        rawKey,
        idempotencyKey,
        request: {
          objective: "Grow qualified Halio users",
          preferredChannels: ["x", "linkedin", "youtube", "blog"],
          contentCapabilities: ["founder_text", "screen_recording"],
        },
        fetcher,
      }),
    ).resolves.toMatchObject({
      result: { id: "scan_dashboard", status: "QUEUED" },
      pollAfterMs: 30_000,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [path, init] = fetcher.mock.calls[0]!;
    expect(path).toBe(`/v1/projects/${projectId}/next-move`);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "idempotency-key": idempotencyKey,
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      objective: "Grow qualified Halio users",
      preferred_channels: ["x", "linkedin", "youtube", "blog"],
      content_capabilities: ["founder_text", "screen_recording"],
      generation_level: "draft",
    });
  });

  it("normalizes relative or same-origin absolute status URLs to the exact route", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        Response.json(
          {
            id: "scan_dashboard",
            status: "RUNNING",
            status_url: "/v1/next-moves/scan_dashboard",
            poll_after_seconds: 30,
          },
          { headers: { "retry-after": "45" } },
        ),
    );

    for (const statusUrl of [
      "/v1/next-moves/scan_dashboard",
      "https://trendsfast.com/v1/next-moves/scan_dashboard",
    ]) {
      await expect(
        readDashboardProjectNextMove({
          statusUrl,
          currentOrigin: "https://trendsfast.com",
          rawKey,
          expectedId: "scan_dashboard",
          fetcher,
        }),
      ).resolves.toMatchObject({ result: { status: "RUNNING" }, pollAfterMs: 45_000 });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("/v1/next-moves/scan_dashboard", {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${rawKey}`,
      },
    });

    const blockedFetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => Response.json({}));
    await expect(
      readDashboardProjectNextMove({
        statusUrl: "https://attacker.example/collect",
        currentOrigin: "https://trendsfast.com",
        rawKey,
        expectedId: "scan_dashboard",
        fetcher: blockedFetcher,
      }),
    ).rejects.toThrow(/status location was invalid/i);
    expect(blockedFetcher).not.toHaveBeenCalled();
  });

  it("rejects a non-live key and missing Location before any secret can leak", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({}),
    );
    await expect(
      requestDashboardProjectNextMove({
        projectId,
        rawKey: rawKey.replace("tf_live_", "tf_test_"),
        idempotencyKey,
        request: {
          objective: "Grow qualified Halio users",
          preferredChannels: ["x"],
          contentCapabilities: ["founder_text"],
        },
        fetcher,
      }),
    ).rejects.toThrow(/valid live project API key/i);
    expect(fetcher).not.toHaveBeenCalled();

    const missingLocation = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      Response.json(
        {
          id: "scan_dashboard",
          status: "QUEUED",
          status_url: "/v1/next-moves/scan_dashboard",
          poll_after_seconds: 30,
        },
        { status: 202, headers: { "retry-after": "30" } },
      ),
    );
    await expect(
      requestDashboardProjectNextMove({
        projectId,
        rawKey,
        idempotencyKey,
        request: {
          objective: "Grow qualified Halio users",
          preferredChannels: ["x"],
          contentCapabilities: ["founder_text"],
        },
        fetcher: missingLocation,
      }),
    ).rejects.toThrow(/status location was invalid/i);
  });

  it("retains the server Retry-After boundary on a rate admission error", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        Response.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "The API key hourly request limit was reached.",
            },
          },
          { status: 429, headers: { "retry-after": "3600" } },
        ),
    );

    await expect(
      requestDashboardProjectNextMove({
        projectId,
        rawKey,
        idempotencyKey,
        request: {
          objective: "Grow qualified Halio users",
          preferredChannels: ["x"],
          contentCapabilities: ["founder_text"],
        },
        fetcher,
      }),
    ).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 3_600_000,
      message: "The API key hourly request limit was reached.",
    });
  });
});

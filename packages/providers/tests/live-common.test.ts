import { describe, expect, it, vi } from "vitest";

import { fetchJson } from "../src/live/common";
import { createProviderContext, type FetchLike } from "../src/index";

describe("live transport deadlines", () => {
  it("aborts a stalled fetch at the provider timeout when the scan deadline is later", async () => {
    let activeRequests = 0;
    const aborted = vi.fn();
    const fetch = vi.fn<FetchLike>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          activeRequests += 1;
          const signal = init?.signal;
          expect(signal).toBeInstanceOf(AbortSignal);
          signal?.addEventListener(
            "abort",
            () => {
              activeRequests -= 1;
              aborted();
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const now = new Date("2026-08-11T08:00:00.000Z");
    const context = createProviderContext({
      credentialMode: "managed",
      fetch,
      now: () => now,
      deadline: new Date(now.getTime() + 1_000),
    });

    await expect(fetchJson(context, "https://api.example.com", {}, 5)).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(activeRequests).toBe(0);
  });
});

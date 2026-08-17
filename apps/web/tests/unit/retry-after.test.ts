import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCAN_POLL_AFTER_MS,
  retryAfterMilliseconds,
  scanRefreshCopy,
} from "../../lib/retry-after";

describe("retryAfterMilliseconds", () => {
  it("honors delay-seconds from the server", () => {
    expect(retryAfterMilliseconds("30")).toBe(30_000);
  });

  it("honors an HTTP-date relative to the supplied clock", () => {
    const nowMs = Date.parse("2026-08-17T10:00:00.000Z");
    expect(
      retryAfterMilliseconds("Mon, 17 Aug 2026 10:00:45 GMT", {
        nowMs,
      }),
    ).toBe(45_000);
  });

  it("uses the normal polling interval for missing or invalid headers", () => {
    expect(retryAfterMilliseconds(null)).toBe(DEFAULT_SCAN_POLL_AFTER_MS);
    expect(retryAfterMilliseconds("not-a-retry-value")).toBe(DEFAULT_SCAN_POLL_AFTER_MS);
  });

  it("bounds zero and excessive values to avoid hot or abandoned polling", () => {
    expect(retryAfterMilliseconds("0")).toBe(1_000);
    expect(retryAfterMilliseconds("99999")).toBe(10 * 60_000);
  });
});

describe("scanRefreshCopy", () => {
  it("states honestly that a connection failure will be retried automatically", () => {
    expect(scanRefreshCopy("retrying", 30_000)).toEqual({
      readout: "Connection problem. Retrying automatically in 30 seconds…",
      note: "Automatic refresh will keep retrying after the connection problem. Your scan is still stored.",
    });
  });
});

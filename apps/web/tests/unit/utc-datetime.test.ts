import { afterEach, describe, expect, it } from "vitest";

import { isoToUtcDateTimeValue, utcDateTimeValueToIso } from "../../lib/utc-datetime";

const originalTimezone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimezone;
});

describe("UTC datetime-local bridge", () => {
  it("round-trips the same instant in Europe/Amsterdam instead of applying the local offset", () => {
    process.env.TZ = "Europe/Amsterdam";
    const instant = "2026-08-14T10:00:00.000Z";

    const fieldValue = isoToUtcDateTimeValue(instant);

    expect(fieldValue).toBe("2026-08-14T10:00:00.000");
    expect(utcDateTimeValueToIso(fieldValue)).toBe(instant);
    expect(new Date(fieldValue).toISOString()).not.toBe(instant);
  });

  it("rejects malformed or impossible UTC field values", () => {
    expect(() => utcDateTimeValueToIso("2026-02-30T10:00")).toThrow(/valid utc/i);
    expect(() => utcDateTimeValueToIso("14 August 2026")).toThrow(/valid utc/i);
  });
});

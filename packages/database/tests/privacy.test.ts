import { describe, expect, it } from "vitest";

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
    expect(typeof PrivacyRepository.prototype.purgeExpired).toBe("function");
  });
});

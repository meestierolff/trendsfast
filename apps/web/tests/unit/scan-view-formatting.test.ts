import { describe, expect, it } from "vitest";
import {
  confidenceLabel,
  formatCodeLabel,
  formatScanDate,
} from "../../components/scan-view-formatters";

describe("private result formatting", () => {
  it("turns confidence into a readable label without hiding the score", () => {
    expect(confidenceLabel(0.82)).toBe("High · 82%");
    expect(confidenceLabel(0.7)).toBe("Medium · 70%");
    expect(confidenceLabel(0.42)).toBe("Low · 42%");
  });

  it("formats persisted timestamps deterministically in UTC", () => {
    expect(formatScanDate("2026-08-11T10:00:08.000Z")).toBe("11 Aug 2026, 10:00 UTC");
    expect(formatScanDate("not-a-date")).toBe("Not available");
  });

  it("makes contract enum values readable while preserving known names", () => {
    expect(formatCodeLabel("CORROBORATED_SIGNAL")).toBe("Corroborated signal");
    expect(formatCodeLabel("hacker_news")).toBe("Hacker News");
    expect(formatCodeLabel("x")).toBe("X");
  });
});

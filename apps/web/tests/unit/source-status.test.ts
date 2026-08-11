import { describe, expect, it } from "vitest";
import { SOURCE_CATALOG, publicSourceLabel } from "../../lib/source-catalog";

describe("source status catalog", () => {
  it("never represents automated Reddit access as connected", () => {
    const reddit = SOURCE_CATALOG.find((source) => source.slug === "reddit");
    expect(reddit?.engineeringState).toBe("LEGAL_REVIEW");
    expect(reddit && publicSourceLabel(reddit)).toBe("Permission required");
  });

  it("keeps example availability separate from production read-back", () => {
    expect(SOURCE_CATALOG.every((source) => typeof source.exampleAvailable === "boolean")).toBe(
      true,
    );
    expect(SOURCE_CATALOG.filter((source) => source.productionVerified)).toHaveLength(0);
    expect(
      SOURCE_CATALOG.filter((source) => source.engineeringState !== "LEGAL_REVIEW").every(
        (source) => publicSourceLabel(source) === "Coming soon",
      ),
    ).toBe(true);
  });

  it("keeps callable manual evidence supplemental and unverified", () => {
    const manual = SOURCE_CATALOG.find((source) => source.slug === "manual");
    expect(manual?.engineeringState).toBe("UNVERIFIED");
    expect(manual && publicSourceLabel(manual)).toBe("Coming soon");
    expect(manual?.limitation).toMatch(/supplemental/i);
    expect(manual?.limitation).toMatch(/cannot qualify approval/i);
  });
});

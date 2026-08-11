import { describe, expect, it } from "vitest";
import { SOURCE_CATALOG } from "../../lib/source-catalog";

describe("source status catalog", () => {
  it("never represents automated Reddit access as live", () => {
    const reddit = SOURCE_CATALOG.find((source) => source.slug === "reddit");
    expect(reddit?.status).toBe("LEGAL_REVIEW");
  });

  it("marks fixture availability independently from production read-back", () => {
    expect(SOURCE_CATALOG.every((source) => typeof source.fixtureAvailable === "boolean")).toBe(
      true,
    );
    expect(SOURCE_CATALOG.filter((source) => source.productionVerified)).toHaveLength(0);
  });

  it("does not call manual evidence live before an entry route exists", () => {
    const manual = SOURCE_CATALOG.find((source) => source.slug === "manual");
    expect(manual?.status).toBe("ADAPTER_ONLY");
    expect(manual?.limitation).toMatch(/no callable founder entry/i);
  });
});

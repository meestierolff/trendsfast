import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveWebsiteOnlyContext } from "../../lib/website-context-service";

describe("website-only context resolution", () => {
  it("derives and hashes bounded injected website evidence without a provider call", async () => {
    const readWebsite = vi.fn().mockResolvedValue([
      {
        id: "signal_home",
        source: "website",
        sourceId: "page_home",
        url: "https://halio.nl/",
        title: "Halio — Inzicht in je portefeuille",
        textExcerpt:
          "Description: Helder inzicht in je beleggingen\nHeadings: Je portefeuille begrijpen\nPage text: Voor Nederlandse beleggers",
        observedAt: "2026-08-17T12:00:00.000Z",
        metrics: {},
        queryId: "context",
        provenance: {
          provider: "website_fetch",
          retrievedAt: "2026-08-17T12:00:00.000Z",
          cached: false,
          rawPayloadHash: "sha256:fixture",
        },
      },
    ]);

    const resolved = await resolveWebsiteOnlyContext("https://halio.nl", { readWebsite });

    expect(readWebsite).toHaveBeenCalledWith("https://halio.nl");
    expect(resolved.context).toMatchObject({
      language: "nl",
      category: expect.stringMatching(/investment/i),
    });
    expect(resolved.profile.contextProvenance.observed_facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ source_url: "https://halio.nl/" })]),
    );
    expect(resolved.sourceContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(resolved.observedPageCount).toBe(1);
  });
});

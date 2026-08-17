import { describe, expect, it } from "vitest";

import { reconcileMemberContextProvenance } from "../src/member-context-provenance";

const previousContext = {
  name: "Halio",
  url: "https://halio.nl/",
  category: "investment portfolio software",
  audience: "Self-directed investors",
  problem: "Portfolio context is fragmented.",
  desiredOutcome: "Understand a portfolio clearly.",
  credibleClaims: [],
  alternatives: [],
  competitors: [],
  markets: ["Netherlands"],
  language: "nl",
  suitableChannels: ["x"],
  availableFormats: ["founder_text"],
  credibleTopics: ["portfolio clarity"],
  assumptions: ["Website-only assumption"],
};

describe("member context provenance reconciliation", () => {
  it("synchronizes corrected context while retaining only trusted observations", () => {
    const corrected = reconcileMemberContextProvenance({
      previousContext,
      previousEntityType: "PRODUCT",
      nextContext: {
        ...previousContext,
        audience: "Dutch long-term ETF investors",
        assumptions: ["Founder-confirmed audience boundary"],
      },
      nextEntityType: "PRODUCT",
      currentProvenance: {
        observed_facts: [
          {
            field: "page_title",
            value: "Halio — portfolio clarity",
            source_url: "https://halio.nl/",
          },
        ],
        inferred_context: [
          {
            field: "audience",
            value: "Self-directed investors",
            rationale: "Inferred from bounded website evidence.",
          },
        ],
        assumptions: ["Website-only assumption"],
      },
      requestedProvenance: {
        observed_facts: [
          {
            field: "forged_fact",
            value: "Must never replace the trusted observation",
            source_url: "https://attacker.example/",
          },
        ],
        inferred_context: [
          {
            field: "audience",
            value: "Self-directed investors",
            rationale: "Stale website inference.",
          },
          {
            field: "founder_note",
            value: "Avoid daily-trading framing.",
            rationale: "Founder supplied this positioning boundary.",
          },
        ],
        assumptions: ["Stale independent provenance assumption"],
      },
    });

    expect(corrected.observed_facts).toEqual([
      {
        field: "page_title",
        value: "Halio — portfolio clarity",
        source_url: "https://halio.nl/",
      },
    ]);
    expect(corrected.assumptions).toEqual(["Founder-confirmed audience boundary"]);
    expect(corrected.inferred_context.filter((entry) => entry.field === "audience")).toEqual([
      {
        field: "audience",
        value: "Dutch long-term ETF investors",
        rationale:
          "Founder-confirmed correction to editable context; not an independently verified external fact.",
      },
    ]);
    expect(corrected.inferred_context).toContainEqual({
      field: "founder_note",
      value: "Avoid daily-trading framing.",
      rationale: "Founder supplied this positioning boundary.",
    });
  });
});

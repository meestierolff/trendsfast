import { describe, expect, it } from "vitest";

import {
  requireDecisionEvidenceQuality,
  type ReviewableEvidenceReceipt,
} from "../src/repositories/review-evidence";

function receipt(
  source: string,
  canonicalUrl: string,
  overrides: Partial<ReviewableEvidenceReceipt> = {},
): ReviewableEvidenceReceipt {
  return {
    bindingRole: "DECISION_SUPPORT",
    availability: "AVAILABLE",
    verified: true,
    source,
    canonicalUrl,
    ...overrides,
  };
}

describe("founder review evidence quality", () => {
  it("requires every deterministic support receipt to remain available and verified", () => {
    expect(() =>
      requireDecisionEvidenceQuality({
        action: "PUBLISH",
        signalClass: "CORROBORATED_SIGNAL",
        receipts: [
          receipt("hacker_news", "https://news.ycombinator.com/item?id=1"),
          receipt("github", "https://github.com/trendsfast/repository", { verified: false }),
        ],
      }),
    ).toThrow(/every decision-support receipt/i);
  });

  it("counts platform independence rather than distinct URLs on one platform", () => {
    expect(() =>
      requireDecisionEvidenceQuality({
        action: "PUBLISH",
        signalClass: "CORROBORATED_SIGNAL",
        receipts: [
          receipt("hacker_news", "https://news.ycombinator.com/item?id=1"),
          receipt("hacker_news", "https://news.ycombinator.com/item?id=2"),
        ],
      }),
    ).toThrow(/two available, verified, independent/i);
  });

  it("ignores supplemental evidence when preserving the synthesized quality floor", () => {
    const quality = requireDecisionEvidenceQuality({
      action: "PUBLISH",
      signalClass: "CORROBORATED_SIGNAL",
      receipts: [
        receipt("hacker_news", "https://news.ycombinator.com/item?id=1"),
        receipt("github", "https://github.com/trendsfast/repository"),
        receipt("manual", "https://example.com/founder-note", {
          bindingRole: "SUPPLEMENTAL",
          verified: false,
        }),
      ],
    });
    expect(quality).toEqual({ evidenceCount: 2, independentSourceCount: 2 });
  });

  it("allows WAIT without manufacturing an evidence requirement", () => {
    expect(
      requireDecisionEvidenceQuality({
        action: "WAIT",
        signalClass: "INSUFFICIENT_SIGNAL",
        receipts: [],
      }),
    ).toEqual({ evidenceCount: 0, independentSourceCount: 0 });
  });
});

import { describe, expect, it } from "vitest";

import { classifyUnsafeContent, classifyUnsafeContentSet } from "../src/content-safety";

describe("deterministic content safety", () => {
  it.each([
    ["URL_OR_EMAIL", "Read https://invented.example/results now."],
    ["METRIC_CLAIM", "Demand increased by 42%."],
    ["METRIC_CLAIM", "Demand doubled after launch."],
    ["PERFORMANCE_GUARANTEE", "Guaranteed returns without risk."],
    ["FINANCIAL_DIRECTIVE", "Buy the ETF now."],
    ["FINANCIAL_DIRECTIVE", "Purchase Tesla shares now."],
    ["FINANCIAL_DIRECTIVE", "Dispose of the stock position."],
    ["FINANCIAL_DIRECTIVE", "Rebalance your portfolio today."],
    ["PERFORMANCE_CLAIM", "Halio can grow the investor portfolio."],
    ["PERFORMANCE_CLAIM", "Earn more money with this approach."],
    ["METRIC_CLAIM", "This creates fivefold growth."],
    ["PERFORMANCE_GUARANTEE", "Gegarandeerd rendement zonder risico."],
    ["FINANCIAL_DIRECTIVE", "Koop deze ETF nu."],
    ["FINANCIAL_DIRECTIVE", "Stoot deze aandelenpositie af."],
    ["PERFORMANCE_CLAIM", "Verdien meer geld met deze aanpak."],
    ["METRIC_CLAIM", "Dit levert vijfvoudige groei op."],
  ] as const)("classifies %s prose", (kind, value) => {
    expect(classifyUnsafeContent(value)).toContain(kind);
  });

  it("normalizes compatibility punctuation before URL classification", () => {
    expect(classifyUnsafeContent("Read invented．example now.")).toContain("URL_OR_EMAIL");
    expect(classifyUnsafeContent("B\u200buy the ETF now.")).toContain("FINANCIAL_DIRECTIVE");
  });

  it("does not mistake a list number or a distribution hold for a metric or financial order", () => {
    expect(
      classifyUnsafeContentSet([
        "Three evidence checks for technical founders",
        "Hold distribution until the evidence is current.",
      ]),
    ).toEqual([]);
    expect(
      classifyUnsafeContent("Hold distribution until the evidence is current.", {
        financialContext: true,
      }),
    ).toEqual([]);
    expect(
      classifyUnsafeContent("A short product workflow with private data removed.", {
        financialContext: true,
      }),
    ).toEqual([]);
  });

  it("can reject every numeric model addition without treating B2B as a deterministic metric", () => {
    expect(classifyUnsafeContent("B2B distribution", { rejectAnyNumber: false })).toEqual([]);
    expect(classifyUnsafeContent("B2B distribution", { rejectAnyNumber: true })).toContain(
      "METRIC_CLAIM",
    );
  });

  it("does not treat ordinary technical language as a financial claim outside finance", () => {
    expect(
      classifyUnsafeContentSet(
        ["API returns JSON", "JavaScript Promises", "Alpha release", "A short guide"],
        { financialContext: false },
      ),
    ).toEqual([]);
  });

  it("classifies ambiguous return language when the saved product context is financial", () => {
    expect(classifyUnsafeContent("Higher returns for users", { financialContext: true })).toContain(
      "PERFORMANCE_CLAIM",
    );
    expect(classifyUnsafeContent("Hold TSLA", { financialContext: true })).toContain(
      "FINANCIAL_DIRECTIVE",
    );
    expect(classifyUnsafeContent("Trade Nvidia", { financialContext: true })).toContain(
      "FINANCIAL_DIRECTIVE",
    );
  });

  it.each([
    "Go long Tesla shares now",
    "Short Tesla",
    "Exit your stock position",
    "Close your position in Tesla",
    "Open a position in Nvidia",
    "Load up on Nvidia shares",
    "Cash out your portfolio",
    "Ga long op Tesla",
    "Short Tesla aandelen",
    "Open een positie in Nvidia",
    "Sluit je positie in Tesla",
    "Stap uit je aandelenpositie",
  ])("rejects the financial directive %s in a saved financial context", (value) => {
    expect(classifyUnsafeContent(value, { financialContext: true })).toContain(
      "FINANCIAL_DIRECTIVE",
    );
  });

  it.each([
    "Build wealth faster",
    "Grow your net worth",
    "Beat inflation with Tesla shares",
    "Get richer with this portfolio",
    "Achieve financial freedom",
    "Retire richer",
    "Bouw sneller vermogen op",
    "Laat je geld harder werken",
    "Word rijker met deze portefeuille",
    "Versla de inflatie met aandelen",
    "Bereik financi\u00eble vrijheid",
  ])("rejects the financial performance claim %s in a saved financial context", (value) => {
    expect(classifyUnsafeContent(value, { financialContext: true })).toContain("PERFORMANCE_CLAIM");
  });
});

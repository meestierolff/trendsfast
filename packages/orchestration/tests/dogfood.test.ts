import { describe, expect, it } from "vitest";
import { hasFinancialSafetyContext } from "../src/content-safety";
import { DOGFOOD_FIXTURES, fixtureDecision } from "../src/dogfood";

describe("dogfood fixture differentiation", () => {
  it("covers the required eight products", () => {
    expect(DOGFOOD_FIXTURES.map((fixture) => fixture.name)).toEqual([
      "TrendsFast",
      "Halio",
      "ShipToUsers",
      "Eve",
      "Ask Me Someday",
      "Not An Insider",
      "Payout Rank",
      "Top of the World",
    ]);
  });

  it("does not repeat generic audience, topic, channel, format, or evidence plans", () => {
    const decisions = DOGFOOD_FIXTURES.map(fixtureDecision);
    expect(new Set(decisions.map((decision) => decision.context.audience)).size).toBe(8);
    expect(new Set(decisions.map((decision) => decision.move.topic)).size).toBe(8);
    expect(
      new Set(decisions.map((decision) => `${decision.move.channel}:${decision.move.format}`)).size,
    ).toBe(8);
    expect(new Set(decisions.map((decision) => decision.evidencePlan.join("|"))).size).toBe(8);
    expect(new Set(decisions.map((decision) => decision.move.action)).size).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("keeps decision-output language distinct from financial performance context", () => {
    const trendsFast = DOGFOOD_FIXTURES.find((fixture) => fixture.slug === "trendsfast");
    const halio = DOGFOOD_FIXTURES.find((fixture) => fixture.slug === "halio");
    if (!trendsFast || !halio) throw new Error("Required dogfood fixtures are missing");

    expect(hasFinancialSafetyContext(trendsFast.context)).toBe(false);
    expect(hasFinancialSafetyContext(halio.context)).toBe(true);
  });
});

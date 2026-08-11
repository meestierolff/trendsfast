import { describe, expect, it } from "vitest";
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
});

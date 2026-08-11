import { describe, expect, it } from "vitest";
import { QueryPlanSchema, type ProjectContext } from "@trendsfast/schemas";

import {
  buildQueryPlan,
  fromStoredQueryPlan,
  projectContextToProductQueryContext,
  toStoredQueryPlan,
} from "../src/index";

const project: ProjectContext = {
  name: "TrendsFast",
  url: "https://trendsfast.com",
  category: "distribution intelligence",
  audience: "technical solo founders and small developer-tool teams",
  problem: "distribution research is fragmented across live sources",
  desiredOutcome: "choose one timely evidence-backed distribution move",
  credibleClaims: ["founder-reviewed recommendations", "stored source receipts"],
  alternatives: ["social listening", "manual research"],
  competitors: ["generic trend dashboards"],
  markets: ["US"],
  language: "en",
  suitableChannels: ["x", "reddit"],
  availableFormats: ["founder_text", "technical_tutorial"],
  credibleTopics: ["Google Trends", "founder-led distribution"],
  assumptions: [],
};

describe("shared schema integration", () => {
  it("adapts persisted project context and emits a valid stored query plan", () => {
    const context = projectContextToProductQueryContext(project);
    const runtimePlan = buildQueryPlan(context, {
      productUrl: project.url,
      now: new Date("2026-08-11T08:00:00.000Z"),
      market: "US",
      language: "en",
    });
    const stored = toStoredQueryPlan(runtimePlan, {
      id: "query_plan_1",
      projectContextVersionId: "project_context_version_1",
    });

    expect(QueryPlanSchema.safeParse(stored).success).toBe(true);
    expect(
      stored.providers.find((group) => group.source === "google_trends")?.constraints.maxCalls,
    ).toBe(1);
    expect(stored.providers.length).toBeLessThanOrEqual(20);
    expect(fromStoredQueryPlan(stored)).toEqual(runtimePlan);
  });
});

import { describe, expect, it } from "vitest";

import { parseApiKey, parseDeliveryToken } from "@trendsfast/core";
import { ProjectContextSchema, QueryPlanSchema } from "@trendsfast/schemas";

import {
  FIXTURE_API_KEY,
  FIXTURE_DELIVERY_TOKEN,
  FIXTURE_SCAN_PUBLIC_ID,
  normalizeProductUrl,
} from "../src/index";
import { FIXTURE_PROJECT_CONTEXT, FIXTURE_QUERY_PLAN } from "../src/seed";

describe("fixture vertical slice", () => {
  it("ships valid context, query plan, and explicitly non-production credentials", () => {
    expect(ProjectContextSchema.parse(FIXTURE_PROJECT_CONTEXT).name).toBe("TrendsFast");
    expect(QueryPlanSchema.parse(FIXTURE_QUERY_PLAN).providers).toHaveLength(3);
    expect(parseApiKey(FIXTURE_API_KEY)?.environment).toBe("test");
    expect(parseDeliveryToken(FIXTURE_DELIVERY_TOKEN)?.tokenPrefix).toBe("fixture1");
    expect(FIXTURE_API_KEY).toContain("fixture-only");
    expect(FIXTURE_DELIVERY_TOKEN).toContain("fixture-demo");
    expect(normalizeProductUrl("https://trendsfast.com")).toBe("https://trendsfast.com/");
    expect(FIXTURE_SCAN_PUBLIC_ID).toBe("scan_fixture_trendsfast");
  });
});

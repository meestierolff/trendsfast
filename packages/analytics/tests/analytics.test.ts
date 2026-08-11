import { describe, expect, it } from "vitest";
import { buildExternalAnalyticsPayload, parseAttribution, TRACKED_EVENTS } from "../src/index";

describe("analytics privacy boundary", () => {
  it("keeps the documented event vocabulary explicit", () => {
    expect(TRACKED_EVENTS).toContain("scan_delivered");
    expect(TRACKED_EVENTS).toContain("move_marked_used");
    expect(TRACKED_EVENTS).not.toContain("evidence_text_copied");
  });

  it("never forwards sensitive fields to optional analytics", () => {
    const external = buildExternalAnalyticsPayload("scan_result_viewed", {
      ref: "reddit",
      utm_source: "reddit",
      private_scan_url: "/scan/top-secret",
      email: "founder@example.com",
      product_url: "https://example.com/?secret=1",
      feedback: "private words",
      api_key: "tf_live_prefix.secret",
    });

    expect(external).toEqual({ event: "scan_result_viewed", ref: "reddit", utm_source: "reddit" });
  });

  it("drops query strings and unknown attribution values", () => {
    expect(
      parseAttribution(
        new URL(
          "https://trendsfast.com/?ref=github&utm_source=readme&utm_medium=link&utm_campaign=launch&ignored=x",
        ),
      ),
    ).toEqual({
      ref: "github",
      utm_source: "readme",
      utm_medium: "link",
      utm_campaign: "launch",
      first_landing: "/",
    });
  });
});

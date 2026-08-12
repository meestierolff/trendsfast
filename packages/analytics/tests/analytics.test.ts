import { describe, expect, it } from "vitest";
import {
  buildExternalAnalyticsPayload,
  createAnalytics,
  LAUNCH_ANALYTICS_EVENTS,
  parseAttribution,
  TRACKED_EVENTS,
} from "../src/index";

describe("analytics privacy boundary", () => {
  it("keeps the documented event vocabulary explicit", () => {
    expect(LAUNCH_ANALYTICS_EVENTS).toEqual([
      "landing_viewed",
      "hero_cta_clicked",
      "demo_viewed",
      "free_scan_submitted",
      "scan_status_viewed",
      "scan_delivered",
      "evidence_opened",
      "feedback_submitted",
      "move_would_use",
      "move_used",
      "repeat_scan_requested",
      "agents_page_viewed",
      "docs_viewed",
      "pricing_viewed",
      "beta_waitlist_joined",
      "checkout_started",
      "subscription_started",
    ]);
    expect(TRACKED_EVENTS).toContain("scan_result_viewed");
    expect(TRACKED_EVENTS).not.toContain("evidence_text_copied");
  });

  it("never forwards sensitive fields to optional analytics", () => {
    const external = buildExternalAnalyticsPayload("evidence_opened", {
      ref: "reddit",
      utm_source: "reddit",
      private_scan_url: "/scan/top-secret",
      email: "founder@example.com",
      product_url: "https://example.com/?secret=1",
      feedback: "private words",
      api_key: "tf_live_prefix.secret",
    });

    expect(external).toEqual({ event: "evidence_opened", ref: "reddit", utm_source: "reddit" });
  });

  it("never writes an open properties envelope to the first-party ledger", async () => {
    const written: unknown[] = [];
    const analytics = createAnalytics({
      ledger: { write: async (event) => void written.push(event) },
    });
    await analytics.track("hero_cta_clicked", {
      properties: {
        placement: "homepage_hero",
        email: "founder@example.com",
        note: "arbitrary free text",
        token: "private-token",
      },
    });
    expect(written).toEqual([
      expect.objectContaining({ properties: { placement: "homepage_hero" } }),
    ]);
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

  it("never projects a private capability path into attribution", () => {
    const privatePath = "/scan/scan_this-private-capability-must-never-persist";
    expect(
      parseAttribution(new URL(`https://trendsfast.com${privatePath}?utm_source=launch`)),
    ).toEqual({ first_landing: "/other", utm_source: "launch" });
    expect(buildExternalAnalyticsPayload("landing_viewed", { first_landing: privatePath })).toEqual(
      { event: "landing_viewed", first_landing: "/other" },
    );
  });
});

"use client";

export type BrowserAnalyticsEvent =
  | { event: "landing_viewed"; placement: "homepage" }
  | {
      event: "hero_cta_clicked";
      placement: "homepage_hero" | "homepage_repeat" | "homepage_final" | "agents";
    }
  | { event: "demo_viewed"; placement: "homepage_demo" }
  | { event: "agents_page_viewed"; placement: "agents" }
  | { event: "docs_viewed"; placement: "docs" }
  | { event: "pricing_viewed"; placement: "pricing" };

/** Fire-and-forget only. Analytics failure must never block a navigation or core action. */
export function sendFirstPartyAnalytics(event: BrowserAnalyticsEvent): void {
  try {
    const body = JSON.stringify(event);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const accepted = navigator.sendBeacon(
        "/api/analytics/events",
        new Blob([body], { type: "application/json" }),
      );
      if (accepted) return;
    }
    void fetch("/api/analytics/events", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics is intentionally best effort.
  }
}

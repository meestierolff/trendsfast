"use client";

import { useEffect } from "react";

import { sendFirstPartyAnalytics, type BrowserAnalyticsEvent } from "../lib/analytics-client";

type PageViewEvent = Extract<
  BrowserAnalyticsEvent,
  {
    event: "landing_viewed" | "agents_page_viewed" | "docs_viewed" | "pricing_viewed";
  }
>;

export function AnalyticsPageView({ event }: { event: PageViewEvent }) {
  useEffect(() => {
    sendFirstPartyAnalytics(event);
  }, [event]);
  return null;
}

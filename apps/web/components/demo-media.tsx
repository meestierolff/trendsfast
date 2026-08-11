"use client";

import { useEffect, useRef } from "react";

import { sendFirstPartyAnalytics } from "../lib/analytics-client";
import { ExampleExplorer } from "./example-explorer";

function safeMediaUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return value.startsWith("/") && !value.startsWith("//") ? value : null;
  }
}

const transcript = [
  "Paste a public product URL.",
  "Review the inferred product and buyer context.",
  "Inspect the available source coverage and limitations.",
  "Reveal one PUBLISH, REPLY, REMIX, or WAIT.",
  "Open the original evidence receipts.",
  "Complete founder review before delivery.",
  "Create and poll the same result through the REST API.",
] as const;

export function DemoMedia({ videoUrl, captionsUrl }: { videoUrl?: string; captionsUrl?: string }) {
  const safeVideo = safeMediaUrl(videoUrl);
  const safeCaptions = safeMediaUrl(captionsUrl);
  const videoLayoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = videoLayoutRef.current;
    if (!node || !safeVideo || !safeCaptions) return;
    if (typeof IntersectionObserver === "undefined") {
      sendFirstPartyAnalytics({ event: "demo_viewed", placement: "homepage_demo" });
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        sendFirstPartyAnalytics({ event: "demo_viewed", placement: "homepage_demo" });
        observer.disconnect();
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [safeCaptions, safeVideo]);

  if (!safeVideo || !safeCaptions) {
    return (
      <div className="demo-fallback">
        <p>Interactive walkthrough using example data.</p>
        <ExampleExplorer />
      </div>
    );
  }

  return (
    <div ref={videoLayoutRef} className="demo-video-layout">
      <video controls playsInline preload="metadata">
        <source src={safeVideo} />
        <track kind="captions" src={safeCaptions} srcLang="en" label="English" default />
        Your browser does not support embedded video. Use the transcript beside the player.
      </video>
      <aside>
        <p className="section-index">VIDEO TRANSCRIPT</p>
        <ol>
          {transcript.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

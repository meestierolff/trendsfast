"use client";

import { useEffect, useRef, useState } from "react";
import { EXAMPLE_MOVES, type ExampleMove } from "../lib/example-moves";
import { sendFirstPartyAnalytics } from "../lib/analytics-client";
import { NextMoveCard } from "./next-move-card";

const actions = Object.keys(EXAMPLE_MOVES) as ExampleMove["action"][];

export function ExampleExplorer() {
  const [action, setAction] = useState<ExampleMove["action"]>("PUBLISH");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
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
  }, []);

  return (
    <div ref={rootRef} className="example-explorer" data-testid="interactive-demo">
      <div className="action-tabs" aria-label="Next Move outcome examples">
        {actions.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={candidate === action}
            onClick={() => setAction(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>
      <NextMoveCard move={EXAMPLE_MOVES[action]} />
    </div>
  );
}

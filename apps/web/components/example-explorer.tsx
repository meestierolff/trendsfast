"use client";

import { useState } from "react";
import { EXAMPLE_MOVES, type ExampleMove } from "../lib/example-moves";
import { NextMoveCard } from "./next-move-card";

const actions = Object.keys(EXAMPLE_MOVES) as ExampleMove["action"][];

export function ExampleExplorer() {
  const [action, setAction] = useState<ExampleMove["action"]>("PUBLISH");

  return (
    <div className="example-explorer" data-testid="interactive-demo">
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

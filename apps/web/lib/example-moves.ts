export type ExampleMove = {
  action: "PUBLISH" | "REPLY" | "REMIX" | "WAIT";
  channel: string;
  topic: string;
  hook: string;
  angle: string;
  whyNow: string;
  signalClass: string;
  confidence: number;
  validFor: string;
  outline: string[];
  evidence: { source: string; title: string; note: string }[];
  limitation: string;
};

export const EXAMPLE_MOVES: Record<ExampleMove["action"], ExampleMove> = {
  PUBLISH: {
    action: "PUBLISH",
    channel: "Founder post · X",
    topic: "Why live signals still fail to tell founders what to do",
    hook: "I spent more time researching distribution than shipping the feature.",
    angle:
      "Show the gap between a feed of signals and one evidence-bound decision, using a real scan teardown.",
    whyNow:
      "Search interest and two independent founder/developer discussions converge on agent-ready research workflows.",
    signalClass: "CORROBORATED_SIGNAL",
    confidence: 0.82,
    validFor: "48 hours",
    outline: [
      "Open with the weekly research loop you replaced.",
      "Show the evidence receipts and what each one contributes.",
      "End with the decision and invite one founder URL.",
    ],
    evidence: [
      {
        source: "Google Trends",
        title: "distribution agent workflows",
        note: "Measured 30-day direction",
      },
      {
        source: "Hacker News",
        title: "Founder discussion on agent research",
        note: "Independent developer conversation",
      },
    ],
    limitation: "Fixture example. Links and engagement are not represented as live evidence.",
  },
  REPLY: {
    action: "REPLY",
    channel: "Hacker News",
    topic: "A founder asks how to choose distribution channels",
    hook: "Channel choice gets easier when you separate audience presence from evidence quality.",
    angle:
      "Contribute a compact decision framework before mentioning the product or offering a scan.",
    whyNow:
      "One exceptional, recent conversation matches the product’s core expertise and remains active.",
    signalClass: "EMERGING_SIGNAL",
    confidence: 0.74,
    validFor: "12 hours",
    outline: [
      "Answer the question directly in three criteria.",
      "Share one limitation that prevents overconfidence.",
      "Only offer the tool if the author wants a worked example.",
    ],
    evidence: [
      {
        source: "Hacker News",
        title: "Choosing a launch channel as a small team",
        note: "Recent, high-fit thread",
      },
    ],
    limitation:
      "Fixture example. A live reply would require an original, verified conversation URL.",
  },
  REMIX: {
    action: "REMIX",
    channel: "YouTube short demo",
    topic: "Turn a product URL into one distribution decision",
    hook: "Here is the 40-second research loop behind one founder post.",
    angle:
      "Translate a proven screen-recording format into an evidence-first scan, without copying the creator.",
    whyNow:
      "Recent videos using fast workflow teardowns outperform their age baseline in the fixture panel.",
    signalClass: "CORROBORATED_SIGNAL",
    confidence: 0.77,
    validFor: "5 days",
    outline: [
      "Paste a product URL on screen.",
      "Reveal one receipt from each independent source.",
      "Land on the Next Move and its honest limitation.",
    ],
    evidence: [
      { source: "YouTube", title: "Compact agent workflow demos", note: "Format signal" },
      {
        source: "Open web",
        title: "Evidence-first agent tutorial",
        note: "Independent topic confirmation",
      },
    ],
    limitation:
      "Fixture example. Relative performance requires real publication age and view snapshots.",
  },
  WAIT: {
    action: "WAIT",
    channel: "No channel",
    topic: "No move clears the quality floor",
    hook: "Do not force a post from thin evidence.",
    angle:
      "Save the founder’s credibility and re-check when demand or a conversation creates a defensible window.",
    whyNow:
      "Available signals share one origin and search demand is flat, so publishing would overstate momentum.",
    signalClass: "INSUFFICIENT_SIGNAL",
    confidence: 0.89,
    validFor: "Re-check in 72 hours",
    outline: [
      "Keep the strongest query cluster for the next scan.",
      "Watch for an independent discussion or measured demand change.",
      "Prepare a product-specific example, but do not publish yet.",
    ],
    evidence: [
      { source: "Google Trends", title: "Flat search series", note: "Measured external series" },
    ],
    limitation: "Fixture example. WAIT is a positive outcome, not a failed scan.",
  },
};

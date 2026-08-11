import type { NextMoveCardModel } from "../components/next-move-card";

export type ExampleMove = NextMoveCardModel;

const shared = {
  productName: "SignalKit",
  founderReviewed: true,
  autoPublish: false,
} as const;

export const EXAMPLE_MOVES: Record<ExampleMove["action"], ExampleMove> = {
  PUBLISH: {
    ...shared,
    action: "PUBLISH",
    channel: "X",
    format: "Founder text post",
    topic: "Why live signals still fail to tell founders what to do",
    hook: "I spent more time researching distribution than shipping the feature.",
    angle:
      "Show the gap between a feed of signals and one evidence-bound decision, using a product-specific scan teardown.",
    whyNow:
      "Search interest and two independent founder and developer discussions converge on agent-ready research workflows.",
    signalClass: "CORROBORATED_SIGNAL",
    confidence: 0.82,
    validUntil: "48 hours",
    outline: [
      "Open with the weekly research loop you replaced.",
      "Show the evidence receipts and what each one contributes.",
      "End with the decision and invite one founder URL.",
    ],
    evidence: [
      {
        source: "Search demand",
        title: "Distribution agent workflows",
        note: "Example measured 30-day direction",
      },
      {
        source: "Developer community",
        title: "Founder discussion on agent research",
        note: "Example independent conversation",
      },
    ],
    limitations: ["Example data does not represent current source coverage or customer traction."],
  },
  REPLY: {
    ...shared,
    action: "REPLY",
    channel: "Hacker News",
    format: "Helpful reply",
    topic: "A founder asks how to choose distribution channels",
    hook: "Channel choice gets easier when you separate audience presence from evidence quality.",
    angle:
      "Contribute a compact decision framework before mentioning the product or offering a scan.",
    whyNow:
      "One exceptional, recent conversation matches the product’s core expertise and remains active.",
    signalClass: "EMERGING_SIGNAL",
    confidence: 0.74,
    validUntil: "12 hours",
    outline: [
      "Answer the question directly in three criteria.",
      "Share one limitation that prevents overconfidence.",
      "Only offer the tool if the author wants a worked example.",
    ],
    evidence: [
      {
        source: "Developer community",
        title: "Choosing a launch channel as a small team",
        note: "Example high-fit conversation",
      },
    ],
    limitations: ["A real reply requires a current, original conversation URL."],
  },
  REMIX: {
    ...shared,
    action: "REMIX",
    channel: "YouTube",
    format: "Short screen recording",
    topic: "Turn a product URL into one distribution decision",
    hook: "Here is the 40-second research loop behind one founder post.",
    angle:
      "Translate a useful screen-recording pattern into an evidence-first scan without copying the creator.",
    whyNow:
      "Two example content signals point to concise workflow teardowns as a credible format for this product.",
    signalClass: "CORROBORATED_SIGNAL",
    confidence: 0.77,
    validUntil: "5 days",
    outline: [
      "Paste a product URL on screen.",
      "Reveal one receipt from each independent source.",
      "Land on the Next Move and its honest limitation.",
    ],
    evidence: [
      { source: "Video", title: "Compact agent workflow demos", note: "Example format signal" },
      {
        source: "Open web",
        title: "Evidence-first agent tutorial",
        note: "Example independent confirmation",
      },
    ],
    limitations: ["Relative content performance requires real age-adjusted observations."],
  },
  WAIT: {
    ...shared,
    action: "WAIT",
    channel: "No channel",
    format: "No asset",
    topic: "No move clears the quality floor",
    hook: "Do not force a post from thin evidence.",
    angle:
      "Protect the founder’s credibility and re-check when demand or a conversation creates a defensible window.",
    whyNow:
      "The example signals share one origin and demand is flat, so publishing would overstate momentum.",
    signalClass: "INSUFFICIENT_SIGNAL",
    confidence: 0.89,
    validUntil: "Re-check in 72 hours",
    outline: [
      "Keep the strongest query cluster for the next scan.",
      "Watch for an independent discussion or measured demand change.",
      "Prepare a product-specific example, but do not publish yet.",
    ],
    evidence: [],
    limitations: ["WAIT is a useful outcome, not a failed scan."],
  },
};

type ReviewableAction = "PUBLISH" | "REPLY" | "REMIX" | "WAIT";
type ReviewableSignalClass =
  | "MEASURED_EXTERNAL_SERIES"
  | "MEASURED_INTERNAL_VELOCITY"
  | "CORROBORATED_SIGNAL"
  | "EMERGING_SIGNAL"
  | "INSUFFICIENT_SIGNAL";

export type ReviewableEvidenceReceipt = {
  bindingRole: "DECISION_SUPPORT" | "SUPPLEMENTAL";
  availability: "AVAILABLE" | "SOURCE_NO_LONGER_AVAILABLE" | "REJECTED";
  verified: boolean;
  source: string;
  canonicalUrl: string;
};

function originalUrl(receipt: ReviewableEvidenceReceipt): URL | null {
  try {
    const url = new URL(receipt.canonicalUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function independenceKey(receipt: ReviewableEvidenceReceipt): string | null {
  const url = originalUrl(receipt);
  if (!url) return null;
  const host = url.hostname.toLocaleLowerCase("en").replace(/^www\./, "");
  const source = receipt.source.toLocaleLowerCase("en");
  if (source === "x" || host === "x.com" || host === "twitter.com") return "platform:x";
  if (source === "hacker_news" || host === "news.ycombinator.com" || host === "hn.algolia.com") {
    return "platform:hacker_news";
  }
  if (source === "github" || host === "github.com") return "platform:github";
  if (source === "youtube" || host === "youtube.com" || host === "youtu.be") {
    return "platform:youtube";
  }
  if (source === "google_trends" || host === "trends.google.com") {
    return "platform:google_trends";
  }
  if (source === "reddit" || host === "reddit.com" || host.endsWith(".reddit.com")) {
    return "platform:reddit";
  }
  return `domain:${host}`;
}

/**
 * Revalidates the persisted action against the exact decision-support receipts.
 * Supplemental founder evidence never upgrades the synthesized quality floor.
 */
export function requireDecisionEvidenceQuality(input: {
  action: ReviewableAction;
  signalClass: ReviewableSignalClass;
  receipts: readonly ReviewableEvidenceReceipt[];
}): { evidenceCount: number; independentSourceCount: number } {
  if (input.action === "WAIT") return { evidenceCount: 0, independentSourceCount: 0 };

  const support = input.receipts.filter((receipt) => receipt.bindingRole === "DECISION_SUPPORT");
  if (support.length === 0) {
    throw new Error("A non-WAIT move requires verified stored decision-support evidence");
  }
  if (
    support.some((receipt) => receipt.availability !== "AVAILABLE" || receipt.verified !== true)
  ) {
    throw new Error(
      "Every decision-support receipt must remain available and founder verified before approval",
    );
  }

  const independenceKeys = support.map(independenceKey);
  if (independenceKeys.some((key) => key === null)) {
    throw new Error("Decision-support evidence requires valid original HTTP URLs");
  }
  const independentSourceCount = new Set(independenceKeys as string[]).size;
  if (input.action === "PUBLISH" && (support.length < 2 || independentSourceCount < 2)) {
    throw new Error("PUBLISH requires two available, verified, independent evidence receipts");
  }
  if (input.signalClass === "CORROBORATED_SIGNAL" && independentSourceCount < 2) {
    throw new Error("A corroborated signal requires two independent decision-support receipts");
  }
  return { evidenceCount: support.length, independentSourceCount };
}

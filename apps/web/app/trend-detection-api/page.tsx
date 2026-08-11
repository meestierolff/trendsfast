import type { Metadata } from "next";
import { IntentPage } from "../../components/intent-page";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Trend detection API with evidence receipts",
  description:
    "Detect relevant social and search trends with explicit measured, corroborated, emerging, and insufficient-signal truth classes.",
  path: "/trend-detection-api",
});

export default function TrendDetectionApiPage() {
  return (
    <IntentPage
      eyebrow="TREND DETECTION API"
      title="Recent is not the same as trending."
      intro="TrendsFast keeps measured series, internally observed velocity, independent corroboration, emerging signals, and insufficient evidence separate."
      points={[
        {
          title: "Measured stays measured",
          text: "Time series and repeated snapshots can support momentum. A single recent post cannot become a velocity claim.",
        },
        {
          title: "Independence is explicit",
          text: "Five articles copied from one announcement remain one origin. Cross-source confirmation requires independent evidence lineage.",
        },
        {
          title: "The floor can stop the move",
          text: "Weak freshness, relevance, credibility, independence, or coverage returns WAIT with visible limitations.",
        },
      ]}
    />
  );
}

import type { Metadata } from "next";
import { IntentPage } from "../../components/intent-page";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Content distribution API for founders and agents",
  description:
    "Turn a product URL and current evidence into one content angle, hook, format, and distribution channel without auto-publishing.",
  path: "/content-distribution-api",
});

export default function ContentDistributionApiPage() {
  return (
    <IntentPage
      eyebrow="CONTENT DISTRIBUTION API"
      title="Give your agent a decision, not a content calendar."
      intro="TrendsFast recommends the one channel and format that best fit the evidence and founder—not every channel at once."
      points={[
        {
          title: "Evidence source is not output channel",
          text: "Search or GitHub evidence may point to a LinkedIn explanation; an X conversation may support a deeper owned article.",
        },
        {
          title: "One move is one action",
          text: "A Next Move can power a post, reply, thread, article, short video, tutorial, or brief. It is not promised as a finished asset.",
        },
        {
          title: "You stay in control",
          text: "No social-account connection and no auto-publishing. The founder reviews, edits, and chooses whether to act.",
        },
      ]}
    />
  );
}

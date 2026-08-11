import type { Metadata } from "next";
import { IntentPage } from "../../components/intent-page";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Social media trend API for AI agents",
  description:
    "A social media trend API that turns relevant social and search evidence into one topic, hook, format, and distribution channel for AI agents.",
  path: "/social-media-trend-api",
});

export default function SocialMediaTrendApiPage() {
  return (
    <IntentPage
      eyebrow="SOCIAL MEDIA TREND API"
      title="Turn relevant social trends into one next move."
      intro="TrendsFast combines product context with bounded social, search, developer, news, and content signals. It returns a decision your agent can use—not a firehose of posts."
      points={[
        {
          title: "Relevant before popular",
          text: "A signal must fit the product, buyer, founder credibility, timing, and available format before it can become a recommendation.",
        },
        {
          title: "Receipts before generation",
          text: "Original evidence is stored and ranked before synthesis. The model cannot invent a URL, metric, source, or trend class.",
        },
        {
          title: "One action, including WAIT",
          text: "PUBLISH, REPLY, REMIX, or WAIT keeps agents focused on the next defensible action rather than endless trend browsing.",
        },
      ]}
    />
  );
}

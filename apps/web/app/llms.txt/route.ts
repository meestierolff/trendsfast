import { absoluteUrl, SITE_GITHUB_URL } from "../../lib/site";

export const dynamic = "force-static";

export function GET() {
  const body = `# TrendsFast

> TrendsFast is the social and search trend intelligence API for founders and their AI agents.

TrendsFast accepts a public product URL and returns exactly one evidence-backed Next Move: PUBLISH, REPLY, REMIX, or WAIT. A move contains a relevant topic, recommended distribution channel, angle, hook, format, outline, why-now explanation, original evidence receipts, signal truth class, freshness, confidence, limitations, and a validity window.

## Product rules

- Recent is not automatically trending.
- A model cannot add evidence URLs or unsupported metrics.
- Copied coverage does not become independent confirmation.
- WAIT is a valid result when evidence does not clear the quality floor.
- TrendsFast does not connect social accounts or auto-publish.
- Public source labels require deployed read-back evidence.

## Public resources

- Home: ${absoluteUrl("/")}
- AI agents: ${absoluteUrl("/agents")}
- Developer docs: ${absoluteUrl("/docs")}
- Source status: ${absoluteUrl("/sources")}
- Channels: ${absoluteUrl("/channels")}
- Pricing: ${absoluteUrl("/pricing")}
- Blog: ${absoluteUrl("/blog")}
- News: ${absoluteUrl("/news")}
- Open source: ${SITE_GITHUB_URL}
- OpenAPI: ${absoluteUrl("/v1/openapi.json")}

## Capability truth

Available for approved projects: REST API, structured Next Move JSON, asynchronous status polling, project-scoped API keys, and HTTP workflow examples.

Coming soon: TrendsFast CLI, MCP server, and native connectors. A generic HTTP example is not a native integration.
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

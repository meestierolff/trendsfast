import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  ProviderBudget,
  ProviderCircuitBreaker,
  createProviderContext,
  createWebsiteAdapter,
  executeProvider,
} from "@trendsfast/providers";
import {
  deriveProjectContextProfile,
  inferWebsiteOnlyProjectContext,
  type ProjectContextProfile,
} from "@trendsfast/orchestration";
import { SignalSchema, type ProjectContext, type Signal } from "@trendsfast/schemas";

const WEBSITE_CONTEXT_DEADLINE_MS = 15_000;

export class WebsiteContextResolutionError extends Error {
  constructor(message = "The public website could not be read safely.") {
    super(message);
    this.name = "WebsiteContextResolutionError";
  }
}

export type WebsiteContextResolution = {
  context: ProjectContext;
  profile: ProjectContextProfile;
  sourceContentHash: string;
  observedPageCount: number;
};

export type WebsiteContextReader = (url: string) => Promise<Signal[]>;

async function readBoundedWebsiteContext(url: string): Promise<Signal[]> {
  const adapter = createWebsiteAdapter();
  const deadline = new Date(Date.now() + WEBSITE_CONTEXT_DEADLINE_MS);
  const result = await executeProvider(
    adapter,
    {
      scanId: `context_${randomUUID()}`,
      productUrl: url,
      queries: [
        {
          id: `context_${randomUUID()}`,
          provider: "website",
          role: "product_context",
          query: new URL(url).hostname.slice(0, 180),
          // The website adapter treats this as one query while independently
          // enforcing its five-page same-origin crawl and byte ceilings.
          limit: 5,
        },
      ],
    },
    {
      context: createProviderContext({
        credentialMode: "managed",
        // This context is intentionally incapable of supplying paid-provider
        // credentials. Only the zero-cost website adapter is instantiated.
        env: {},
        deadline,
      }),
      budget: new ProviderBudget(0),
      circuitBreaker: new ProviderCircuitBreaker(),
      deadline,
    },
  );
  const signals = result.signals
    .map((signal) => SignalSchema.safeParse(signal))
    .filter((parsed): parsed is { success: true; data: Signal } => parsed.success)
    .map((parsed) => parsed.data)
    .filter((signal) => signal.source === "website");
  if (signals.length === 0) throw new WebsiteContextResolutionError();
  return signals;
}

export async function resolveWebsiteOnlyContext(
  url: string,
  options: { readWebsite?: WebsiteContextReader } = {},
): Promise<WebsiteContextResolution> {
  let signals: Signal[];
  try {
    signals = await (options.readWebsite ?? readBoundedWebsiteContext)(url);
  } catch (error) {
    if (error instanceof WebsiteContextResolutionError) throw error;
    throw new WebsiteContextResolutionError();
  }
  const websiteSignals = signals.filter((signal) => signal.source === "website").slice(0, 5);
  if (websiteSignals.length === 0) throw new WebsiteContextResolutionError();
  try {
    const context = inferWebsiteOnlyProjectContext(url, websiteSignals);
    const profile = deriveProjectContextProfile(context, websiteSignals);
    const sourceContentHash = createHash("sha256")
      .update(
        JSON.stringify(
          websiteSignals.map((signal) => ({
            url: signal.url,
            title: signal.title ?? null,
            textExcerpt: signal.textExcerpt ?? null,
            rawPayloadHash: signal.provenance.rawPayloadHash ?? null,
          })),
        ),
      )
      .digest("hex");
    return { context, profile, sourceContentHash, observedPageCount: websiteSignals.length };
  } catch {
    throw new WebsiteContextResolutionError(
      "The website was read, but a safe product context could not be derived.",
    );
  }
}

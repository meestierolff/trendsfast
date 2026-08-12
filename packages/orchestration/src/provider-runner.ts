import {
  ProviderBudget,
  ProviderCircuitBreaker,
  executeProvider,
  type ProviderAdapter,
  type ProviderExecutionContext,
  type ProviderQuery,
  type ProviderSlug,
} from "@trendsfast/providers";
import type { ProviderRunner } from "./state-machine";

export const DEFAULT_PROVIDER_ORDER: ProviderSlug[] = [
  "website",
  "google_trends",
  "hacker_news",
  "github",
  "x",
  "tavily",
  "youtube",
  "manual",
];

function request(
  provider: ProviderSlug,
  scanId: string,
  productUrl: string | undefined,
  queries: ProviderQuery[],
) {
  return {
    scanId,
    ...(productUrl ? { productUrl } : {}),
    queries: queries.filter((query) => query.provider === provider),
  };
}

export function createProviderRunner(input: {
  registry: ReadonlyMap<ProviderSlug, ProviderAdapter>;
  context: ProviderExecutionContext;
  circuitBreaker?: ProviderCircuitBreaker;
}): ProviderRunner {
  const circuitBreaker = input.circuitBreaker ?? new ProviderCircuitBreaker();
  return {
    order: DEFAULT_PROVIDER_ORDER.filter((slug) => input.registry.has(slug)),
    estimate(provider, queries) {
      const adapter = input.registry.get(provider);
      if (!adapter) return 0;
      return adapter.estimate(request(provider, "estimate", undefined, queries), input.context)
        .estimatedUsd;
    },
    async execute(provider, work, budget) {
      const adapter = input.registry.get(provider);
      if (!adapter) throw new Error(`Provider adapter ${provider} is not registered`);
      const remainingMs = Math.max(1, budget.deadline.getTime() - input.context.now().getTime());
      const boundedAdapter: ProviderAdapter = {
        ...adapter,
        metadata: {
          ...adapter.metadata,
          timeoutMs: Math.min(adapter.metadata.timeoutMs, remainingMs),
        },
      };
      return executeProvider(
        boundedAdapter,
        request(provider, work.scanId, work.productUrl, work.queries),
        {
          context: input.context,
          budget: new ProviderBudget(budget.remainingUsd),
          circuitBreaker,
          deadline: budget.deadline,
          beforeAttempt: budget.reserveAttempt,
          afterAttempt: budget.settleAttempt,
        },
      );
    },
  };
}

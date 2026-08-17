import {
  ProviderBudget,
  ProviderCircuitBreaker,
  executeProvider,
  type ProviderAdapter,
  type ProviderExecutionContext,
  type ProviderQuery,
  type ProviderSlug,
} from "@trendsfast/providers";
import type { ProviderExecutionEligibility, ProviderRunner } from "./state-machine";

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
  eligibility?: ReadonlyMap<ProviderSlug, ProviderExecutionEligibility>;
  circuitBreaker?: ProviderCircuitBreaker;
}): ProviderRunner {
  if (input.context.credentialMode !== "fixture") {
    if (!input.eligibility) throw new Error("LIVE_PROVIDER_ELIGIBILITY_REQUIRED");
    for (const provider of input.registry.keys()) {
      if (!input.eligibility.has(provider)) {
        throw new Error(`LIVE_PROVIDER_ELIGIBILITY_MISSING:${provider}`);
      }
    }
  }
  const circuitBreaker = input.circuitBreaker ?? new ProviderCircuitBreaker();
  const eligibility = (provider: ProviderSlug): ProviderExecutionEligibility => {
    const projected = input.eligibility?.get(provider);
    if (projected) return projected;
    return input.context.credentialMode === "fixture"
      ? { eligible: true }
      : {
          eligible: false,
          code: "PROVIDER_VERIFICATION_UNAVAILABLE",
          message: "Source skipped because exact production provider verification is unavailable.",
        };
  };
  return {
    order: DEFAULT_PROVIDER_ORDER.filter((slug) => input.registry.has(slug)),
    requiresFreshRunEvidence: input.context.credentialMode !== "fixture",
    eligibility,
    estimate(provider, queries) {
      if (!eligibility(provider).eligible) return 0;
      const adapter = input.registry.get(provider);
      if (!adapter) return 0;
      return adapter.estimate(request(provider, "estimate", undefined, queries), input.context)
        .estimatedUsd;
    },
    async execute(provider, work, budget) {
      const projected = eligibility(provider);
      if (!projected.eligible) throw new Error(projected.code);
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

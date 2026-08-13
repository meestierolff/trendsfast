import type {
  ProductQueryContext,
  ProviderQuery,
  ProviderQueryRole,
  ProviderSlug,
  QueryPlan,
} from "./types";
import { cleanText, queryString, stableId } from "./util";

export const PROVIDER_LIMITS = {
  website: { maxQueries: 1, maxCalls: 5, maxResultsPerCall: 5, maxResults: 5 },
  google_trends: { maxQueries: 5, maxCalls: 1, maxResultsPerCall: 5, maxResults: 10 },
  hacker_news: { maxQueries: 5, maxCalls: 5, maxResultsPerCall: 10, maxResults: 30 },
  github: { maxQueries: 3, maxCalls: 3, maxResultsPerCall: 10, maxResults: 20 },
  x: { maxQueries: 2, maxCalls: 2, maxResultsPerCall: 10, maxResults: 20 },
  tavily: { maxQueries: 2, maxCalls: 2, maxResultsPerCall: 10, maxResults: 20 },
  youtube: { maxQueries: 2, maxCalls: 3, maxResultsPerCall: 10, maxResults: 20 },
  manual: { maxQueries: 0, maxCalls: 0, maxResultsPerCall: 20, maxResults: 20 },
} as const;

type QuerySeed = {
  provider: ProviderSlug;
  role: ProviderQueryRole;
  query: string;
  limit: number;
  lookbackHours?: number;
};

export type BuildQueryPlanOptions = {
  productUrl: string;
  now?: Date;
  market?: string;
  language?: string;
};

function first(values: string[], fallback: string): string {
  return cleanText(values[0]) ?? fallback;
}

function distinct(values: string[], maximum: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = cleanText(value, 100);
    if (!clean) continue;
    const key = clean.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= maximum) break;
  }
  return output;
}

export function buildQueryPlan(
  context: ProductQueryContext,
  options: BuildQueryPlanOptions,
): QueryPlan {
  const category = cleanText(context.category) ?? "developer tools";
  const pain = cleanText(context.pain) ?? category;
  const outcome = cleanText(context.desiredOutcome) ?? category;
  const productTerm = first(context.productTerminology, category);
  const buyerTerm = first(context.buyerTerminology, "technical founders");
  const credibleTopic = first(context.credibleTopics, category);
  const adjacent = first(context.adjacentNarratives, category);
  const trigger = first(context.triggerEvents, `new ${category} launches`);
  const competitor = first(context.competitors, first(context.alternatives, category));
  const repository = first(context.repositories, productTerm);

  const trendKeywords = distinct(
    [productTerm, category, credibleTopic, outcome, buyerTerm],
    PROVIDER_LIMITS.google_trends.maxQueries,
  );
  while (trendKeywords.length < PROVIDER_LIMITS.google_trends.maxQueries) {
    trendKeywords.push(
      `${category} ${["software", "tools", "workflow", "platform", "research"][trendKeywords.length]}`,
    );
  }

  const seeds: QuerySeed[] = [
    {
      provider: "website",
      role: "product_context",
      query: options.productUrl,
      limit: 1,
    },
    ...trendKeywords.map((keyword, index): QuerySeed => ({
      provider: "google_trends",
      role: index === 4 ? "related_rising_query" : "search_demand",
      query: keyword,
      limit: 1,
    })),
    {
      provider: "hacker_news",
      role: "developer_pain",
      query: queryString([`Ask HN`, pain, buyerTerm]),
      limit: 10,
      lookbackHours: 168,
    },
    {
      provider: "hacker_news",
      role: "launch_narrative",
      query: queryString([`Show HN`, category, productTerm]),
      limit: 10,
      lookbackHours: 168,
    },
    {
      provider: "hacker_news",
      role: "developer_pain",
      query: queryString([category, `problem`, pain]),
      limit: 10,
      lookbackHours: 168,
    },
    {
      provider: "hacker_news",
      role: "launch_narrative",
      query: queryString([credibleTopic, `developer workflow`]),
      limit: 10,
      lookbackHours: 168,
    },
    {
      provider: "hacker_news",
      role: "developer_pain",
      query: queryString([buyerTerm, outcome, `discussion`]),
      limit: 10,
      lookbackHours: 168,
    },
    {
      provider: "github",
      role: "repository_adoption",
      query: queryString([repository, `in:name,description`]),
      limit: 10,
      lookbackHours: 720,
    },
    {
      provider: "github",
      role: "issue_pain",
      query: queryString([`"${pain}"`, `is:issue`]),
      limit: 10,
      lookbackHours: 720,
    },
    {
      provider: "github",
      role: "release_activity",
      query: /^[\w.-]+\/[\w.-]+$/.test(repository)
        ? repository
        : queryString([
            category,
            `pushed:>=${new Date((options.now ?? new Date()).getTime() - 30 * 86_400_000).toISOString().slice(0, 10)}`,
          ]),
      limit: 10,
      lookbackHours: 720,
    },
    {
      provider: "x",
      role: "current_narrative",
      query: queryString([buyerTerm, adjacent, `current discussion`]),
      limit: 10,
      lookbackHours: 72,
    },
    {
      provider: "x",
      role: "reply_opportunity",
      query: queryString([pain, `founder`, `question OR help`]),
      limit: 10,
      lookbackHours: 72,
    },
    {
      provider: "tavily",
      role: "news_trigger",
      query: queryString([trigger, category, `latest news`]),
      limit: 10,
      lookbackHours: 168,
    },
    {
      provider: "tavily",
      role: "independent_verification",
      query: queryString([competitor, credibleTopic, `launch analysis`]),
      limit: 10,
      lookbackHours: 720,
    },
    {
      provider: "youtube",
      role: "video_traction",
      query: queryString([category, credibleTopic, `tutorial`]),
      limit: 10,
      lookbackHours: 720,
    },
    {
      provider: "youtube",
      role: "content_format",
      query: queryString([buyerTerm, outcome, `demo`]),
      limit: 10,
      lookbackHours: 720,
    },
  ];

  const market = cleanText(options.market, 16);
  const language = cleanText(options.language, 16);
  const entries = seeds.map((seed, index): ProviderQuery => {
    const base = {
      id: stableId("query", `${seed.provider}:${seed.role}:${seed.query}:${index}`),
      provider: seed.provider,
      role: seed.role,
      query: seed.query.slice(0, 180),
      limit: seed.limit,
    };
    return {
      ...base,
      ...(seed.lookbackHours === undefined ? {} : { lookbackHours: seed.lookbackHours }),
      ...(market === undefined ? {} : { market }),
      ...(language === undefined ? {} : { language }),
    };
  });

  return {
    version: "query-plan-v1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    entries,
  };
}

export function validateQueryPlan(plan: QueryPlan): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of plan.entries) {
    const limits = PROVIDER_LIMITS[entry.provider];
    if (ids.has(entry.id)) errors.push(`duplicate query id (${entry.id})`);
    ids.add(entry.id);
    if (!entry.query.trim()) errors.push(`${entry.provider} has an empty query`);
    if (entry.query.length > 180) errors.push(`${entry.provider} query exceeds 180 characters`);
    if (entry.limit < 1 || entry.limit > limits.maxResultsPerCall) {
      errors.push(`${entry.provider} query result limit is outside 1-${limits.maxResultsPerCall}`);
    }
  }
  for (const provider of Object.keys(PROVIDER_LIMITS) as ProviderSlug[]) {
    const count = plan.entries.filter((entry) => entry.provider === provider).length;
    const maximum = PROVIDER_LIMITS[provider].maxQueries;
    if (count > maximum) errors.push(`${provider} exceeds max queries per scan (${maximum})`);
  }
  return errors;
}

export function assertValidQueryPlan(plan: QueryPlan): void {
  const errors = validateQueryPlan(plan);
  if (errors.length > 0) throw new Error(`Invalid query plan: ${errors.join("; ")}`);
}

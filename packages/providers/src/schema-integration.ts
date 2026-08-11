import type { ProjectContext, QueryPlan as StoredQueryPlan } from "@trendsfast/schemas";

import { PROVIDER_LIMITS } from "./query-plan";
import type { ProductQueryContext, ProviderQueryRole, ProviderSlug, QueryPlan } from "./types";
import { stableId } from "./util";

export function projectContextToProductQueryContext(project: ProjectContext): ProductQueryContext {
  return {
    category: project.category,
    pain: project.problem,
    desiredOutcome: project.desiredOutcome,
    productTerminology: [project.name, project.category, ...project.credibleClaims].slice(0, 10),
    buyerTerminology: [project.audience],
    alternatives: project.alternatives,
    competitors: project.competitors,
    adjacentNarratives: project.credibleTopics,
    credibleTopics: project.credibleTopics,
    triggerEvents: project.credibleTopics.slice(0, 5).map((topic) => `${topic} launch`),
    repositories: [],
  };
}

type StoredPlanIdentity = {
  id: string;
  projectContextVersionId: string;
};

export function toStoredQueryPlan(
  runtimePlan: QueryPlan,
  identity: StoredPlanIdentity,
): StoredQueryPlan {
  const providers = runtimePlan.entries.map((entry) => {
    const limits = PROVIDER_LIMITS[entry.provider];
    return {
      id: entry.id,
      source: entry.provider,
      role: entry.role,
      terms: [entry.query],
      constraints: {
        maxCalls: Math.min(1, limits.maxCalls),
        maxResults: Math.min(limits.maxResultsPerCall, entry.limit),
        ...(entry.lookbackHours === undefined ? {} : { lookbackHours: entry.lookbackHours }),
        ...(entry.market === undefined ? {} : { market: entry.market }),
        ...(entry.language === undefined ? {} : { language: entry.language }),
      },
    };
  });
  return {
    id: identity.id,
    projectContextVersionId: identity.projectContextVersionId,
    version: runtimePlan.version,
    generatedAt: runtimePlan.generatedAt,
    providers,
  };
}

const PROVIDER_SLUGS = new Set<ProviderSlug>([
  "website",
  "google_trends",
  "hacker_news",
  "github",
  "x",
  "tavily",
  "youtube",
  "manual",
]);

const QUERY_ROLES = new Set<ProviderQueryRole>([
  "product_context",
  "search_demand",
  "related_rising_query",
  "developer_pain",
  "launch_narrative",
  "repository_adoption",
  "issue_pain",
  "release_activity",
  "current_narrative",
  "reply_opportunity",
  "news_trigger",
  "independent_verification",
  "video_traction",
  "content_format",
  "manual_evidence",
]);

export function fromStoredQueryPlan(stored: StoredQueryPlan): QueryPlan {
  const entries: QueryPlan["entries"] = [];
  const counts = new Map<ProviderSlug, number>();
  for (const group of stored.providers) {
    if (!PROVIDER_SLUGS.has(group.source as ProviderSlug)) {
      throw new Error(`Stored query plan contains unsupported source ${group.source}`);
    }
    if (!QUERY_ROLES.has(group.role as ProviderQueryRole)) {
      throw new Error(`Stored query plan contains unsupported role ${group.role}`);
    }
    const provider = group.source as ProviderSlug;
    const role = group.role as ProviderQueryRole;
    const limits = PROVIDER_LIMITS[provider];
    let count = counts.get(provider) ?? 0;
    for (const [index, term] of group.terms.entries()) {
      if (count >= limits.maxQueries || group.constraints.maxResults < 1) break;
      entries.push({
        id: index === 0 ? group.id : stableId("query", `${group.id}:${index}:${term}`),
        provider,
        role,
        query: term.slice(0, 180),
        limit: Math.max(1, Math.min(limits.maxResultsPerCall, group.constraints.maxResults)),
        ...(group.constraints.lookbackHours === undefined
          ? {}
          : { lookbackHours: group.constraints.lookbackHours }),
        ...(group.constraints.market === undefined ? {} : { market: group.constraints.market }),
        ...(group.constraints.language === undefined
          ? {}
          : { language: group.constraints.language }),
      });
      count += 1;
    }
    counts.set(provider, count);
  }
  return {
    version: "query-plan-v1",
    generatedAt: stored.generatedAt,
    entries,
  };
}

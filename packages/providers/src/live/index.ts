export { createWebsiteAdapter } from "./website";
export { createHackerNewsAdapter } from "./hacker-news";
export { createGitHubAdapter } from "./github";
export { createGoogleTrendsAdapter } from "./google-trends";
export { createXAdapter } from "./x";
export { createTavilyAdapter } from "./tavily";
export { createYouTubeAdapter } from "./youtube";
export { createManualEvidenceAdapter } from "./manual";

import type { CredentialMode, ProviderAdapter, ProviderSlug } from "../types";
import { createFixtureAdapters } from "../fixtures";
import { createGitHubAdapter } from "./github";
import { createGoogleTrendsAdapter } from "./google-trends";
import { createHackerNewsAdapter } from "./hacker-news";
import { createManualEvidenceAdapter } from "./manual";
import { createTavilyAdapter } from "./tavily";
import { createWebsiteAdapter } from "./website";
import { createXAdapter } from "./x";
import { createYouTubeAdapter } from "./youtube";

export function createLiveAdapters(): ProviderAdapter[] {
  return [
    createWebsiteAdapter(),
    createGoogleTrendsAdapter(),
    createHackerNewsAdapter(),
    createGitHubAdapter(),
    createXAdapter(),
    createTavilyAdapter(),
    createYouTubeAdapter(),
    createManualEvidenceAdapter(),
  ];
}

export function createProviderRegistry(
  credentialMode: CredentialMode,
): ReadonlyMap<ProviderSlug, ProviderAdapter> {
  const adapters = credentialMode === "fixture" ? createFixtureAdapters() : createLiveAdapters();
  return new Map(adapters.map((adapter) => [adapter.metadata.slug, adapter]));
}

export function createLiveProviderRegistry(): ReadonlyMap<ProviderSlug, ProviderAdapter> {
  return new Map(createLiveAdapters().map((adapter) => [adapter.metadata.slug, adapter]));
}

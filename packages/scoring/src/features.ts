import type {
  OpportunityScoreComponents,
  ScoringSignal,
  SignalCluster,
  TrendSignalClass,
} from "./types";
import {
  canonicalizeSignalUrl,
  countIndependentSources,
  signalTopicSimilarity,
  sourceIndependenceKey,
} from "./clustering";
import { jaccardSimilarity, overlapCoverage, textTokens } from "./text";

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function logarithmic(value: number | undefined, reference: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return clamp(Math.log1p(value) / Math.log1p(reference));
}

export function recencyScore(signal: ScoringSignal, now = new Date()): number {
  const timestamp = new Date(signal.publishedAt ?? signal.observedAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const ageHours = Math.max(0, (now.getTime() - timestamp) / 3_600_000);
  return clamp(Math.exp(-ageHours / 96));
}

export function sourceSpecificRelativeEngagement(signal: ScoringSignal): number {
  const metrics = signal.metrics;
  const published = new Date(signal.publishedAt ?? signal.observedAt).getTime();
  const observed = new Date(signal.observedAt).getTime();
  const ageHours =
    Number.isFinite(published) && Number.isFinite(observed)
      ? Math.max(1, (observed - published) / 3_600_000)
      : 24;
  switch (signal.source) {
    case "x": {
      const interactions =
        (metrics.likes ?? 0) + (metrics.comments ?? 0) * 2 + (metrics.shares ?? 0) * 2;
      const rate = metrics.views && metrics.views > 0 ? interactions / metrics.views : 0;
      const viewsPerHour = metrics.views === undefined ? undefined : metrics.views / ageHours;
      return clamp(0.55 * logarithmic(viewsPerHour, 20_000) + 0.45 * clamp(rate / 0.08));
    }
    case "hacker_news":
      return clamp(
        0.65 * logarithmic(metrics.points, 500) + 0.35 * logarithmic(metrics.comments, 250),
      );
    case "github":
      return clamp(
        0.65 * logarithmic(metrics.stars, 10_000) +
          0.2 * logarithmic(metrics.forks, 2_000) +
          0.15 * logarithmic(metrics.comments, 500),
      );
    case "youtube": {
      const engagement = (metrics.likes ?? 0) + (metrics.comments ?? 0) * 2;
      const rate = metrics.views && metrics.views > 0 ? engagement / metrics.views : 0;
      const viewsPerDay =
        metrics.views === undefined ? undefined : metrics.views / Math.max(1 / 24, ageHours / 24);
      return clamp(0.65 * logarithmic(viewsPerDay, 100_000) + 0.35 * clamp(rate / 0.08));
    }
    default:
      return 0;
  }
}

const SOURCE_QUALITY: Record<string, number> = {
  google_trends: 0.95,
  github: 0.9,
  hacker_news: 0.85,
  website: 0.8,
  manual: 0.8,
  youtube: 0.75,
  tavily: 0.72,
  x: 0.7,
};

export function sourceQualityScore(signal: ScoringSignal): number {
  return SOURCE_QUALITY[signal.source] ?? 0.5;
}

export type DeterministicSignalFeatures = {
  recency: number;
  productRelevance: number;
  audienceRelevance: number;
  relativeEngagement: number;
  queryRelevance: number;
  duplicateUrl: boolean;
  semanticSimilarity: number;
  entityOverlap: number;
  independenceKey: string;
  independentSourceCount: number;
  sourceQuality: number;
  novelty: number;
  saturationProxy: number;
  productCredibility: number;
  channelFit: number;
  formatFit: number;
  evidenceCompleteness: number;
};

export type CalculateSignalFeaturesInput = {
  signal: ScoringSignal;
  peers?: ScoringSignal[];
  query: string;
  audienceTerms: string[];
  productTerms: string[];
  credibleTerms: string[];
  historicalTopicTerms?: string[];
  channelFit?: number;
  formatFit?: number;
  now?: Date;
};

function validEvidenceFieldScore(signal: ScoringSignal): number {
  let urlValid = false;
  try {
    const url = new URL(signal.url);
    urlValid =
      (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    urlValid = false;
  }
  const checks = [
    urlValid,
    Boolean(signal.source),
    Boolean(signal.sourceId),
    Boolean(signal.observedAt && Number.isFinite(new Date(signal.observedAt).getTime())),
    Boolean(signal.queryId),
    Boolean(signal.provenance.provider),
    Boolean(signal.provenance.retrievedAt),
  ];
  return checks.filter(Boolean).length / checks.length;
}

export function calculateDeterministicSignalFeatures(
  input: CalculateSignalFeaturesInput,
): DeterministicSignalFeatures {
  const peers = input.peers ?? [];
  const signalTokens = textTokens(`${input.signal.title ?? ""} ${input.signal.textExcerpt ?? ""}`);
  const queryTokens = textTokens(input.query);
  const audienceTokens = textTokens(input.audienceTerms.join(" "));
  const productTokens = textTokens(input.productTerms.join(" "));
  const credibleTokens = textTokens(input.credibleTerms.join(" "));
  const historicalTokens = textTokens((input.historicalTopicTerms ?? []).join(" "));
  const entityTokens = signalTokens.filter(
    (token) => token.includes("#") || token.includes("+") || token.length >= 6,
  );
  const credibleEntities = credibleTokens.filter(
    (token) => token.includes("#") || token.includes("+") || token.length >= 6,
  );
  let canonicalUrl: string | undefined;
  try {
    canonicalUrl = canonicalizeSignalUrl(input.signal.url);
  } catch {
    canonicalUrl = undefined;
  }
  const duplicateUrl =
    canonicalUrl !== undefined &&
    peers.some((peer) => {
      try {
        return canonicalizeSignalUrl(peer.url) === canonicalUrl;
      } catch {
        return false;
      }
    });
  const semanticSimilarity = peers.length
    ? Math.max(...peers.map((peer) => signalTopicSimilarity(input.signal, peer)))
    : 0;
  const recency = recencyScore(input.signal, input.now);
  const relativeEngagement = sourceSpecificRelativeEngagement(input.signal);
  return {
    recency,
    productRelevance: overlapCoverage(signalTokens, productTokens),
    audienceRelevance: overlapCoverage(signalTokens, audienceTokens),
    relativeEngagement,
    queryRelevance: jaccardSimilarity(signalTokens, queryTokens),
    duplicateUrl,
    semanticSimilarity,
    entityOverlap: jaccardSimilarity(entityTokens, credibleEntities),
    independenceKey: sourceIndependenceKey(input.signal),
    independentSourceCount: countIndependentSources([input.signal, ...peers]),
    sourceQuality: sourceQualityScore(input.signal),
    novelty:
      historicalTokens.length === 0 ? 1 : 1 - jaccardSimilarity(signalTokens, historicalTokens),
    saturationProxy: clamp(relativeEngagement * (1 - recency) + (duplicateUrl ? 0.2 : 0)),
    productCredibility: overlapCoverage(signalTokens, credibleTokens),
    channelFit: clamp(input.channelFit ?? 0.5),
    formatFit: clamp(input.formatFit ?? 0.5),
    evidenceCompleteness: validEvidenceFieldScore(input.signal),
  };
}

function clusterTokens(cluster: SignalCluster): string[] {
  return textTokens(
    cluster.signals.map((signal) => `${signal.title ?? ""} ${signal.textExcerpt ?? ""}`).join(" "),
  );
}

function relevance(tokens: string[], terms: string[]): number {
  const target = textTokens(terms.join(" "));
  return clamp(overlapCoverage(tokens, target));
}

function momentumScore(signalClass: TrendSignalClass): number {
  switch (signalClass) {
    case "MEASURED_EXTERNAL_SERIES":
      return 1;
    case "MEASURED_INTERNAL_VELOCITY":
      return 0.95;
    case "CORROBORATED_SIGNAL":
      return 0.8;
    case "EMERGING_SIGNAL":
      return 0.55;
    case "INSUFFICIENT_SIGNAL":
      return 0;
  }
}

export type DeriveScoreComponentsInput = {
  cluster: SignalCluster;
  audienceTerms: string[];
  productTerms: string[];
  credibleTerms: string[];
  signalClass: TrendSignalClass;
  now?: Date;
  novelty?: number;
  formatFit?: number;
  saturation?: number;
};

export function deriveOpportunityScoreComponents(
  input: DeriveScoreComponentsInput,
): OpportunityScoreComponents {
  const tokens = clusterTokens(input.cluster);
  const recency = input.cluster.signals.length
    ? Math.max(...input.cluster.signals.map((signal) => recencyScore(signal, input.now)))
    : 0;
  const quality = input.cluster.signals.length
    ? input.cluster.signals.reduce((sum, signal) => sum + sourceQualityScore(signal), 0) /
      input.cluster.signals.length
    : 0;
  const relativeEngagement = input.cluster.signals.length
    ? Math.max(...input.cluster.signals.map(sourceSpecificRelativeEngagement))
    : 0;
  const defaultSaturation = clamp(
    relativeEngagement * (1 - recency) + Math.max(0, input.cluster.signals.length - 4) / 10,
  );
  return {
    audienceFit: relevance(tokens, input.audienceTerms),
    productRelevance: relevance(tokens, input.productTerms),
    measuredOrCorroboratedMomentum: momentumScore(input.signalClass),
    novelty: clamp(input.novelty ?? 0.7),
    productCredibility: relevance(tokens, input.credibleTerms),
    formatFit: clamp(input.formatFit ?? 0.5),
    remainingWindow: recency,
    sourceQuality: clamp(quality),
    saturation: clamp(input.saturation ?? defaultSaturation),
    evidenceDependency: input.cluster.independentSourceCount >= 2 ? 0 : 1,
  };
}

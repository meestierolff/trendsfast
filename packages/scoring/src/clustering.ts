import type { ScoringSignal, SignalCluster } from "./types";
import { jaccardSimilarity, scoringHash, textTokens } from "./text";

const TRACKING_PARAMETERS = new Set(["fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref_src"]);

export function canonicalizeSignalUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Signal URL must use HTTP or HTTPS");
  url.protocol = url.protocol.toLocaleLowerCase("en");
  url.hostname = url.hostname.toLocaleLowerCase("en").replace(/^www\./, "");
  if (url.hostname === "twitter.com") url.hostname = "x.com";
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLocaleLowerCase("en").startsWith("utm_") ||
      TRACKING_PARAMETERS.has(key.toLocaleLowerCase("en"))
    ) {
      url.searchParams.delete(key);
    }
  }
  const sorted = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
  );
  url.search = "";
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
  const output = url.href;
  return output.endsWith("/") && url.pathname === "/" && !url.search ? output.slice(0, -1) : output;
}

function contentTokens(signal: ScoringSignal): string[] {
  return textTokens(`${signal.title ?? ""} ${signal.textExcerpt ?? ""}`);
}

function richness(signal: ScoringSignal): number {
  return (
    (signal.title?.length ?? 0) +
    (signal.textExcerpt?.length ?? 0) +
    Object.keys(signal.metrics).length * 50 +
    Object.keys(signal.author ?? {}).length * 20 +
    (signal.publishedAt ? 20 : 0)
  );
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.parent[index]!;
    if (parent === index) return index;
    const root = this.find(parent);
    this.parent[index] = root;
    return root;
  }

  union(left: number, right: number): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a === b) return;
    if (a < b) this.parent[b] = a;
    else this.parent[a] = b;
  }
}

export type DeduplicationResult = {
  signals: ScoringSignal[];
  duplicateOf: Map<string, string>;
};

export function deduplicateSignals(input: ScoringSignal[]): DeduplicationResult {
  const signals = [...input].sort((a, b) => a.id.localeCompare(b.id));
  const union = new UnionFind(signals.length);
  const exactKeys = new Map<string, number>();
  for (let index = 0; index < signals.length; index += 1) {
    const signal = signals[index]!;
    const keys = [
      `source:${signal.source}:${signal.sourceId}`,
      `url:${canonicalizeSignalUrl(signal.url)}`,
    ];
    for (const key of keys) {
      const previous = exactKeys.get(key);
      if (previous === undefined) exactKeys.set(key, index);
      else union.union(previous, index);
    }
  }
  const groups = new Map<number, ScoringSignal[]>();
  for (let index = 0; index < signals.length; index += 1) {
    const root = union.find(index);
    const members = groups.get(root) ?? [];
    members.push(signals[index]!);
    groups.set(root, members);
  }
  const output: ScoringSignal[] = [];
  const duplicateOf = new Map<string, string>();
  for (const members of groups.values()) {
    members.sort((a, b) => richness(b) - richness(a) || a.id.localeCompare(b.id));
    const winner = members[0]!;
    output.push({ ...winner, url: canonicalizeSignalUrl(winner.url) });
    for (const duplicate of members.slice(1)) duplicateOf.set(duplicate.id, winner.id);
  }
  output.sort((a, b) => a.id.localeCompare(b.id));
  return { signals: output, duplicateOf };
}

function hostname(signal: ScoringSignal): string {
  try {
    return new URL(signal.url).hostname.toLocaleLowerCase("en").replace(/^www\./, "");
  } catch {
    return "invalid";
  }
}

export function sourceIndependenceKey(signal: ScoringSignal): string {
  const host = hostname(signal);
  const source = signal.source.toLocaleLowerCase("en");
  if (source === "x" || host === "x.com" || host === "twitter.com") return "platform:x";
  if (source === "hacker_news" || host === "news.ycombinator.com" || host === "hn.algolia.com") {
    return "platform:hacker_news";
  }
  if (source === "github" || host === "github.com") return "platform:github";
  if (source === "youtube" || host === "youtube.com" || host === "youtu.be")
    return "platform:youtube";
  if (source === "google_trends" || host === "trends.google.com") return "platform:google_trends";
  if (source === "reddit" || host === "reddit.com" || host.endsWith(".reddit.com"))
    return "platform:reddit";
  return `domain:${host}`;
}

export function countIndependentSources(signals: ScoringSignal[]): number {
  return new Set(signals.map(sourceIndependenceKey)).size;
}

function entityTokens(signal: ScoringSignal): string[] {
  return textTokens(`${signal.title ?? ""} ${signal.textExcerpt ?? ""}`).filter(
    (token) => token.includes("+") || token.includes("#") || token.length >= 6,
  );
}

export function signalTopicSimilarity(left: ScoringSignal, right: ScoringSignal): number {
  const title = jaccardSimilarity(textTokens(left.title), textTokens(right.title));
  const content = jaccardSimilarity(contentTokens(left), contentTokens(right));
  const entities = jaccardSimilarity(entityTokens(left), entityTokens(right));
  return 0.5 * title + 0.35 * content + 0.15 * entities;
}

export function clusterSignals(
  input: ScoringSignal[],
  options: { similarityThreshold?: number } = {},
): SignalCluster[] {
  const { signals } = deduplicateSignals(input);
  const threshold = options.similarityThreshold ?? 0.38;
  const union = new UnionFind(signals.length);
  for (let left = 0; left < signals.length; left += 1) {
    for (let right = left + 1; right < signals.length; right += 1) {
      if (signalTopicSimilarity(signals[left]!, signals[right]!) >= threshold)
        union.union(left, right);
    }
  }
  const grouped = new Map<number, ScoringSignal[]>();
  for (let index = 0; index < signals.length; index += 1) {
    const root = union.find(index);
    const members = grouped.get(root) ?? [];
    members.push(signals[index]!);
    grouped.set(root, members);
  }
  const clusters = [...grouped.values()].map((members): SignalCluster => {
    members.sort((a, b) => a.id.localeCompare(b.id));
    const representative = [...members].sort(
      (a, b) => richness(b) - richness(a) || a.id.localeCompare(b.id),
    )[0]!;
    const memberIds = members.map((member) => member.id);
    const allTokens = members.flatMap(contentTokens);
    const tokenFrequency = new Map<string, number>();
    for (const token of allTokens) tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    const topicFingerprint = [...tokenFrequency]
      .sort(([aToken, aCount], [bToken, bCount]) => bCount - aCount || aToken.localeCompare(bToken))
      .slice(0, 12)
      .map(([token]) => token);
    const independenceKeys = [...new Set(members.map(sourceIndependenceKey))].sort();
    return {
      id: `cluster_${scoringHash(memberIds.join(":"))}`,
      memberIds,
      signals: members,
      representativeSignalId: representative.id,
      representativeTitle: representative.title ?? representative.textExcerpt ?? representative.url,
      topicFingerprint,
      independenceKeys,
      independentSourceCount: independenceKeys.length,
    };
  });
  return clusters.sort((a, b) => a.id.localeCompare(b.id));
}

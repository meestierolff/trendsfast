import { createHash } from "node:crypto";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
  "you",
  "your",
]);

export function scoringHash(value: string, length = 20): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function textTokens(value: string | undefined): string[] {
  return [
    ...new Set(
      normalizeText(value)
        .split(" ")
        .map((token) => token.replace(/^[-.]+|[-.]+$/g, ""))
        .filter((token) => token.length >= 2 && !STOPWORDS.has(token)),
    ),
  ].sort();
}

export function jaccardSimilarity(left: Iterable<string>, right: Iterable<string>): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function overlapCoverage(candidate: Iterable<string>, target: Iterable<string>): number {
  const candidateSet = new Set(candidate);
  const targetSet = new Set(target);
  if (targetSet.size === 0) return 0;
  let found = 0;
  for (const token of targetSet) if (candidateSet.has(token)) found += 1;
  return found / targetSet.size;
}

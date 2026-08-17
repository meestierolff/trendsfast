export type UnsafeContentKind =
  | "URL_OR_EMAIL"
  | "METRIC_CLAIM"
  | "PERFORMANCE_GUARANTEE"
  | "FINANCIAL_DIRECTIVE"
  | "PERFORMANCE_CLAIM";

export type UnsafeContentPolicy = {
  /** Model prose may not introduce any number; deterministic prose only rejects metric-shaped use. */
  rejectAnyNumber?: boolean;
  /** Enables ambiguous investment vocabulary only for saved financial-product contexts. */
  financialContext?: boolean;
};

export type ContentSafetyContext = {
  category: string;
  audience: string;
  problem: string;
  desiredOutcome: string;
  credibleClaims: readonly string[];
  credibleTopics: readonly string[];
  assumptions: readonly string[];
};

export const UNSAFE_CONTENT_QUALITY_REASON = "UNSAFE_PRODUCT_CREDIBILITY_BOUNDARY";
export const UNSAFE_CONTENT_LIMITATION =
  "The selected evidence could not be converted into safe deterministic prose, so distribution was held.";
export const SAFE_DISTRIBUTION_WAIT_PROSE = {
  topic: "No safe distribution claim is available yet",
  angle:
    "Hold distribution until independent, current evidence supports a safe and credible product claim.",
  hook: "Do not force a move from unsafe or unsupported content.",
  outline: [
    "Keep the strongest evidence receipts.",
    "Require a safe product-specific framing without prohibited claims.",
    "Re-run before preparing distribution content.",
  ],
  cta: "Re-check when the evidence supports a safe and credible claim.",
} as const;

const URL_OR_EMAIL =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z]{2,24}\b|\b[^\s@]+@[^\s@]+\.[^\s@]+\b)/iu;
const ANY_NUMBER = /\p{N}/u;
const METRIC_CLAIM =
  /(?:[%€$£¥]|\b(?:percent(?:age)?|double[ds]?|triple[ds]?|hal(?:f|ved)|hundreds?|thousands?|millions?|billions?|roi|cagr|apy|(?:two|three|four|five|six|seven|eight|nine|ten|multi|several)[- ]?fold|(?:twee|drie|vier|vijf|zes|zeven|acht|negen|tien)voudig(?:e)?)\b|\p{N}(?:[.,]\p{N})*\s*(?:x\b|percent\b|views?\b|clicks?\b|impressions?\b|conversions?\b|signups?\b|downloads?\b|followers?\b|users?\b|customers?\b|points?\b|comments?\b|stars?\b|returns?\b|profits?\b|revenue\b|sales\b))/iu;
const PERFORMANCE_GUARANTEE =
  /\b(?:guarantee(?:d|s)?|risk[- ]free|sure[- ]?fire|fail[- ]?proof|will\s+(?:always|certainly|definitely)|can(?:not|'t)\s+(?:fail|lose)|never\s+(?:fails?|loses?)|(?:ensure(?:d|s)?|promise(?:d|s)?|certain(?:ly)?)(?:\W+[\p{L}\p{M}]+){0,3}\W+(?:results?|outcomes?|growth|performance|profits?|gains?)|gegarandeerd|garantie|risicoloos|zonder\s+risico|zal\s+(?:altijd|zeker)|kan\s+niet\s+(?:mislukken|verliezen))\b/iu;
const FINANCIAL_DIRECTIVE =
  /\b(?:buy|sell|invest\s+in|koop|kopen|verkoop|verkopen|investeer(?:t)?\s+in|beleg(?:t)?\s+in|(?:short|trade(?![- ]?offs?\b)|allocate|rebalance|accumulate|divest|overweight|underweight|hold)\s+(?:(?:your|the|this|that|more|less)\s+)?(?:capital|cash|money|funds?|portfolios?|assets?|holdings?|positions?|stocks?|shares?|bonds?|etfs?|crypto(?:currency|currencies)?))\b/iu;
const FINANCIAL_ASSET_TRANSACTION =
  /\b(?:purchase|acquire|dispose\s+of|liquidate|dump|offload|aanschaffen?|verwerven?|afstoten|stoot|stoten|liquideren|dumpen)(?:\W+[\p{L}\p{M}$]+){0,5}\W+(?:capital|cash|money|funds?|portfolios?|assets?|holdings?|positions?|stocks?|shares?|bonds?|etfs?|equities|securities|crypto(?:currency|currencies)?|kapitaal|geld|fondsen?|portefeuilles?|activa|posities?|aandelen(?:posities?)?|obligaties?)\b/iu;
const AMBIGUOUS_FINANCIAL_DIRECTIVE =
  /\b(?:trade(?![- ]?offs?\b)|allocate|rebalance|accumulate|divest|overweight|underweight)\b/iu;
const FINANCIAL_TICKER_HOLD = /\b(?:Hold|HOLD|hold)\s+\$?[A-Z]{1,6}\b/u;
const FINANCIAL_POSITION_DIRECTIVE =
  /\b(?:(?:open|close|exit|enter|sluit|verlaat)\s+(?:(?:a|an|the|your|this|that|een|je|jouw|de|het)\s+)?(?:(?:stock|share|aandeel)\s+)?(?:position|positie)|(?:cash\s+out|load\s+up)(?:\W+[\p{L}\p{M}$]+){0,4}\W+(?:portfolios?|positions?|holdings?|investments?|stocks?|shares?|assets?|portefeuilles?|posities?|beleggingen?|aandelen|activa)|stap\s+(?:in|uit)(?:\W+[\p{L}\p{M}$]+){0,3}\W+(?:aandelenposities?|posities?|beleggingen?|aandelen|activa))\b/iu;
const FINANCIAL_NAMED_DIRECTION =
  /\b(?:[Gg]o\s+long(?:\s+on)?|[Gg]a\s+long(?:\s+op)?|[Ss]hort)\s+(?:\$?[A-Z]{1,6}|[\p{Lu}][\p{L}\p{M}-]{1,30})\b/u;
const CLEAR_PERFORMANCE_CLAIM =
  /\b(?:outperform(?:s|ed|ing)?|beat(?:s|ing)?\s+the\s+market|portfolio\s+(?:growth|performance)|wealth\s+(?:growth|performance)|(?:grow|boost|increase|improve|maximi[sz]e|multiply|accelerate|deliver|drive|earn|make|generate)(?:\W+[\p{L}\p{M}]+){0,4}\W+(?:portfolios?|wealth|money|cash|income|returns?|profits?|gains?|revenue|sales|conversions?|performance|growth)|versla(?:at|an)?\s+de\s+markt|portefeuille\s*(?:groei|prestatie)|vermogensgroei|(?:groei|verhoog|verbeter|maximaliseer|verdubbel|verdien|genereer|maak)(?:\W+[\p{L}\p{M}]+){0,4}\W+(?:portefeuille|vermogen|geld|inkomen|rendement|winst|omzet|conversie|prestatie))\b/iu;
const AMBIGUOUS_FINANCIAL_PERFORMANCE =
  /\b(?:alpha|returns?|profits?|gains?|loss(?:es)?|yield|rendement|winst|verlies)\b/iu;
const FINANCIAL_ASPIRATION_CLAIM =
  /\b(?:(?:build|grow|increase|boost)\s+(?:your\s+)?(?:wealth|net\s+worth)|(?:get|become|retire)\s+richer|(?:beat|outpace)\s+(?:the\s+)?inflation|achieve\s+financial\s+(?:freedom|independence)|make\s+(?:your\s+)?money\s+work\s+harder|bouw\s+(?:sneller\s+)?vermogen\s+op|laat\s+(?:je|jouw)\s+geld\s+harder\s+werken|word\s+rijker|versla\s+de\s+inflatie|bereik\s+financi(?:e|\u00eb)le\s+(?:vrijheid|onafhankelijkheid))\b/iu;
const FINANCIAL_CONTEXT =
  /\b(?:financ(?:e|ial)|invest(?:ors?|ing|ments?)?|portfolios?|trading?|brokers?|stocks?|shares?|bonds?|etfs?|funds?|wealth|retirement|returns?|belegg(?:en|er|ers|ing)|portefeuille|aandelen|rendement)\b/iu;

export function hasFinancialSafetyContext(context: ContentSafetyContext): boolean {
  return FINANCIAL_CONTEXT.test(
    [
      context.category,
      context.audience,
      context.problem,
      context.desiredOutcome,
      ...context.credibleClaims,
      ...context.credibleTopics,
      ...context.assumptions,
    ]
      .join(" ")
      .normalize("NFKC"),
  );
}

/**
 * Classifies prose without consulting external state. NFKC normalization keeps
 * compatibility punctuation and full-width characters from bypassing checks.
 */
export function classifyUnsafeContent(
  value: string,
  policy: UnsafeContentPolicy = {},
): UnsafeContentKind[] {
  const normalized = value.normalize("NFKC").replace(/\p{Cf}/gu, "");
  const kinds: UnsafeContentKind[] = [];
  if (URL_OR_EMAIL.test(normalized)) kinds.push("URL_OR_EMAIL");
  if (
    (policy.rejectAnyNumber === true && ANY_NUMBER.test(normalized)) ||
    METRIC_CLAIM.test(normalized)
  ) {
    kinds.push("METRIC_CLAIM");
  }
  if (PERFORMANCE_GUARANTEE.test(normalized)) kinds.push("PERFORMANCE_GUARANTEE");
  if (
    FINANCIAL_DIRECTIVE.test(normalized) ||
    FINANCIAL_ASSET_TRANSACTION.test(normalized) ||
    (policy.financialContext === true &&
      (AMBIGUOUS_FINANCIAL_DIRECTIVE.test(normalized) ||
        FINANCIAL_TICKER_HOLD.test(normalized) ||
        FINANCIAL_POSITION_DIRECTIVE.test(normalized) ||
        FINANCIAL_NAMED_DIRECTION.test(normalized)))
  ) {
    kinds.push("FINANCIAL_DIRECTIVE");
  }
  if (
    CLEAR_PERFORMANCE_CLAIM.test(normalized) ||
    (policy.financialContext === true &&
      (AMBIGUOUS_FINANCIAL_PERFORMANCE.test(normalized) ||
        FINANCIAL_ASPIRATION_CLAIM.test(normalized)))
  ) {
    kinds.push("PERFORMANCE_CLAIM");
  }
  return kinds;
}

export function classifyUnsafeContentSet(
  values: readonly string[],
  policy: UnsafeContentPolicy = {},
): UnsafeContentKind[] {
  return [...new Set(values.flatMap((value) => classifyUnsafeContent(value, policy)))];
}

export function hasUnsafeContent(
  values: readonly string[],
  policy: UnsafeContentPolicy = {},
): boolean {
  return classifyUnsafeContentSet(values, policy).length > 0;
}

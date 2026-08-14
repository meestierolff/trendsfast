const SECRET_VALUE_PATTERN = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]&#]+)`;
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`((?:["'])?\b(?:XAI_API_KEY|DATAFORSEO_PASSWORD|TAVILY_API_KEY|YOUTUBE_API_KEY|GITHUB_TOKEN|OPENAI_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|OPS_TOKEN|SESSION_SECRET|API_KEY_PEPPER|CRON_SECRET|OPS_ALERT_WEBHOOK_SECRET|TURNSTILE_SECRET_KEY|DATABASE_PASSWORD|POSTGRES_PASSWORD|SUPABASE_DB_PASSWORD|TRENDSFAST_[A-Z0-9_]*PASSWORD|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)(?:["'])?\s*(?:=|:)\s*)(${SECRET_VALUE_PATTERN})`,
  "gi",
);
const JSON_SECRET_FIELD_PATTERN = new RegExp(
  String.raw`((["'])(?:authorization|password|secret|token|credential)\2\s*:\s*)(${SECRET_VALUE_PATTERN})`,
  "gi",
);
const TRENDSFAST_KEY_PATTERN = /\btf_(?:test|live)_[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{1,256}\b/g;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const DATABASE_URL_PATTERN = /\b(postgres(?:ql)?:\/\/[^\s:/]+):([^@\s]+)@/gi;
const URL_SECRET_QUERY_PATTERN =
  /([?&](?:api(?:[_-]|%5f|%2d)?key|access(?:[_-]|%5f|%2d)?token|auth(?:[_-]|%5f|%2d)?token|authorization|credential|password|secret|session|signature|token)=)([^&#\s"'<>]*)/gi;
const PREFIXED_CREDENTIAL_PATTERN =
  /(?<![A-Za-z0-9_-])(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|tvly-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{16,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})(?![A-Za-z0-9_-])/g;

function redactAssignedValue(prefix: string, rawValue: string): string {
  const unquoted =
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? rawValue.slice(1, -1)
      : rawValue;
  if (/^(?:\[REDACTED\]|%5BREDACTED%5D)$/iu.test(unquoted)) return `${prefix}${rawValue}`;
  if (prefix.includes("=")) return `${prefix}[REDACTED]`;
  const quote = rawValue[0];
  const quoted =
    (quote === '"' || quote === "'") && rawValue.length >= 2 && rawValue.at(-1) === quote;
  return quoted ? `${prefix}${quote}[REDACTED]${quote}` : `${prefix}[REDACTED]`;
}

export function redactSecrets(value: string): string {
  return value
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, prefix: string, rawValue: string) =>
      redactAssignedValue(prefix, rawValue),
    )
    .replace(
      JSON_SECRET_FIELD_PATTERN,
      (_match, prefix: string, _quote: string, rawValue: string) =>
        redactAssignedValue(prefix, rawValue),
    )
    .replace(URL_SECRET_QUERY_PATTERN, (match, prefix: string, rawValue: string) =>
      /^(?:\[REDACTED\]|%5BREDACTED%5D)$/iu.test(rawValue) ? match : `${prefix}[REDACTED]`,
    )
    .replace(TRENDSFAST_KEY_PATTERN, "[REDACTED_TRENDSFAST_KEY]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(DATABASE_URL_PATTERN, "$1:[REDACTED]@")
    .replace(PREFIXED_CREDENTIAL_PATTERN, "[REDACTED_CREDENTIAL]");
}

const SECRET_FIELD_PATTERN =
  /(authorization|api[_-]?key|token|secret|password|provider[_-]?payload|model[_-]?prompt)/i;

export function redactRecord(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (SECRET_FIELD_PATTERN.test(key)) return [key, "[REDACTED]"];
      if (typeof value === "string") return [key, redactSecrets(value)];
      if (Array.isArray(value)) {
        return [
          key,
          value.map((item) =>
            typeof item === "string"
              ? redactSecrets(item)
              : item && typeof item === "object"
                ? redactRecord(item as Record<string, unknown>)
                : item,
          ),
        ];
      }
      if (value && typeof value === "object") {
        return [key, redactRecord(value as Record<string, unknown>)];
      }
      return [key, value];
    }),
  );
}

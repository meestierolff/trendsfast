const ENV_SECRET_PATTERN =
  /\b(XAI_API_KEY|DATAFORSEO_PASSWORD|TAVILY_API_KEY|YOUTUBE_API_KEY|GITHUB_TOKEN|OPENAI_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|OPS_TOKEN|SESSION_SECRET)\s*=\s*([^\s;,]+)/gi;
const TRENDSFAST_KEY_PATTERN = /\btf_(?:test|live)_[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{1,256}\b/g;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const DATABASE_URL_PATTERN = /\b(postgres(?:ql)?:\/\/[^\s:/]+):([^@\s]+)@/gi;

export function redactSecrets(value: string): string {
  return value
    .replace(ENV_SECRET_PATTERN, "$1=[REDACTED]")
    .replace(TRENDSFAST_KEY_PATTERN, "[REDACTED_TRENDSFAST_KEY]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(DATABASE_URL_PATTERN, "$1:[REDACTED]@");
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

const SENSITIVE_KEY =
  /authorization|api[_-]?key|token|secret|password|cookie|database_url|webhook/i;
const BEARER_OR_KEY =
  /\b(?:Bearer\s+)?(?:tf_(?:live|test)_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]{32,})\b/g;
const URL_USERINFO = /(postgres(?:ql)?:\/\/)[^@\s]+@/gi;

function redactString(value: string): string {
  return value.replace(URL_USERINFO, "$1[REDACTED]@").replace(BEARER_OR_KEY, "[REDACTED]");
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
      ...(value.cause === undefined ? {} : { cause: redact(value.cause, seen) }),
      ...Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(child, seen),
        ]),
      ),
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(child, seen),
    ]),
  );
}

export type ErrorReporter = {
  captureException(error: unknown, context?: Record<string, unknown>): void;
};

export function createLogger(input: {
  sink?: Pick<Console, "info" | "warn" | "error">;
  reporter?: ErrorReporter;
}) {
  const sink = input.sink ?? console;
  return {
    info(message: string, context: Record<string, unknown> = {}) {
      sink.info(JSON.stringify({ level: "info", message, ...(redact(context) as object) }));
    },
    warn(message: string, context: Record<string, unknown> = {}) {
      sink.warn(JSON.stringify({ level: "warn", message, ...(redact(context) as object) }));
    },
    error(message: string, error: unknown, context: Record<string, unknown> = {}) {
      const safeError = redact(error);
      const safeContext = redact(context) as Record<string, unknown>;
      sink.error(
        JSON.stringify({
          level: "error",
          message,
          error: safeError,
          ...safeContext,
        }),
      );
      input.reporter?.captureException(safeError, safeContext);
    },
  };
}

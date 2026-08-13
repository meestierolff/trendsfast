const SENSITIVE_KEY =
  /authorization|api[_-]?key|token|secret|password|cookie|database_url|webhook/i;

function asciiEqualsAt(value: string, index: number, expectedLowercase: string): boolean {
  if (index + expectedLowercase.length > value.length) return false;
  for (let offset = 0; offset < expectedLowercase.length; offset += 1) {
    const code = value.charCodeAt(index + offset);
    const lowercaseCode = code >= 65 && code <= 90 ? code + 32 : code;
    if (lowercaseCode !== expectedLowercase.charCodeAt(offset)) return false;
  }
  return true;
}

function isAsciiWord(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    code === 95 ||
    (code >= 97 && code <= 122)
  );
}

function isCredentialCharacter(code: number): boolean {
  return isAsciiWord(code) || code === 45;
}

function isWhitespace(code: number): boolean {
  return (
    code === 0x0009 ||
    code === 0x000a ||
    code === 0x000b ||
    code === 0x000c ||
    code === 0x000d ||
    code === 0x0020 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function redactPostgresUserInfo(value: string): string {
  const output: string[] = [];
  let copiedThrough = 0;
  let candidate: { index: number; prefixLength: number } | null = null;
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (isWhitespace(code)) {
      candidate = null;
      index += 1;
      continue;
    }

    if (code === 64) {
      if (candidate && index > candidate.index + candidate.prefixLength) {
        output.push(
          value.slice(copiedThrough, candidate.index + candidate.prefixLength),
          "[REDACTED]@",
        );
        copiedThrough = index + 1;
      }
      candidate = null;
      index += 1;
      continue;
    }

    if (candidate) {
      index += 1;
      continue;
    }

    const prefixLength = asciiEqualsAt(value, index, "postgresql://")
      ? 13
      : asciiEqualsAt(value, index, "postgres://")
        ? 11
        : 0;
    if (prefixLength > 0) {
      candidate = { index, prefixLength };
      index += prefixLength;
    } else {
      index += 1;
    }
  }
  if (output.length === 0) return value;
  output.push(value.slice(copiedThrough));
  return output.join("");
}

function trendsFastCredentialEnd(value: string, index: number): number | null {
  const prefixLength =
    value.startsWith("tf_live_", index) || value.startsWith("tf_test_", index) ? 8 : 0;
  if (prefixLength === 0) return null;
  let cursor = index + prefixLength;
  const firstSegmentStart = cursor;
  while (cursor < value.length && isCredentialCharacter(value.charCodeAt(cursor))) cursor += 1;
  if (cursor === firstSegmentStart || value.charCodeAt(cursor) !== 46) return null;
  cursor += 1;
  const secondSegmentStart = cursor;
  while (cursor < value.length && isCredentialCharacter(value.charCodeAt(cursor))) cursor += 1;
  return cursor === secondSegmentStart ? null : cursor;
}

function credentialEnd(value: string, index: number): number | null {
  const trendsFastEnd = trendsFastCredentialEnd(value, index);
  if (trendsFastEnd !== null) return trendsFastEnd;
  let cursor = index;
  while (cursor < value.length && isCredentialCharacter(value.charCodeAt(cursor))) cursor += 1;
  return cursor - index >= 32 ? cursor : null;
}

function redactBearerOrKeys(value: string): string {
  const output: string[] = [];
  let copiedThrough = 0;
  let index = 0;
  while (index < value.length) {
    const startsAtWordBoundary = index === 0 || !isAsciiWord(value.charCodeAt(index - 1));
    let credentialStart = index;
    if (startsAtWordBoundary && value.startsWith("Bearer", index)) {
      let cursor = index + 6;
      if (isWhitespace(value.charCodeAt(cursor))) {
        while (cursor < value.length && isWhitespace(value.charCodeAt(cursor))) cursor += 1;
        credentialStart = cursor;
      }
    }
    const end = startsAtWordBoundary ? credentialEnd(value, credentialStart) : null;
    if (end !== null) {
      output.push(value.slice(copiedThrough, index), "[REDACTED]");
      copiedThrough = end;
      index = end;
      continue;
    }
    index += 1;
  }
  if (output.length === 0) return value;
  output.push(value.slice(copiedThrough));
  return output.join("");
}

function redactString(value: string): string {
  return redactBearerOrKeys(redactPostgresUserInfo(value));
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

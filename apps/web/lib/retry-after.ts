export const DEFAULT_SCAN_POLL_AFTER_MS = 30_000;

export type ScanRefreshState = "idle" | "refreshing" | "retrying";

export function scanRefreshCopy(
  state: ScanRefreshState,
  pollAfterMs: number,
): { readout: string; note: string } {
  const seconds = Math.ceil(pollAfterMs / 1_000);
  if (state === "refreshing") {
    return {
      readout: "Checking for a new state…",
      note: "You can leave this tab and return with the same private link.",
    };
  }
  if (state === "retrying") {
    return {
      readout: `Connection problem. Retrying automatically in ${seconds} seconds…`,
      note: "Automatic refresh will keep retrying after the connection problem. Your scan is still stored.",
    };
  }
  return {
    readout: `Next check follows Retry-After (${seconds} seconds)`,
    note: "You can leave this tab and return with the same private link.",
  };
}

/** Parses either legal Retry-After form without allowing an invalid header to create a hot loop. */
export function retryAfterMilliseconds(
  value: string | null,
  options: { fallbackMs?: number; nowMs?: number; maximumMs?: number } = {},
): number {
  const fallbackMs = options.fallbackMs ?? DEFAULT_SCAN_POLL_AFTER_MS;
  const maximumMs = options.maximumMs ?? 10 * 60_000;
  if (value === null) return fallbackMs;

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Math.max(Number(trimmed) * 1_000, 1_000), maximumMs);
  }

  const targetMs = Date.parse(trimmed);
  if (Number.isNaN(targetMs)) return fallbackMs;
  const nowMs = options.nowMs ?? Date.now();
  return Math.min(Math.max(targetMs - nowMs, 1_000), maximumMs);
}

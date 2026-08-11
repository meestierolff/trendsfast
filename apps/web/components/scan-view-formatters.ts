export type ScanDate = string | Date;

const properNames: Record<string, string> = {
  x: "X",
  github: "GitHub",
  youtube: "YouTube",
  hacker_news: "Hacker News",
  google_trends: "Google Trends",
  dataforseo_trends: "DataForSEO Trends",
};

export function formatCodeLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "Not available";
  const known = properNames[normalized.toLowerCase()];
  if (known) return known;
  const readable = normalized.toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  return readable.replace(/^./, (character) => character.toUpperCase());
}

export function confidenceLabel(value: number): string {
  const label = value >= 0.8 ? "High" : value >= 0.65 ? "Medium" : "Low";
  return `${label} · ${Math.round(value * 100)}%`;
}

export function formatScanDate(value: ScanDate | null | undefined): string {
  if (!value) return "Not available";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not available";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}

export function dateTimeValue(value: ScanDate | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

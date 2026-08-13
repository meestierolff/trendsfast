import type { ContentCapabilities, ContentCapabilityName } from "@trendsfast/schemas";

function normalizedFormat(format: string): string {
  return format.trim().toLowerCase().replace(/[ -]+/g, "_");
}

/** Bounded semantic bridge between founder-facing format names and production capabilities. */
export function contentCapabilitiesForFormat(format: string): ContentCapabilityName[] {
  const normalized = normalizedFormat(format);
  const exact: ContentCapabilityName[] = [
    "founder_text",
    "founder_on_camera",
    "screen_recording",
    "ai_avatar",
    "carousel",
    "product_demo",
    "long_form",
  ];
  if ((exact as string[]).includes(normalized)) {
    return [normalized as ContentCapabilityName];
  }
  if (normalized === "founder_camera") return ["founder_on_camera"];
  if (/screen_?record|screencast/.test(normalized)) return ["screen_recording"];
  if (/avatar/.test(normalized)) return ["ai_avatar"];
  if (/product_?demo|workflow_?demo/.test(normalized)) return ["product_demo"];
  if (/carousel|annotated_?chart|architecture_?diagram|comparison_?table|slides/.test(normalized)) {
    return ["carousel"];
  }
  if (/long_?form/.test(normalized)) return ["long_form"];
  if (/tutorial/.test(normalized)) {
    return ["screen_recording", "long_form", "founder_text"];
  }
  if (/text|post|thread|story|guide|methodology|teardown|article|reply/.test(normalized)) {
    return ["founder_text"];
  }
  return [];
}

export function formatHasEnabledCapability(
  format: string,
  capabilities: ContentCapabilities,
): boolean {
  return contentCapabilitiesForFormat(format).some((name) => capabilities[name]);
}

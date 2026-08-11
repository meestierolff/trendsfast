import { lookup } from "node:dns/promises";

import type { DnsResolver, ProviderExecutionContext, ProviderHealthStatus } from "./types";
import { createPinnedWebsiteTransport } from "./website-security";

export type ProviderContextOverrides = Partial<ProviderExecutionContext> & {
  credentialMode: ProviderExecutionContext["credentialMode"];
};

const defaultResolver: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family }));
};

export function createProviderContext(
  overrides: Partial<ProviderExecutionContext> & {
    credentialMode?: ProviderExecutionContext["credentialMode"];
  } = {},
): ProviderExecutionContext {
  return {
    credentialMode: overrides.credentialMode ?? "fixture",
    env: overrides.env ?? process.env,
    fetch:
      overrides.fetch ?? (globalThis.fetch.bind(globalThis) as ProviderExecutionContext["fetch"]),
    websiteTransport: overrides.websiteTransport ?? createPinnedWebsiteTransport(),
    resolveDns: overrides.resolveDns ?? defaultResolver,
    now: overrides.now ?? (() => new Date()),
    sleep:
      overrides.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    ...(overrides.deadline === undefined ? {} : { deadline: overrides.deadline }),
    ...(overrides.abortSignal === undefined ? {} : { abortSignal: overrides.abortSignal }),
  };
}

export function hasRequiredCredentials(
  requiredNames: string[],
  context: ProviderExecutionContext,
): boolean {
  return requiredNames.every((name) => Boolean(context.env[name]?.trim()));
}

export function credentialHealth(
  requiredNames: string[],
  context: ProviderExecutionContext,
): ProviderHealthStatus {
  if (context.credentialMode === "fixture") return "HEALTHY";
  return hasRequiredCredentials(requiredNames, context) ? "HEALTHY" : "UNCONFIGURED";
}

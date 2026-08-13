export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

type PublicEnvironment = Readonly<Record<string, string | undefined>>;

export class SupabaseAuthConfigurationError extends Error {
  constructor(message = "Supabase Auth is not configured for this deployment") {
    super(message);
    this.name = "SupabaseAuthConfigurationError";
  }
}

function parseSupabaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The two values are intentionally publishable. They authenticate the client
 * to Supabase Auth, while all TrendsFast business data remains server-only.
 */
export function readSupabasePublicConfig(
  environment: PublicEnvironment = process.env,
): SupabasePublicConfig | null {
  const url = parseSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "");
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!url || publishableKey.length < 20 || publishableKey.length > 2_048) return null;
  return { url, publishableKey };
}

export function requireSupabasePublicConfig(
  environment: PublicEnvironment = process.env,
): SupabasePublicConfig {
  const config = readSupabasePublicConfig(environment);
  if (!config) throw new SupabaseAuthConfigurationError();
  return config;
}

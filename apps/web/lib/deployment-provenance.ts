export type DeploymentProvenance = {
  deploymentEnvironment: "local" | "preview" | "production";
  releaseSha: string | null;
  deploymentHost: string | null;
  deploymentId: string | null;
};

function bounded(value: string | undefined, maximum: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function host(value: string | undefined): string | null {
  const normalized = bounded(value, 255);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized.includes("://") ? normalized : `https://${normalized}`);
    return parsed.username || parsed.password ? null : parsed.host.slice(0, 255);
  } catch {
    return null;
  }
}

/** Trusted server-side deployment identity; request bodies cannot override it. */
export function deploymentProvenance(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DeploymentProvenance {
  const vercelEnvironment = env.VERCEL_ENV?.trim();
  if (vercelEnvironment === "production" || vercelEnvironment === "preview") {
    return {
      deploymentEnvironment: vercelEnvironment,
      releaseSha: bounded(env.VERCEL_GIT_COMMIT_SHA, 100),
      deploymentHost: host(env.VERCEL_URL),
      deploymentId: bounded(env.VERCEL_DEPLOYMENT_ID, 255),
    };
  }
  if (env.TRENDSFAST_DEPLOYMENT_ENV?.trim() === "production") {
    return {
      deploymentEnvironment: "production",
      releaseSha: bounded(env.TRENDSFAST_RELEASE_SHA, 100),
      deploymentHost: host(env.TRENDSFAST_DEPLOYMENT_HOST),
      deploymentId: bounded(env.TRENDSFAST_DEPLOYMENT_ID, 255),
    };
  }
  return {
    deploymentEnvironment: "local",
    releaseSha: bounded(env.VERCEL_GIT_COMMIT_SHA ?? env.TRENDSFAST_RELEASE_SHA, 100),
    deploymentHost: host(env.VERCEL_URL ?? env.TRENDSFAST_DEPLOYMENT_HOST),
    deploymentId: bounded(env.VERCEL_DEPLOYMENT_ID ?? env.TRENDSFAST_DEPLOYMENT_ID, 255),
  };
}

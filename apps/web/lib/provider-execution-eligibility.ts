import "server-only";

import type { Environment } from "@trendsfast/config";
import type {
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderSlug,
} from "@trendsfast/providers";
import type { ProviderExecutionEligibility } from "@trendsfast/orchestration";

import { deploymentProvenance, type DeploymentProvenance } from "./deployment-provenance";
import { getPublicRepositories } from "./server-database";

type ProductionVerificationProjection = {
  source: string;
  provider: string;
  state: string;
  credentialMode: string;
  deploymentEnvironment: string;
  healthStatus: string | null;
  readbackVerified: boolean;
  canonicalUrlCount: number;
};

type VerificationLookupState = "available" | "identity_unavailable" | "lookup_failed";

function blocked(
  code: Exclude<ProviderExecutionEligibility, { eligible: true }>["code"],
  message: string,
): ProviderExecutionEligibility {
  return { eligible: false, code, message };
}

function hasConfiguredCredentials(
  adapter: ProviderAdapter,
  credentialEnvironment: Readonly<Record<string, string | undefined>>,
): boolean {
  return adapter.metadata.requiredEnvironmentVariables.every((name) =>
    Boolean(credentialEnvironment[name]?.trim()),
  );
}

/**
 * Pure fail-closed projection. A static adapter registration or a historical
 * verification record can never make a live provider executable.
 */
export function projectProviderExecutionEligibility(input: {
  credentialMode: Environment["PROVIDER_CREDENTIAL_MODE"];
  credentialEnvironment: Readonly<Record<string, string | undefined>>;
  registry: ReadonlyMap<ProviderSlug, ProviderAdapter>;
  deployment: DeploymentProvenance;
  lookupState: VerificationLookupState;
  records: readonly ProductionVerificationProjection[];
}): ReadonlyMap<ProviderSlug, ProviderExecutionEligibility> {
  if (input.credentialMode === "fixture") {
    return new Map([...input.registry.keys()].map((source) => [source, { eligible: true }]));
  }

  const records = new Map(input.records.map((record) => [record.source, record]));
  return new Map(
    [...input.registry].map(([source, adapter]): [ProviderSlug, ProviderExecutionEligibility] => {
      if (source === "manual") {
        return [
          source,
          blocked(
            "PROVIDER_MANUAL_INPUT_REQUIRED",
            "Manual evidence is skipped unless founder-reviewed evidence is intentionally supplied.",
          ),
        ];
      }
      if (!hasConfiguredCredentials(adapter, input.credentialEnvironment)) {
        return [
          source,
          blocked(
            "PROVIDER_UNCONFIGURED",
            "Source skipped because required server-side provider configuration is unavailable.",
          ),
        ];
      }
      if (
        input.deployment.deploymentEnvironment !== "production" ||
        !input.deployment.releaseSha ||
        !input.deployment.deploymentHost ||
        !input.deployment.deploymentId ||
        input.lookupState === "identity_unavailable"
      ) {
        return [
          source,
          blocked(
            "PROVIDER_DEPLOYMENT_IDENTITY_UNAVAILABLE",
            "Source skipped because exact production deployment identity is unavailable.",
          ),
        ];
      }
      if (input.lookupState !== "available") {
        return [
          source,
          blocked(
            "PROVIDER_VERIFICATION_UNAVAILABLE",
            "Source skipped because exact production provider verification could not be read.",
          ),
        ];
      }

      const record = records.get(source);
      const exactVerified =
        record?.source === source &&
        record.provider === adapter.metadata.publicName &&
        record.deploymentEnvironment === "production" &&
        record.credentialMode === input.credentialMode &&
        record.state === "VERIFIED" &&
        record.healthStatus === "HEALTHY" &&
        record.readbackVerified === true &&
        Number.isSafeInteger(record.canonicalUrlCount) &&
        record.canonicalUrlCount > 0;
      return exactVerified
        ? [source, { eligible: true }]
        : [
            source,
            blocked(
              "PROVIDER_NOT_PRODUCTION_VERIFIED",
              "Source skipped because it is not verified healthy for this exact production deployment.",
            ),
          ];
    }),
  );
}

/** Reads only the migration-owned exact-deployment public projection. */
export async function loadProviderExecutionEligibility(input: {
  env: Environment;
  context: ProviderExecutionContext;
  registry: ReadonlyMap<ProviderSlug, ProviderAdapter>;
}): Promise<ReadonlyMap<ProviderSlug, ProviderExecutionEligibility>> {
  const deployment = deploymentProvenance();
  if (input.env.PROVIDER_CREDENTIAL_MODE === "fixture") {
    return projectProviderExecutionEligibility({
      credentialMode: input.env.PROVIDER_CREDENTIAL_MODE,
      credentialEnvironment: input.context.env,
      registry: input.registry,
      deployment,
      lookupState: "available",
      records: [],
    });
  }
  if (
    deployment.deploymentEnvironment !== "production" ||
    !deployment.releaseSha ||
    !deployment.deploymentHost ||
    !deployment.deploymentId
  ) {
    return projectProviderExecutionEligibility({
      credentialMode: input.env.PROVIDER_CREDENTIAL_MODE,
      credentialEnvironment: input.context.env,
      registry: input.registry,
      deployment,
      lookupState: "identity_unavailable",
      records: [],
    });
  }

  try {
    const records =
      await getPublicRepositories().providerVerifications.latestPublicProductionBySource({
        releaseSha: deployment.releaseSha,
        deploymentHost: deployment.deploymentHost,
        deploymentId: deployment.deploymentId,
      });
    return projectProviderExecutionEligibility({
      credentialMode: input.env.PROVIDER_CREDENTIAL_MODE,
      credentialEnvironment: input.context.env,
      registry: input.registry,
      deployment,
      lookupState: "available",
      records,
    });
  } catch {
    return projectProviderExecutionEligibility({
      credentialMode: input.env.PROVIDER_CREDENTIAL_MODE,
      credentialEnvironment: input.context.env,
      registry: input.registry,
      deployment,
      lookupState: "lookup_failed",
      records: [],
    });
  }
}

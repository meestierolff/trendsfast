import "server-only";

import {
  ProviderBudget,
  ProviderCircuitBreaker,
  createManualEvidenceAdapter,
  createProviderContext,
  executeProvider,
  type ManualEvidenceInput,
  type ProviderExecutionContext,
} from "@trendsfast/providers";
import { SignalSchema } from "@trendsfast/schemas";

import { getRepositories } from "./server-database";
import { deploymentProvenance } from "./deployment-provenance";

export type FounderManualEvidenceInput = Omit<ManualEvidenceInput, "reviewedBy">;

export async function addManualFounderEvidence(input: {
  scanPublicId: string;
  evidence: FounderManualEvidenceInput;
  reviewerId: string;
  context?: ProviderExecutionContext;
}) {
  const adapter = createManualEvidenceAdapter();
  const context =
    input.context ??
    createProviderContext({
      credentialMode: "managed",
      env: process.env,
    });
  const result = await executeProvider(
    adapter,
    {
      scanId: input.scanPublicId,
      queries: [],
      manualEvidence: [{ ...input.evidence, reviewedBy: input.reviewerId }],
    },
    {
      context,
      budget: new ProviderBudget(0),
      circuitBreaker: new ProviderCircuitBreaker(),
      deadline: new Date(context.now().getTime() + adapter.metadata.timeoutMs),
    },
  );
  const signal = SignalSchema.safeParse(result.signals[0]);
  if (result.status !== "SUCCESS" || result.signals.length !== 1 || !signal.success) {
    throw new Error("Manual evidence did not pass the bounded provider contract");
  }
  return getRepositories().manualEvidence.add({
    scanPublicId: input.scanPublicId,
    signal: signal.data,
    reason: input.evidence.reason,
    sourceLabel: input.evidence.sourceLabel,
    reviewerId: input.reviewerId,
    observedAt: new Date(result.finishedAt),
    deployment: deploymentProvenance(),
  });
}

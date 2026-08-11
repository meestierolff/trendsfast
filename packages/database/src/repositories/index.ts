import type { TrendsFastDatabase } from "../client";
import { AnalyticsRepository } from "./analytics";
import { AuthAdmissionRepository } from "./auth-admission";
import { ApiKeyRepository } from "./api-keys";
import { CostRepository } from "./costs";
import { DeliveryRepository } from "./delivery";
import { FeedbackRepository } from "./feedback";
import { ScanRepository } from "./lifecycle";
import { ReviewRepository } from "./review";
import { ScanDataRepository } from "./scan-data";
import { PrivacyRepository } from "./privacy";
import { ManualEvidenceRepository } from "./manual-evidence";
import { ProviderVerificationRepository } from "./provider-verification";

export * from "./analytics";
export * from "./auth-admission";
export * from "./api-keys";
export * from "./costs";
export * from "./delivery";
export * from "./feedback";
export * from "./lifecycle";
export * from "./review";
export * from "./scan-data";
export * from "./privacy";
export * from "./manual-evidence";
export * from "./provider-verification";

export function createRepositories(
  db: TrendsFastDatabase,
  options: { apiKeyPepper?: string } = {},
) {
  return {
    analytics: new AnalyticsRepository(db),
    authAdmission: new AuthAdmissionRepository(db),
    apiKeys: new ApiKeyRepository(db, options.apiKeyPepper),
    costs: new CostRepository(db),
    delivery: new DeliveryRepository(db),
    feedback: new FeedbackRepository(db),
    manualEvidence: new ManualEvidenceRepository(db),
    privacy: new PrivacyRepository(db),
    providerVerifications: new ProviderVerificationRepository(db),
    reviews: new ReviewRepository(db),
    scanData: new ScanDataRepository(db),
    scans: new ScanRepository(db),
  };
}

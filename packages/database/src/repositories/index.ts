import type { TrendsFastDatabase } from "../client";
import { AnalyticsRepository } from "./analytics";
import { AuthAdmissionRepository } from "./auth-admission";
import { BillingRepository } from "./billing";
import { ApiKeyRepository } from "./api-keys";
import { CostRepository } from "./costs";
import { DeliveryRepository } from "./delivery";
import { FeedbackRepository } from "./feedback";
import { FounderUsageRepository } from "./founder-usage";
import { FounderGrantRepository } from "./founder-grants";
import { FounderLaunchInterestRepository } from "./founder-launch-interest";
import { ScanRepository } from "./lifecycle";
import { ReviewRepository } from "./review";
import { ScanDataRepository } from "./scan-data";
import { PrivacyRepository } from "./privacy";
import { ManualEvidenceRepository } from "./manual-evidence";
import { MonitoringRepository } from "./monitoring";
import { ProviderVerificationRepository } from "./provider-verification";

export * from "./analytics";
export * from "./auth-admission";
export * from "./billing";
export * from "./founder-usage-model";
export * from "./founder-grants";
export * from "./founder-launch-interest";
export * from "./monitoring-model";
export * from "./monitoring";
export * from "./api-keys";
export * from "./costs";
export * from "./delivery";
export * from "./feedback";
export * from "./founder-usage";
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
    billing: new BillingRepository(db, options.apiKeyPepper),
    apiKeys: new ApiKeyRepository(db, options.apiKeyPepper),
    costs: new CostRepository(db),
    delivery: new DeliveryRepository(db),
    feedback: new FeedbackRepository(db),
    founderLaunchInterests: new FounderLaunchInterestRepository(db),
    founderGrants: new FounderGrantRepository(db),
    founderUsage: new FounderUsageRepository(db),
    manualEvidence: new ManualEvidenceRepository(db),
    monitoring: new MonitoringRepository(db),
    privacy: new PrivacyRepository(db),
    providerVerifications: new ProviderVerificationRepository(db),
    reviews: new ReviewRepository(db),
    scanData: new ScanDataRepository(db),
    scans: new ScanRepository(db),
  };
}

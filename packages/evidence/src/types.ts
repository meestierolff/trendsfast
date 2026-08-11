export type EvidenceMetrics = {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  points?: number;
  stars?: number;
  forks?: number;
};

export type StoredEvidenceSignal = {
  id: string;
  source: string;
  sourceId: string;
  url: string;
  title?: string;
  textExcerpt?: string;
  author?: {
    id?: string;
    handle?: string;
    displayName?: string;
    followerCount?: number;
  };
  publishedAt?: string;
  observedAt: string;
  language?: string;
  metrics: EvidenceMetrics;
  queryId: string;
  provenance: {
    provider: string;
    requestId?: string;
    retrievedAt: string;
    cached: boolean;
    rawPayloadHash?: string;
  };
};

export type EvidenceAvailability = "AVAILABLE" | "SOURCE_NO_LONGER_AVAILABLE" | "REJECTED";

export type EvidenceReceipt = {
  id: string;
  signalId: string;
  source: string;
  provider: string;
  url: string;
  title?: string;
  publishedAt?: string;
  observedAt: string;
  reason: string;
  metrics: EvidenceMetrics;
  verified: boolean;
  availability: EvidenceAvailability;
  lastCheckedAt?: string;
};

export type EvidenceSignalStore = {
  getByIds: (ids: string[]) => Promise<StoredEvidenceSignal[]>;
};

export type EvidenceBindingErrorCode =
  | "INVALID_MODEL_OUTPUT"
  | "MODEL_EVIDENCE_CLAIM"
  | "INVALID_SIGNAL_REFERENCE"
  | "DUPLICATE_SIGNAL_REFERENCE"
  | "SIGNAL_NOT_ALLOWED"
  | "SIGNAL_NOT_STORED"
  | "INVALID_STORED_SOURCE"
  | "INVALID_STORED_URL"
  | "MISSING_EVIDENCE_REASON"
  | "EVIDENCE_DOES_NOT_SUPPORT_RECOMMENDATION";

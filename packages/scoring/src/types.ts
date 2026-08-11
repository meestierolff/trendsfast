export type ScoringMetrics = {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  points?: number;
  stars?: number;
  forks?: number;
};

export type ScoringSignal = {
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
  metrics: ScoringMetrics;
  queryId: string;
  provenance: {
    provider: string;
    requestId?: string;
    retrievedAt: string;
    cached: boolean;
    rawPayloadHash?: string;
  };
};

export type ScoringMetricSnapshot = {
  signalId: string;
  observedAt: string;
  metrics: ScoringMetrics;
};

export type TrendMeasurement = {
  id: string;
  source: string;
  provider: string;
  queryId: string;
  kind: "EXTERNAL_TIME_SERIES";
  label: string;
  points: Array<{ at: string; value: number }>;
};

export type TrendSignalClass =
  | "MEASURED_EXTERNAL_SERIES"
  | "MEASURED_INTERNAL_VELOCITY"
  | "CORROBORATED_SIGNAL"
  | "EMERGING_SIGNAL"
  | "INSUFFICIENT_SIGNAL";

export type SignalCluster = {
  id: string;
  memberIds: string[];
  signals: ScoringSignal[];
  representativeTitle: string;
  topicFingerprint: string[];
  independenceKeys: string[];
  independentSourceCount: number;
};

export type OpportunityScoreComponents = {
  audienceFit: number;
  productRelevance: number;
  measuredOrCorroboratedMomentum: number;
  novelty: number;
  productCredibility: number;
  formatFit: number;
  remainingWindow: number;
  sourceQuality: number;
  saturation: number;
  evidenceDependency: number;
};

export type NextMoveAction = "PUBLISH" | "REPLY" | "REMIX" | "WAIT";

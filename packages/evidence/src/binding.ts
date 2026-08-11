import { createHash } from "node:crypto";
import {
  SourceSlugSchema,
  type EvidenceReceipt as PublicEvidenceReceipt,
} from "@trendsfast/schemas";

import type {
  EvidenceBindingErrorCode,
  EvidenceReceipt,
  EvidenceSignalStore,
  StoredEvidenceSignal,
} from "./types";

export class EvidenceBindingError extends Error {
  readonly code: EvidenceBindingErrorCode;
  readonly path?: string;

  constructor(code: EvidenceBindingErrorCode, message: string, path?: string) {
    super(message);
    this.name = "EvidenceBindingError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

function stableReceiptId(signalId: string, url: string): string {
  const hash = createHash("sha256").update(`${signalId}:${url}`).digest("hex").slice(0, 20);
  return `evidence_${hash}`;
}

function normalizedKey(key: string): string {
  return key.replace(/[_-]/g, "").toLocaleLowerCase("en");
}

const FORBIDDEN_MODEL_KEYS = new Set([
  "evidence",
  "evidenceurl",
  "evidenceurls",
  "citation",
  "citations",
  "link",
  "links",
  "url",
  "urls",
  "metric",
  "metrics",
  "engagement",
  "views",
  "likes",
  "comments",
  "shares",
  "points",
  "stars",
  "forks",
  "followercount",
  "source",
  "sources",
  "provider",
  "providers",
  "publishedat",
  "observedat",
  "verified",
]);

function assertNoModelEvidenceClaims(value: unknown, path = "$", seen = new Set<object>()): void {
  if (typeof value === "string" && /https?:\/\/[^\s]+/i.test(value)) {
    throw new EvidenceBindingError(
      "MODEL_EVIDENCE_CLAIM",
      "Model output cannot supply evidence URLs",
      path,
    );
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) {
    throw new EvidenceBindingError(
      "INVALID_MODEL_OUTPUT",
      "Model output must not contain cycles",
      path,
    );
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoModelEvidenceClaims(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizedKey(key);
    if (normalized !== "evidencesignalids" && FORBIDDEN_MODEL_KEYS.has(normalized)) {
      throw new EvidenceBindingError(
        "MODEL_EVIDENCE_CLAIM",
        `Model output cannot supply evidence field “${key}”`,
        `${path}.${key}`,
      );
    }
    assertNoModelEvidenceClaims(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function modelRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new EvidenceBindingError("INVALID_MODEL_OUTPUT", "Model output must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function signalReferences(modelOutput: Record<string, unknown>): string[] {
  const value = modelOutput.evidenceSignalIds;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) {
    throw new EvidenceBindingError(
      "INVALID_SIGNAL_REFERENCE",
      "Model output must contain an evidenceSignalIds string array",
    );
  }
  if (value.length > 20) {
    throw new EvidenceBindingError(
      "INVALID_SIGNAL_REFERENCE",
      "Model output references more than 20 evidence signals",
    );
  }
  return value.map((id) => (id as string).trim());
}

function assertStoredUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EvidenceBindingError("INVALID_STORED_URL", "Stored signal has an invalid URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new EvidenceBindingError(
      "INVALID_STORED_URL",
      "Stored signal URL must use HTTP(S) and contain no credentials",
    );
  }
}

export type BindStoredEvidenceInput = {
  modelOutput: unknown;
  store: EvidenceSignalStore;
  allowedSignalIds: ReadonlySet<string>;
  reasonBySignalId: Readonly<Record<string, string>>;
  supportBySignalId: Readonly<Record<string, boolean>>;
  verificationBySignalId?: Readonly<Record<string, boolean>>;
};

export type BoundEvidence<T extends Record<string, unknown> = Record<string, unknown>> = {
  proposal: Omit<T, "evidenceSignalIds">;
  evidence: EvidenceReceipt[];
};

export async function bindStoredEvidence<
  T extends Record<string, unknown> = Record<string, unknown>,
>(input: BindStoredEvidenceInput): Promise<BoundEvidence<T>> {
  assertNoModelEvidenceClaims(input.modelOutput);
  const modelOutput = modelRecord(input.modelOutput);
  const ids = signalReferences(modelOutput);
  if (new Set(ids).size !== ids.length) {
    throw new EvidenceBindingError(
      "DUPLICATE_SIGNAL_REFERENCE",
      "Model output contains a duplicate evidence signal reference",
    );
  }
  const disallowed = ids.find((id) => !input.allowedSignalIds.has(id));
  if (disallowed) {
    throw new EvidenceBindingError(
      "SIGNAL_NOT_ALLOWED",
      `Signal ${disallowed} is not part of the selected stored candidate set`,
    );
  }
  const stored = await input.store.getByIds(ids);
  const byId = new Map(stored.map((signal) => [signal.id, signal]));
  const missing = ids.find((id) => !byId.has(id));
  if (missing) {
    throw new EvidenceBindingError(
      "SIGNAL_NOT_STORED",
      `Signal ${missing} was not found in stored provider/manual records`,
    );
  }

  const evidence = ids.map((id): EvidenceReceipt => {
    const signal = byId.get(id)!;
    assertStoredUrl(signal.url);
    if (!SourceSlugSchema.safeParse(signal.source).success) {
      throw new EvidenceBindingError(
        "INVALID_STORED_SOURCE",
        `Stored signal ${id} has an unknown source slug`,
      );
    }
    const reason = input.reasonBySignalId[id]?.trim();
    if (!reason) {
      throw new EvidenceBindingError(
        "MISSING_EVIDENCE_REASON",
        `Stored signal ${id} has no reviewed relevance reason`,
      );
    }
    if (input.supportBySignalId[id] !== true) {
      throw new EvidenceBindingError(
        "EVIDENCE_DOES_NOT_SUPPORT_RECOMMENDATION",
        `Stored signal ${id} was not verified as supporting the recommendation`,
      );
    }
    return {
      id: stableReceiptId(signal.id, signal.url),
      signalId: signal.id,
      source: signal.source,
      provider: signal.provenance.provider,
      url: signal.url,
      ...(signal.title === undefined ? {} : { title: signal.title }),
      ...(signal.publishedAt === undefined ? {} : { publishedAt: signal.publishedAt }),
      observedAt: signal.observedAt,
      reason: reason.slice(0, 1_000),
      metrics: { ...signal.metrics },
      role: "DECISION_SUPPORT",
      verified: input.verificationBySignalId?.[signal.id] === true,
      availability: "AVAILABLE",
    };
  });

  const proposal = { ...modelOutput };
  delete proposal.evidenceSignalIds;
  return { proposal: proposal as Omit<T, "evidenceSignalIds">, evidence };
}

export function createInMemoryEvidenceStore(signals: StoredEvidenceSignal[]): EvidenceSignalStore {
  const records = new Map(signals.map((signal) => [signal.id, signal]));
  return {
    getByIds: async (ids) =>
      ids.flatMap((id) => {
        const signal = records.get(id);
        return signal ? [signal] : [];
      }),
  };
}

export function markSourceNoLongerAvailable(
  receipt: EvidenceReceipt,
  checkedAt: string,
): EvidenceReceipt {
  const timestamp = new Date(checkedAt);
  if (!Number.isFinite(timestamp.getTime()))
    throw new Error("checkedAt must be an ISO-compatible date");
  return {
    ...receipt,
    verified: false,
    availability: "SOURCE_NO_LONGER_AVAILABLE",
    lastCheckedAt: timestamp.toISOString(),
  };
}

export function markEvidenceRejected(receipt: EvidenceReceipt, checkedAt: string): EvidenceReceipt {
  const timestamp = new Date(checkedAt);
  if (!Number.isFinite(timestamp.getTime()))
    throw new Error("checkedAt must be an ISO-compatible date");
  return {
    ...receipt,
    verified: false,
    availability: "REJECTED",
    lastCheckedAt: timestamp.toISOString(),
  };
}

export function toPublicEvidenceReceipt(receipt: EvidenceReceipt): PublicEvidenceReceipt {
  return {
    source: receipt.source as PublicEvidenceReceipt["source"],
    url: receipt.url,
    ...(receipt.title === undefined ? {} : { title: receipt.title }),
    ...(receipt.publishedAt === undefined ? {} : { publishedAt: receipt.publishedAt }),
    observedAt: receipt.observedAt,
    reason: receipt.reason,
    provider: receipt.provider,
    role: receipt.role,
    verified: receipt.verified,
    availability: receipt.availability,
  };
}

export function assertEvidenceReceiptsAreStored(
  receipts: EvidenceReceipt[],
  storedSignals: StoredEvidenceSignal[],
): string[] {
  const errors: string[] = [];
  const stored = new Map(storedSignals.map((signal) => [signal.id, signal]));
  for (const receipt of receipts) {
    const signal = stored.get(receipt.signalId);
    if (!signal) {
      errors.push(`${receipt.id}: signal is not stored`);
      continue;
    }
    if (receipt.url !== signal.url) errors.push(`${receipt.id}: URL differs from stored signal`);
    if (receipt.source !== signal.source)
      errors.push(`${receipt.id}: source differs from stored signal`);
    if (receipt.provider !== signal.provenance.provider) {
      errors.push(`${receipt.id}: provider differs from stored signal`);
    }
    if (receipt.observedAt !== signal.observedAt) {
      errors.push(`${receipt.id}: observed time differs from stored signal`);
    }
    if (JSON.stringify(receipt.metrics) !== JSON.stringify(signal.metrics)) {
      errors.push(`${receipt.id}: metrics differ from stored signal`);
    }
  }
  return errors;
}

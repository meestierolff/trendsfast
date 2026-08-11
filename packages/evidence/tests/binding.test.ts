import { describe, expect, it } from "vitest";

import {
  EvidenceBindingError,
  assertEvidenceReceiptsAreStored,
  bindStoredEvidence,
  markSourceNoLongerAvailable,
  toPublicEvidenceReceipt,
  type EvidenceSignalStore,
  type StoredEvidenceSignal,
} from "../src/index";
import { EvidenceReceiptSchema } from "@trendsfast/schemas";

const storedSignal: StoredEvidenceSignal = {
  id: "sig_x_1",
  source: "x",
  sourceId: "1900000000000000000",
  url: "https://x.com/founder/status/1900000000000000000",
  title: "Founders are replacing generic content calendars with live evidence",
  textExcerpt: "A current founder conversation about distribution research.",
  publishedAt: "2026-08-11T06:00:00.000Z",
  observedAt: "2026-08-11T08:00:00.000Z",
  metrics: { likes: 43, comments: 11 },
  queryId: "query_x_1",
  provenance: {
    provider: "xai_x_search",
    requestId: "req_x_1",
    retrievedAt: "2026-08-11T08:00:00.000Z",
    cached: false,
  },
};

function store(signals: StoredEvidenceSignal[] = [storedSignal]): EvidenceSignalStore {
  return {
    getByIds: async (ids) => signals.filter((signal) => ids.includes(signal.id)),
  };
}

describe("stored evidence binding", () => {
  it("binds URLs, metrics, source and provider exclusively from stored signals", async () => {
    const result = await bindStoredEvidence({
      modelOutput: {
        action: "REPLY",
        topic: "Evidence-backed founder distribution",
        evidenceSignalIds: ["sig_x_1"],
      },
      store: store(),
      allowedSignalIds: new Set(["sig_x_1"]),
      reasonBySignalId: { sig_x_1: "A current, directly relevant founder conversation." },
      supportBySignalId: { sig_x_1: true },
      verificationBySignalId: { sig_x_1: true },
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      signalId: "sig_x_1",
      url: storedSignal.url,
      source: "x",
      provider: "xai_x_search",
      metrics: { likes: 43, comments: 11 },
      verified: true,
      availability: "AVAILABLE",
    });
    expect(result.proposal).not.toHaveProperty("evidenceSignalIds");
    expect(assertEvidenceReceiptsAreStored(result.evidence, [storedSignal])).toEqual([]);
    expect(
      EvidenceReceiptSchema.safeParse(toPublicEvidenceReceipt(result.evidence[0]!)).success,
    ).toBe(true);
  });

  it.each([
    { evidence: [{ url: "https://model.invalid/fabricated" }] },
    { evidenceUrls: ["https://model.invalid/fabricated"] },
    { metrics: { likes: 999_999 } },
    { source: "x" },
    { provider: "xai" },
    { citation: "https://model.invalid/fabricated" },
    { engagement: { likes: 999_999 } },
  ])("rejects model-originated evidence claims: %j", async (forbidden) => {
    await expect(
      bindStoredEvidence({
        modelOutput: {
          action: "REPLY",
          evidenceSignalIds: ["sig_x_1"],
          ...forbidden,
        },
        store: store(),
        allowedSignalIds: new Set(["sig_x_1"]),
        reasonBySignalId: { sig_x_1: "Relevant conversation." },
        supportBySignalId: { sig_x_1: true },
      }),
    ).rejects.toBeInstanceOf(EvidenceBindingError);
  });

  it("rejects missing, unselected, duplicate, and non-HTTP stored records", async () => {
    await expect(
      bindStoredEvidence({
        modelOutput: { action: "REPLY", evidenceSignalIds: ["missing"] },
        store: store(),
        allowedSignalIds: new Set(["missing"]),
        reasonBySignalId: { missing: "Reason" },
        supportBySignalId: { missing: true },
      }),
    ).rejects.toMatchObject({ code: "SIGNAL_NOT_STORED" });

    await expect(
      bindStoredEvidence({
        modelOutput: { action: "REPLY", evidenceSignalIds: ["sig_x_1"] },
        store: store(),
        allowedSignalIds: new Set(["different"]),
        reasonBySignalId: { sig_x_1: "Reason" },
        supportBySignalId: { sig_x_1: true },
      }),
    ).rejects.toMatchObject({ code: "SIGNAL_NOT_ALLOWED" });

    await expect(
      bindStoredEvidence({
        modelOutput: { action: "REPLY", evidenceSignalIds: ["sig_x_1", "sig_x_1"] },
        store: store(),
        allowedSignalIds: new Set(["sig_x_1"]),
        reasonBySignalId: { sig_x_1: "Reason" },
        supportBySignalId: { sig_x_1: true },
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_SIGNAL_REFERENCE" });

    await expect(
      bindStoredEvidence({
        modelOutput: { action: "REPLY", evidenceSignalIds: ["sig_bad"] },
        store: store([{ ...storedSignal, id: "sig_bad", url: "javascript:alert(1)" }]),
        allowedSignalIds: new Set(["sig_bad"]),
        reasonBySignalId: { sig_bad: "Reason" },
        supportBySignalId: { sig_bad: true },
      }),
    ).rejects.toMatchObject({ code: "INVALID_STORED_URL" });
  });

  it("marks a disappeared source without substituting another URL", async () => {
    const result = await bindStoredEvidence({
      modelOutput: { action: "REPLY", evidenceSignalIds: ["sig_x_1"] },
      store: store(),
      allowedSignalIds: new Set(["sig_x_1"]),
      reasonBySignalId: { sig_x_1: "Relevant conversation." },
      supportBySignalId: { sig_x_1: true },
    });
    const unavailable = markSourceNoLongerAvailable(
      result.evidence[0]!,
      "2026-08-11T09:00:00.000Z",
    );

    expect(unavailable.url).toBe(storedSignal.url);
    expect(unavailable.availability).toBe("SOURCE_NO_LONGER_AVAILABLE");
    expect(unavailable.verified).toBe(false);
    expect(unavailable.lastCheckedAt).toBe("2026-08-11T09:00:00.000Z");
  });

  it("rejects a stored item that was reviewed as not supporting the recommendation", async () => {
    await expect(
      bindStoredEvidence({
        modelOutput: { action: "REPLY", evidenceSignalIds: ["sig_x_1"] },
        store: store(),
        allowedSignalIds: new Set(["sig_x_1"]),
        reasonBySignalId: { sig_x_1: "Only superficially related." },
        supportBySignalId: { sig_x_1: false },
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_DOES_NOT_SUPPORT_RECOMMENDATION" });
  });
});

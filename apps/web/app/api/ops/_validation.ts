import { z } from "zod";

const EvidenceIdSchema = z.string().uuid();
const ReasonSchema = z.string().trim().min(10).max(4_000);
const ReviewVersionSchema = z.number().int().min(1).max(1_000_000);
const LongTextSchema = z.string().trim().min(1).max(4_000);
const ShortTextSchema = z.string().trim().min(1).max(500);
const LabelSchema = z.string().trim().min(1).max(100);
const StringListSchema = z.array(z.string().trim().min(1).max(1_000)).min(1).max(50);

const EditAndApproveSchema = z
  .object({
    expectedVersion: ReviewVersionSchema,
    reason: ReasonSchema,
    topic: ShortTextSchema,
    angle: LongTextSchema,
    channel: LabelSchema,
    format: LabelSchema,
    hook: LongTextSchema,
    outline: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    cta: LongTextSchema,
    whyNow: LongTextSchema,
    limitations: z.array(z.string().trim().min(1).max(1_000)).max(50),
    validUntil: z.string().datetime({ offset: true }),
    confidenceRationale: LongTextSchema,
    evidenceReceiptIds: z.array(EvidenceIdSchema).max(50),
    exactEvidenceReviewed: z.literal(true),
  })
  .strict();

const CorrectContextSchema = z
  .object({
    expectedVersion: ReviewVersionSchema,
    reason: ReasonSchema,
    productName: z.string().trim().min(1).max(200),
    audience: LongTextSchema,
    problem: LongTextSchema,
    desiredOutcome: LongTextSchema,
    credibleClaims: z.array(z.string().trim().min(1).max(200)).max(50),
    credibleTopics: StringListSchema,
    suitableChannels: StringListSchema,
    availableFormats: StringListSchema,
    assumptions: z.array(z.string().trim().min(1).max(200)).max(50),
  })
  .strict();

const RecomputeStoredSchema = z
  .object({ expectedVersion: ReviewVersionSchema, reason: ReasonSchema })
  .strict();

const schemas = {
  "verify-evidence": z
    .object({ evidenceReceiptId: EvidenceIdSchema, expectedVersion: ReviewVersionSchema })
    .strict(),
  "reject-evidence": z
    .object({
      evidenceReceiptId: EvidenceIdSchema,
      expectedVersion: ReviewVersionSchema,
      reason: ReasonSchema,
    })
    .strict(),
  approve: z
    .object({
      expectedVersion: ReviewVersionSchema,
      note: z.string().trim().max(4_000).optional(),
    })
    .strict(),
  "edit-and-approve": EditAndApproveSchema,
  "correct-context": CorrectContextSchema,
  "recompute-stored": RecomputeStoredSchema,
  "convert-to-wait": z
    .object({
      reason: ReasonSchema,
      expectedVersion: ReviewVersionSchema,
      validForHours: z.union([z.literal(24), z.literal(48), z.literal(72), z.literal(168)]),
    })
    .strict(),
  deliver: z
    .object({ expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90)]) })
    .strict(),
  "mark-failed": z
    .object({
      failureCode: z
        .string()
        .trim()
        .min(2)
        .max(100)
        .regex(/^[A-Za-z0-9_:-]+$/),
      failureMessage: z.string().trim().min(10).max(500),
    })
    .strict(),
  retry: z.object({}).strict(),
} as const;

export type OpsActionName = keyof typeof schemas;

export type ParsedOpsAction =
  | { success: true; action: "verify-evidence"; data: z.infer<(typeof schemas)["verify-evidence"]> }
  | { success: true; action: "reject-evidence"; data: z.infer<(typeof schemas)["reject-evidence"]> }
  | { success: true; action: "approve"; data: z.infer<(typeof schemas)["approve"]> }
  | {
      success: true;
      action: "edit-and-approve";
      data: z.infer<(typeof schemas)["edit-and-approve"]>;
    }
  | {
      success: true;
      action: "correct-context";
      data: z.infer<(typeof schemas)["correct-context"]>;
    }
  | {
      success: true;
      action: "recompute-stored";
      data: z.infer<(typeof schemas)["recompute-stored"]>;
    }
  | { success: true; action: "convert-to-wait"; data: z.infer<(typeof schemas)["convert-to-wait"]> }
  | { success: true; action: "deliver"; data: z.infer<(typeof schemas)["deliver"]> }
  | { success: true; action: "mark-failed"; data: z.infer<(typeof schemas)["mark-failed"]> }
  | { success: true; action: "retry"; data: z.infer<(typeof schemas)["retry"]> }
  | { success: false; error: string };

export function parseOpsAction(action: string, raw: unknown): ParsedOpsAction {
  if (!Object.hasOwn(schemas, action)) {
    return { success: false, error: "Unknown operations action." };
  }

  switch (action as OpsActionName) {
    case "verify-evidence": {
      const parsed = schemas["verify-evidence"].safeParse(raw);
      return parsed.success
        ? { success: true, action: "verify-evidence", data: parsed.data }
        : { success: false, error: "A valid evidence receipt is required." };
    }
    case "reject-evidence": {
      const parsed = schemas["reject-evidence"].safeParse(raw);
      return parsed.success
        ? { success: true, action: "reject-evidence", data: parsed.data }
        : { success: false, error: "Evidence rejection needs a receipt and a reason." };
    }
    case "approve": {
      const parsed = schemas.approve.safeParse(raw);
      return parsed.success
        ? { success: true, action: "approve", data: parsed.data }
        : { success: false, error: "Approval requires the current version and a bounded note." };
    }
    case "edit-and-approve": {
      const parsed = schemas["edit-and-approve"].safeParse(raw);
      return parsed.success
        ? { success: true, action: "edit-and-approve", data: parsed.data }
        : {
            success: false,
            error: "Edit-and-approve requires the current version and only editable move fields.",
          };
    }
    case "correct-context": {
      const parsed = schemas["correct-context"].safeParse(raw);
      return parsed.success
        ? { success: true, action: "correct-context", data: parsed.data }
        : {
            success: false,
            error: "Context correction requires the current version and bounded founder context.",
          };
    }
    case "recompute-stored": {
      const parsed = schemas["recompute-stored"].safeParse(raw);
      return parsed.success
        ? { success: true, action: "recompute-stored", data: parsed.data }
        : {
            success: false,
            error: "Stored-evidence recompute requires the current version and a reason.",
          };
    }
    case "convert-to-wait": {
      const parsed = schemas["convert-to-wait"].safeParse(raw);
      return parsed.success
        ? { success: true, action: "convert-to-wait", data: parsed.data }
        : { success: false, error: "WAIT requires a reason and a bounded validity window." };
    }
    case "deliver": {
      const parsed = schemas.deliver.safeParse(raw);
      return parsed.success
        ? { success: true, action: "deliver", data: parsed.data }
        : { success: false, error: "Choose a supported delivery expiry." };
    }
    case "mark-failed": {
      const parsed = schemas["mark-failed"].safeParse(raw);
      return parsed.success
        ? { success: true, action: "mark-failed", data: parsed.data }
        : { success: false, error: "A safe failure code and explanation are required." };
    }
    case "retry": {
      const parsed = schemas.retry.safeParse(raw);
      return parsed.success
        ? { success: true, action: "retry", data: parsed.data }
        : { success: false, error: "Retry does not accept additional fields." };
    }
  }
}

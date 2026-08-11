import { z } from "zod";

const EvidenceIdSchema = z.string().uuid();
const ReasonSchema = z.string().trim().min(10).max(4_000);

const schemas = {
  "verify-evidence": z.object({ evidenceReceiptId: EvidenceIdSchema }).strict(),
  "reject-evidence": z
    .object({ evidenceReceiptId: EvidenceIdSchema, reason: ReasonSchema })
    .strict(),
  approve: z.object({ note: z.string().trim().max(4_000).optional() }).strict(),
  "convert-to-wait": z
    .object({
      reason: ReasonSchema,
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
        : { success: false, error: "The approval note is too long." };
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

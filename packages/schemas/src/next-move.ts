import { z } from "zod";

import {
  ConfidenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  LongTextSchema,
  PrioritySchema,
  PublicHttpUrlSchema,
  ShortTextSchema,
  StringListSchema,
} from "./common";
import {
  NextMoveActionSchema,
  ScanStateSchema,
  SignalClassSchema,
  SourceSlugSchema,
} from "./enums";
import { ContentCapabilityNameSchema } from "./project";
import type { Signal } from "./signal";

export const NEXT_MOVE_CONTRACT_VERSION = "next-move-v1" as const;

export const GenerationLevelSchema = z.enum(["brief", "draft"]);
export type GenerationLevel = z.infer<typeof GenerationLevelSchema>;

export const TrendWindowStateSchema = z.enum([
  "EARLY",
  "RISING",
  "ACTIVE",
  "SATURATING",
  "DECAYING",
  "EVERGREEN",
  "UNKNOWN",
]);
export type TrendWindowState = z.infer<typeof TrendWindowStateSchema>;

export const TrendWindowBasisSchema = z.enum([
  "MEASURED_EXTERNAL_SERIES",
  "MEASURED_INTERNAL_VELOCITY",
  "CORROBORATED_INFERENCE",
  "SINGLE_SIGNAL_INFERENCE",
  "UNKNOWN",
]);
export type TrendWindowBasis = z.infer<typeof TrendWindowBasisSchema>;

export const TrendWindowSchema = z
  .object({
    state: TrendWindowStateSchema,
    basis: TrendWindowBasisSchema,
    observed_since: IsoDateTimeSchema.optional(),
    last_confirmed_at: IsoDateTimeSchema,
    recommended_action_by: IsoDateTimeSchema.optional(),
    valid_until: IsoDateTimeSchema,
    recheck_at: IsoDateTimeSchema,
    estimated_remaining_hours: z
      .object({
        min: z
          .number()
          .int()
          .nonnegative()
          .max(24 * 365),
        max: z
          .number()
          .int()
          .positive()
          .max(24 * 365),
      })
      .strict()
      .optional(),
    confidence: ConfidenceSchema,
    explanation: LongTextSchema,
  })
  .strict()
  .superRefine((window, context) => {
    const validUntil = new Date(window.valid_until).getTime();
    const lastConfirmed = new Date(window.last_confirmed_at).getTime();
    const recheckAt = new Date(window.recheck_at).getTime();
    if (lastConfirmed > validUntil) {
      context.addIssue({
        code: "custom",
        path: ["last_confirmed_at"],
        message: "The last confirmation cannot be after the validity boundary",
      });
    }
    if (recheckAt > validUntil) {
      context.addIssue({
        code: "custom",
        path: ["recheck_at"],
        message: "The recheck time cannot be after the validity boundary",
      });
    }
    if (
      window.recommended_action_by !== undefined &&
      new Date(window.recommended_action_by).getTime() > validUntil
    ) {
      context.addIssue({
        code: "custom",
        path: ["recommended_action_by"],
        message: "The recommended action deadline cannot exceed the validity boundary",
      });
    }
    if (
      window.observed_since !== undefined &&
      new Date(window.observed_since).getTime() > lastConfirmed
    ) {
      context.addIssue({
        code: "custom",
        path: ["observed_since"],
        message: "The first observation cannot be after the last confirmation",
      });
    }
    if (
      window.estimated_remaining_hours &&
      window.estimated_remaining_hours.min > window.estimated_remaining_hours.max
    ) {
      context.addIssue({
        code: "custom",
        path: ["estimated_remaining_hours", "min"],
        message: "The remaining-hours minimum cannot exceed the maximum",
      });
    }
    if (window.basis === "UNKNOWN" && window.estimated_remaining_hours !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["estimated_remaining_hours"],
        message: "An unknown trend window cannot claim an estimated remaining duration",
      });
    }
    if (window.state === "UNKNOWN" && window.basis !== "UNKNOWN") {
      context.addIssue({
        code: "custom",
        path: ["basis"],
        message: "An unknown trend-window state must use an unknown basis",
      });
    }
    if (window.basis === "UNKNOWN" && window.state !== "UNKNOWN") {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "An unknown trend-window basis must use an unknown state",
      });
    }
  });
export type TrendWindow = z.infer<typeof TrendWindowSchema>;

const BreakoutFactorSchema = z.number().finite().min(0).max(1);

export const BreakoutPotentialSchema = z
  .object({
    level: z.enum(["low", "medium", "high", "unknown"]),
    basis: z.enum(["EVIDENCE_GROUNDED", "HEURISTIC", "INSUFFICIENT_DATA"]),
    factors: z
      .object({
        audience_relevance: BreakoutFactorSchema,
        timing: BreakoutFactorSchema,
        novelty: BreakoutFactorSchema,
        product_credibility: BreakoutFactorSchema,
        format_fit: BreakoutFactorSchema,
        saturation_risk: BreakoutFactorSchema,
      })
      .strict(),
    explanation: LongTextSchema,
  })
  .strict()
  .superRefine((potential, context) => {
    const insufficient = potential.basis === "INSUFFICIENT_DATA";
    if ((potential.level === "unknown") !== insufficient) {
      context.addIssue({
        code: "custom",
        path: ["level"],
        message: "Unknown breakout potential is reserved for insufficient data",
      });
    }
  });
export type BreakoutPotential = z.infer<typeof BreakoutPotentialSchema>;

const BlueprintListSchema = z.array(z.string().trim().min(1).max(1_000)).max(20);
const ProductionOptionSchema = z.enum([
  "FOUNDER_TEXT",
  "SCREEN_RECORDING",
  "FOUNDER_CAMERA",
  "AI_AVATAR",
  "CAROUSEL",
  "PRODUCT_DEMO",
]);

export const ContentBlueprintSchema = z
  .object({
    content_premise: LongTextSchema,
    audience_tension: LongTextSchema,
    product_role: LongTextSchema,
    format_family: z.string().trim().min(1).max(100),
    format_basis: z.enum(["SOURCE_OBSERVED", "PRODUCT_FIT", "HEURISTIC"]),
    hook_family: z.string().trim().min(1).max(200),
    hook_variants: z
      .array(
        z
          .object({
            style: z.enum(["direct", "contrarian", "proof"]),
            text: LongTextSchema,
          })
          .strict(),
      )
      .length(3),
    tone: BlueprintListSchema.min(1),
    structure: BlueprintListSchema.min(1),
    cta: LongTextSchema,
    asset_requirements: BlueprintListSchema,
    channel_instructions: BlueprintListSchema.min(1),
    production_options: z.array(ProductionOptionSchema).min(1).max(6),
  })
  .strict()
  .superRefine((blueprint, context) => {
    const styles = blueprint.hook_variants.map((variant) => variant.style);
    if (new Set(styles).size !== 3) {
      context.addIssue({
        code: "custom",
        path: ["hook_variants"],
        message: "Hook variants must contain one direct, one contrarian, and one proof style",
      });
    }
    const hookTexts = blueprint.hook_variants.map((variant) => variant.text.toLowerCase());
    if (new Set(hookTexts).size !== hookTexts.length) {
      context.addIssue({
        code: "custom",
        path: ["hook_variants"],
        message: "Hook variants must be differentiated",
      });
    }
    if (new Set(blueprint.production_options).size !== blueprint.production_options.length) {
      context.addIssue({
        code: "custom",
        path: ["production_options"],
        message: "Production options cannot contain duplicates",
      });
    }
  });
export type ContentBlueprint = z.infer<typeof ContentBlueprintSchema>;

export const PublishDetailsSchema = z
  .object({
    action: z.literal("PUBLISH"),
    content_type: z.string().trim().min(1).max(100),
    blueprint: ContentBlueprintSchema,
    publish_by: IsoDateTimeSchema,
  })
  .strict();
export type PublishDetails = z.infer<typeof PublishDetailsSchema>;

export const ReplyTargetSchema = z
  .object({
    source: SourceSlugSchema,
    url: PublicHttpUrlSchema,
    author: z.string().trim().min(1).max(300).optional(),
    title_or_excerpt: LongTextSchema.optional(),
    published_at: IsoDateTimeSchema.optional(),
    observed_at: IsoDateTimeSchema,
    why_this_target: LongTextSchema,
    credibility_reason: LongTextSchema,
    reply_objective: LongTextSchema,
    reply_angle: LongTextSchema,
    suggested_reply: LongTextSchema,
    short_reply_variant: LongTextSchema.optional(),
    tone: BlueprintListSchema.min(1),
    reply_by: IsoDateTimeSchema,
  })
  .strict();
export type ReplyTarget = z.infer<typeof ReplyTargetSchema>;

export const ReplyDetailsSchema = z
  .object({
    action: z.literal("REPLY"),
    primary_target: ReplyTargetSchema,
    secondary_targets: z.array(ReplyTargetSchema).max(2),
  })
  .strict();
export type ReplyDetails = z.infer<typeof ReplyDetailsSchema>;

export const RemixSourceContentSchema = z
  .object({
    source: SourceSlugSchema,
    url: PublicHttpUrlSchema,
    author: z.string().trim().min(1).max(300).optional(),
    observed_hook: LongTextSchema.optional(),
    observed_format_family: z.string().trim().min(1).max(100).optional(),
    relevance_reason: LongTextSchema,
  })
  .strict();

export const RemixDetailsSchema = z
  .object({
    action: z.literal("REMIX"),
    source_content: z.array(RemixSourceContentSchema).min(1).max(3),
    preserve: BlueprintListSchema.min(1),
    transform: BlueprintListSchema.min(1),
    do_not_copy: BlueprintListSchema.min(1),
    transformed_concept: LongTextSchema,
    blueprint: ContentBlueprintSchema,
    remix_by: IsoDateTimeSchema,
  })
  .strict();
export type RemixDetails = z.infer<typeof RemixDetailsSchema>;

export const WaitFailureReasonSchema = z.enum([
  "WEAK_RELEVANCE",
  "LOW_CREDIBILITY",
  "SATURATED",
  "WEAK_EVIDENCE",
  "DEPENDENT_EVIDENCE",
  "BAD_TIMING",
  "MISSING_COVERAGE",
]);
export type WaitFailureReason = z.infer<typeof WaitFailureReasonSchema>;

export const WaitDetailsSchema = z
  .object({
    action: z.literal("WAIT"),
    considered_opportunity: LongTextSchema,
    failure_reasons: z.array(WaitFailureReasonSchema).min(1).max(7),
    do_not_act_on: BlueprintListSchema.min(1),
    watch_conditions: BlueprintListSchema.min(1),
    recheck_at: IsoDateTimeSchema,
    alternative: LongTextSchema.optional(),
  })
  .strict();
export type WaitDetails = z.infer<typeof WaitDetailsSchema>;

export const ActionDetailsSchema = z
  .discriminatedUnion("action", [
    PublishDetailsSchema,
    ReplyDetailsSchema,
    RemixDetailsSchema,
    WaitDetailsSchema,
  ])
  .superRefine((details, context) => {
    if (details.action === "REPLY") {
      const urls = [details.primary_target, ...details.secondary_targets].map(
        (target) => target.url,
      );
      if (new Set(urls).size !== urls.length) {
        context.addIssue({
          code: "custom",
          path: ["secondary_targets"],
          message: "Reply targets must refer to distinct stored source URLs",
        });
      }
    }
    if (
      details.action === "WAIT" &&
      new Set(details.failure_reasons).size !== details.failure_reasons.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["failure_reasons"],
        message: "WAIT failure reasons cannot contain duplicates",
      });
    }
  });
export type ActionDetails = z.infer<typeof ActionDetailsSchema>;

type StoredEvidenceBindingSignal = Pick<
  Signal,
  "id" | "source" | "url" | "title" | "textExcerpt" | "author" | "publishedAt" | "observedAt"
>;

/**
 * Verifies that every factual target/source field in action details is copied
 * from the exact stored evidence allowlist. This pure boundary is shared by
 * generation, persistence reconciliation, and delivery projections.
 */
export function assertActionDetailsBoundToStoredEvidence(input: {
  details: ActionDetails;
  evidenceSignalIds: readonly string[];
  storedSignals: readonly StoredEvidenceBindingSignal[];
}): void {
  const storedById = new Map(input.storedSignals.map((signal) => [signal.id, signal]));
  const exactSignals = input.evidenceSignalIds.map((id) => {
    const signal = storedById.get(id);
    if (!signal) throw new Error(`Evidence ${id} is not stored`);
    return signal;
  });
  const assertFactualTarget = (target: {
    source: Signal["source"];
    url: string;
    author?: string | undefined;
    title_or_excerpt?: string | undefined;
    published_at?: string | undefined;
    observed_at?: string | undefined;
    observed_hook?: string | undefined;
  }) => {
    const matches = exactSignals.filter(
      (signal) => signal.url === target.url && signal.source === target.source,
    );
    if (matches.length === 0) {
      throw new Error("Action detail URL is not evidence-bound to the requested source");
    }
    const isExactMatch = matches.some((signal) => {
      const authors = new Set(
        [signal.author?.handle, signal.author?.displayName].filter(
          (author): author is string => author !== undefined,
        ),
      );
      const exactText = signal.title ?? signal.textExcerpt;
      return (
        (target.author === undefined || authors.has(target.author)) &&
        (target.title_or_excerpt === undefined || target.title_or_excerpt === exactText) &&
        (target.observed_hook === undefined || target.observed_hook === exactText) &&
        (target.published_at === undefined || target.published_at === signal.publishedAt) &&
        (target.observed_at === undefined || target.observed_at === signal.observedAt)
      );
    });
    if (isExactMatch) return;
    if (
      target.author !== undefined &&
      !matches.some(
        (signal) =>
          signal.author?.handle === target.author || signal.author?.displayName === target.author,
      )
    ) {
      throw new Error("Action detail author is not evidence-bound");
    }
    throw new Error("Action detail factual fields are not evidence-bound");
  };
  if (input.details.action === "REPLY") {
    assertFactualTarget(input.details.primary_target);
    input.details.secondary_targets.forEach(assertFactualTarget);
  }
  if (input.details.action === "REMIX") {
    input.details.source_content.forEach(assertFactualTarget);
  }
}

const NextMoveSharedShape = {
  contractVersion: z.literal(NEXT_MOVE_CONTRACT_VERSION),
  generationLevel: GenerationLevelSchema,
  channel: z.string().trim().min(1).max(100),
  topic: ShortTextSchema,
  angle: LongTextSchema,
  format: z.string().trim().min(1).max(100),
  hook: LongTextSchema,
  outline: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
  cta: LongTextSchema,
  priority: PrioritySchema,
  confidence: ConfidenceSchema,
  validUntil: IsoDateTimeSchema,
  trendWindow: TrendWindowSchema,
  breakoutPotential: BreakoutPotentialSchema,
  draftContent: LongTextSchema.optional(),
};

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const VersionedNextMoveSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        ...NextMoveSharedShape,
        action: z.literal("PUBLISH"),
        details: PublishDetailsSchema,
      })
      .strict(),
    z
      .object({
        ...NextMoveSharedShape,
        action: z.literal("REPLY"),
        details: ReplyDetailsSchema,
      })
      .strict(),
    z
      .object({
        ...NextMoveSharedShape,
        action: z.literal("REMIX"),
        details: RemixDetailsSchema,
      })
      .strict(),
    z
      .object({
        ...NextMoveSharedShape,
        action: z.literal("WAIT"),
        details: WaitDetailsSchema,
      })
      .strict(),
  ])
  .superRefine((move, context) => {
    if (move.validUntil !== move.trendWindow.valid_until) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "The legacy validity field must equal the versioned trend-window boundary",
      });
    }
    if (move.generationLevel === "brief" && move.draftContent !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["draftContent"],
        message: "Brief generation cannot contain a draft asset",
      });
    }
    if ((move.action === "REPLY" || move.action === "WAIT") && move.draftContent !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["draftContent"],
        message: "Draft assets are supported only for PUBLISH and REMIX",
      });
    }
    const requiresDraft =
      move.generationLevel === "draft" && (move.action === "PUBLISH" || move.action === "REMIX");
    if (requiresDraft !== (move.draftContent !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["draftContent"],
        message: "Draft generation requires exactly one draft asset for PUBLISH or REMIX",
      });
    }
    if (move.action === "PUBLISH") {
      if (
        move.details.content_type !== move.format ||
        move.details.blueprint.format_family !== move.format
      ) {
        context.addIssue({
          code: "custom",
          path: ["details", "content_type"],
          message: "Publish details must use the selected top-level format",
        });
      }
      if (move.details.publish_by !== move.validUntil) {
        context.addIssue({
          code: "custom",
          path: ["details", "publish_by"],
          message: "The publish deadline must equal the decision validity boundary",
        });
      }
      if (
        !sameStringList(move.details.blueprint.structure, move.outline) ||
        move.details.blueprint.cta !== move.cta
      ) {
        context.addIssue({
          code: "custom",
          path: ["details", "blueprint"],
          message: "Publish blueprint prose must match the reconciled decision fields",
        });
      }
    }
    if (move.action === "REPLY") {
      const targets = [move.details.primary_target, ...move.details.secondary_targets];
      if (targets.some((target) => target.reply_by !== move.validUntil)) {
        context.addIssue({
          code: "custom",
          path: ["details", "primary_target", "reply_by"],
          message: "Every reply deadline must equal the decision validity boundary",
        });
      }
    }
    if (move.action === "REMIX") {
      if (move.details.blueprint.format_family !== move.format) {
        context.addIssue({
          code: "custom",
          path: ["details", "blueprint", "format_family"],
          message: "Remix details must use the selected top-level format",
        });
      }
      if (move.details.remix_by !== move.validUntil) {
        context.addIssue({
          code: "custom",
          path: ["details", "remix_by"],
          message: "The remix deadline must equal the decision validity boundary",
        });
      }
      if (
        !sameStringList(move.details.blueprint.structure, move.outline) ||
        move.details.blueprint.cta !== move.cta
      ) {
        context.addIssue({
          code: "custom",
          path: ["details", "blueprint"],
          message: "Remix blueprint prose must match the reconciled decision fields",
        });
      }
    }
    if (move.action === "WAIT" && move.details.recheck_at !== move.trendWindow.recheck_at) {
      context.addIssue({
        code: "custom",
        path: ["details", "recheck_at"],
        message: "The WAIT recheck time must equal the trend-window recheck time",
      });
    }
  });
export type VersionedNextMove = z.infer<typeof VersionedNextMoveSchema>;

export type VersionedNextMoveProse = Pick<
  VersionedNextMove,
  "channel" | "topic" | "angle" | "format" | "hook" | "outline" | "cta"
>;

function reconcileBlueprint(
  blueprint: ContentBlueprint,
  prose: VersionedNextMoveProse,
): ContentBlueprint {
  return ContentBlueprintSchema.parse({
    ...blueprint,
    content_premise: `${prose.topic}: ${prose.angle}`,
    format_family: prose.format,
    format_basis: blueprint.format_family === prose.format ? blueprint.format_basis : "HEURISTIC",
    hook_variants: [
      { style: "direct", text: prose.hook },
      { style: "contrarian", text: `A different way to see it: ${prose.angle}` },
      { style: "proof", text: `The practical test: ${prose.topic}` },
    ],
    structure: prose.outline,
    cta: prose.cta,
  });
}

function draftFromReconciledBlueprint(
  action: "PUBLISH" | "REMIX",
  blueprint: ContentBlueprint,
): string {
  return [
    blueprint.hook_variants[0]!.text,
    "",
    blueprint.audience_tension,
    "",
    ...blueprint.structure.map((step) => `- ${step}`),
    "",
    blueprint.product_role,
    "",
    blueprint.cta,
    "",
    `[${action} draft — founder approval required; do not auto-publish]`,
  ].join("\n");
}

/**
 * Reconciles prose-only revisions without changing the selected action, score,
 * timing truth, breakout classification, or any stored-source identity fields.
 */
export function reconcileVersionedNextMove(input: {
  move: VersionedNextMove;
  prose: VersionedNextMoveProse;
  validUntil?: string | Date;
}): VersionedNextMove {
  const move = VersionedNextMoveSchema.parse(input.move);
  const validUntil =
    input.validUntil === undefined
      ? move.validUntil
      : input.validUntil instanceof Date
        ? input.validUntil.toISOString()
        : IsoDateTimeSchema.parse(input.validUntil);
  const recheckAt =
    new Date(move.trendWindow.recheck_at).getTime() <= new Date(validUntil).getTime()
      ? move.trendWindow.recheck_at
      : validUntil;
  const trendWindow = TrendWindowSchema.parse({
    ...move.trendWindow,
    valid_until: validUntil,
    recheck_at: recheckAt,
    ...(move.trendWindow.recommended_action_by === undefined
      ? {}
      : { recommended_action_by: validUntil }),
  });
  let details: ActionDetails;
  switch (move.action) {
    case "PUBLISH": {
      details = {
        ...move.details,
        content_type: input.prose.format,
        blueprint: reconcileBlueprint(move.details.blueprint, input.prose),
        publish_by: validUntil,
      };
      break;
    }
    case "REPLY": {
      const reconcileTarget = (target: ReplyTarget): ReplyTarget => ({
        ...target,
        reply_angle: input.prose.angle,
        suggested_reply: `${input.prose.hook}\n\n${input.prose.angle}`,
        short_reply_variant: input.prose.hook,
        reply_by: validUntil,
      });
      details = {
        ...move.details,
        primary_target: reconcileTarget(move.details.primary_target),
        secondary_targets: move.details.secondary_targets.map(reconcileTarget),
      };
      break;
    }
    case "REMIX": {
      details = {
        ...move.details,
        transformed_concept: `${input.prose.topic}: ${input.prose.angle}`,
        blueprint: reconcileBlueprint(move.details.blueprint, input.prose),
        remix_by: validUntil,
      };
      break;
    }
    case "WAIT": {
      details = {
        ...move.details,
        considered_opportunity: input.prose.topic,
        recheck_at: recheckAt,
        alternative: input.prose.angle,
      };
      break;
    }
  }
  const draftContent =
    move.generationLevel === "draft" && (details.action === "PUBLISH" || details.action === "REMIX")
      ? draftFromReconciledBlueprint(details.action, details.blueprint)
      : undefined;
  return VersionedNextMoveSchema.parse({
    ...move,
    ...input.prose,
    validUntil,
    trendWindow,
    details,
    ...(draftContent === undefined ? { draftContent: undefined } : { draftContent }),
  });
}

/** Converts a reviewed enhanced proposal to an explicit, non-publishing WAIT. */
export function convertVersionedNextMoveToWait(input: {
  move: VersionedNextMove;
  reason: string;
  validUntil: string | Date;
}): VersionedNextMove {
  const move = VersionedNextMoveSchema.parse(input.move);
  const reason = LongTextSchema.parse(input.reason);
  const validUntil =
    input.validUntil instanceof Date
      ? input.validUntil.toISOString()
      : IsoDateTimeSchema.parse(input.validUntil);
  const trendWindow = TrendWindowSchema.parse({
    state: "UNKNOWN",
    basis: "UNKNOWN",
    last_confirmed_at: move.trendWindow.last_confirmed_at,
    valid_until: validUntil,
    recheck_at: validUntil,
    confidence: Math.min(move.trendWindow.confidence, 0.35),
    explanation:
      "Founder review concluded that the stored evidence does not support an actionable remaining-duration estimate.",
  });
  return VersionedNextMoveSchema.parse({
    contractVersion: move.contractVersion,
    generationLevel: move.generationLevel,
    action: "WAIT",
    channel: "none",
    topic: "No move passes the quality floor",
    angle: reason,
    format: "none",
    hook: "Wait for stronger evidence.",
    outline: [reason],
    cta: "Run another scan when the evidence window changes.",
    priority: 0,
    confidence: move.confidence,
    validUntil,
    trendWindow,
    breakoutPotential: {
      level: "unknown",
      basis: "INSUFFICIENT_DATA",
      factors: move.breakoutPotential.factors,
      explanation:
        "Breakout potential is unknown because founder review found insufficient actionable evidence. This label is not a probability.",
    },
    details: {
      action: "WAIT",
      considered_opportunity: move.topic,
      failure_reasons: ["WEAK_EVIDENCE"],
      do_not_act_on: ["Do not act on the prior recommendation as if it still passed review."],
      watch_conditions: ["Recheck after stronger current evidence is stored and reviewed."],
      recheck_at: validUntil,
      alternative: reason,
    },
  });
}

/**
 * Persisted pre-launch core fields retained while the additive contract
 * migration is replayed. New decision code emits VersionedNextMove as well.
 */
export const NextMoveSchema = z
  .object({
    action: NextMoveActionSchema,
    channel: z.string().trim().min(1).max(100),
    topic: ShortTextSchema,
    angle: LongTextSchema,
    format: z.string().trim().min(1).max(100),
    hook: LongTextSchema,
    outline: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    cta: LongTextSchema,
    priority: PrioritySchema,
    confidence: ConfidenceSchema,
    validUntil: IsoDateTimeSchema,
  })
  .strict();
export type NextMove = z.infer<typeof NextMoveSchema>;

export const WhyNowSchema = z
  .object({
    summary: LongTextSchema,
    signalClass: SignalClassSchema,
    independentSourceCount: z.number().int().nonnegative().max(20),
    saturation: z.enum(["low", "low_to_medium", "medium", "high", "unknown"]),
  })
  .strict();
export type WhyNow = z.infer<typeof WhyNowSchema>;

export const EvidenceReceiptSchema = z
  .object({
    source: SourceSlugSchema,
    url: PublicHttpUrlSchema,
    title: ShortTextSchema.optional(),
    publishedAt: IsoDateTimeSchema.optional(),
    observedAt: IsoDateTimeSchema,
    reason: LongTextSchema,
    provider: IdentifierSchema,
    role: z.enum(["DECISION_SUPPORT", "SUPPLEMENTAL"]).default("DECISION_SUPPORT"),
    verified: z.boolean(),
    availability: z
      .enum(["AVAILABLE", "SOURCE_NO_LONGER_AVAILABLE", "REJECTED"])
      .default("AVAILABLE"),
  })
  .strict();
export type EvidenceReceipt = z.infer<typeof EvidenceReceiptSchema>;

export const NextMoveRequestSchema = z
  .object({
    product_url: PublicHttpUrlSchema,
    goal: z.string().trim().min(1).max(100).optional(),
    objective: z.string().trim().min(1).max(100).optional(),
    market: z.string().trim().min(2).max(50).optional(),
    language: z.string().trim().min(2).max(35).optional(),
    preferred_channels: StringListSchema.optional(),
    available_formats: StringListSchema.optional(),
    content_capabilities: z.array(ContentCapabilityNameSchema).min(1).max(7).optional(),
    generation_level: GenerationLevelSchema.default("brief"),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.goal !== undefined && request.objective !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["objective"],
        message: "Use objective or the legacy goal field, not both",
      });
    }
  });
/** Input form keeps the defaulted generation level optional for legacy callers. */
export type NextMoveRequest = z.input<typeof NextMoveRequestSchema>;

export const ProjectNextMoveRequestSchema = z
  .object({
    objective: z.string().trim().min(1).max(100).optional(),
    preferred_channels: StringListSchema.optional(),
    content_capabilities: z.array(ContentCapabilityNameSchema).min(1).max(7).optional(),
    generation_level: GenerationLevelSchema.default("brief"),
  })
  .strict();
export type ProjectNextMoveRequest = z.input<typeof ProjectNextMoveRequestSchema>;

export const IdempotencyKeySchema = z.string().uuid();

export const NextMoveAcceptedResponseSchema = z
  .object({
    id: IdentifierSchema,
    status: z.enum(["QUEUED", "RUNNING", "REVIEW_REQUIRED"]),
    status_url: z.string().trim().min(1).max(2_048),
    poll_after_seconds: z.literal(30),
  })
  .strict();
export type NextMoveAcceptedResponse = z.infer<typeof NextMoveAcceptedResponseSchema>;

export const NextMoveFailedResponseSchema = z
  .object({
    id: IdentifierSchema,
    status: z.literal("FAILED"),
    error: z
      .object({
        code: z.string().trim().min(1).max(100),
        message: z.string().trim().min(1).max(500),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type NextMoveFailedResponse = z.infer<typeof NextMoveFailedResponseSchema>;

const ApiProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    url: PublicHttpUrlSchema,
    audience: LongTextSchema,
    problem: LongTextSchema,
    credible_topics: StringListSchema,
    assumptions: StringListSchema,
  })
  .strict();

export const ApiNextMoveSchema = z
  .object({
    action: NextMoveActionSchema,
    channel: z.string().trim().min(1).max(100),
    topic: ShortTextSchema,
    angle: LongTextSchema,
    format: z.string().trim().min(1).max(100),
    hook: LongTextSchema,
    outline: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    cta: LongTextSchema.optional(),
    priority: PrioritySchema,
    confidence: ConfidenceSchema,
    valid_until: IsoDateTimeSchema,
  })
  .strict();
export type ApiNextMove = z.infer<typeof ApiNextMoveSchema>;

const ApiWhyNowSchema = z
  .object({
    summary: LongTextSchema,
    signal_class: SignalClassSchema,
    independent_source_count: z.number().int().nonnegative().max(20),
    saturation: z.enum(["low", "low_to_medium", "medium", "high", "unknown"]),
  })
  .strict();

const ApiEvidenceSchema = z
  .object({
    source: SourceSlugSchema,
    url: PublicHttpUrlSchema,
    title: ShortTextSchema.optional(),
    published_at: IsoDateTimeSchema.optional(),
    observed_at: IsoDateTimeSchema,
    reason: LongTextSchema,
    provider: IdentifierSchema,
    role: z.enum(["DECISION_SUPPORT", "SUPPLEMENTAL"]),
    verified: z.boolean(),
    availability: z.enum(["AVAILABLE", "SOURCE_NO_LONGER_AVAILABLE", "REJECTED"]).optional(),
  })
  .strict();

export const NextMoveFreshnessSchema = z
  .object({
    state: z.enum(["CURRENT", "STALE"]),
    evaluated_at: IsoDateTimeSchema,
    requires_new_scan: z.boolean(),
  })
  .strict()
  .superRefine((freshness, context) => {
    if ((freshness.state === "STALE") !== freshness.requires_new_scan) {
      context.addIssue({
        code: "custom",
        path: ["requires_new_scan"],
        message: "A stale move requires a new scan and a current move does not",
      });
    }
  });
export type NextMoveFreshness = z.infer<typeof NextMoveFreshnessSchema>;

export function evaluateNextMoveFreshness(input: {
  validUntil: string | Date;
  proposalStale?: boolean;
  now?: string | Date;
}): NextMoveFreshness {
  const validUntil =
    input.validUntil instanceof Date ? input.validUntil : new Date(input.validUntil);
  const evaluatedAt = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  if (Number.isNaN(validUntil.getTime()) || Number.isNaN(evaluatedAt.getTime())) {
    throw new Error("Freshness requires valid timestamps");
  }
  const stale = input.proposalStale === true || evaluatedAt.getTime() >= validUntil.getTime();
  return NextMoveFreshnessSchema.parse({
    state: stale ? "STALE" : "CURRENT",
    evaluated_at: evaluatedAt.toISOString(),
    requires_new_scan: stale,
  });
}

export const NextMoveReadyResponseSchema = z
  .object({
    id: IdentifierSchema,
    status: z.literal("READY"),
    contract_version: z.literal(NEXT_MOVE_CONTRACT_VERSION),
    generation_level: GenerationLevelSchema,
    project: ApiProjectSchema,
    next_move: ApiNextMoveSchema,
    action_details: ActionDetailsSchema,
    trend_window: TrendWindowSchema,
    breakout_potential: BreakoutPotentialSchema,
    draft_content: LongTextSchema.optional(),
    freshness: NextMoveFreshnessSchema,
    why_now: ApiWhyNowSchema,
    evidence: z.array(ApiEvidenceSchema).max(50),
    limitations: StringListSchema,
    founder_reviewed: z.literal(true),
    auto_publish: z.literal(false),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.next_move.action !== response.action_details.action) {
      context.addIssue({
        code: "custom",
        path: ["action_details", "action"],
        message: "Action details must match the immutable primary action",
      });
    }
    if (response.next_move.valid_until !== response.trend_window.valid_until) {
      context.addIssue({
        code: "custom",
        path: ["trend_window", "valid_until"],
        message: "The trend window must use the Next Move validity boundary",
      });
    }
    if (response.generation_level === "brief" && response.draft_content !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["draft_content"],
        message: "Brief generation cannot contain a draft asset",
      });
    }
    if (
      (response.next_move.action === "REPLY" || response.next_move.action === "WAIT") &&
      response.draft_content !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["draft_content"],
        message: "Draft assets are supported only for PUBLISH and REMIX",
      });
    }
    const requiresDraft =
      response.generation_level === "draft" &&
      (response.next_move.action === "PUBLISH" || response.next_move.action === "REMIX");
    if (requiresDraft !== (response.draft_content !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["draft_content"],
        message: "Draft generation requires exactly one draft asset for PUBLISH or REMIX",
      });
    }
    const versioned = VersionedNextMoveSchema.safeParse({
      contractVersion: response.contract_version,
      generationLevel: response.generation_level,
      action: response.next_move.action,
      channel: response.next_move.channel,
      topic: response.next_move.topic,
      angle: response.next_move.angle,
      format: response.next_move.format,
      hook: response.next_move.hook,
      outline: response.next_move.outline,
      cta:
        response.next_move.cta ??
        (response.action_details.action === "PUBLISH" || response.action_details.action === "REMIX"
          ? response.action_details.blueprint.cta
          : "No call to action supplied."),
      priority: response.next_move.priority,
      confidence: response.next_move.confidence,
      validUntil: response.next_move.valid_until,
      trendWindow: response.trend_window,
      breakoutPotential: response.breakout_potential,
      details: response.action_details,
      ...(response.draft_content === undefined ? {} : { draftContent: response.draft_content }),
    });
    if (!versioned.success) {
      context.addIssue({
        code: "custom",
        path: ["action_details"],
        message: "The ready response must contain one internally consistent versioned decision",
      });
    }
  });
export type NextMoveReadyResponse = z.infer<typeof NextMoveReadyResponseSchema>;

export const NextMoveStatusResponseSchema = z.union([
  NextMoveAcceptedResponseSchema,
  NextMoveReadyResponseSchema,
  NextMoveFailedResponseSchema,
]);
export type NextMoveStatusResponse = z.infer<typeof NextMoveStatusResponseSchema>;

export const NextMoveApiRequestSchema = NextMoveRequestSchema;
export const NextMoveResponseSchema = NextMoveStatusResponseSchema;
export type NextMoveApiRequest = NextMoveRequest;
export type NextMoveResponse = NextMoveStatusResponse;

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().trim().min(1).max(100),
        message: z.string().trim().min(1).max(500),
        request_id: IdentifierSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** A useful assertion for exhaustive handlers importing only this package. */
export const isTerminalScanState = (state: z.infer<typeof ScanStateSchema>) =>
  state === "READY" || state === "FAILED";

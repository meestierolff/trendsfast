import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  LongTextSchema,
  PublicHttpUrlSchema,
  ShortTextSchema,
  StringListSchema,
} from "./common";
import { SourceSlugSchema } from "./enums";

export const ProjectEntityTypeSchema = z.enum(["PRODUCT", "BRAND", "CREATOR_LED_BRAND"]);
export type ProjectEntityType = z.infer<typeof ProjectEntityTypeSchema>;

export const ContextProvenanceSchema = z
  .object({
    observed_facts: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(100),
            value: LongTextSchema,
            source_url: PublicHttpUrlSchema,
          })
          .strict(),
      )
      .max(100),
    inferred_context: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(100),
            value: LongTextSchema,
            rationale: LongTextSchema,
          })
          .strict(),
      )
      .max(100),
    assumptions: StringListSchema,
  })
  .strict();
export type ContextProvenance = z.infer<typeof ContextProvenanceSchema>;

export const VoiceProfileSchema = z
  .object({
    traits: StringListSchema,
    preferred_phrases: StringListSchema,
    avoid_phrases: StringListSchema,
    sample_texts: z.array(LongTextSchema).max(12),
    sample_urls: z.array(PublicHttpUrlSchema).max(12),
  })
  .strict();
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const ContentCapabilityNameSchema = z.enum([
  "founder_text",
  "founder_on_camera",
  "screen_recording",
  "ai_avatar",
  "carousel",
  "product_demo",
  "long_form",
]);
export type ContentCapabilityName = z.infer<typeof ContentCapabilityNameSchema>;

export const ContentCapabilitiesSchema = z
  .object({
    founder_text: z.boolean(),
    founder_on_camera: z.boolean(),
    screen_recording: z.boolean(),
    ai_avatar: z.boolean(),
    carousel: z.boolean(),
    product_demo: z.boolean(),
    long_form: z.boolean(),
  })
  .strict();
export type ContentCapabilities = z.infer<typeof ContentCapabilitiesSchema>;

export const EMPTY_CONTEXT_PROVENANCE: ContextProvenance = {
  observed_facts: [],
  inferred_context: [],
  assumptions: [],
};

export const EMPTY_VOICE_PROFILE: VoiceProfile = {
  traits: [],
  preferred_phrases: [],
  avoid_phrases: [],
  sample_texts: [],
  sample_urls: [],
};

export const CONSERVATIVE_CONTENT_CAPABILITIES: ContentCapabilities = {
  founder_text: true,
  founder_on_camera: false,
  screen_recording: false,
  ai_avatar: false,
  carousel: false,
  product_demo: false,
  long_form: false,
};

export function contentCapabilitiesFromNames(
  names: readonly ContentCapabilityName[],
): ContentCapabilities {
  const selected = new Set(names);
  return ContentCapabilitiesSchema.parse(
    Object.fromEntries(
      ContentCapabilityNameSchema.options.map((name) => [name, selected.has(name)]),
    ),
  );
}

export const ProjectContextSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    url: PublicHttpUrlSchema,
    category: ShortTextSchema,
    audience: LongTextSchema,
    problem: LongTextSchema,
    desiredOutcome: LongTextSchema,
    credibleClaims: StringListSchema,
    alternatives: StringListSchema,
    competitors: StringListSchema,
    markets: StringListSchema,
    language: z.string().trim().min(2).max(35),
    suitableChannels: StringListSchema,
    availableFormats: StringListSchema,
    credibleTopics: StringListSchema,
    assumptions: StringListSchema,
  })
  .strict();
export type ProjectContext = z.infer<typeof ProjectContextSchema>;

export const ProviderQueryConstraintsSchema = z
  .object({
    maxCalls: z.number().int().min(0).max(20),
    maxResults: z.number().int().min(0).max(100),
    lookbackHours: z
      .number()
      .int()
      .positive()
      .max(24 * 365)
      .optional(),
    market: z.string().trim().min(2).max(50).optional(),
    language: z.string().trim().min(2).max(35).optional(),
  })
  .strict();
export type ProviderQueryConstraints = z.infer<typeof ProviderQueryConstraintsSchema>;

export const ProviderQueryGroupSchema = z
  .object({
    id: IdentifierSchema,
    source: SourceSlugSchema,
    role: z.string().trim().min(1).max(500),
    terms: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
    accounts: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    repositories: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
    constraints: ProviderQueryConstraintsSchema,
  })
  .strict();
export type ProviderQueryGroup = z.infer<typeof ProviderQueryGroupSchema>;

export const QueryPlanSchema = z
  .object({
    id: IdentifierSchema,
    projectContextVersionId: IdentifierSchema,
    version: z.string().trim().min(1).max(100),
    generatedAt: IsoDateTimeSchema,
    providers: z.array(ProviderQueryGroupSchema).min(1).max(20),
  })
  .strict();
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

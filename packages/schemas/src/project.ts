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

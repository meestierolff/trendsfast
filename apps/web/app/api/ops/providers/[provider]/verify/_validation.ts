import { z } from "zod";

export const ProviderVerificationBodySchema = z
  .object({
    productUrl: z.url().max(2_048).optional(),
    query: z.string().trim().min(1).max(180).optional(),
    market: z.string().trim().min(1).max(16).optional(),
    language: z.string().trim().min(2).max(16).optional(),
  })
  .strict();

import { z } from "zod";

export const ApiKeyIdSchema = z.string().uuid();
export const ApiKeyIssueBodySchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    environment: z.enum(["test", "live"]),
    scopes: z
      .array(z.enum(["next_move:read", "next_move:write"]))
      .min(1)
      .max(2)
      .refine((scopes) => new Set(scopes).size === scopes.length),
    rateLimitPerHour: z.number().int().min(1).max(10_000),
    providerCostLimitUsd: z.number().finite().nonnegative().max(10_000),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const ApiKeyReplacementBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();

export function parseBoundedFutureExpiry(value: string, now = new Date()): Date | null {
  const expiresAt = new Date(value);
  const minimum = now.getTime() + 5 * 60_000;
  const maximum = now.getTime() + 366 * 24 * 60 * 60_000;
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() < minimum ||
    expiresAt.getTime() > maximum
  ) {
    return null;
  }
  return expiresAt;
}

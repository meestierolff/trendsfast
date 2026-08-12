import { z } from "zod";

import { derivePrivacyHash } from "./first-party-analytics";

export const FOUNDER_LAUNCH_BODY_MAX_BYTES = 512;
export const FOUNDER_LAUNCH_CONSENT_VERSION = "founder-launch-v1";
export const FOUNDER_LAUNCH_RETENTION_DAYS = 180;

const FounderLaunchInterestBodySchema = z
  .object({
    email: z.string().trim().min(3).max(254).email(),
    consent: z.literal(true),
    source: z.enum(["homepage", "pricing"]),
    website: z.literal(""),
  })
  .strict();

export type FounderLaunchInterestBody = z.infer<typeof FounderLaunchInterestBodySchema>;

export function parseFounderLaunchInterestBody(value: unknown): FounderLaunchInterestBody | null {
  const parsed = FounderLaunchInterestBodySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeLaunchInterestEmail(value: string): string {
  const parsed = z.string().trim().min(3).max(254).email().safeParse(value);
  if (!parsed.success) throw new Error("A valid email address is required");
  return parsed.data.normalize("NFKC").toLowerCase();
}

export type FounderLaunchInterestWriter = {
  create(input: {
    normalizedEmail: string;
    emailHash: string;
    consentVersion: string;
    consentedAt: Date;
    source: "homepage" | "pricing";
    expiresAt: Date;
    anonymousSessionHash: string;
  }): Promise<{ id: string; created: boolean }>;
};

export async function acceptFounderLaunchInterest(
  input: {
    email: string;
    source: "homepage" | "pricing";
    anonymousSessionHash: string;
  },
  dependencies: {
    secret: string;
    interests: FounderLaunchInterestWriter;
    now?: Date;
  },
): Promise<{ joined: true }> {
  const now = dependencies.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("Launch interest time is invalid");
  const normalizedEmail = normalizeLaunchInterestEmail(input.email);
  const emailHash = derivePrivacyHash(
    dependencies.secret,
    "founder-launch-email:v1",
    normalizedEmail,
  );
  const expiresAt = new Date(now.getTime() + FOUNDER_LAUNCH_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
  await dependencies.interests.create({
    normalizedEmail,
    emailHash,
    consentVersion: FOUNDER_LAUNCH_CONSENT_VERSION,
    consentedAt: now,
    source: input.source,
    expiresAt,
    anonymousSessionHash: input.anonymousSessionHash,
  });

  return { joined: true };
}

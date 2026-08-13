import "server-only";

import { cookies } from "next/headers";

import { getMemberRepositories } from "./server-database";
import {
  PROJECT_CLAIM_COOKIE,
  projectClaimCookieOptions,
  projectClaimHash,
} from "./project-claim-cookie";
import type { VerifiedAuthIdentity } from "./auth-session";

export type ProjectClaimConsumeResult =
  | { status: "CLAIMED" | "ALREADY_OWNER"; projectId: string }
  | { status: "OWNERSHIP_CONFLICT" }
  | { status: "NOT_FOUND" | "EXPIRED" | "INVALIDATED" | "REPLAYED" };

type MemberAuthRepository = {
  createClaimForDelivery(input: {
    deliveryTokenId: string;
    projectId: string;
    claimHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<{ id: string; expiresAt: Date }>;
  consumeProjectClaim(input: {
    claimHash: string;
    identity: VerifiedAuthIdentity;
    now?: Date;
  }): Promise<ProjectClaimConsumeResult>;
};

function memberAuthRepository(): MemberAuthRepository {
  const repositories = getMemberRepositories() as ReturnType<typeof getMemberRepositories> & {
    members?: MemberAuthRepository;
  };
  if (!repositories.members) {
    throw new Error("The member authorization repository is not installed");
  }
  return repositories.members;
}

export async function consumeProjectClaimHash(
  claimHash: string,
  identity: VerifiedAuthIdentity,
): Promise<ProjectClaimConsumeResult> {
  return memberAuthRepository().consumeProjectClaim({
    claimHash,
    identity,
    now: new Date(),
  });
}

export async function createProjectClaimForDelivery(input: {
  deliveryTokenId: string;
  projectId: string;
  claimHash: string;
  expiresAt: Date;
  now: Date;
}) {
  return memberAuthRepository().createClaimForDelivery(input);
}

export async function consumePendingProjectClaim(
  identity: VerifiedAuthIdentity,
): Promise<ProjectClaimConsumeResult | { status: "NO_CLAIM" | "MALFORMED" }> {
  const cookieStore = await cookies();
  const rawClaim = cookieStore.get(PROJECT_CLAIM_COOKIE)?.value;
  if (!rawClaim) return { status: "NO_CLAIM" };
  const claimHash = projectClaimHash(rawClaim);
  if (!claimHash) {
    cookieStore.set(PROJECT_CLAIM_COOKIE, "", {
      ...projectClaimCookieOptions(),
      maxAge: 0,
    });
    return { status: "MALFORMED" };
  }

  const result = await consumeProjectClaimHash(claimHash, identity);
  cookieStore.set(PROJECT_CLAIM_COOKIE, "", {
    ...projectClaimCookieOptions(),
    maxAge: 0,
  });
  return result;
}

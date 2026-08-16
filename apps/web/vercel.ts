import hobby from "./vercel.hobby.json";
import ops from "./vercel.ops.json";
import pro from "./vercel.pro.json";

const profile = process.env.TRENDSFAST_VERCEL_CONFIG_PROFILE;
const projectId = process.env.VERCEL_PROJECT_ID;

const HOBBY_PUBLIC_PROJECT_ID = "prj_nYn6zjWW4BcKd03QaVO6LTOF3CSC";
const HOBBY_OPS_PROJECT_ID = "prj_EYAjX2Nyd1jUXSjfWVTVoI320nnU";

export function resolveVercelConfig(
  selectedProfile: string | undefined,
  buildProjectId: string | undefined = undefined,
) {
  if (
    selectedProfile !== undefined &&
    selectedProfile !== "public" &&
    selectedProfile !== "staged" &&
    selectedProfile !== "ops" &&
    selectedProfile !== "pro"
  ) {
    throw new Error("TRENDSFAST_VERCEL_CONFIG_PROFILE must be public, staged, ops, pro, or unset");
  }
  if (
    buildProjectId !== undefined &&
    buildProjectId !== HOBBY_PUBLIC_PROJECT_ID &&
    buildProjectId !== HOBBY_OPS_PROJECT_ID
  ) {
    throw new Error("VERCEL_PROJECT_ID does not identify a pinned TrendsFast project");
  }
  if (selectedProfile === "public") return hobby;
  if (selectedProfile === "pro") return pro;
  if (selectedProfile === "ops" || selectedProfile === "staged") return ops;

  // Vercel compiles vercel.ts again during the hosted build. When the current
  // Hobby flow forwards no per-deployment selector, select the same reviewed
  // profile from Vercel's existing build-time project identity.
  if (buildProjectId === HOBBY_PUBLIC_PROJECT_ID) return hobby;
  if (buildProjectId === HOBBY_OPS_PROJECT_ID) return ops;

  // The legacy staged-public flow and the ops surface deliberately share the
  // same cron-free deployment shape, but keep distinct selectors so their
  // operational intent cannot be confused in command logs or review.
  return ops;
}

// Founder scripts select a reviewed profile during local CLI compilation.
// Hosted compilation uses the pinned Vercel project ID, while unlinked local
// tooling retains the conservative cron-free default.
export const config = resolveVercelConfig(profile, projectId);

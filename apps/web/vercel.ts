import hobby from "./vercel.hobby.json";
import ops from "./vercel.ops.json";
import pro from "./vercel.pro.json";

const profile = process.env.TRENDSFAST_VERCEL_CONFIG_PROFILE;

export function resolveVercelConfig(selectedProfile: string | undefined) {
  if (
    selectedProfile !== undefined &&
    selectedProfile !== "public" &&
    selectedProfile !== "staged" &&
    selectedProfile !== "ops" &&
    selectedProfile !== "pro"
  ) {
    throw new Error("TRENDSFAST_VERCEL_CONFIG_PROFILE must be public, staged, ops, pro, or unset");
  }
  if (selectedProfile === "public") return hobby;
  if (selectedProfile === "pro") return pro;
  // The legacy staged-public flow and the ops surface deliberately share the
  // same cron-free deployment shape, but keep distinct selectors so their
  // operational intent cannot be confused in command logs or review.
  return ops;
}

// Automatic Git/default builds stay cron-free. Founder scripts select a
// reviewed profile because Vercel CLI reloads the config in rootDirectory.
export const config = resolveVercelConfig(profile);

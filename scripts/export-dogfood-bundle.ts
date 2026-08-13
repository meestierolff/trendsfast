import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createDatabaseClient, createRepositories } from "@trendsfast/database";

import { buildReviewBundle } from "../apps/web/lib/review-bundle-service";
import { renderReviewBundleMarkdown } from "../apps/web/lib/review-bundle";

const PRIVATE_ROOT = resolve(".var/private/dogfood");
const scanId = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const includePrivateCosts = process.argv.includes("--include-private-costs");

if (!scanId || !/^[A-Za-z0-9_.-]{1,100}$/.test(scanId)) {
  throw new Error("Usage: pnpm dogfood:export <scan-id> [--include-private-costs]");
}
const connectionString = process.env.OPS_DATABASE_URL?.trim();
if (!connectionString) throw new Error("OPS_DATABASE_URL is required for founder-private export");

await mkdir(PRIVATE_ROOT, { recursive: true, mode: 0o700 });
await chmod(resolve(".var/private"), 0o700);
await chmod(PRIVATE_ROOT, 0o700);

const client = createDatabaseClient({
  connectionString,
  ...(process.env.DATABASE_SSL_CA?.trim() ? { sslCa: process.env.DATABASE_SSL_CA.trim() } : {}),
  applicationName: "trendsfast-dogfood-export",
});
try {
  const bundle = await buildReviewBundle(createRepositories(client.db), scanId, new Date(), {
    includePrivateCosts,
  });
  if (!bundle) throw new Error("No complete founder-reviewed bundle exists for that scan");

  const suffix = includePrivateCosts ? "private-costs" : "public-safe";
  const jsonPath = resolve(PRIVATE_ROOT, `${scanId}-${suffix}.json`);
  const markdownPath = resolve(PRIVATE_ROOT, `${scanId}-${suffix}.md`);
  await writeFile(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(markdownPath, `${renderReviewBundleMarkdown(bundle)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await chmod(jsonPath, 0o600);
  await chmod(markdownPath, 0o600);
  console.info(
    JSON.stringify({
      jsonPath,
      markdownPath,
      privateCostsIncluded: includePrivateCosts,
    }),
  );
} finally {
  await client.close();
}

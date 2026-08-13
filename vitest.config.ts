import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": `${root}apps/web`,
      "@trendsfast/analytics": `${root}packages/analytics/src/index.ts`,
      "@trendsfast/billing": `${root}packages/billing/src/index.ts`,
      "@trendsfast/config": `${root}packages/config/src/index.ts`,
      "@trendsfast/core": `${root}packages/core/src/index.ts`,
      "@trendsfast/database": `${root}packages/database/src/index.ts`,
      "@trendsfast/evidence": `${root}packages/evidence/src/index.ts`,
      "@trendsfast/observability": `${root}packages/observability/src/index.ts`,
      "@trendsfast/orchestration": `${root}packages/orchestration/src/index.ts`,
      "@trendsfast/providers": `${root}packages/providers/src/index.ts`,
      "@trendsfast/schemas": `${root}packages/schemas/src/index.ts`,
      "@trendsfast/scoring": `${root}packages/scoring/src/index.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/web/tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});

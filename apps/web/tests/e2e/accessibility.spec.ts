import { expect, test } from "@playwright/test";
import axe from "axe-core";

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
};

const OPS_BASE_URL = process.env.OPS_BASE_URL ?? "http://127.0.0.1:3001";

const pages = [
  { name: "landing", path: "/" },
  { name: "agents", path: "/agents" },
  { name: "channels", path: "/channels" },
  { name: "news", path: "/news" },
  { name: "blog", path: "/blog" },
  { name: "pricing", path: "/pricing" },
  { name: "source status", path: "/sources" },
  { name: "social trend API", path: "/social-media-trend-api" },
  { name: "trend detection API", path: "/trend-detection-api" },
  { name: "content distribution API", path: "/content-distribution-api" },
  { name: "private fixture result", path: "/scan/scan_fixture_trendsfast" },
  { name: "founder login", path: new URL("/ops", OPS_BASE_URL).toString() },
] as const;

for (const target of pages) {
  test(`${target.name} has no automated WCAG A/AA violations`, async ({ page }) => {
    const response = await page.goto(target.path);
    expect(response?.status()).toBe(200);
    await page.addScriptTag({ content: axe.source });

    const violations = await page.evaluate(async () => {
      const axeApi = (
        globalThis as typeof globalThis & {
          axe: {
            run(
              context: Document,
              options: Record<string, unknown>,
            ): Promise<{ violations: AxeViolation[] }>;
          };
        }
      ).axe;
      const result = await axeApi.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      });
      return result.violations.flatMap((violation) =>
        violation.nodes.map((node) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          target: node.target,
          failureSummary: node.failureSummary,
        })),
      );
    });

    if (violations.length > 0) {
      throw new Error(JSON.stringify(violations, null, 2));
    }
  });
}

import { expect, test } from "@playwright/test";
import axe from "axe-core";

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
};

const pages = [
  { name: "landing", path: "/" },
  { name: "source status", path: "/sources" },
  { name: "private fixture result", path: "/scan/scan_fixture_trendsfast" },
  { name: "founder login", path: "/ops" },
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

import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function jsxElements(sourceText: string, tagName: string): string[] {
  const file = ts.createSourceFile(
    "dashboard-today-actions.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const elements: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === tagName) {
      elements.push(node.getText(file));
    } else if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === tagName) {
      elements.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return elements;
}

describe("dashboard proposal card accessibility contract", () => {
  it("keeps semantic DRAFT review and READY post-actions in native keyboard controls", () => {
    const card = source("../../components/dashboard-proposal-card.tsx");
    const actions = source("../../components/dashboard-today-actions.tsx");
    const buttons = jsxElements(actions, "button");
    const links = jsxElements(actions, "a");
    const inputs = jsxElements(actions, "input");

    expect(card).toContain('aria-labelledby="next-content-proposal-title"');
    expect(card).toContain('id="next-content-proposal-title"');
    expect(card).toContain("<time dateTime={proposal.act_before}>");
    expect(card).toContain('rel="noreferrer noopener"');

    expect(inputs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/type="checkbox"[\s\S]*checked=\{evidenceAttested\}/),
      ]),
    );
    expect(actions).toContain(
      'currentReviewState === "DRAFT" || currentReviewState === "APPROVED"',
    );
    expect(buttons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/submitReview\("APPROVE"\)[\s\S]*Approve proposal/),
        expect.stringMatching(/submitReview\("SKIP"\)[\s\S]*Review and skip/),
      ]),
    );

    expect(actions).toContain('currentReviewState === "READY" && !skipped');
    expect(buttons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/copy\(content,[\s\S]*>\s*Copy\s*</),
        expect.stringMatching(/copy\(agentPrompt,[\s\S]*Continue in my agent/),
        expect.stringMatching(/onClick=\{\(\) => void complete\(\)\}[\s\S]*completion\.label/),
      ]),
    );
    expect(actions).toContain('label: "Mark as posted"');
    expect(actions).toContain('label: "Mark as replied"');
    expect(actions).toContain('label: "Mark as remixed"');
    expect(links).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/href=\{destination\}[\s\S]*Open destination/),
      ]),
    );
    expect(actions).not.toContain("Use this proposal");
    expect(actions).not.toContain("tabIndex={-1}");
    expect(actions).not.toContain("auto-post");
  });

  it("refreshes the dashboard after a DRAFT skip enters the terminal REJECTED state", () => {
    const actions = source("../../components/dashboard-today-actions.tsx");
    const skipSuccess = actions.match(
      /if \(reviewDecision === "SKIP"\) \{([\s\S]*?)\} else \{/,
    )?.[1];

    expect(skipSuccess).toContain('setCurrentReviewState("REJECTED")');
    expect(skipSuccess).toContain("setSkipped(true)");
    expect(skipSuccess).toContain("router.refresh()");
    expect(skipSuccess).not.toContain('setCurrentReviewState("READY")');
    expect(actions).toMatch(
      /\{currentReviewState === "DRAFT" \? \([\s\S]*?submitReview\("SKIP"\)[\s\S]*?Review and skip[\s\S]*?\) : null\}/,
    );
  });

  it("offers an APPROVED proposal only the idempotent finish-delivery review action", () => {
    const actions = source("../../components/dashboard-today-actions.tsx");

    expect(actions).toMatch(/currentReviewState === "APPROVED"[\s\S]*?"Finish reviewed delivery"/);
    expect(actions).toContain('{currentReviewState === "DRAFT" ? (');
    expect(actions).not.toContain("Finish and skip");
  });

  it("keeps the proposal hierarchy single-column on mobile and preserves visible focus", () => {
    const css = source("../../app/dashboard/dashboard.css");

    expect(css).toMatch(
      /@media \(max-width: 800px\)[\s\S]*\.dashboard-proposal-facts,[\s\S]*\.dashboard-proposal-specifics,[\s\S]*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(
      /\.dashboard-decision-details > summary:focus-visible \{[\s\S]*outline: 2px solid var\(--cyan\);/,
    );
    expect(css).toMatch(/\.dashboard-proposal-draft,[\s\S]*overflow-x: auto;/);
    expect(css).not.toMatch(/outline:\s*none/);
  });
});

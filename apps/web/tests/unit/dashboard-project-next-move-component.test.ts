import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("dashboard project Next Move component contract", () => {
  it("uses one memory-only project-key control for initial generation and refresh", () => {
    const control = source("../../components/dashboard-refresh-control.tsx");
    const today = source("../../app/dashboard/today/page.tsx");
    const actions = source("../../components/dashboard-today-actions.tsx");
    const keyManager = source("../../components/dashboard-api-key-manager.tsx");

    expect(control).toContain("requestDashboardProjectNextMove({");
    expect(control).toContain("readDashboardProjectNextMove({");
    expect(control).toContain('type="password"');
    expect(control).toContain('autoComplete="off"');
    expect(control).toContain('setRawKey("")');
    expect(control).toContain("generation");
    expect(control).not.toMatch(/localStorage|sessionStorage|document\.cookie|console\./);

    expect(today).toContain('label="Generate next distribution content"');
    expect(today).toContain("request={refreshInput}");
    expect(today).toContain("objective: context.context.desiredOutcome");
    expect(today).toContain("preferredChannels: context.context.suitableChannels");
    expect(today).toContain("Object.entries(context.record.contentCapabilities)");
    expect(today).toContain("dashboard.pendingRequest");
    expect(today).toContain("This project is single-flight");
    expect(actions).toContain("<DashboardRefreshControl");
    expect(actions).toContain("activeRequestState");
    expect(actions).toContain("Project single-flight admission prevents");
    expect(actions).not.toContain(
      "/api/dashboard/projects/${encodeURIComponent(projectId)}/refresh",
    );
    expect(keyManager).toContain('"generation_level":"draft"');
    expect(keyManager).not.toContain('"reddit"');
  });

  it("keeps the retired member refresh route non-executing", () => {
    const retiredRoute = source("../../app/api/dashboard/projects/[projectId]/refresh/route.ts");

    expect(retiredRoute).toContain("status: 410");
    expect(retiredRoute).toContain("POST /v1/projects/{project_id}/next-move");
    expect(retiredRoute).not.toMatch(/requestProjectRefresh|runPersistedScan|after\(/);
  });
});

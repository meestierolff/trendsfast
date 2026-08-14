import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HOBBY_ENVIRONMENT_PHASE_FIELD,
  HOBBY_ENVIRONMENT_PHASES,
  HOBBY_OPS_ORIGIN,
} from "../../../scripts/hobby-environments";
import { HOBBY_SCAN_ENABLEMENT_EVIDENCE_PATH } from "../../../scripts/hobby-scan-enablement";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readOperationsDocument(name: string): string {
  return readFileSync(join(repositoryRoot, "docs/operations", name), "utf8");
}

const launchRunbook = readOperationsDocument("HOBBY_LAUNCH_2026-08-13.md");
const deploymentRunbook = readOperationsDocument("DEPLOYMENT.md");
const domainChecklist = readOperationsDocument("DOMAIN_CHECKLIST.md");
const environmentReference = readOperationsDocument("ENVIRONMENT.md");
const releaseReportTemplate = readOperationsDocument("RELEASE_REPORT_TEMPLATE.md");

describe("Hobby environment phase documentation contract", () => {
  it("documents every reviewed phase with its derived origins and scan state", () => {
    expect(launchRunbook).toContain(`\`${HOBBY_ENVIRONMENT_PHASE_FIELD}\``);

    for (const [phase, profile] of Object.entries(HOBBY_ENVIRONMENT_PHASES)) {
      const row = launchRunbook
        .split("\n")
        .find((line) => line.includes(`\`${phase}\``) && line.startsWith("|"));
      expect(row, `missing phase matrix row for ${phase}`).toBeDefined();
      expect(row).toContain(`\`${profile.publicOrigin}\``);
      expect(row).toContain(`\`${HOBBY_OPS_ORIGIN}\``);
      expect(row).toContain(`\`${profile.publicScansEnabled}\``);
    }
  });

  it("makes the marker authoritative and requires the full transition workflow", () => {
    for (const document of [
      launchRunbook,
      deploymentRunbook,
      domainChecklist,
      environmentReference,
    ]) {
      expect(document).toContain(HOBBY_ENVIRONMENT_PHASE_FIELD);
      expect(document).toContain("pnpm env:prepare-hobby");
    }

    for (const phase of ["canonical-origin-scans-off", "canonical-origin-scans-on"] as const) {
      expect(launchRunbook).toContain(`${HOBBY_ENVIRONMENT_PHASE_FIELD}=${phase}`);
      expect(deploymentRunbook).toContain(`${HOBBY_ENVIRONMENT_PHASE_FIELD}=${phase}`);
      expect(domainChecklist).toContain(`${HOBBY_ENVIRONMENT_PHASE_FIELD}=${phase}`);
    }

    for (const requiredStep of [
      "strict `--check` and `--apply`",
      "Have the founder deploy both accepted surfaces",
      "immutable public",
      "exact deployment Current",
      "stable origin",
      "application-authenticated ops",
    ]) {
      expect(launchRunbook).toContain(requiredStep);
    }

    expect(launchRunbook).toContain("never toggle `PUBLIC_SCANS_ENABLED` independently");

    for (const document of [
      launchRunbook,
      deploymentRunbook,
      domainChecklist,
      environmentReference,
    ]) {
      expect(document).toContain(HOBBY_SCAN_ENABLEMENT_EVIDENCE_PATH);
    }
    for (const requiredEvidence of [
      "accepted 40-character release SHA",
      "site-key hash",
      "public_scan",
      "founderApproved",
      "halio",
      "shipToUsers",
    ]) {
      expect(launchRunbook).toContain(requiredEvidence);
    }
  });

  it("requires release evidence for the selected phase, Hobby cron, and Turnstile matrix", () => {
    expect(releaseReportTemplate).toContain(HOBBY_ENVIRONMENT_PHASE_FIELD);
    expect(releaseReportTemplate).toContain("every enabled/disabled effect flag");
    expect(releaseReportTemplate).toContain("0 7 * * *");
    expect(releaseReportTemplate).toContain("no/wrong/correct Bearer results");

    for (const outcome of [
      "valid",
      "missing",
      "forged",
      "replayed",
      "expired",
      "wrong-action",
      "wrong-host",
    ]) {
      expect(releaseReportTemplate).toContain(outcome);
    }
  });
});

describe("canonical host redirect runbook contract", () => {
  it("records the tracked one-hop mechanism and keeps live verification open", () => {
    for (const document of [deploymentRunbook, domainChecklist]) {
      expect(document).toContain("apps/web/next.config.ts");
      expect(document).toContain("www.trendsfast.com");
      expect(document).toContain("https://trendsfast.com/:path*");
      expect(document).toContain("query");
      expect(document).toContain("ops");
    }

    expect(domainChecklist).toContain("permanent `308`");
    expect(domainChecklist).toContain("takes exactly one hop");
  });
});

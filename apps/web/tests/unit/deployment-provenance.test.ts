import { describe, expect, it } from "vitest";

import { deploymentProvenance } from "../../lib/deployment-provenance";

describe("trusted deployment provenance", () => {
  it("derives Vercel production identity only from server environment", () => {
    expect(
      deploymentProvenance({
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_SHA: "9afad5e123456789",
        VERCEL_URL: "trendsfast.example",
        VERCEL_DEPLOYMENT_ID: "deployment_123",
      }),
    ).toEqual({
      deploymentEnvironment: "production",
      releaseSha: "9afad5e123456789",
      deploymentHost: "trendsfast.example",
      deploymentId: "deployment_123",
    });
  });

  it("defaults to local without an explicit hosted production identity", () => {
    expect(deploymentProvenance({})).toEqual({
      deploymentEnvironment: "local",
      releaseSha: null,
      deploymentHost: null,
      deploymentId: null,
    });
  });
});

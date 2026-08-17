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

  it("prefers the request-time Vercel deployment ID over the embedded build fallback", () => {
    expect(
      deploymentProvenance(
        {
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_SHA: "9afad5e123456789",
          VERCEL_URL: "trendsfast.example",
          VERCEL_DEPLOYMENT_ID: "deployment_runtime",
        },
        "deployment_build",
      ).deploymentId,
    ).toBe("deployment_runtime");
  });

  it("uses the embedded build deployment ID when the request-time value is absent", () => {
    expect(
      deploymentProvenance(
        {
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_SHA: "9afad5e123456789",
          VERCEL_URL: "trendsfast.example",
        },
        "deployment_build",
      ),
    ).toEqual({
      deploymentEnvironment: "production",
      releaseSha: "9afad5e123456789",
      deploymentHost: "trendsfast.example",
      deploymentId: "deployment_build",
    });
  });

  it("keeps hosted provenance incomplete when neither deployment ID is available", () => {
    expect(
      deploymentProvenance(
        {
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_SHA: "9afad5e123456789",
          VERCEL_URL: "trendsfast.example",
        },
        "",
      ).deploymentId,
    ).toBeNull();
  });

  it("does not mask a malformed request-time deployment ID with the build fallback", () => {
    expect(
      deploymentProvenance(
        {
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_SHA: "9afad5e123456789",
          VERCEL_URL: "trendsfast.example",
          VERCEL_DEPLOYMENT_ID: " ",
        },
        "deployment_build",
      ).deploymentId,
    ).toBeNull();
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

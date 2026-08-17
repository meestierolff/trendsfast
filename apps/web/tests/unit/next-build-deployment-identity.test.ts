import { afterEach, describe, expect, it, vi } from "vitest";

const hostedEnvironment = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_SHA: "9afad5e123456789",
  VERCEL_URL: "trendsfast-build.example",
  VERCEL_DEPLOYMENT_ID: "dpl_Build123",
};

async function loadConfigWithoutAmbientVercelIdentity() {
  for (const name of Object.keys(hostedEnvironment)) vi.stubEnv(name, "");
  vi.resetModules();
  return import("../../next.config");
}

describe("hosted build deployment identity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("captures the non-secret deployment ID under a build-only name", async () => {
    const { resolveBuildOnlyDeploymentEnvironment } =
      await loadConfigWithoutAmbientVercelIdentity();
    expect(resolveBuildOnlyDeploymentEnvironment(hostedEnvironment)).toEqual({
      TRENDSFAST_BUILD_DEPLOYMENT_ID: "dpl_Build123",
    });
  });

  it.each(["VERCEL_GIT_COMMIT_SHA", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID"] as const)(
    "fails a hosted build when %s is absent",
    async (name) => {
      const { resolveBuildOnlyDeploymentEnvironment } =
        await loadConfigWithoutAmbientVercelIdentity();
      expect(() =>
        resolveBuildOnlyDeploymentEnvironment({ ...hostedEnvironment, [name]: undefined }),
      ).toThrow(/Hosted Vercel builds require clean/);
    },
  );

  it("rejects a hosted build without an exact Vercel environment", async () => {
    const { resolveBuildOnlyDeploymentEnvironment } =
      await loadConfigWithoutAmbientVercelIdentity();
    expect(() =>
      resolveBuildOnlyDeploymentEnvironment({ ...hostedEnvironment, VERCEL_ENV: undefined }),
    ).toThrow(/production or preview VERCEL_ENV/);
  });

  it("rejects whitespace-padded hosted identity values", async () => {
    const { resolveBuildOnlyDeploymentEnvironment } =
      await loadConfigWithoutAmbientVercelIdentity();
    expect(() =>
      resolveBuildOnlyDeploymentEnvironment({
        ...hostedEnvironment,
        VERCEL_DEPLOYMENT_ID: " dpl_Build123",
      }),
    ).toThrow(/Hosted Vercel builds require clean/);
  });

  it("does not require hosted system values for local development", async () => {
    const { resolveBuildOnlyDeploymentEnvironment } =
      await loadConfigWithoutAmbientVercelIdentity();
    expect(
      resolveBuildOnlyDeploymentEnvironment({ VERCEL: "1", VERCEL_ENV: "development" }),
    ).toEqual({});
    expect(resolveBuildOnlyDeploymentEnvironment({})).toEqual({});
  });

  it("wires the hosted capture into the exported Next configuration", async () => {
    for (const [name, value] of Object.entries(hostedEnvironment)) vi.stubEnv(name, value);
    vi.resetModules();

    const hostedConfig = await import("../../next.config");

    expect(hostedConfig.nextConfig.env).toEqual({
      TRENDSFAST_BUILD_DEPLOYMENT_ID: "dpl_Build123",
    });
  });

  it("refuses to load the Next configuration for a hosted build with no deployment ID", async () => {
    for (const [name, value] of Object.entries(hostedEnvironment)) vi.stubEnv(name, value);
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");
    vi.resetModules();

    await expect(import("../../next.config")).rejects.toThrow(/Hosted Vercel builds require clean/);
  });
});

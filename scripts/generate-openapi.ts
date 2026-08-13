import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createV1Api } from "../apps/web/lib/v1-api";

const unavailable = async (): Promise<never> => {
  throw new Error("OpenAPI generation never executes product operations");
};

const response = await createV1Api({
  providerCredentialMode: "fixture",
  liveApiCreationEnabled: false,
  authenticate: async () => null,
  createOrReuse: unavailable,
  createOrReuseForProject: unavailable,
  getStatus: async () => null,
}).request("/v1/openapi.json");

if (!response.ok) {
  throw new Error(`Could not generate the OpenAPI document (${response.status})`);
}

const outputDirectory = resolve("openapi");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  resolve(outputDirectory, "openapi.json"),
  `${JSON.stringify(await response.json(), null, 2)}\n`,
  { encoding: "utf8", mode: 0o644 },
);

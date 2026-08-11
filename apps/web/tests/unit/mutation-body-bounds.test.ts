import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getRepositories, resolveReadyScanIdentity } = vi.hoisted(() => {
  return {
    getRepositories: vi.fn(() => {
      throw new Error("The database must not be reached for an oversized request");
    }),
    resolveReadyScanIdentity: vi.fn(() => {
      throw new Error("Private token resolution must not run for an oversized request");
    }),
  };
});

vi.mock("../../lib/server-database", () => ({ getRepositories }));
vi.mock("../../lib/scan-view-service", () => ({ resolveReadyScanIdentity }));
vi.mock("../../lib/scan-processing", () => ({ runPersistedScan: vi.fn() }));

import { createCsrfToken, issueOpsSession } from "../../lib/ops-session";
import { POST as postOpsAction } from "../../app/api/ops/scans/[scanId]/actions/[action]/route";
import { POST as postOpsSession } from "../../app/api/ops/session/route";
import { POST as postFeedback } from "../../app/api/scans/[token]/feedback/route";
import { POST as postShareConsent } from "../../app/api/scans/[token]/share-consent/route";

const origin = process.env.APP_URL ?? "http://localhost:3000";
const sessionSecret = "mutation-body-test-secret-at-least-32-characters";

function streamedRequest(input: {
  path: string;
  prefix: string;
  paddingBytes: number;
  suffix?: string;
  contentType: string;
  contentLength?: string;
  headers?: Record<string, string>;
}): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input.prefix));
      controller.enqueue(encoder.encode("x".repeat(input.paddingBytes)));
      if (input.suffix) controller.enqueue(encoder.encode(input.suffix));
      controller.close();
    },
  });
  return new Request(`${origin}${input.path}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": input.contentType,
      ...(input.contentLength === undefined ? {} : { "content-length": input.contentLength }),
      ...input.headers,
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

afterEach(() => {
  vi.unstubAllEnvs();
  getRepositories.mockClear();
  resolveReadyScanIdentity.mockClear();
});

describe("mutation route actual-byte bounds", () => {
  it.each([
    { label: "missing", contentLength: undefined },
    { label: "understated", contentLength: "1" },
  ])(
    "bounds unauthenticated ops JSON with $label Content-Length",
    async ({ label, contentLength }) => {
      const response = await postOpsSession(
        streamedRequest({
          path: "/api/ops/session",
          prefix: '{"token":"',
          paddingBytes: 5_000,
          suffix: '"}',
          contentType: "application/json",
          ...(contentLength === undefined ? {} : { contentLength }),
          headers: { "x-forwarded-for": label === "missing" ? "203.0.113.10" : "203.0.113.11" },
        }),
      );
      expect(response.status).toBe(413);
    },
  );

  it.each([
    { label: "missing", contentLength: undefined },
    { label: "understated", contentLength: "1" },
  ])(
    "bounds unauthenticated ops form data with $label Content-Length",
    async ({ contentLength }) => {
      const response = await postOpsSession(
        streamedRequest({
          path: "/api/ops/session",
          prefix: "_method=delete&padding=",
          paddingBytes: 5_000,
          contentType: "application/x-www-form-urlencoded",
          ...(contentLength === undefined ? {} : { contentLength }),
        }),
      );
      expect(response.status).toBe(413);
    },
  );

  it.each([
    { label: "missing", contentLength: undefined },
    { label: "understated", contentLength: "1" },
  ])("bounds private feedback JSON with $label Content-Length", async ({ contentLength }) => {
    const response = await postFeedback(
      streamedRequest({
        path: "/api/scans/private-token/feedback",
        prefix: '{"kind":"USEFUL","padding":"',
        paddingBytes: 9_000,
        suffix: '"}',
        contentType: "application/json",
        ...(contentLength === undefined ? {} : { contentLength }),
      }),
      { params: Promise.resolve({ token: "private-token" }) },
    );
    expect(response.status).toBe(413);
    expect(resolveReadyScanIdentity).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing", contentLength: undefined },
    { label: "understated", contentLength: "1" },
  ])("bounds private consent form data with $label Content-Length", async ({ contentLength }) => {
    const response = await postShareConsent(
      streamedRequest({
        path: "/api/scans/private-token/share-consent",
        prefix: "consent=true&padding=",
        paddingBytes: 9_000,
        contentType: "application/x-www-form-urlencoded",
        ...(contentLength === undefined ? {} : { contentLength }),
      }),
      { params: Promise.resolve({ token: "private-token" }) },
    );
    expect(response.status).toBe(413);
    expect(resolveReadyScanIdentity).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing", contentLength: undefined },
    { label: "understated", contentLength: "1" },
  ])("bounds authenticated ops actions with $label Content-Length", async ({ contentLength }) => {
    vi.stubEnv("APP_URL", origin);
    vi.stubEnv("SESSION_SECRET", sessionSecret);
    const session = issueOpsSession({ secret: sessionSecret });
    const response = await postOpsAction(
      streamedRequest({
        path: "/api/ops/scans/scan_1/actions/approve",
        prefix: '{"note":"',
        paddingBytes: 17_000,
        suffix: '"}',
        contentType: "application/json",
        ...(contentLength === undefined ? {} : { contentLength }),
        headers: {
          cookie: `tf_ops_session=${session}`,
          "x-csrf-token": createCsrfToken(session, sessionSecret),
        },
      }),
      { params: Promise.resolve({ scanId: "scan_1", action: "approve" }) },
    );
    expect(response.status).toBe(413);
    expect(getRepositories).not.toHaveBeenCalled();
  });
});
